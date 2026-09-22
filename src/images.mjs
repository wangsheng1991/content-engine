// Cover images and illustrations, produced by a pluggable backend.
//
// Two hard rules shape this file:
//
//  1. The PNG lands in `topics/<slug>/assets/` — it is *source*, committed with the topic, never
//     built into `dist/`. CI compiles the site on an ubuntu runner with no Chrome and no Chinese
//     system font, so an image generated at build time would vanish from the deployed site while
//     still looking fine locally.
//
//  2. No image model is required to ship a cover. The `card` backend lays the title out as HTML and
//     screenshots it with the local Chrome, which is deterministic, free and needs no key. A model
//     backend (`qwen`, `command`) can be swapped in per topic the moment one is worth paying for.
//
// Backends:
//   card     render a typographic card with the local Chrome, headless — zero dependencies
//   qwen     POST a prompt to an image API (qwen-image-2.1 and anything OpenAI-images shaped)
//   command  run any command you already have, handing it the prompt and the output path
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureDir, escapeHtml, exists, isPlainObject, sha256, toArray } from './util.mjs';
import { englishTitle } from './i18n.mjs';

export const BACKENDS = ['card', 'qwen', 'command'];
export const COVER_WIDTH = 1200;
export const COVER_HEIGHT = 630;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/** The browser used by the `card` backend, or null when this machine has none. */
export function chromePath() {
  return CHROME_CANDIDATES.find((p) => p && exists(p)) ?? null;
}

/** The image backend a job falls back to when neither the job nor the config picks one. */
export function defaultBackend(config = {}, kind = 'cover') {
  const images = config.images ?? {};
  if (images.backend) return images.backend;
  return kind === 'cover' ? 'card' : 'qwen';
}

/**
 * Every image one topic needs, as a flat list of jobs.
 *
 * A cover is always planned, in English as well as Chinese whenever an English title exists —
 * Dev.to is an English platform and hands a Chinese card to an English readership otherwise.
 * Illustrations come from `images:` in source.yaml; each one is referenced from article.md by its
 * plain relative path (`assets/<id>.png`), so nothing else in the compiler has to know about it.
 */
export function planImages(topic, config = {}) {
  const source = topic.source ?? {};
  const cover = isPlainObject(source.cover) ? source.cover : {};
  const site = config.site ?? {};
  const jobs = [];

  const variants = [
    {
      id: 'cover',
      lang: 'zh',
      title: cover.headline ?? source.title ?? topic.slug,
      kicker: cover.kicker ?? kickerOf(source),
      dek: cover.dek ?? source.subtitle ?? '',
      tags: toArray(source.tags),
    },
    {
      id: 'cover-en',
      lang: 'en',
      title: cover.en?.headline ?? englishTitle(source),
      // A Latin card must not inherit the Chinese furniture: the tags would render as a row of
      // glyphs the English reader cannot use, so the card takes the tags Dev.to will get instead.
      kicker: cover.en?.kicker ?? kickerOf(source),
      dek: cover.en?.dek ?? '',
      tags: toArray(source.platforms?.devto?.tags),
    },
  ];

  for (const variant of variants) {
    if (!variant.title) continue;
    const override = variant.lang === 'zh' ? cover : { ...cover, ...(cover.en ?? {}) };
    jobs.push({
      id: variant.id,
      kind: 'cover',
      lang: variant.lang,
      file: `assets/og${variant.lang === 'en' ? '.en' : ''}.png`,
      backend: override.backend ?? defaultBackend(config, 'cover'),
      command: override.command,
      width: Number(override.width) || COVER_WIDTH,
      height: Number(override.height) || COVER_HEIGHT,
      prompt: override.prompt ?? '',
      card: {
        title: variant.title,
        kicker: variant.kicker,
        dek: variant.dek,
        date: source.date ?? '',
        tags: variant.tags,
        author: site.author ?? '',
        site: site.name ?? '',
        siteUrl: site.baseUrl ?? '',
        lang: variant.lang,
      },
    });
  }

  for (const entry of toArray(source.images)) {
    if (!isPlainObject(entry) || !entry.id) continue;
    const id = String(entry.id);
    jobs.push({
      id,
      kind: 'illustration',
      lang: entry.lang ?? 'zh',
      file: String(entry.file ?? `assets/${id}.png`),
      backend: entry.backend ?? defaultBackend(config, 'illustration'),
      command: entry.command,
      width: Number(entry.width) || 1024,
      height: Number(entry.height) || 1024,
      prompt: entry.prompt ?? '',
      caption: entry.caption ?? '',
      card: {
        title: entry.title ?? source.title ?? '',
        kicker: entry.kicker ?? '',
        dek: entry.dek ?? '',
        date: '',
        tags: [],
        author: site.author ?? '',
        site: site.name ?? '',
        siteUrl: site.baseUrl ?? '',
        lang: entry.lang ?? 'zh',
      },
    });
  }

  return jobs;
}

