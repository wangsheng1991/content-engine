// The deck has two engines and they answer different questions.
//
//   pandoc      one editable .pptx, for the person who wants to rearrange it in PowerPoint.
//   html+chrome the html deck, one png per page and a pdf — which is what a carousel, a pdf
//               handout and the frames of a video actually need, with no new dependency.
//
// Both read the same slides.md, so a deck that is right in one is right in the other.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromePath, screenshot } from './images.mjs';
import { renderTemplate } from './template.mjs';
import { copyDir, ensureDir, exists, isoNow, readText, sha256, writeOut } from './util.mjs';

export function pandocPath() {
  try {
    execFileSync('pandoc', ['--version'], { stdio: 'ignore' });
    return 'pandoc';
  } catch {
    return null;
  }
}

/** Convert an already-compiled slides.md into a real .pptx via pandoc. */
export function buildDeck({ bin, input, title, outFile, log = () => {} }) {
  if (!bin) return { built: false, reason: 'pandoc not installed' };
  if (!exists(input)) return { built: false, reason: `deck source missing: ${input}` };
  ensureDir(path.dirname(outFile));
  try {
    execFileSync(
      bin,
      [input, '-o', outFile, '-f', 'markdown', '-t', 'pptx', '--slide-level=2', '--metadata', `title=${title}`],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    log(`deck: ${outFile}`);
    return { built: true, file: outFile };
  } catch (error) {
    return { built: false, reason: String(error.stderr || error.message).trim().slice(0, 400) };
  }
}

// --- the html deck ----------------------------------------------------------

/**
 * Canvas sizes, in the units each destination actually wants: a projector-shaped 16:9 for a
 * pptx substitute and for video, 3:4 for a 小红书 carousel, 1:1 for a square feed.
 */
export const DECK_ASPECTS = {
  '16:9': { width: 1600, height: 900 },
  '4:3': { width: 1440, height: 1080 },
  '3:4': { width: 1080, height: 1440 },
  '1:1': { width: 1080, height: 1080 },
};
export const DEFAULT_ASPECT = '16:9';

export function deckAspects() {
  return Object.keys(DECK_ASPECTS);
}

export function deckSize(aspect = DEFAULT_ASPECT) {
  const size = DECK_ASPECTS[String(aspect)];
  if (!size) throw new Error(`unknown deck aspect "${aspect}" — available: ${deckAspects().join(' / ')}`);
  return size;
}

/** The same two letters the cover card carries, so the deck and the cover read as one series. */
export const DECK_MARK = 'AI';

/**
 * The deck as a list of renderable pages: a cover made from the `#` heading and whatever lead
 * paragraph followed it, then one page per `##` slide.
 *
 * The cover is page 0 so that the pages numbered 1..n stay the slides someone wrote, and the
 * outline built at compile time still lines up with them.
 */
export function deckPages(deck, { slug = '', siteName = '', footer = '' } = {}) {
  const slides = deck.slides ?? [];
  const total = slides.length;
  const shared = {
    mark: DECK_MARK,
    deck_title: deck.title,
    total,
    footer: footer || siteName,
    tag: slug,
  };
  const cover = {
    ...shared,
    number: 0,
    counter: '',
    title: deck.title,
    heading_tag: 'h1',
    kicker: '',
    lead: deck.lead ?? '',
    body: '',
    notes: '',
    frame: '00',
  };
  const pages = slides.map((slide) => ({
    ...shared,
    number: slide.index,
    counter: `${slide.index} / ${total}`,    title: slide.title,
    heading_tag: 'h2',
    kicker: '',
    lead: '',
    body: slide.html,
    notes: slide.notes ?? '',
    frame: String(slide.index).padStart(2, '0'),
  }));
  return [cover, ...pages];
}

/** The per-page document, at the canvas it will be screenshotted at. */
export function slideDocument({ page, size, css, templates, lang = 'zh-CN' }) {
  return renderTemplate(templates.slide, {
    ...page,
    lang,
    base: baseSize(size),
    width: size.width,
    height: size.height,
    css,
    fit: templates.fit,
  });
}

/** The whole deck in one scrollable, printable html file. */
export function deckDocument({ pages, size, css, templates, lang = 'zh-CN', title = '' }) {
  return renderTemplate(templates.deck, {
    pages,
    lang,
    title: title || pages[0]?.deck_title || 'deck',
    base: baseSize(size),
    width: size.width,
    height: size.height,
    css,
    fit: templates.fit,
  });
}

/** One `rem` is one percent of the canvas width, which is what makes the sizes portable. */
function baseSize({ width }) {
  return Number((width / 100).toFixed(3));
}

export function loadDeckTemplates(templatesDir) {
  const dir = path.join(templatesDir, 'deck');
  return {
    css: readText(path.join(dir, 'slide.css')),
    slide: readText(path.join(dir, 'slide.html')),
    deck: readText(path.join(dir, 'deck.html')),
    fit: readText(path.join(dir, 'fit.js')),
  };
}

/**
 * Print an html file to pdf with Chrome, waiting for the file to appear and settle.
 *
 * Same shape as the screenshot above, and for the same reason: this Chrome does not exit after
 * writing. There is one difference that matters — `--print-to-pdf` needs a browser that has the
 * print pipeline compiled in. Chromium as Playwright ships it does not, and hangs instead of
 * failing, which is why a deck run can end as a timeout rather than an error.
 */
export function printToPdf({ chrome, htmlFile, outFile, width, height, timeoutMs = 45000 }) {
  return new Promise((resolve) => {
    // Same reason as the screenshot above: a pdf from an earlier run would be mistaken for this
    // one's, and the run would end with the previous deck.
    try {
      fs.rmSync(outFile, { force: true });
    } catch {
      /* the size check below will decide either way */
    }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-chrome-'));
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
      `--window-size=${width},${height}`,
      '--virtual-time-budget=3000',
      '--no-pdf-header-footer',
      `--print-to-pdf=${outFile}`,
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
      if (exists(outFile)) {
        const size = fs.statSync(outFile).size;
        if (size > 1024 && size === lastSize) stable += 1;
        else stable = 0;
        lastSize = size;
        if (stable >= 2) {
          stop();
          resolve({ ok: true });
          return;
        }
      }
      if (Date.now() - start > timeoutMs) {
        stop();
        resolve({ ok: false, reason: `Chrome produced no pdf within ${timeoutMs / 1000}s` });
      }
    }, 250);
  });
}

