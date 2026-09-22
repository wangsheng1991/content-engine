// Publish a topic's long-form article to Dev.to.
//
// Dev.to belongs with Bluesky in the small set of platforms that need no developer application:
// one API key generated from the account's own settings is the whole credential, there is no app
// review, and the key can be revoked by the person who owns the account. That is why it comes
// second, right after Bluesky: X, Instagram, TikTok, YouTube and Reddit all require an
// application registered with the platform before any tool may post on the owner's behalf.
//
// Two things make it a good fit for this content rather than just a place to cross-post:
//
//   * `canonical_url` tells Dev.to that the article was published here first, so the search
//     engines credit the site instead of treating the copy as duplicate content.
//   * The body is the same compiled markdown the site publishes — including the evidence list and
//     the call to action already tagged with `?ref=<slug>` — so the copy on Dev.to cannot drift
//     from the copy on the site.
//
// The transport is curl, for the same reason every other publisher here uses it: nothing else on
// this machine honours the ambient proxy, and the platform's own toolchain is not installable.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { englishCoverOf, coverOf } from './images.mjs';
import { loadTopic } from './topic.mjs';
import { joinUrl } from './util.mjs';

const API = 'https://dev.to/api';

/** Dev.to accepts at most four tags, each lowercase alphanumeric and at most 30 characters. */
export const TAG_LIMIT = 4;
export const TAG_MAX = 30;
/** The API rejects a body longer than 100 000 characters. */
export const BODY_MAX = 100000;

function curlJson(url, { method = 'GET', body, apiKey, timeout = 90 } = {}) {
  const args = ['-sS', '-X', method, '--noproxy', '127.0.0.1,localhost', '--max-time', String(timeout)];
  if (apiKey) args.push('-H', `api-key: ${apiKey}`);
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body));
  args.push('-w', '\n__HTTP__%{http_code}', url);

  let out;
  try {
    out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`无法连接 dev.to：${String(error.message).split('\n')[0]}`);
  }
  const split = out.lastIndexOf('\n__HTTP__');
  if (split === -1) throw new Error('dev.to 没有返回可解析的响应');
  const status = Number(out.slice(split + 9).trim());
  const text = out.slice(0, split);
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status, json, text };
}

/**
 * Dev.to's tag rules, applied rather than hoped for: lowercase, letters and digits only, no
 * duplicates, at most four, none longer than 30 characters. "3D vision" is not a legal tag; "3d"
 * and "vision" are, so a topic with prose-like tags still publishes instead of failing on a 422.
 */
export function devtoTags(tags = [], { limit = TAG_LIMIT } = {}) {
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    const tag = String(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!tag || tag.length > TAG_MAX || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length === limit) break;
  }
  return out;
}

/**
 * The article's own page on the site: the canonical URL this copy points back to. Deliberately
 * WITHOUT `?ref=` — the site's own pages declare their untagged URL as canonical, and a copy whose
 * canonical disagrees with the original's is a copy the search engines may treat as original.
 * Attribution does not suffer: the call to action inside the body keeps its `?ref=<slug>`.
 */
export function canonicalUrl(slug, config) {
  return `${joinUrl(config?.site?.baseUrl ?? '', 'blog', slug)}/`;
}

/**
 * Rewrite topic-relative image paths to the site's absolute asset URLs. The article's own copy of
 * `assets/photo.png` resolves on the site (the build expands it) and silently 404s everywhere else,
 * so a cross-post needs the URL the reader's browser can actually fetch.
 */
