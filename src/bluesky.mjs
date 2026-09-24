// Publish a topic's short post to Bluesky.
//
// Bluesky is first because it is the only platform in this set that needs no developer app: an app
// password is created in the account's own settings and the official AT Protocol endpoint takes it
// directly. Every other platform in the plan — X, Instagram, TikTok, YouTube, Pinterest, Reddit —
// requires an application registered with that platform before any tool may post, and on a
// self-hosted scheduler that registration falls to whoever runs the instance.
//
// So this is the same shape as the Hugging Face publisher, deliberately: curl for transport
// (nothing else on this machine honours the ambient proxy), the credential read from the
// environment and never printed, and a post that cannot be read back is not reported as published.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { loadTopic } from './topic.mjs';
import { isPlainObject, joinUrl } from './util.mjs';

/** Reads are public and need no credential; writes go to the account's own PDS. */
const APPVIEW = 'https://public.api.bsky.app';
const DEFAULT_PDS = 'https://bsky.social';

/** Bluesky counts grapheme clusters, not bytes — an emoji is one character, not four. */
export const POST_LIMIT = 300;

/** Four images per post, none over a megabyte: the account's own limits, not a preference. */
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 1_000_000;

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

const SEGMENTER = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function graphemeLength(text) {
  return [...SEGMENTER.segment(text)].length;
}

function curlJson(url, { method = 'GET', body, token, timeout = 60 } = {}) {
  const args = ['-sS', '-X', method, '--noproxy', '127.0.0.1,localhost', '--max-time', String(timeout)];
  if (token) args.push('-H', `Authorization: Bearer ${token}`);
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body));
  args.push('-w', '\n__HTTP__%{http_code}', url);

  let out;
  try {
    out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`无法连接 ${new URL(url).host}：${String(error.message).split('\n')[0]}`);
  }
  const split = out.lastIndexOf('\n__HTTP__');
  if (split === -1) throw new Error(`${new URL(url).host} 没有返回可解析的响应`);
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