// The tags already appear as chips along the bottom, so the kicker carries the kind alone.
function kickerOf(source) {
  return String(source.kind ?? '').trim();
}

/**
 * Assets that article.md points at but that do not exist on disk.
 *
 * A missing illustration is invisible until someone opens the published page, which is exactly the
 * kind of thing a build should say out loud. Returned rather than thrown so the site still builds.
 */
export function missingAssets(topic) {
  const article = String(topic.article ?? '');
  const referenced = new Set();
  for (const match of article.matchAll(/(?:src|href)="(assets\/[^"?#]+)/g)) referenced.add(match[1]);
  for (const match of article.matchAll(/!\[[^\]]*\]\((assets\/[^)\s?#]+)/g)) referenced.add(match[1]);
  return [...referenced].filter((rel) => !exists(path.join(topic.dir, rel))).sort();
}

/** The typographic card, as a standalone HTML document sized to the screenshot. */
export function coverCardHtml(job) {
  const { width, height, card } = job;
  const cjk = /[\u3400-\u9fff\u3040-\u30ff]/.test(card.title);
  // A Chinese title carries more meaning per character than a Latin one, so it wants the larger
  // size until it gets long; tracking is left alone for CJK, where negative tracking only jams
  // glyphs together.
  const size = card.title.length > 46 ? 44 : card.title.length > 26 ? 54 : 64;
  const tracking = cjk ? '0' : '-0.025em';
  const tags = card.tags.slice(0, 4);
  return `<!doctype html>
<html lang="${escapeHtml(card.lang === 'en' ? 'en' : 'zh-CN')}">
<head>
<meta charset="utf-8">
<style>
  :root { --accent: #1a73e8; --fg: #111827; --muted: #4b5563; --faint: #6b7280; --hair: #e5e7eb; }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${width}px; height: ${height}px; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
      "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;
    color: var(--fg); background: #ffffff;
    display: flex; flex-direction: column; padding: 68px 76px 56px;
    -webkit-font-smoothing: antialiased;
  }
  header { display: flex; align-items: center; gap: 12px; }
  .mark {
    width: 34px; height: 34px; border-radius: 9px; background: var(--fg); color: #fff;
    display: grid; place-items: center; font-size: 15px; font-weight: 600;
  }
  .site { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
  .date { margin-left: auto; font-size: 17px; color: var(--faint); font-variant-numeric: tabular-nums; }
  main { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 8px 0 0; }
  .kicker {
    font-size: 18px; font-weight: 600; color: var(--accent); letter-spacing: 0.08em;
    text-transform: uppercase; margin: 0 0 22px;
  }
  h1 {
    font-size: ${size}px; line-height: 1.28; font-weight: 600; letter-spacing: ${tracking};
    margin: 0; text-wrap: balance; max-width: 1000px;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .dek {
    font-size: 23px; line-height: 1.6; color: var(--muted); margin: 26px 0 0; max-width: 980px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  footer {
    display: flex; align-items: center; gap: 10px; border-top: 1px solid var(--hair);
    padding-top: 20px; font-size: 16px; color: var(--faint);
  }
  .tag { border: 1px solid var(--hair); border-radius: 999px; padding: 4px 13px; font-size: 15px; color: var(--muted); }
  .who { margin-left: auto; }
</style>
</head>
<body>
  <header>
    <span class="mark" aria-hidden="true">AI</span>
    <span class="site">${escapeHtml(card.site)}</span>
    <span class="date">${escapeHtml(card.date)}</span>
  </header>
  <main>
    ${card.kicker ? `<p class="kicker">${escapeHtml(card.kicker)}</p>` : ''}
    <h1>${escapeHtml(card.title)}</h1>
    ${card.dek ? `<p class="dek">${escapeHtml(card.dek)}</p>` : ''}
  </main>
  <footer>
    ${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
    <span class="who">${escapeHtml(card.author)}</span>
  </footer>
</body>
</html>
`;
}

/**
 * Screenshot a local HTML file with Chrome.
 *
 * Chrome writes the PNG and then simply never exits — on macOS it sits there holding the display
 * link. So the completion signal cannot be the process exiting: it is the output file appearing and
 * holding a stable size, after which the whole process group is killed.
 */
function screenshot({ chrome, htmlFile, outFile, width, height, scale = 1, timeoutMs = 45000 }) {
  return new Promise((resolve) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-chrome-'));
    const args = [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-crash-reporter',
      '--disable-background-networking',
      `--user-data-dir=${profile}`,
      `--force-device-scale-factor=${scale}`,
      `--window-size=${width},${height}`,
      '--virtual-time-budget=2000',
      `--screenshot=${outFile}`,
      `file://${htmlFile}`,
    ];
    const child = spawn(chrome, args, { stdio: 'ignore', detached: true });
    const start = Date.now();
    let lastSize = -1;
    let stable = 0;

    const stop = () => {
      clearInterval(timer);
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
      try {
        fs.rmSync(profile, { recursive: true, force: true });
      } catch {
        /* Chrome may still hold a lock; the temp dir is disposable */
      }
    };

    const timer = setInterval(() => {
      const done = () => {
        stop();
        resolve({ ok: true });
      };
      if (exists(outFile)) {
        const size = fs.statSync(outFile).size;
        if (size > 2048 && size === lastSize) stable += 1;
        else stable = 0;
        lastSize = size;
        if (stable >= 2) return done();
      }
      if (Date.now() - start > timeoutMs) {
        stop();
        resolve({ ok: false, reason: `Chrome produced no screenshot within ${timeoutMs / 1000}s` });
      }
    }, 250);
  });
}

async function renderCard({ job, root, outFile, log }) {
  const chrome = chromePath();
  if (!chrome) return { ok: false, reason: 'no local Chrome/Chromium found (set CHROME_PATH)' };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-card-'));
  const htmlFile = path.join(work, 'card.html');
  fs.writeFileSync(htmlFile, coverCardHtml(job));
  try {
    const result = await screenshot({
      chrome,
      htmlFile,
      outFile,
      width: job.width,
      height: job.height,
      scale: Number(process.env.COVER_SCALE) || 1,
    });
    if (!result.ok) return result;
    log(`  card → ${path.relative(root, outFile)} (${job.width}×${job.height})`);
    return { ok: true, backend: 'card', model: 'html+chrome' };
  } finally {
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* disposable */
    }
  }
}

/** Read a dotted path out of an API response, tolerating the shapes image APIs actually use. */
function pluck(value, dotted) {
  let cursor = value;
  for (const key of String(dotted).split('.')) {
    if (cursor === undefined || cursor === null) return undefined;
    cursor = Array.isArray(cursor) && /^\d+$/.test(key) ? cursor[Number(key)] : cursor[key];
  }
  return cursor;
}

const DEFAULT_IMAGE_PATHS = [
  'data.0.b64_json',
  'data.0.url',
  'output.choices.0.message.content.0.image',
  'output.results.0.url',
  'output.image_url',
];

/**
 * The model backend. Deliberately written as a thin adapter over whatever the provider's HTTP
 * contract turns out to be: endpoint, headers, body and response path all come from config, so
 * pointing this at a real service is a config change, not a code change.
 */
async function renderQwen({ job, config, root, outFile, log }) {
  const settings = config.images?.qwen ?? {};
  const endpoint = settings.endpoint;
  if (!endpoint) {
    return { ok: false, reason: 'images.qwen.endpoint is not set in content.config.json' };
  }
  const keyEnv = settings.apiKeyEnv ?? 'QWEN_API_KEY';
  const apiKey = process.env[keyEnv];
  if (!apiKey) return { ok: false, reason: `${keyEnv} is not set` };
  if (!job.prompt) return { ok: false, reason: `${job.id}: a model backend needs a prompt` };

  const body = settings.body ?? {
    model: settings.model ?? 'qwen-image-2.1',
    prompt: job.prompt,
    n: 1,
    size: `${job.width}*${job.height}`,
    response_format: 'b64_json',
  };
  const headers = { 'content-type': 'application/json', ...(settings.headers ?? {}), authorization: `Bearer ${apiKey}` };

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(settings.timeoutMs) || 180000),
    });
  } catch (error) {
    return { ok: false, reason: `request failed: ${error.message}` };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, reason: `HTTP ${response.status}: ${detail.slice(0, 300)}` };
  }

  const payload = await response.json().catch(() => null);
  if (!payload) return { ok: false, reason: 'response was not JSON' };

  const paths = toArray(settings.imagePath ?? DEFAULT_IMAGE_PATHS);
  let image;
  for (const candidate of paths) {
    const value = pluck(payload, candidate);
    if (typeof value === 'string' && value) {
      image = candidate.endsWith('b64_json') ? `data:image/png;base64,${value}` : value;
      break;
    }
  }
  if (!image) {
    return { ok: false, reason: `no image in the response (looked at ${paths.join(', ')})` };
  }

  if (image.startsWith('data:')) {
    fs.writeFileSync(outFile, Buffer.from(image.split(',')[1], 'base64'));
  } else {
    const download = await fetch(image, { signal: AbortSignal.timeout(120000) });
    if (!download.ok) return { ok: false, reason: `could not download the image: HTTP ${download.status}` };
    fs.writeFileSync(outFile, Buffer.from(await download.arrayBuffer()));
  }
  log(`  qwen → ${path.relative(root, outFile)}`);
  return { ok: true, backend: 'qwen', model: body.model ?? 'unknown' };
}

