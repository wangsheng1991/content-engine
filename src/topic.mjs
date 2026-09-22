// Topic loading: one directory under `topics/` is the single source of truth.
import path from 'node:path';
import { exists, listDirs, readJson, readTextIfExists } from './util.mjs';
import { parseYaml } from './yaml.mjs';

export function listTopicSlugs(root, topicsDir = 'topics') {
  return listDirs(path.join(root, topicsDir));
}

/** Load and validate every文件 that makes up a topic. Throws on broken content. */
export function loadTopic(root, slug, { topicsDir = 'topics' } = {}) {
  const dir = path.join(root, topicsDir, slug);
  if (!exists(dir)) throw new Error(`topic not found: ${dir}`);

  const sourceRaw = readTextIfExists(path.join(dir, 'source.yaml'));
  if (!sourceRaw) throw new Error(`${slug}: source.yaml is required`);
  const source = parseYaml(sourceRaw, { file: `${slug}/source.yaml` });
  validateSource(slug, source);

  const ctaRaw = readTextIfExists(path.join(dir, 'cta.yaml'));
  const cta = ctaRaw ? parseYaml(ctaRaw, { file: `${slug}/cta.yaml` }) : null;

  const evidenceRaw = readTextIfExists(path.join(dir, 'evidence.json'));
  const evidence = evidenceRaw ? readJson(path.join(dir, 'evidence.json')) : { topic: slug, claims: [] };
  validateEvidence(slug, evidence);

  const videoRaw = readTextIfExists(path.join(dir, 'video.yaml'));
  const video = videoRaw ? parseYaml(videoRaw, { file: `${slug}/video.yaml` }) : null;

  return {
    slug,
    dir,
    source,
    cta,
    evidence,
    video,
    article: readTextIfExists(path.join(dir, 'article.md')),
    // The English long-form body, when the topic has one. Dev.to is an English platform, and an
    // English title over a Chinese body is the worst of both: it promises a read the copy cannot
    // deliver. Its presence is what creates the /en/ routes — nothing is translated automatically.
    article_en: readTextIfExists(path.join(dir, 'article.en.md')),
    readme: readTextIfExists(path.join(dir, 'README.md')),
    slides: readTextIfExists(path.join(dir, 'slides.md')),
    assetsDir: path.join(dir, 'assets'),
    files: {
      source: path.join(dir, 'source.yaml'),
      cta: path.join(dir, 'cta.yaml'),
      evidence: path.join(dir, 'evidence.json'),
      video: path.join(dir, 'video.yaml'),
    },
  };
}

function validateSource(slug, source) {
  const problems = [];
  if (!source.title) problems.push('title');
  if (!source.summary) problems.push('summary');
  if (source.slug && source.slug !== slug) problems.push(`slug mismatch (source.yaml says "${source.slug}")`);
  for (const key of ['key_facts', 'links', 'tags']) {
    const value = source[key];
    if (value !== undefined && value !== null && !Array.isArray(value)) problems.push(`${key} must be a list`);
  }
  if (problems.length) throw new Error(`${slug}/source.yaml: missing or invalid ${problems.join(', ')}`);
}

function validateEvidence(slug, evidence) {
  if (!Array.isArray(evidence?.claims)) throw new Error(`${slug}/evidence.json: "claims" must be a list`);
  evidence.claims.forEach((claim, index) => {
    for (const key of ['id', 'claim', 'source']) {
      if (!claim?.[key]) throw new Error(`${slug}/evidence.json: claim #${index + 1} is missing "${key}"`);
    }
  });
}