/** Never includes the message body of a failed login — it can echo the password back. */
export function createSession({ identifier, password, pds = DEFAULT_PDS }) {  if (!identifier || !password) throw new Error('missing BLUESKY_HANDLE / BLUESKY_APP_PASSWORD');
  const { status, json } = curlJson(`${pds}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    body: { identifier, password },
  });
  if (status !== 200 || !json?.accessJwt) {
    throw new Error(`Bluesky 登录失败（HTTP ${status}）—— 检查 handle 与 app password`);
  }
  return { accessJwt: json.accessJwt, did: json.did, handle: json.handle };
}

/**
 * Upload one image and return the blob reference the record points at.
 *
 * Bytes go in as the request body, which is the one place curlJson cannot be reused: it serialises
 * a JSON object and this is a JPEG. The response body of a failure can be large, so only the first
 * part of it is kept for the message.
 */
export function uploadBlob({ session, bytes, mime, pds = DEFAULT_PDS, timeout = 120 }) {
  const args = [
    '-sS', '-X', 'POST', '--noproxy', '127.0.0.1,localhost', '--max-time', String(timeout),
    '-H', `Authorization: Bearer ${session.accessJwt}`,
    '-H', `Content-Type: ${mime}`,
    '--data-binary', '@-',
    '-w', '\n__HTTP__%{http_code}',
    `${pds}/xrpc/com.atproto.repo.uploadBlob`,
  ];
  let out;
  try {
    out = execFileSync('curl', args, { input: bytes, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`上传图片失败：${String(error.message).split('\n')[0]}`);
  }
  const split = out.lastIndexOf('\n__HTTP__');
  if (split === -1) throw new Error('上传图片时 PDS 没有返回可解析的响应');
  const status = Number(out.slice(split + 9).trim());
  let json = null;
  try {
    json = JSON.parse(out.slice(0, split) || 'null');
  } catch {
    json = null;
  }
  if (status !== 200 || !json?.blob) {
    throw new Error(`上传图片失败（HTTP ${status}）：${String(json?.message ?? '').slice(0, 200)}`);
  }
  return json.blob;
}

/** The public page for a topic: what the post should send people to. */
export function topicLink(slug, config) {
  return `${joinUrl(config?.site?.baseUrl ?? '', 'topics', slug)}/`;
}

/**
 * The Bluesky posts a topic carries.
 *
 * One by default, from `platforms.bluesky.text`. A topic with more to say — the announcement, then
 * the demo on its own — writes `platforms.bluesky.posts` instead, and each entry needs an id that
 * is stable across runs, because that id is what the ledger remembers.
 */
export function blueskyPosts(topic) {
  const block = topic?.source?.platforms?.bluesky ?? {};
  const list = block.posts;
  if (list === undefined || list === null) return [{ id: 'main', text: block.text, images: block.images }];
  if (!Array.isArray(list) || !list.length) throw new Error(`${topic.slug}: platforms.bluesky.posts 必须是非空列表`);
  const seen = new Set();
  return list.map((entry, index) => {
    const id = String(entry?.id ?? '').trim() || `p${index + 1}`;
    if (seen.has(id)) throw new Error(`${topic.slug}: platforms.bluesky.posts 里 id "${id}" 重复 —— 账本按 id 记，重名的第二条会被当成已发`);
    seen.add(id);
    return { id, text: entry?.text, images: entry?.images };
  });
}

/**
 * The images a post carries, resolved off disk.
 *
 * An entry may be the bare file name — the alt text is then taken from the topic's own `media:`
 * list, so the description of a picture lives in one place — or an object carrying its own `alt`.
 *
 * A post with a picture and no alt text is a post a screen reader cannot read, so an entry without
 * alt text anywhere is refused here rather than sent. The size cap is checked before the upload
 * rather than after the rejection, and the number of images before anything is read at all.
 */
export function composeImages(topic, { root, topicsDir = 'topics', entries = undefined } = {}) {
  const list = entries === undefined ? topic?.source?.platforms?.bluesky?.images : entries;
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new Error(`${topic.slug}: platforms.bluesky.images 必须是列表`);
  if (list.length > MAX_IMAGES) {
    throw new Error(`${topic.slug}: ${list.length} 张图，Bluesky 一条最多 ${MAX_IMAGES} 张`);
  }
  const described = new Map((topic?.source?.media ?? []).map((item) => [String(item?.file ?? ''), item]));
  return list.map((entry) => {
    const file = typeof entry === 'string' ? entry : entry?.file;
    if (!file) throw new Error(`${topic.slug}: platforms.bluesky.images 里有一项没有 file`);
    const declared = described.get(file);
    const inlineAlt = typeof entry === 'string' ? '' : String(entry?.alt ?? '');
    const alt = String(inlineAlt || declared?.alt || '').trim();
    if (!alt) {
      throw new Error(`${topic.slug}: ${file} 没有 alt —— 在 media: 里给它写一句，或在这一项里直接写；没有替代文字的图，对读屏的人等于不存在`);
    }
    const abs = path.join(root, topicsDir, topic.slug, file);
    if (!fs.existsSync(abs)) throw new Error(`${topic.slug}: 找不到 ${file} —— 先跑 content images / 把它放进 assets/`);
    const bytes = fs.statSync(abs).size;
    if (bytes > MAX_IMAGE_BYTES) {
      throw new Error(`${topic.slug}: ${file} 有 ${bytes} 字节，超过 Bluesky 的 ${MAX_IMAGE_BYTES} —— 缩一版再发`);
    }
    const ext = path.extname(abs).slice(1).toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (!mime) throw new Error(`${topic.slug}: 不认识的图片格式 .${ext}${ext === 'mp4' ? ' —— 视频要另外走视频上传，这一条只发图片' : ''}`);
    return { file, path: abs, alt, mime, bytes };
  });
}

/** The embed an image post carries, given the uploaded blobs in the same order as the entries. */
export function imageEmbed(images, blobs) {
  if (!images.length) return undefined;
  return {
    $type: 'app.bsky.embed.images',
    images: images.map((image, index) => ({ alt: image.alt, image: blobs[index] })),
  };
}

/**
 * Where a link sits inside a post, in the UTF-8 byte offsets Bluesky's facet format uses. Getting
 * this wrong is the difference between a clickable link and a wall of text, and it is invisible
 * until a human looks at the result — hence the tests.
 */
export function linkFacets(text) {
  const facets = [];
  const pattern = /https?:\/\/[^\s<>"'()]+/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    // Trailing punctuation belongs to the sentence, not to the address.
    const url = match[0].replace(/[.,;:!?]+$/, '');
    facets.push({
      index: {
        byteStart: Buffer.byteLength(text.slice(0, match.index), 'utf8'),
        byteEnd: Buffer.byteLength(text.slice(0, match.index + url.length), 'utf8'),
      },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
    });
  }
  return facets;
}

/**
 * The post for one topic. `platforms.bluesky.text` in source.yaml wins; otherwise the X headline is
 * reused and the topic's own page appended, so a topic that was never written for Bluesky still
 * publishes something true about itself rather than nothing.
 */
export function composePost(topic, config, { text: written = undefined, limit = POST_LIMIT } = {}) {
  const link = topicLink(topic.slug, config);
  const explicit = written ?? topic.source?.platforms?.bluesky?.text;
  let text = explicit
    ? String(explicit).trim()
    : `${String(topic.source?.platforms?.x?.title ?? topic.source?.title ?? topic.slug).trim()}\n\n${link}`;

  if (!text.includes(link) && explicit) text = `${text}\n\n${link}`;

  const length = graphemeLength(text);
  if (length > limit) {
    throw new Error(`${topic.slug}: 帖子 ${length} 字符，超过 Bluesky 的 ${limit} 上限 —— 缩短 platforms.bluesky.text`);
  }
  if (!text.trim()) throw new Error(`${topic.slug}: 帖子是空的`);
  return { text, length, link, facets: linkFacets(text) };
}

/**
 * Read the post back from the public appview: a write that cannot be seen is not a publish. The
 * images are read back for the same reason they are sent — a blob that uploaded fine and a record
 * that dropped it looks exactly like success from the sending side.
 */
function readBack(uri, { appview = APPVIEW, attempts = 5, expectImages = 0 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { status, json } = curlJson(`${appview}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}`, { timeout: 30 });
    const post = json?.thread?.post;
    if (status === 200 && post?.uri) {
      return { verified: true, url: postUrl(post), images: (post.record?.embed?.images ?? []).length, imagesExpected: expectImages };
    }
    if (attempt < attempts) execFileSync('sleep', ['2']);
  }
  return { verified: false, reason: '公开接口还读不到这条帖子（可能只是索引慢）' };
}

/** The public permalink of a post — shared with the feedback sweep, which stores it per content unit. */
export function postUrl(post) {
  const handle = post.author?.handle ?? 'bsky.app';
  const rkey = String(post.uri).split('/').pop();
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

/**
 * What has already gone out, and where.
 *
 * Every publisher in this repository can be run twice, and on every other platform the second run
 * is merely a duplicate to delete. Here it is a second post on a public timeline that nobody can
 * take back quietly, so the record of what was sent is kept next to the numbers the feedback sweep
 * reads back — git-ignored for the same reason: it describes the world, not the source.
 */
export const PUBLISHED_DIR = 'data/published';

function ledgerFile(root) {
  return path.join(root ?? '.', PUBLISHED_DIR, 'bluesky.json');
}

export function readLedger(root) {
  const file = ledgerFile(root);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    // A corrupt ledger must not be silently treated as empty: that is the one failure that would
    // re-send everything. Refuse the run and let whoever broke it fix or delete the file.
    throw new Error(`${PUBLISHED_DIR}/bluesky.json 读不出来 —— 修好或删掉它，否则无法判断哪些已经发过`);
  }
}

function writeLedger(root, ledger) {
  const file = ledgerFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

/** The key a post is remembered under: the topic plus the id of the post inside it. */
export function postKey(slug, id) {
  return `${slug}#${id}`;
}