/**
 * What is in the deck directory, and what it was made from.
 *
 * A rendered deck outlives the build that made it — `content build` overwrites the sources next
 * to the pictures but does not delete the pictures — so the source hash is what tells a later
 * reader whether what they are looking at is still what slides.md says.
 */
export function deckManifest({ slug, aspect, size, pages, source, files = [], timeline = null, video = null }) {
  const byNumber = new Map((timeline ?? []).map((entry) => [entry.number, entry]));
  return {
    slug,
    aspect,
    width: size.width,
    height: size.height,
    generated_at: isoNow(),
    source: 'slides.md',
    source_sha256: sha256(source).slice(0, 16),
    pages: pages.map((page) => {
      const entry = byNumber.get(page.number);
      return {
        number: page.number,
        title: page.title,
        file: page.file,
        narrated: entry ? entry.narrated : Boolean(page.notes),
        ...(entry ? { duration: entry.duration } : {}),
      };
    }),
    video,
    files,
  };
}

/**
 * Render the deck into `outDir`: the combined html, one png per page, and the pdf.
 *
 * The per-page html is written next to the images and removed afterwards, because a slide that
 * points at `assets/…` only resolves those paths from the directory they were authored for.
 */
export async function renderDeck({
  deck,
  topic,
  templates,
  outDir,
  aspect = DEFAULT_ASPECT,
  slug = '',
  siteName = '',
  lang = 'zh-CN',
  pdf = true,
  log = () => {},
}) {
  const size = deckSize(aspect);
  const pages = deckPages(deck, { slug, siteName });
  if (!pages.length) return { ok: false, reason: 'the deck has no slides', pages: [], files: [] };

  const chrome = chromePath();
  if (!chrome) return { ok: false, reason: 'no local Chrome/Chromium found (set CHROME_PATH)', pages, files: [] };

  ensureDir(outDir);
  ensureDir(path.join(outDir, 'slides'));
  const files = [];
  const notes = [];

  const deckHtml = path.join(outDir, 'deck.html');
  writeOut(deckHtml, deckDocument({ pages, size, css: templates.css, templates, lang, title: deck.title }));
  files.push('deck.html');

  // A slide may embed an illustration from the topic. Copy them so the html deck is a folder
  // someone can hand to someone else, and so the per-page renders resolve their `assets/…` paths.
  if (pages.some((page) => /["'(]assets\//.test(`${page.lead ?? ''}${page.body ?? ''}`))) {
    const copied = copyDir(topic.assetsDir, path.join(outDir, 'assets'));
    if (copied) {
      files.push(`assets/ (${copied})`);
      notes.push(`${slug}: copied ${copied} asset file(s) next to the deck`);
    }
  }

  const rendered = [];
  const pageHtml = [];
  try {
    for (const page of pages) {
      const file = path.join(outDir, `page-${page.frame}.html`);
      writeOut(file, slideDocument({ page, size, css: templates.css, templates, lang }));
      pageHtml.push(file);
      const outFile = path.join(outDir, 'slides', `${page.frame}.png`);
      const shot = await screenshot({ chrome, htmlFile: file, outFile, width: size.width, height: size.height });
      if (!shot.ok) {
        notes.push(`${slug}: page ${page.frame} rendered no image — ${shot.reason}`);
        continue;
      }
      files.push(`slides/${page.frame}.png`);
      rendered.push({ ...page, file: `slides/${page.frame}.png`, path: outFile });
      log(`  deck ${slug}: slides/${page.frame}.png  ${page.title || deck.title}`);
    }
  } finally {
    for (const file of pageHtml) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* a stray page-*.html is not worth failing the run over */
      }
    }
  }

  if (pdf) {
    const outFile = path.join(outDir, 'deck.pdf');
    const printed = await printToPdf({ chrome, htmlFile: deckHtml, outFile, width: size.width, height: size.height });
    if (printed.ok) files.push('deck.pdf');
    else notes.push(`${slug}: deck.pdf skipped — ${printed.reason}`);
  }

  return { ok: rendered.length > 0, pages: rendered, size, files, notes };
}

