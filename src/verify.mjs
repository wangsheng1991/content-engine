// The quality gate: a topic may only be published when every claim it makes is
// backed by a quote that really exists in the source it names.
//
// Why this exists as code rather than as a rule in a document: the whole point of
// the engine is to turn one sentence into published content quickly, and at that
// speed nobody re-reads the sources. The cheap way to be fast and still be right
// is to let a machine refuse the claim. The expensive way is to publish a number
// that turns out to be invented.
//
// Structural checks always run and need no network. The verbatim re-check needs
// the sources to be reachable, and this machine's route to them is intermittent,
// so it is opt-in: an unreachable source is reported as `unreachable`, never
// silently as a pass. `--strict` turns that into a failure for CI, where the
// network is expected to be up.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { exists, readJson, readTextIfExists } from './util.mjs';
import { parseYaml } from './yaml.mjs';
import { listTopicSlugs } from './topic.mjs';

const MIN_CLAIM = 12;
const MIN_QUOTE = 20;

/** Collapse whitespace so a quote can be compared against wrapped source text. */
function normalize(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** Strip markup and entities down to comparable prose. */
export function toComparableText(body) {
  return normalize(
    String(body ?? '')
      .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'"),
  );
}

/**
 * Fetch a source with curl. Node's own fetch ignores the ambient proxy here and
 * the direct route is blocked, so curl — which honours HTTPS_PROXY — is the
 * fetcher that actually reaches these hosts.
 */
function fetchSource(url, { timeout = 25, retries = 2 } = {}) {
  // --noproxy keeps loopback out of the ambient proxy: this machine has
  // HTTP_PROXY set, and a request to 127.0.0.1 has no business going through it.
  const args = ['-sS', '-L', '--noproxy', '127.0.0.1,localhost', '--max-time', String(timeout), '--compressed', url];
  let lastError = 'unknown error';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return { body: execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (error) {
      lastError = String(error.stderr || error.message).split('\n').filter(Boolean).pop() ?? error.message;
    }
  }
  return { body: null, error: lastError };
}

function checkStructure(slug, topic) {
  const problems = [];
  const warnings = [];
  const { source, cta, evidence } = topic;

  for (const key of ['kind', 'date']) {
    if (!source?.[key]) warnings.push(`source.yaml: "${key}" is missing — RSS and platform posts read it`);
  }
  if (!cta) problems.push('cta.yaml is missing — the topic has no conversion endpoint');
  else {
    if (!cta.url) problems.push('cta.yaml: "url" is missing');
    if (!cta.label) problems.push('cta.yaml: "label" is missing');
    if (cta.url && !/^https?:\/\//.test(String(cta.url))) problems.push(`cta.yaml: url is not absolute (${cta.url})`);
  }

  const claims = Array.isArray(evidence?.claims) ? evidence.claims : [];
  if (!claims.length) problems.push('evidence.json: no claims — nothing here is backed by a source');
  if (evidence?.topic && evidence.topic !== slug) {
    warnings.push(`evidence.json: topic is "${evidence.topic}" but the directory is "${slug}"`);
  }
  if (!evidence?.checked_at) warnings.push('evidence.json: "checked_at" is missing — staleness is invisible');

  const seen = new Set();
  claims.forEach((claim, index) => {
    const at = `evidence.json claim #${index + 1}${claim?.id ? ` (${claim.id})` : ''}`;
    if (!claim?.quote) {
      problems.push(`${at}: no "quote" — a claim without a quote is an assertion, not evidence`);
      return;
    }
    if (normalize(claim.quote).length < MIN_QUOTE) problems.push(`${at}: quote is too short to be evidence`);
    if (normalize(claim.claim).length < MIN_CLAIM) problems.push(`${at}: claim text is too short to check`);
    if (!/^https?:\/\//.test(String(claim.source ?? ''))) problems.push(`${at}: source is not an absolute URL`);
    if (seen.has(claim.id)) problems.push(`${at}: duplicate id "${claim.id}"`);
    seen.add(claim.id);
    if (claim.verified === false) warnings.push(`${at}: marked verified:false — resolve or drop it before publishing`);
  });

  return { problems, warnings, claims };
}

function checkOnline(claims, { timeout, retries, log }) {
  const byUrl = new Map();
  for (const claim of claims) {
    const url = String(claim?.source ?? '');
    if (!/^https?:\/\//.test(url)) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(claim);
  }

  const statuses = [];
  for (const [url, group] of byUrl) {
    log(`  取源 ${url}`);
    const { body, error } = fetchSource(url, { timeout, retries });
    const haystack = body === null ? null : toComparableText(body);
    for (const claim of group) {
      if (haystack === null) {
        statuses.push({ id: claim.id, url, status: 'unreachable', detail: error });
        continue;
      }
      const needle = normalize(claim.quote);
      statuses.push(haystack.includes(needle)
        ? { id: claim.id, url, status: 'verbatim' }
        : { id: claim.id, url, status: 'quote-not-found' });
    }
  }
  return statuses;
}

/**
 * Verify one topic. Returns a report; never throws on a bad topic — the caller
 * decides what a failure means.
 */
export function verifyTopic(root, slug, {
  topicsDir = 'topics',
  online = false,
  strict = false,
  timeout = 25,
  retries = 2,
  log = () => {},
} = {}) {
  const dir = path.join(root, topicsDir, slug);
  const report = { slug, problems: [], warnings: [], claims: [], checked: 0, verbatim: 0, unreachable: 0, mismatched: 0 };

  if (!exists(path.join(dir, 'source.yaml'))) {
    report.problems.push(`${slug}: no source.yaml`);
    return report;
  }

  const source = parseYaml(readTextIfExists(path.join(dir, 'source.yaml')), { file: `${slug}/source.yaml` });
  const ctaRaw = readTextIfExists(path.join(dir, 'cta.yaml'));
  const cta = ctaRaw ? parseYaml(ctaRaw, { file: `${slug}/cta.yaml` }) : null;
  const evidenceFile = path.join(dir, 'evidence.json');
  const evidence = exists(evidenceFile) ? readJson(evidenceFile) : { topic: slug, claims: [] };

  const { problems, warnings, claims } = checkStructure(slug, { source, cta, evidence });
  report.problems.push(...problems);
  report.warnings.push(...warnings);
  report.claims = claims.map((c) => ({ id: c.id, quote: normalize(c.quote).slice(0, 60) }));
  report.checked = claims.length;

  if (online && claims.length) {
    report.verbatimOf = checkOnline(claims, { timeout, retries, log });
    report.verbatim = report.verbatimOf.filter((s) => s.status === 'verbatim').length;
    report.unreachable = report.verbatimOf.filter((s) => s.status === 'unreachable').length;
    report.mismatched = report.verbatimOf.filter((s) => s.status === 'quote-not-found').length;
    for (const s of report.verbatimOf) {
      if (s.status === 'quote-not-found') report.problems.push(`${s.id}: quote not found in ${s.url}`);
      if (s.status === 'unreachable' && strict) report.problems.push(`${s.id}: source unreachable (${s.detail})`);
      if (s.status === 'unreachable' && !strict) report.warnings.push(`${s.id}: source unreachable — not re-checked (${s.detail})`);
    }
  }

  report.ok = report.problems.length === 0;
  return report;
}

export function verifyAll(root, { topicsDir = 'topics', slugs, ...options } = {}) {
  const list = slugs?.length ? slugs : listTopicSlugs(root, topicsDir);
  const reports = list.map((slug) => verifyTopic(root, slug, { topicsDir, ...options }));
  return { reports, ok: reports.every((r) => r.ok) };
}