/**
 * Publish one or more topics.
 *
 * A session is created once, not per topic, and `--dry-run` prints exactly what would be sent
 * without contacting Bluesky at all — which is how the wording gets reviewed before it is public.
 */
export function blueskyPublish({ root, config, slugs, identifier, password, pds = DEFAULT_PDS, dryRun = false, force = false, log = console.log }) {
  if (!slugs?.length) throw new Error('指定要发布的主题：content publish --bluesky <slug>');
  if (!dryRun && (!identifier || !password)) {
    throw new Error('缺少凭证 —— 把 BLUESKY_HANDLE / BLUESKY_APP_PASSWORD 放进 vault 或环境变量后重试');
  }

  const ledger = readLedger(root);
  const topicsDir = config.paths?.topics;
  const composed = slugs.map((slug) => {
    const topic = loadTopic(root, slug, { topicsDir });
    const posts = blueskyPosts(topic).map((post) => ({
      id: post.id,
      key: postKey(slug, post.id),
      text: composePost(topic, config, { text: post.text }),
      images: composeImages(topic, { root, topicsDir, entries: post.images }),
      already: ledger[postKey(slug, post.id)] ?? null,
    }));
    return { slug, posts };
  });

  if (dryRun) {
    for (const { slug, posts } of composed) {
      for (const post of posts) {
        const mark = post.already && !force ? '已发过，会跳过' : '待发';
        log(`\n${slug}#${post.id} （${post.text.length}/${POST_LIMIT} 字符，含 ${post.text.facets.length} 个链接${post.images.length ? `，${post.images.length} 张图` : ''}）—— ${mark}`);
        if (post.already) log(`  已发于 ${post.already.at ?? '?'}：${post.already.url ?? post.already.uri ?? ''}`);
        log('─'.repeat(60));
        log(post.text.text);
        for (const image of post.images) log(`\n[图] ${image.file} · ${image.mime} · ${image.bytes} 字节\n[alt] ${image.alt}`);
        log('─'.repeat(60));
      }
    }
    const waiting = composed.flatMap((t) => t.posts).filter((p) => !p.already || force).length;
    log(`\ndry-run：未联系 Bluesky，未发布。会发 ${waiting} 条，跳过 ${composed.flatMap((t) => t.posts).length - waiting} 条。`);
    return { results: composed.flatMap(({ slug, posts }) => posts.map((p) => ({ slug, id: p.id, dryRun: true, skipped: Boolean(p.already) && !force }))), ok: true };
  }

  const session = createSession({ identifier, password, pds });
  log(`已登录：${session.handle}`);

  const results = [];
  for (const { slug, posts } of composed) {
    for (const post of posts) {
      if (post.already && !force) {
        log(`  · ${slug}#${post.id} 已经发过了，跳过：${post.already.url ?? ''}`);
        results.push({ slug, id: post.id, published: false, skipped: true, url: post.already.url });
        continue;
      }
      let blobs = [];
      try {
        blobs = post.images.map((image) => uploadBlob({ session, bytes: fs.readFileSync(image.path), mime: image.mime, pds }));
        if (post.images.length) log(`  已上传 ${blobs.length} 张图（${post.images.map((i) => i.file).join(', ')}）`);
      } catch (error) {
        log(`  ! ${slug}#${post.id}: ${error.message}`);
        results.push({ slug, id: post.id, published: false, reason: error.message });
        continue;
      }
      const embed = imageEmbed(post.images, blobs);
      const record = {
        $type: 'app.bsky.feed.post',
        text: post.text.text,
        langs: [config?.site?.language ?? 'en'],
        createdAt: new Date().toISOString(),
        ...(post.text.facets.length ? { facets: post.text.facets } : {}),
        ...(embed ? { embed } : {}),
      };
      const { status, json } = curlJson(`${pds}/xrpc/com.atproto.repo.createRecord`, {
        method: 'POST',
        token: session.accessJwt,
        body: { repo: session.did, collection: 'app.bsky.feed.post', record },
      });
      if (status !== 200 || !json?.uri) {
        log(`  ! ${slug}#${post.id} 发布失败（HTTP ${status}）：${String(json?.message ?? '').slice(0, 200)}`);
        results.push({ slug, id: post.id, published: false, status });
        continue;
      }
      const check = readBack(json.uri, { expectImages: post.images.length });
      log(check.verified ? `  ✓ ${slug}#${post.id} 已发布并回读确认：${check.url}` : `  ! ${check.reason}`);
      if (check.verified && check.images !== check.imagesExpected) {
        log(`  ! 帖子发出去了，但回读到 ${check.images} 张图（应是 ${check.imagesExpected} 张）—— 图没有进 embed`);
      }
      // Recorded before the results are returned: a post that is out is out, even if the process
      // dies before it finishes reporting.
      ledger[post.key] = { uri: json.uri, url: check.url ?? null, at: new Date().toISOString(), images: post.images.length };
      writeLedger(root, ledger);
      results.push({ slug, id: post.id, published: true, uri: json.uri, ...check });
    }
  }

  const sent = results.filter((r) => r.published && r.verified);
  const skipped = results.filter((r) => r.skipped);
  const failed = results.filter((r) => !r.published && !r.skipped);
  const ok = failed.length === 0;
  log('');
  log(ok
    ? `Bluesky 发布完成：发出 ${sent.length} 条，跳过 ${skipped.length} 条已经发过的`
    : `Bluesky 发布未全部通过回读确认：发出 ${sent.length}，跳过 ${skipped.length}，失败 ${failed.length}`);
  return { results, ok };
}