export function absolutizeAssets(markdown, slug, config) {
  const base = `${joinUrl(config?.site?.baseUrl ?? '', 'assets', slug)}/`;
  return String(markdown ?? '')
    .replace(/(\]\()assets\//g, `$1${base}`)
    .replace(/(\bsrc=")assets\//g, `$1${base}`);
}

/** The site's copy of the article, front matter removed — Dev.to takes body markdown, not a file. */
export function stripFrontMatter(markdown) {
  const text = String(markdown ?? '');
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (match ? text.slice(match[0].length) : text).replace(/^\s*\n/, '');
}

/** `blog/<slug>.md` → `<slug>`. The extension is dropped: `blog/a.md` is the topic `a`, not `a.md`. */
export function slugFromArtifact(filePath) {
  return String(filePath).replace(/^.*\//, '').replace(/\.md$/, '');
}

/** Which compiled articles to ship: the tier-A `blog/<slug>.md` artifacts. */
export function devtoArtifacts(manifest, slugs) {
  return (manifest?.artifacts ?? []).filter((a) => {
    if (a.kind !== 'blog' || !String(a.path).endsWith('.md')) return false;
    if (!slugs?.length) return true;
    return slugs.includes(slugFromArtifact(a.path));
  });
}

/**
 * One topic's article, ready for the API. The caller supplies the compiled markdown, so what is
 * sent cannot differ from what the site serves.
 */
export function composeArticle({ slug, source, markdown, config, coverUrl }) {
  const title = String(source?.platforms?.devto?.title ?? source?.title ?? slug).trim();
  if (!title) throw new Error(`${slug}: 文章没有标题`);
  const body = absolutizeAssets(stripFrontMatter(markdown), slug, config);
  if (!body.trim()) throw new Error(`${slug}: 文章是空的 —— 先 content build`);
  if (body.length > BODY_MAX) throw new Error(`${slug}: 正文 ${body.length} 字符，超过 Dev.to 的 ${BODY_MAX} 上限`);
  const description = oneLine(source?.summary ?? '').slice(0, 200);
  return {
    title,
    body_markdown: body,
    published: true,
    canonical_url: canonicalUrl(slug, config),
    ...(description ? { description } : {}),
    // Dev.to re-hosts the image off this absolute URL, so the site has to be deployed first —
    // which is the order `content publish` already uses: git push, then the platform call.
    ...(coverUrl ? { cover_image: coverUrl } : {}),
    // `platforms.devto.tags` wins when present: a Chinese topic's own tags are not legal Dev.to
    // tags at all (lowercase ASCII only), so without an override they publish as an empty list.
    tags: devtoTags(source?.platforms?.devto?.tags ?? source?.tags ?? []),
  };
}

function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * The cover to hand Dev.to: the English card when one exists, the Chinese one otherwise. Dev.to's
 * audience reads English, so a Chinese card would be a published cover nobody can read.
 */
export function coverUrlOf(topic, config) {
  const cover = englishCoverOf(topic) ?? coverOf(topic);
  if (!cover) return undefined;
  return `${joinUrl(config?.site?.baseUrl ?? '', 'assets', topic.slug)}/${cover.rel}`;
}

/** Read the article back from the public API: a write that cannot be seen is not a publish. */
function readBack(id, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { status, json } = curlJson(`${API}/articles/${id}`, { timeout: 30 });
    if (status === 200 && json?.id === id) return { verified: true, url: json.url, canonical: json.canonical_url ?? null };
    if (attempt < attempts) execFileSync('sleep', ['2']);
  }
  return { verified: false, reason: '公开接口还读不到这篇文章（可能只是索引慢）' };
}

/**
 * Publish one or more topics. `--dry-run` prints exactly what would be sent and contacts nothing,
 * which is how the title and the tags get reviewed before they are public.
 */
export function devtoPublish({ root, config, manifest, slugs, apiKey, draft = false, dryRun = false, log = console.log }) {
  if (!dryRun && !apiKey) {
    throw new Error('缺少凭证 —— 把 DEVTO_API_KEY 放进 vault 或环境变量后重试');
  }
  const artifacts = devtoArtifacts(manifest, slugs);
  if (!artifacts.length) {
    throw new Error(slugs?.length
      ? `没有编译好的文章可发：${slugs.join(', ')} —— 先跑 content build`
      : '构建清单里没有文章产物 —— 先跑 content build');
  }

  const prepared = artifacts.map((artifact) => {
    const slug = slugFromArtifact(artifact.path);
    const topic = loadTopic(root, slug, { topicsDir: config.paths?.topics });
    const outDir = path.isAbsolute(config.paths.out) ? config.paths.out : path.join(root, config.paths.out);
    const markdown = fs.readFileSync(path.join(outDir, artifact.path), 'utf8');
    const article = composeArticle({ slug, source: topic.source, markdown, config, coverUrl: coverUrlOf(topic, config) });
    return { slug, article: draft ? { ...article, published: false } : article };
  });

  if (dryRun) {
    for (const { slug, article } of prepared) {
      log(`\n${slug} （${article.tags.length} 个标签，正文 ${article.body_markdown.length} 字符）`);
      log('─'.repeat(60));
      log(`title:     ${article.title}`);
      log(`tags:      ${article.tags.join(', ') || '（无）'}`);
      log(`canonical: ${article.canonical_url}`);
      if (article.cover_image) log(`cover:     ${article.cover_image}`);
      log(`published: ${article.published}`);
      log('─'.repeat(60));
      log(article.body_markdown.split('\n').slice(0, 12).join('\n'));
      log('…');
    }
    log('\ndry-run：未联系 Dev.to，未发布。');
    return { results: prepared.map(({ slug }) => ({ slug, dryRun: true })), ok: true };
  }

  const results = [];
  for (const { slug, article } of prepared) {
    const { status, json } = curlJson(`${API}/articles`, { method: 'POST', apiKey, body: { article } });
    if (status !== 201 || !json?.id) {
      const detail = String(json?.error ?? json?.message ?? json?.errors?.[0] ?? '').slice(0, 200);
      log(`  ! 发布失败（HTTP ${status}）：${detail}`);
      results.push({ slug, published: false, status });
      continue;
    }
    const check = readBack(json.id);
    log(check.verified ? `  ✓ 已发布并回读确认：${check.url}` : `  ! ${check.reason}`);
    results.push({ slug, published: true, id: json.id, ...check });
  }

  const ok = results.every((r) => r.published && r.verified);
  log('');
  log(ok ? `Dev.to 发布完成：${results.length} 篇` : 'Dev.to 发布未全部通过回读确认');
  return { results, ok };
}
