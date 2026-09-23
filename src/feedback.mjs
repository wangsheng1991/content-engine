// Feedback: read the numbers back from the platforms that carry this content.
//
// Publishing is a write and writes are the fragile part; this is the other half — a read-only sweep
// that answers "did anybody look at what we published?". Two channels, read together and written as
// one record per content unit:
//
//   * Dev.to is the only channel in this stack that reports views at all. `page_views_count` has a
//     value only through the authenticated `/articles/me*` endpoints; the public copy of the same
//     article reports null, which is why the api-key is not optional here.
//   * Bluesky is fully public and needs no credential, but it has no impression count anywhere —
//     that field does not exist in the appview. What it does have is who liked a post, which is the
//     useful part: a name is a lead, a number is not.
//
// The join back to a topic is the content's own link, never a title or a timestamp: Dev.to returns
// the `canonical_url` the article was published with, and every Bluesky post carries the topic page
// the composer appended to it. A remote record that carries neither is reported as unmatched rather
// than guessed at.
//
// Transport is curl, like every other network call in this repository: nothing else on this machine
// honours the ambient proxy.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { listTopicSlugs } from './topic.mjs';
import { ensureDir, isoNow } from './util.mjs';
import { postUrl } from './bluesky.mjs';

export const DEVTO_API = 'https://dev.to/api';
export const APPVIEW = 'https://public.api.bsky.app';
/** The handle that owns the posts: wangsheng199, not wangsheng1991. */
export const DEFAULT_HANDLE = 'wangsheng199.bsky.social';
/** Where the numbers land relative to the repository root; git-ignored on purpose. */
export const FEEDBACK_DIR = 'data/feedback';
/** The appview returns at most 100 posts per call; 50 is a year of this cadence. */
export const FEED_LIMIT = 50;
/** Days of Dev.to history to carry alongside the totals. */
export const HISTORY_DAYS = 7;

/**
 * The requests this run would make, in order. Printed by `--dry-run` so the sweep can be reviewed
 * before it touches anything, and asserted by the tests so a new endpoint cannot appear unreviewed.
 */
export function planRequests({ handle = DEFAULT_HANDLE, historyStart, historyEnd } = {}) {
  return [
    { channel: 'devto', method: 'GET', auth: 'api-key', url: `${DEVTO_API}/articles/me/published`, note: '每篇文章的浏览量、互动、评论、canonical_url' },
    { channel: 'devto', method: 'GET', auth: 'api-key', url: `${DEVTO_API}/analytics/totals`, note: '账号级：浏览量、平均阅读时长、互动、评论、关注' },
    { channel: 'devto', method: 'GET', auth: 'api-key', url: `${DEVTO_API}/analytics/historical?start=${historyStart}&end=${historyEnd}`, note: `按天：近 ${HISTORY_DAYS} 天的同一组数字` },
    { channel: 'bluesky', method: 'GET', auth: 'none', url: `${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${handle}`, note: '账号级：粉丝、关注、发帖数' },
    { channel: 'bluesky', method: 'GET', auth: 'none', url: `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed?actor=${handle}&limit=${FEED_LIMIT}`, note: '每帖：赞、转、评、引用、收藏' },
    { channel: 'bluesky', method: 'GET', auth: 'none', url: `${APPVIEW}/xrpc/app.bsky.feed.getLikes?uri=<at-uri>`, note: '每帖一次：谁点了赞（只对匹配到主题的帖子发）' },
  ];
}

function curlJson(url, { method = 'GET', apiKey, timeout = 90 } = {}) {
  const args = ['-sS', '-X', method, '--noproxy', '127.0.0.1,localhost', '--max-time', String(timeout)];
  if (apiKey) {
    args.push('-H', `api-key: ${apiKey}`);
    args.push('-H', 'Accept: application/vnd.forem.api-v1+json');
  }
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
  if (status !== 200) {
    const detail = String(json?.error ?? json?.message ?? text ?? '').replace(/\s+/g, ' ').slice(0, 160);
    throw new Error(`${new URL(url).host} 返回 HTTP ${status}${detail ? `：${detail}` : ''}`);
  }
  return json;
}

/** The real transport. Tests inject their own, so the suite never touches the network. */
export function curlTransport() {
  return { json: (url, options) => Promise.resolve(curlJson(url, options)) };
}

/** One content unit is one (topic, channel) pair; that pair is also the file name. */
export function unitId(topic, channel) {
  return `${topic}.${channel}`;
}

/**
 * The topic an article belongs to, read off the canonical URL Dev.to stored when it was published.
 * `/blog/<slug>/` is the Chinese body, `/en/blog/<slug>/` the English one — both are the same topic.
 * A canonical that points somewhere else belongs to no topic here.
 */
