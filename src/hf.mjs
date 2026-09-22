// Publish the tier-A Hugging Face card to the Hub.
//
// Hugging Face is one of the two anchors of the growth plan — GitHub holds the
// code, the Hub holds the card and, later, the weights and evaluation sets. This
// is the only step that was ever blocked on a credential rather than on code, so
// it lives in its own module: everything it needs is a token and a repo name.
//
// curl is the transport, for the same reason the verifier uses it: it honours the
// ambient proxy, and the platform's own toolchain is not installable here.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './util.mjs';

const API = 'https://huggingface.co';

function curl(args, { timeout = 120 } = {}) {
  const out = execFileSync('curl', ['-sS', '-L', '--noproxy', '127.0.0.1,localhost', '--max-time', String(timeout), ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const split = out.lastIndexOf('\n__HTTP__');
  if (split === -1) return { status: 0, body: out };
  return { status: Number(out.slice(split + 9).trim()), body: out.slice(0, split) };
}

/** The repo a topic's card belongs to: an explicit hf_repo wins, else owner/slug. */
export function resolveHfTarget(slug, source, config) {
  const hf = config?.huggingface ?? {};
  const explicit = source?.hf_repo;
  if (explicit) return String(explicit);
  const owner = hf.owner;
  if (!owner) {
    throw new Error('no Hugging Face owner configured — set "huggingface.owner" in content.config.json or add hf_repo to source.yaml');
  }
  return `${owner}/${slug}`;
}

/** Which card artifacts to ship: tier A "huggingface" entries, optionally one topic. */
export function hfArtifacts(manifest, slugs) {
  return manifest.artifacts.filter((a) => {
    if (a.kind !== 'huggingface') return false;
    if (!slugs?.length) return true;
    return slugs.some((slug) => a.path.startsWith(`huggingface/${slug}/`));
  });
}

/** The login behind the token — needed to tell a personal namespace from an org. */
function tokenLogin(token) {
  const { status, body } = curl(['-H', `Authorization: Bearer ${token}`, `${API}/api/whoami-v2`, '-w', '\n__HTTP__%{http_code}'], { timeout: 40 });
  if (status !== 200) throw new Error(`无法读取 token 身份（HTTP ${status}）——检查 HF_TOKEN 是否有效`);
  return JSON.parse(body).name;
}

function ensureRepo(repo, { type, isPrivate, token, login, log }) {
  // The create endpoint takes the bare name and the namespace separately: passing
  // "owner/name" as `name` is rejected as an illegal character.
  const parts = String(repo).split('/');
  const name = parts.pop();
  const owner = parts.pop();
  const payload = { type, name, private: isPrivate };
  if (owner && owner !== login) payload.organization = owner;

  const { status, body } = curl([
    '-X', 'POST', `${API}/api/repos/create`,
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify(payload),
    '-w', '\n__HTTP__%{http_code}',
  ]);
  if (status === 200) {
    log(`  已创建 ${type} 仓库：${repo}${isPrivate ? '（私有）' : ''}`);
    return { created: true };
  }
  if (status === 409 || /already exist/i.test(body)) {
    log(`  仓库已存在：${repo}`);
    return { created: false };
  }
  throw new Error(`创建仓库失败（HTTP ${status}）：${body.slice(0, 300)}`);
}

function commitFile(repo, { type, filePath, content, summary, token }) {
  const prefix = type === 'dataset' ? '/api/datasets' : '/api/models';
  const ndjson = [
    JSON.stringify({ key: 'header', value: { summary } }),
    JSON.stringify({ key: 'file', value: { path: filePath, content: Buffer.from(content).toString('base64'), encoding: 'base64' } }),
  ].join('\n');
  const tmp = path.join(fs.mkdtempSync('/tmp/hf-'), 'commit.ndjson');
  fs.writeFileSync(tmp, `${ndjson}\n`);
  const { status, body } = curl([
    '-X', 'POST', `${API}${prefix}/${repo}/commit/main`,
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Content-Type: application/x-ndjson',
    '--data-binary', `@${tmp}`,
    '-w', '\n__HTTP__%{http_code}',
  ]);
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  if (status !== 200) throw new Error(`上传 ${filePath} 失败（HTTP ${status}）：${body.slice(0, 300)}`);
  return JSON.parse(body);
}

/** Read the file back and compare digests; a publish that cannot be read is not a publish. */
function readBack(repo, { type, filePath, token, expected }) {
  const prefix = type === 'dataset' ? '/datasets' : '';
  const url = `${API}${prefix}/${repo}/raw/main/${filePath}`;
  const { status, body } = curl(['-H', `Authorization: Bearer ${token}`, url, '-w', '\n__HTTP__%{http_code}'], { timeout: 60 });
  if (status !== 200) return { verified: false, reason: `回读失败 HTTP ${status}` };
  const remote = sha256(body);
  return remote === expected
    ? { verified: true, bytes: Buffer.byteLength(body) }
    : { verified: false, reason: `回读内容不一致（远端 ${remote.slice(0, 12)} ≠ 本地 ${expected.slice(0, 12)}）` };
}

/**
 * Upload every selected card. Never logs the token, and never claims success
 * without reading the file back.
 */
export function hfPublish({ root, config, manifest, slugs, repoOverride, isPrivate, token, dryRun = false, log = console.log }) {
  if (!token && !dryRun) throw new Error('missing HF_TOKEN — add it to the agent key vault, then retry');
  const hf = config?.huggingface ?? {};
  const type = hf.type ?? 'dataset';
  const artifacts = hfArtifacts(manifest, slugs);
  if (!artifacts.length) throw new Error('no huggingface artifacts in the build — run "content build" first');

  const results = [];
  const login = dryRun ? null : tokenLogin(token);
  for (const artifact of artifacts) {
    const slug = artifact.path.split('/')[1];
    const sourceFile = path.join(root, config.paths.topics, slug, 'source.yaml');
    const source = fs.existsSync(sourceFile) ? { hf_repo: readHfRepo(sourceFile) } : {};
    const repo = repoOverride ?? resolveHfTarget(slug, source, config);
    const file = path.join(root, config.paths.out, artifact.path);
    const content = fs.readFileSync(file);
    const summary = `content-engine: publish ${slug} card`;

    log(`${slug} → ${repo} (${type}${isPrivate ? ', private' : ', public'})`);
    if (dryRun) {
      log(`  dry-run：将上传 ${artifact.path}（${content.length}B），未执行`);
      results.push({ slug, repo, dryRun: true });
      continue;
    }
    ensureRepo(repo, { type, isPrivate, token, login, log });
    const commit = commitFile(repo, { type, filePath: 'README.md', content, summary, token });
    log(`  已提交 ${commit.commitOid?.slice(0, 10)}`);
    const check = readBack(repo, { type, filePath: 'README.md', token, expected: sha256(content) });
    log(check.verified ? `  ✓ 回读一致（${check.bytes}B）` : `  ! ${check.reason}`);
    results.push({ slug, repo, commit: commit.commitOid, url: commit.commitUrl, ...check });
  }
  const ok = results.every((r) => r.dryRun || r.verified);
  log('');
  log(ok ? `HF 发布完成：${results.length} 张卡片` : 'HF 发布未全部通过回读校验');
  return { results, ok };
}

/** Minimal scrape of `hf_repo:` from source.yaml — no need to load the whole topic. */
function readHfRepo(file) {
  const match = fs.readFileSync(file, 'utf8').match(/^hf_repo:\s*["']?([^"'\n]+)["']?\s*$/m);
  return match ? match[1].trim() : null;
}