/** The escape hatch: any command you already have, told where to write the file. */
async function renderCommand({ job, config, root, outFile, log }) {
  const template = job.command ?? config.images?.command;
  if (!template) return { ok: false, reason: 'no images.command configured' };
  const command = String(template)
    .replaceAll('{prompt}', job.prompt)
    .replaceAll('{out}', outFile)
    .replaceAll('{width}', String(job.width))
    .replaceAll('{height}', String(job.height));
  const result = await new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: 'ignore' });
    child.on('error', (error) => resolve({ code: -1, error }));
    child.on('close', (code) => resolve({ code }));
  });
  if (result.code !== 0) return { ok: false, reason: `command exited ${result.code}${result.error ? `: ${result.error.message}` : ''}` };
  if (!exists(outFile)) return { ok: false, reason: 'command exited 0 but wrote no file' };
  log(`  command → ${path.relative(root, outFile)}`);
  return { ok: true, backend: 'command', model: 'shell' };
}

const RENDERERS = { card: renderCard, qwen: renderQwen, command: renderCommand };

/**
 * Produce every planned image for the selected topics.
 *
 * An image that already exists is left alone unless `force` is set: the files are committed source,
 * so a rebuild must not quietly replace a reviewed illustration.
 */
export async function renderImages({
  root,
  config,
  topics,
  backend,
  force = false,
  only = [],
  dryRun = false,
  log = () => {},
}) {
  const rendered = [];
  const skipped = [];
  const failed = [];
  const provenance = {};

  for (const topic of topics) {
    const jobs = planImages(topic, config).filter((job) => !only.length || only.includes(job.id));
    if (!jobs.length) continue;
    log(`${topic.slug}:`);
    const record = [];
    for (const job of jobs) {
      const chosen = backend ?? job.backend;
      const outFile = path.join(topic.dir, job.file);
      const renderer = RENDERERS[chosen];
      if (!renderer) {
        failed.push({ slug: topic.slug, id: job.id, reason: `unknown backend "${chosen}"` });
        continue;
      }
      if (exists(outFile) && !force) {
        skipped.push({ slug: topic.slug, id: job.id, file: job.file });
        log(`  ${job.id}: kept — ${path.relative(root, outFile)} already exists`);
        record.push({ id: job.id, file: job.file, backend: `kept`, bytes: fs.statSync(outFile).size });
        continue;
      }
      if (dryRun) {
        log(`  ${job.id}: would render with "${chosen}" → ${path.relative(root, outFile)}`);
        continue;
      }
      ensureDir(path.dirname(outFile));
      try {
        fs.rmSync(outFile, { force: true });
      } catch {
        /* a screenshot cannot overwrite in place reliably */
      }
      const result = await renderer({ job, config, root, outFile, log });
      if (!result.ok) {
        failed.push({ slug: topic.slug, id: job.id, reason: result.reason });
        log(`  ${job.id}: skipped — ${result.reason}`);
        continue;
      }
      const bytes = fs.statSync(outFile).size;
      rendered.push({ slug: topic.slug, id: job.id, file: job.file, backend: result.backend, bytes });
      record.push({
        id: job.id,
        file: job.file,
        kind: job.kind,
        backend: result.backend,
        model: result.model,
        prompt: job.prompt || undefined,
        prompt_sha256: job.prompt ? sha256(job.prompt).slice(0, 16) : undefined,
        size: `${job.width}×${job.height}`,
        bytes,
        sha256: sha256(fs.readFileSync(outFile)).slice(0, 16),
      });
    }
    if (record.length) provenance[topic.slug] = record;
  }

  if (!dryRun && Object.keys(provenance).length) {
    for (const topic of topics) {
      const record = provenance[topic.slug];
      if (!record) continue;
      const file = path.join(topic.dir, 'images.json');
      const previous = exists(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { topic: topic.slug, images: [] };
      const merged = new Map((previous.images ?? []).map((entry) => [entry.id, entry]));
      for (const entry of record) merged.set(entry.id, entry);
      fs.writeFileSync(
        file,
        `${JSON.stringify({ topic: topic.slug, generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), images: [...merged.values()] }, null, 2)}\n`,
      );
    }
  }

  return { rendered, skipped, failed };
}

/**
 * The cover a topic actually has on disk, if any. Read by the compiler so a page only ever points at
 * an image that exists — a broken og:image is worse than none at all.
 */
export function coverOf(topic) {
  for (const name of ['og.png', 'og.jpg', 'og.jpeg', 'og.webp']) {
    const file = path.join(topic.dir, 'assets', name);
    if (exists(file)) return { file: `assets/${name}`, rel: name };
  }
  return null;
}

export function englishCoverOf(topic) {
  for (const name of ['og.en.png', 'og.en.jpg', 'og.en.webp']) {
    const file = path.join(topic.dir, 'assets', name);
    if (exists(file)) return { file: `assets/${name}`, rel: name };
  }
  return null;
}