export function slugFromCanonical(canonicalUrl, baseUrl) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  const url = String(canonicalUrl ?? '').split(/[?#]/)[0];
  if (!base || !url.startsWith(`${base}/`)) return null;
  const match = url.slice(base.length).match(/^\/(?:en\/)?blog\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** The topic link as it appears inside a post: what `composePost` appends to every Bluesky post. */
export function slugFromText(text, baseUrl) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  const haystack = String(text ?? '');
  const index = haystack.indexOf(`${base}/topics/`);
  if (!base || index === -1) return null;
  const slug = haystack.slice(index + base.length + '/topics/'.length).split(/[/?#\s"'()]/)[0];
  return slug ? decodeURIComponent(slug) : null;
}

/** The topic a Bluesky post belongs to: the facet link first, the raw text as the fallback. */
export function slugFromPost(post, baseUrl) {
  const facets = post?.record?.facets ?? [];
  for (const facet of facets) {
    for (const feature of facet?.features ?? []) {
      const slug = slugFromText(feature?.uri, baseUrl);
      if (slug) return slug;
    }
  }
  return slugFromText(post?.record?.text, baseUrl);
}

/**
 * A metric the platform did not report stays null rather than becoming 0 — "nobody looked" and "the
 * api-key was not accepted" are different answers, and only one of them is worth acting on.
 */
function metric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function devtoRecord(article, { topic, fetchedAt }) {
  return {
    topic,
    channel: 'devto',
    external_id: article?.id ?? null,
    external_url: article?.url ?? null,
    canonical_url: article?.canonical_url ?? null,
    title: article?.title ?? null,
    published_at: article?.published_timestamp ?? article?.published_at ?? null,
    fetched_at: fetchedAt,
    metrics: {
      pageViews: metric(article?.page_views_count),
      reactions: metric(article?.public_reactions_count),
      comments: metric(article?.comments_count),
    },
  };
}

export function blueskyRecord(post, { topic, fetchedAt, likers = [] }) {
  return {
    topic,
    channel: 'bluesky',
    external_id: post?.uri ?? null,
    external_url: post ? postUrl(post) : null,
    author: post?.author?.handle ?? null,
    published_at: post?.record?.createdAt ?? null,
    fetched_at: fetchedAt,
    metrics: {
      likeCount: metric(post?.likeCount),
      repostCount: metric(post?.repostCount),
      replyCount: metric(post?.replyCount),
      quoteCount: metric(post?.quoteCount),
      bookmarkCount: metric(post?.bookmarkCount),
    },
    // Who, not how many: the one signal this platform gives that names a person.
    likers: likers
      .map((like) => ({ handle: like?.actor?.handle ?? null, did: like?.actor?.did ?? null, indexedAt: like?.indexedAt ?? null }))
      .filter((like) => like.handle || like.did),
  };
}

/** One file per content unit, overwritten in place — a second run the same day replaces the first. */
export function writeFeedback(outDir, records, { account } = {}) {
  ensureDir(outDir);
  const files = [];
  for (const record of records) {
    const file = path.join(outDir, `${unitId(record.topic, record.channel)}.json`);
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    files.push(file);
  }
  if (account) {
    const file = path.join(outDir, '_account.json');
    fs.writeFileSync(file, `${JSON.stringify(account, null, 2)}\n`);
    files.push(file);
  }
  return files;
}

/** YYYY-MM-DD, `days` before `date`, in UTC — the form the analytics/historical endpoint wants. */
export function dateKey(date, offsetDays = 0) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + offsetDays);
  return copy.toISOString().slice(0, 10);
}

/**
 * Sweep both channels and write what came back.
 *
 * A channel that fails is reported and the other one still lands on disk: a daily sweep that throws
 * away the Dev.to numbers because Bluesky timed out is worse than one that says which half is
 * missing. `--dry-run` contacts nothing at all.
 */
export async function fetchFeedback({
  root,
  config,
  slugs,
  outDir,
  dryRun = false,
  apiKey,
  handle = DEFAULT_HANDLE,
  historyDays = HISTORY_DAYS,
  now = new Date(),
  transport,
  log = console.log,
} = {}) {
  const baseUrl = String(config?.site?.baseUrl ?? '').replace(/\/+$/, '');
  const dir = outDir ?? path.join(root ?? '.', FEEDBACK_DIR);
  const fetchedAt = isoNow(now);
  const historyEnd = dateKey(now);
  const historyStart = dateKey(now, -(historyDays - 1));
  const plan = planRequests({ handle, historyStart, historyEnd });
  const known = root ? listTopicSlugs(root, config?.paths?.topics) : [];
  const wanted = slugs?.length ? slugs.filter((slug) => known.includes(slug)) : known;

  if (dryRun) {
    log(`dry-run：将请求 ${plan.length} 个端点（不发送任何请求，不写任何文件）`);
    for (const request of plan) log(`  ${request.method} ${request.url}${request.auth === 'api-key' ? '  [api-key]' : ''}\n      ${request.note}`);
    log(`  → 命中主题后写入 ${path.relative(root ?? '.', dir)}/<topic>.<channel>.json（一天内重复跑覆盖同一条）`);
    return { dryRun: true, plan, records: [], files: [], unmatched: [], errors: [], fetchedAt };
  }
  if (!apiKey) throw new Error('缺少凭证 —— 把 DEVTO_API_KEY 放进 vault 或环境变量后重试');

  const http = transport ?? curlTransport();
  const errors = [];
  const unmatched = [];
  const records = [];

  // --- Dev.to ------------------------------------------------------------------
  let articles = [];
  let devtoAccount = null;
  try {
    articles = (await http.json(`${DEVTO_API}/articles/me/published`, { apiKey })) ?? [];
    const totals = await http.json(`${DEVTO_API}/analytics/totals`, { apiKey });
    const history = await http.json(`${DEVTO_API}/analytics/historical?start=${historyStart}&end=${historyEnd}`, { apiKey });
    const user = articles.find((article) => article?.user)?.user ?? {};
    devtoAccount = {
      username: user.username ?? null,
      user_id: user.user_id ?? null,
      totals: totals ?? null,
      history: history ?? null,
    };
    for (const article of articles) {
      const topic = slugFromCanonical(article?.canonical_url, baseUrl);
      if (!topic || !wanted.includes(topic)) {
        unmatched.push({ channel: 'devto', external_id: article?.id ?? null, title: article?.title ?? null, canonical_url: article?.canonical_url ?? null });
        continue;
      }
      records.push(devtoRecord(article, { topic, fetchedAt }));
    }
  } catch (error) {
    errors.push({ channel: 'devto', message: error.message });
  }

  // --- Bluesky -----------------------------------------------------------------
  let blueskyAccount = null;
  try {
    const profile = await http.json(`${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`);
    blueskyAccount = {
      handle: profile?.handle ?? handle,
      did: profile?.did ?? null,
      followersCount: metric(profile?.followersCount),
      followsCount: metric(profile?.followsCount),
      postsCount: metric(profile?.postsCount),
    };
    const feed = (await http.json(`${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=${FEED_LIMIT}`))?.feed ?? [];
    const newest = new Map();
    for (const item of feed) {
      const post = item?.post;
      const topic = slugFromPost(post, baseUrl);
      if (!topic || !wanted.includes(topic)) {
        unmatched.push({ channel: 'bluesky', external_id: post?.uri ?? null, text: String(post?.record?.text ?? '').replace(/\s+/g, ' ').slice(0, 120) });
        continue;
      }
      const seen = newest.get(topic);
      if (!seen || String(post?.record?.createdAt ?? '') > String(seen.post?.record?.createdAt ?? '')) newest.set(topic, { post });
    }
    for (const [topic, { post }] of [...newest].sort(([a], [b]) => a.localeCompare(b))) {
      const likes = (await http.json(`${APPVIEW}/xrpc/app.bsky.feed.getLikes?uri=${encodeURIComponent(post.uri)}&limit=50`))?.likes ?? [];
      records.push(blueskyRecord(post, { topic, fetchedAt, likers: likes }));
    }
  } catch (error) {
    errors.push({ channel: 'bluesky', message: error.message });
  }

  const account = { fetched_at: fetchedAt, base_url: baseUrl, devto: devtoAccount, bluesky: blueskyAccount };
  records.sort((a, b) => unitId(a.topic, a.channel).localeCompare(unitId(b.topic, b.channel)));
  const files = writeFeedback(dir, records, { account });

  return { dryRun: false, plan, records, files, unmatched, errors, account, fetchedAt };
}

/** The one-line-per-unit summary `content feedback` prints. */
export function describe(record) {
  const parts = Object.entries(record.metrics ?? {}).map(([key, value]) => `${key} ${value === null ? '—' : value}`);
  return `${unitId(record.topic, record.channel).padEnd(34)} ${parts.join(' · ')}${record.likers?.length ? ` · 点赞者 ${record.likers.map((l) => l.handle).join(', ')}` : ''}`;
}
