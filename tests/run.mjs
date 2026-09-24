// The project's own test suite: `node tests/run.mjs` (also `npm test`).
// Covers the three from-scratch parsers and then compiles the real topics
// end to end into a throwaway directory, asserting the artifacts on disk.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { build, loadConfig } from '../src/build.mjs';
import {
  DECK_ASPECTS,
  DEFAULT_ASPECT,
  deckDocument,
  deckManifest,
  deckPages,
  deckSize,
  loadDeckTemplates,
  slideDocument,
} from '../src/deck.mjs';
import { hasNarration, parseSlides, slideOutline } from '../src/slides.mjs';
import { buildPptx } from '../src/pptx.mjs';
import {
  DEFAULT_SECONDS,
  planTimeline,
  sayArgs,
  sayPath,
  totalSeconds,
  videoArgs,
} from '../src/video.mjs';
import { englishSummary, englishTitle, siteFor, stringsFor } from '../src/i18n.mjs';
import {
  COVER_HEIGHT,
  COVER_WIDTH,
  chromePath,
  coverOf,
  coverCardHtml,
  defaultBackend,
  englishCoverOf,
  imageSizeOf,
  missingAssets,
  planImages,
  renderImages,
} from '../src/images.mjs';
import { extractHeadings, renderMarkdown, toPlainText } from '../src/markdown.mjs';
import { lintAll, lintText, lintTopic, maskMarkdown } from '../src/lint.mjs';
import { renderTemplate } from '../src/template.mjs';
import { loadTopic } from '../src/topic.mjs';
import { parseYaml } from '../src/yaml.mjs';
import { verifyAll, verifyTopic } from '../src/verify.mjs';
import { sha256, withRef } from '../src/util.mjs';
import { spaceCjk, spaceCjkHtml } from '../src/typography.mjs';
import { hfArtifacts, resolveHfTarget } from '../src/hf.mjs';
import {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  POST_LIMIT,
  blueskyPosts,
  blueskyPublish,
  composeImages,
  composePost,
  createSession,
  graphemeLength,
  imageEmbed,
  linkFacets,
  postKey,
  readLedger,
  topicLink,
  uploadBlob,
} from '../src/bluesky.mjs';
import {
  BODY_MAX,
  TAG_LIMIT,
  TAG_MAX,
  absolutizeAssets,
  canonicalUrl,
  composeArticle,
  coverUrlOf,
  devtoArtifacts,
  devtoPublish,
  devtoTags,
  isEnglishArtifact,
  slugFromArtifact,
  stripFrontMatter,
} from '../src/devto.mjs';
import {
  DEFAULT_DURATION,
  classifyTask,
  generate as i2vGenerate,
  mimeFor,
  parseArgs as parseI2vArgs,
} from '../scripts/wan-i2v.mjs';
import {
  DEFAULT_HANDLE,
  FEEDBACK_DIR,
  blueskyRecord,
  dateKey,
  describe,
  devtoRecord,
  fetchFeedback,
  planRequests,
  slugFromCanonical,
  slugFromPost,
  unitId,
} from '../src/feedback.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Stands in for a real source page in the verify tests below. */
const SERVED_BODY = [
  'Specification sheet.',
  'The catalogue entry states that the model is released under the Apache License',
  'and ships 1.7B parameters at a 5.9 GB footprint.',
].join(' ');

let failures = 0;

/** How many times `needle` occurs in `haystack` — for assertions about markup that repeats. */
function count(haystack, needle) {
  return String(haystack).split(needle).length - 1;
}

// The pptx tests read the package back the way a reader would: every entry carries its own name and
// bytes in the local file header, so a page of parsing is enough and no unzip binary is needed.
function readZip(file) {
  const buf = fs.readFileSync(file);
  const out = {};
  for (let at = 0; at < buf.length - 4;) {
    if (buf.readUInt32LE(at) !== 0x04034b50) { at += 1; continue; }
    const method = buf.readUInt16LE(at + 8);
    const size = buf.readUInt32LE(at + 18);
    const nameLength = buf.readUInt16LE(at + 26);
    const extraLength = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 30, at + 30 + nameLength).toString();
    const start = at + 30 + nameLength + extraLength;
    const data = buf.subarray(start, start + size);
    out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString();
    at = start + size;
  }
  return out;
}

// Hand-built XML breaks by leaving a tag open or closing it in the wrong order; nothing else in the
// suite would catch that, and PowerPoint answers it with "needs repair".
function assertXml(xml) {
  const tags = xml.replace(/<!--[^]*?-->/g, '').match(/<\/?[A-Za-z_:][^>]*>/g) ?? [];
  const open = [];
  for (const tag of tags) {
    if (/^<\//.test(tag)) {
      assert.equal(open.pop(), tag.slice(2, -1).trim(), `XML close tag mismatch: ${tag}`);
    } else if (!/\/\s*>$/.test(tag) && !/^<\?/.test(tag)) {
      open.push(tag.slice(1, -1).trim().split(/\s+/)[0]);
    }
  }
  assert.equal(open.length, 0, 'XML has unclosed tags');
}

// Async cases are collected and awaited before the summary: a rejected promise that nobody waits
// for would otherwise report as a pass and then crash the process after the totals are printed.
const pending = [];

function test(name, fn) {
  pending.push(
    (async () => {
      await fn();
      console.log(`✓ ${name}`);
    })().catch((error) => {
      failures += 1;
      console.error(`✗ ${name}\n    ${error.message.split('\n').join('\n    ')}`);
    }),
  );
}

// --- slides / deck / video ---------------------------------------------------
test('slides: every `##` opens a slide, `::: notes` is narration rather than content', () => {
  const deck = parseSlides(
    [
      '# SHARP',
      '',
      'A one-line lead.',
      '',
      '## The problem',
      '',
      '::: notes',
      '这张照片没有视差。',
      ':::-ish', // a line that merely starts like a closing fence stays inside the notes
      ':::',
      '',
      '- One photo in, new viewpoints out.',
      '- A single image has no parallax.',
      '',
      '## Quick start',
      '',
      '```bash',
      '## not a slide, a shell comment',
      'sharp --help',
      '```',
      '',
      '- One line of inference.',
    ].join('\n'),
  );
  assert.equal(deck.title, 'SHARP');
  assert.match(deck.lead, /A one-line lead\./);
  assert.equal(deck.slides.length, 2, 'a `##` inside a fenced block must not split a slide');
  assert.deepEqual(deck.slides.map((s) => s.title), ['The problem', 'Quick start']);
  assert.deepEqual(deck.slides[0].bullets, ['One photo in, new viewpoints out.', 'A single image has no parallax.']);
  assert.match(deck.slides[1].html, /sharp --help/);
  assert.equal(deck.slides[0].notes, '这张照片没有视差。\n:::-ish');
  assert.equal(deck.slides[1].notes, '');
  assert.ok(!/notes/.test(deck.slides[0].html), 'narration is spoken, so it never reaches the slide body');
  assert.ok(hasNarration(deck) && !hasNarration(parseSlides('# x\n\n## a\n\n- b')));
  assert.deepEqual(deck.problems, []);

  // An unclosed notes block swallows the rest of the deck, so it is reported rather than silent.
  const unclosed = parseSlides('# d\n\n## one\n\n::: notes\n说了半句\n\n## two\n\n- b');
  assert.equal(unclosed.slides.length, 1);
  assert.match(unclosed.problems[0], /never closed \(in slide 1: one\)/);
});

test('slides: the outline is read by the same parser that renders the deck', () => {
  const source = fs.readFileSync(path.join(ROOT, 'topics/ml-sharp/slides.md'), 'utf8');
  const outline = slideOutline(source);
  const deck = parseSlides(source);
  assert.equal(outline.total, deck.slides.length);
  assert.deepEqual(
    outline.slides.map((s) => s.title),
    deck.slides.map((s) => s.title),
  );
  assert.ok(deck.slides.some((s) => s.notes), 'ml-sharp carries narration for the video');
});

test('deck: the aspect picks the canvas, and a cover is page zero', () => {
  assert.deepEqual(deckSize('3:4'), { width: 1080, height: 1440, root: 17 });
  assert.deepEqual(deckSize(), DECK_ASPECTS[DEFAULT_ASPECT]);
  assert.throws(() => deckSize('16:10'), /unknown deck aspect/);

  const pages = deckPages(parseSlides('# Deck\n\nLead.\n\n## One\n\n- a'), { slug: 'demo', siteName: 'AI Notes' });
  assert.equal(pages.length, 2);
  assert.equal(pages[0].number, 0, 'the cover is 0 so the written slides keep their own numbers');
  assert.equal(pages[0].counter, '');
  assert.equal(pages[0].heading_tag, 'h1');
  assert.equal(pages[1].counter, '1 / 1');
  assert.match(pages[0].lead, /Lead\./);
});

test('pptx: builtin writer emits an editable OOXML package and speaker notes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-test-')); const out = path.join(dir, 'deck.pptx');
  try {
    const source = fs.readFileSync(path.join(ROOT, 'topics/ml-sharp/slides.md'), 'utf8');
    const result = buildPptx({ source, outFile: out, title: 'SHARP', slug: 'ml-sharp', siteName: 'AI Research Notes' });
    const files = readZip(out); const slideNames = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    assert.equal(result.pages, parseSlides(source).slides.length + 1);
    assert.equal(slideNames.length, result.pages);
    assert.ok(files['[Content_Types].xml'] && files['ppt/presentation.xml']);
    assert.ok(Object.keys(files).some((n) => n.startsWith('ppt/notesSlides/notesSlide')));
    assert.match(files['ppt/slides/slide2.xml'], /The problem/);
    // A fitted slide multiplies every length by a fraction; OOXML wants whole EMU back, and a
    // validator or PowerPoint is the one that would otherwise say so.
    const fractionalEmu = /(?:x|y|cx|cy|lIns|rIns|tIns|bIns)="[^"]*\.[^"]*"/;
    Object.entries(files).filter(([name]) => name.endsWith('.xml')).forEach(([name, xml]) => {
      assert.doesNotMatch(xml, fractionalEmu, `${name}: coordinates are whole EMU`);
    });
    Object.entries(files).filter(([n]) => n.endsWith('.xml')).forEach(([, xml]) => assertXml(xml));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pptx: wrapped bullets reserve the measured height before the next shape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-wrap-test-')); const out = path.join(dir, 'deck.pptx');
  try {
    const source = '# Deck\n\nLead.\n\n## Wrapped\n\n- This deliberately long bullet contains enough ASCII words to wrap across multiple lines before the next item.\n- Following item.';
    buildPptx({ source, outFile: out, title: 'WRAP', slug: 'wrap', siteName: 'AI Notes' });
    const slide = readZip(out)['ppt/slides/slide2.xml'];
    const shapes = [...slide.matchAll(/<p:sp>[\s\S]*?<a:off x="900000" y="(\d+)"\/><a:ext cx="10392000" cy="(\d+)"\/>[\s\S]*?<a:t>([^<]*)<\/a:t>[\s\S]*?<\/p:sp>/g)];
    const first = shapes.find((match) => match[3].includes('This deliberately long bullet'));
    const second = shapes.find((match) => match[3].includes('Following item'));
    assert.ok(first && second, 'both bullet shapes are present');
    assert.ok(Number(second[1]) >= Number(first[1]) + Number(first[2]), 'the following bullet starts after the wrapped bullet box');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('deck: a portrait canvas gets the larger root, so a carousel is not a shrunken slide', () => {
  const templates = loadDeckTemplates(path.join(ROOT, 'templates'));
  const pages = deckPages(parseSlides('# D\n\n## S\n\n- b'));
  const wide = slideDocument({ page: pages[1], size: deckSize('16:9'), css: templates.css, templates });
  const tall = slideDocument({ page: pages[1], size: deckSize('3:4'), css: templates.css, templates });
  assert.match(wide, /html \{ font-size: 16px;/);
  assert.match(tall, /html \{ font-size: 17px;/);
  assert.match(wide, /width: 1600px; height: 900px;/);
  assert.match(tall, /width: 1080px; height: 1440px;/);
  assert.equal(count(wide, 'function fit(slide)'), 1, 'a slide that overflows is scaled down, not clipped');
  const whole = deckDocument({ pages, size: deckSize('16:9'), css: templates.css, templates, title: 'D' });
  assert.match(whole, /@page \{ size: 1600px 900px; margin: 0; \}/);
  assert.match(whole, /zoom: 1 !important/, 'the screen zoom must not leak into the print');
  assert.equal(count(whole, 'class="slide page"'), 2);
});

// --- video -------------------------------------------------------------------
test('video: a page with narration runs as long as the voice, a page without runs as long as asked', () => {
  const pages = [
    { number: 0, title: 'cover', path: '/tmp/00.png' },
    { number: 1, title: 'one', path: '/tmp/01.png' },
    { number: 2, title: 'two', path: '/tmp/02.png' },
  ];
  const timeline = planTimeline(pages, { seconds: 5, tail: 0.4, spoken: { 1: 9.472154 } });
  assert.deepEqual(timeline.map((e) => e.duration), [5, 9.87, 5]);
  assert.deepEqual(timeline.map((e) => e.narrated), [false, true, false]);
  assert.equal(totalSeconds(timeline), 19.87);

  // A synthesis that failed measured nothing, so the page keeps the still length instead of
  // disappearing from the video.
  const none = planTimeline(pages, { seconds: 4, spoken: {} });
  assert.deepEqual(none.map((e) => e.duration), [4, 4, 4]);
  assert.equal(planTimeline(pages, { seconds: 0 })[0].duration, DEFAULT_SECONDS);
});

test('video: every page gets exactly one image input and one audio input, in the same order', () => {
  const timeline = planTimeline(
    [
      { number: 1, title: 'a', path: '/tmp/01.png' },
      { number: 2, title: 'b', path: '/tmp/02.png' },
    ],
    { seconds: 5, spoken: { 2: 3 } },
  );
  const args = videoArgs({
    timeline,
    audio: { 2: '/tmp/narration-02.aiff' },
    size: { width: 1600, height: 900 },
    outFile: '/tmp/out.mp4',
  });
  assert.deepEqual(args.slice(0, 8), ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-t', '5']);
  assert.equal(count(args.join(' '), '-i '), 4, 'two images and two audio inputs');
  assert.ok(args.includes('/tmp/narration-02.aiff'));
  assert.ok(args.includes('anullsrc=r=44100:cl=stereo'), 'a page with no voice gets silence, not a gap');
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /\[0:v\][^;]*\[v0\]/);
  assert.match(graph, /\[1:v\][^;]*\[v1\]/);
  assert.match(graph, /\[2:a\][^;]*atrim=0:5\[a0\]/);
  assert.match(graph, /\[3:a\][^;]*atrim=0:3.4\[a1\]/);
  assert.match(graph, /concat=n=2:v=1:a=1\[vout\]\[aout\]$/);
  assert.equal(args[args.length - 1], '/tmp/out.mp4');
});

test('video: narration is read from a file, so quotes and dashes need no escaping', () => {
  assert.deepEqual(sayArgs({ voice: 'Tingting', outFile: '/tmp/n.aiff', textFile: '/tmp/n.txt' }), [
    '-v',
    'Tingting',
    '-o',
    '/tmp/n.aiff',
    '-f',
    '/tmp/n.txt',
  ]);
  assert.ok(sayArgs({ rate: 200, outFile: 'o', textFile: 't' }).includes('200'));
  // `say` only exists on macOS, and asking for it elsewhere is not an error — just a silent video.
  assert.equal(sayPath(), process.platform === 'darwin' ? '/usr/bin/say' : null);
});

test('deck: the manifest says what the pictures were made from and how long each page runs', () => {
  const pages = [
    { number: 0, title: 'cover', file: 'slides/00.png', notes: '' },
    { number: 1, title: 'one', file: 'slides/01.png', notes: '说一句话' },
  ];
  const manifest = deckManifest({
    slug: 'demo',
    aspect: '16:9',
    size: deckSize('16:9'),
    pages,
    source: '# Deck\n',
    files: ['deck.html'],
    timeline: planTimeline(pages, { seconds: 5, spoken: { 1: 3 } }),
    video: { file: 'deck.mp4', seconds: 8.4, fps: 30, voice: 'Tingting' },
  });
  assert.equal(manifest.source, 'slides.md');
  assert.equal(manifest.source_sha256, sha256('# Deck\n').slice(0, 16));
  assert.deepEqual(manifest.pages.map((p) => p.narrated), [false, true]);
  assert.deepEqual(manifest.pages.map((p) => p.duration), [5, 3.4]);
  assert.equal(manifest.video.seconds, 8.4);
  // Without a video there are no durations to report, only whether a page has something to say.
  const still = deckManifest({ slug: 'd', aspect: '3:4', size: deckSize('3:4'), pages, source: 'x' });
  assert.equal(still.pages[1].duration, undefined);
  assert.equal(still.pages[1].narrated, true);
  assert.equal(still.video, null);
});

// --- yaml -------------------------------------------------------------------
test('yaml: maps, sequences, block scalars, flow collections and comments', () => {
  const value = parseYaml(
    [
      '# a comment',
      'title: "quoted: value"',
      'count: 3',
      'flag: true',
      'nothing: null',
      'tags: [a, b-c, "d e"]',
      'block: |',
      '  line one',
      '  line two',
      'folded: >',
      '  one',
      '  two',
      'nested:',
      '  inner: 1',
      'items:',
      '  - label: first',
      '    url: https://example.com/a',
      '  - plain scalar',
      '  - id: x',
      '    meta:',
      '      deep: yes-please',
    ].join('\n'),
  );
  assert.equal(value.title, 'quoted: value');
  assert.equal(value.count, 3);
  assert.equal(value.flag, true);
  assert.equal(value.nothing, null);
  assert.deepEqual(value.tags, ['a', 'b-c', 'd e']);
  assert.equal(value.block, 'line one\nline two\n');
  assert.equal(value.folded, 'one two\n');
  assert.equal(value.nested.inner, 1);
  assert.equal(value.items.length, 3);
  assert.deepEqual(value.items[0], { label: 'first', url: 'https://example.com/a' });
  assert.equal(value.items[1], 'plain scalar');
  assert.equal(value.items[2].meta.deep, 'yes-please');
});

test('yaml: rejects tabs and anchors with a file:line error', () => {
  assert.throws(() => parseYaml('a:\n\tb: 1', { file: 'x.yaml' }), /x\.yaml:2/);
  assert.throws(() => parseYaml('a: &anchor 1', { file: 'x.yaml' }), /not part of the supported dialect/);
});

// --- markdown ---------------------------------------------------------------
test('markdown: headings get slug ids and code fences are escaped', () => {
  const html = renderMarkdown('# Hello World\n\n```js\nconst a = 1 < 2;\n```\n');
  assert.match(html, /<h1 id="hello-world">Hello World<\/h1>/);
  assert.match(html, /<pre><code class="language-js">const a = 1 &lt; 2;/);
});

test('markdown: tables, lists, links, emphasis and inline code', () => {
  const html = renderMarkdown(
    [
      '| a | b |',
      '| --- | ---: |',
      '| 1 | 2 |',
      '',
      '- one',
      '- two with **bold** and `code`',
      '',
      'See [docs](https://example.com) and https://plain.example.',
      '',
      '> quoted',
    ].join('\n'),
  );
  assert.match(html, /<th>a<\/th>/);
  assert.match(html, /style="text-align:right"/);
  assert.match(html, /<ul>\n<li>one<\/li>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener">docs<\/a>/);
  assert.match(html, /<a href="https:\/\/plain\.example" target="_blank" rel="noopener">/);
  assert.match(html, /<blockquote>\n<p>quoted<\/p>/);
});

test('markdown: headings inside fences are ignored, plain text strips markup', () => {
  const source = '## Real\n\n```\n## Fake\n```\n\ntext with `code` and [link](https://x.dev)\n';
  assert.deepEqual(
    extractHeadings(source).map((h) => h.text),
    ['Real'],
  );
  const plain = toPlainText(source);
  assert.ok(!plain.includes('Fake'));
  assert.ok(plain.includes('Real'));
  assert.ok(plain.includes('link'));
});

// --- template ---------------------------------------------------------------
test('template: interpolation, escaping, if/else, each with @index', () => {
  const out = renderTemplate(
    '{{title}}|{{#each items}}{{@index}}:{{name}}{{#if last}}!{{/if}} {{/each}}|{{#if missing}}no{{else}}fallback{{/if}}|{{{raw}}}',
    {
      title: 'a <b>',
      items: [
        { name: 'x', last: false },
        { name: 'y', last: true },
      ],
      raw: '<em>ok</em>',
    },
  );
  assert.equal(out, 'a &lt;b&gt;|0:x 1:y! |fallback|<em>ok</em>');
});

test('template: scalar each exposes {{this}}, nested paths and lists of lists', () => {
  assert.equal(renderTemplate('{{#each tags}}#{{this}} {{/each}}', { tags: ['a b', 'c'] }), '#a b #c ');
  assert.equal(renderTemplate('{{a.b.c}}', { a: { b: { c: 7 } } }), '7');
  assert.equal(renderTemplate('{{#each x}}{{this.0}}{{/each}}', { x: [['p', 'q']] }), 'p');
});

test('template: unknown paths render empty and blocks stay balanced', () => {
  assert.equal(renderTemplate('[{{a.b.missing}}]', { a: {} }), '[]');
  assert.throws(() => renderTemplate('{{#if a}}x', { a: 1 }), /unclosed/);
});

// --- end to end -------------------------------------------------------------
test('build: compiles every topic into tier A + tier B artifacts on disk', () => {
  const config = loadConfig(ROOT);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-engine-'));
  const manifest = build({ root: ROOT, config, outDir, log: () => {} });

  assert.ok(manifest.topics.length >= 1, 'expected at least one topic');
  assert.ok(manifest.artifacts.length >= 10, 'expected a full artifact set');

  for (const artifact of manifest.artifacts) {
    const file = path.join(outDir, artifact.path);
    assert.ok(fs.existsSync(file), `missing artifact: ${artifact.path}`);
    if (artifact.path.endsWith('.md') || artifact.path.endsWith('.json') || artifact.path.endsWith('.xml') || artifact.path.endsWith('.html') || artifact.path.endsWith('.txt')) {
      const body = fs.readFileSync(file, 'utf8');
      assert.ok(!body.includes('{{'), `unresolved template tag in ${artifact.path}`);
      assert.ok(body.trim().length > 0, `empty artifact: ${artifact.path}`);
    }
  }

  const slug = manifest.topics[0].slug;
  const kinds = new Set(manifest.artifacts.map((a) => a.kind));
  for (const kind of ['site', 'blog', 'github', 'huggingface', 'feed', 'deck', 'video', 'draft:xiaohongshu', 'draft:reddit', 'draft:x', 'draft:zhihu']) {
    assert.ok(kinds.has(kind), `no artifact of kind ${kind}`);
  }

  const page = fs.readFileSync(path.join(outDir, `site/topics/${slug}/index.html`), 'utf8');
  assert.match(page, /<html lang="zh-CN">/);
  assert.match(page, /<h1>/);
  assert.match(page, /<!doctype html>/i);

  // A link preview needs all three: a title, a description and an image. Without the image every
  // share on every platform renders as a blank card.
  assert.match(page, /<meta property="og:title" content="[^"]+">/);
  assert.match(page, /<meta property="og:description" content="[^"]+">/);
  assert.match(page, /<meta property="og:image" content="https:\/\/[^"]+\/assets\/[^"]+\.png">/);
  assert.match(page, /content="summary_large_image"/);
  const coverFile = page.match(/<meta property="og:image" content="([^"]+)">/)[1].replace(/^https:\/\/[^/]+\/content-engine\//, '');
  assert.ok(fs.existsSync(path.join(outDir, 'site', coverFile)), `the cover must ship with the site: ${coverFile}`);

  // The cover is a title card, so the index shows it and the topic/blog pages do not — repeating
  // the <h1> verbatim underneath itself is noise, not illustration.
  const index = fs.readFileSync(path.join(outDir, 'site/index.html'), 'utf8');
  assert.match(index, /class="card-cover"/);
  assert.ok(!page.includes('class="card-cover"'), 'a topic page must not repeat its own title as an image');

  const feed = fs.readFileSync(path.join(outDir, 'site/feed.xml'), 'utf8');
  assert.ok(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.match(feed, /<item>[\s\S]*<\/item>/);
  assert.match(feed, /<enclosure url="https:\/\/[^"]+\.png" type="image\/png" length="[1-9]\d*"\/>/, 'the feed carries the cover, not just the text');

  const sitemap = fs.readFileSync(path.join(outDir, 'site/sitemap.xml'), 'utf8');
  assert.match(sitemap, /<loc>[^<]+\/blog\//);

  const blog = fs.readFileSync(path.join(outDir, `blog/${slug}.md`), 'utf8');
  assert.ok(blog.startsWith('---\n'), 'blog markdown needs frontmatter');

  const storyboard = JSON.parse(fs.readFileSync(path.join(outDir, `video/${slug}/storyboard.json`), 'utf8'));
  const total = storyboard.scenes.reduce((sum, scene) => sum + scene.seconds, 0);
  assert.equal(total, storyboard.total_seconds);
  assert.equal(storyboard.scenes.at(-1).end, total);

  const hf = fs.readFileSync(path.join(outDir, `huggingface/${slug}/README.md`), 'utf8');
  assert.ok(hf.startsWith('---\n'), 'hugging face card needs frontmatter');

  const manifestFile = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  assert.equal(manifestFile.artifacts.length, manifest.artifacts.length);

  fs.rmSync(outDir, { recursive: true, force: true });
});

// --- the English side --------------------------------------------------------
// A topic gets an English page because someone wrote `article.en.md`, never because a template
// translated itself. These assertions are the guard on that: no English body, no English routes.
test('build: only the topic with an English body gets /en/ routes, and both sides link to each other', () => {
  const config = loadConfig(ROOT);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-engine-en-'));
  build({ root: ROOT, config, outDir, log: () => {} });

  const withEnglish = ['wan-i2v-first-frame', 'qwen-image-2-1-bench'];
  const withoutEnglish = ['ml-sharp'];

  for (const slug of withEnglish) {
    const en = fs.readFileSync(path.join(outDir, `site/en/blog/${slug}/index.html`), 'utf8');
    assert.match(en, /<html lang="en">/);
    assert.match(en, /<link rel="canonical" href="https:\/\/[^"]+\/en\/blog\//);
    assert.match(en, /hreflang="zh-CN"/);
    assert.match(en, /hreflang="x-default"/);
    assert.ok(!en.includes('一张照片进去'), 'the English page must not carry the Chinese call to action');
    assert.ok(!en.includes('查看仓库'), 'the English page must not carry Chinese chrome');
    // The English article *is* the English page for that topic — key_facts and evidence claims are
    // written in Chinese — so there is nothing to link to and the page must not link to itself.
    assert.ok(!en.includes('Topic page'), 'there is no English topic page to link to');
    assert.ok(!en.includes(`href="/content-engine/en/blog/${slug}/">Topic page`), 'and never a self-link');

    const zh = fs.readFileSync(path.join(outDir, `site/blog/${slug}/index.html`), 'utf8');
    assert.match(zh, new RegExp(`hreflang="en" href="https://[^"]+/en/blog/${slug}/"`));
    assert.ok(zh.includes(`href="/content-engine/topics/${slug}/">主题页</a>`), 'the Chinese page still links to its topic page');
  }
  for (const slug of withoutEnglish) {
    assert.ok(!fs.existsSync(path.join(outDir, `site/en/blog/${slug}/index.html`)));
    const zh = fs.readFileSync(path.join(outDir, `site/blog/${slug}/index.html`), 'utf8');
    assert.ok(!zh.includes('hreflang'), 'a page with no translation must not claim one');
  }

  const index = fs.readFileSync(path.join(outDir, 'site/en/index.html'), 'utf8');
  assert.match(index, /<html lang="en">/);
  assert.match(index, /href="\/content-engine\/en\/blog\/wan-i2v-first-frame\/"/, 'the English index links to the English article');
  assert.ok(!index.includes('ml-sharp'), 'a topic with no English body must not appear in the English index');

  const sitemap = fs.readFileSync(path.join(outDir, 'site/sitemap.xml'), 'utf8');
  assert.match(sitemap, /<loc>https:\/\/[^<]+\/en\/<\/loc>/);
  assert.ok(fs.existsSync(path.join(outDir, 'site/en/feed.xml')));

  fs.rmSync(outDir, { recursive: true, force: true });
});

test('i18n: the site strings switch language, and a missing English one falls back rather than blanks', () => {
  const site = { name: '站点', name_en: 'Site', tagline: '标语', tagline_en: 'Tagline', locale: 'zh-CN', locale_en: 'en-US' };
  assert.deepEqual([siteFor(site, 'zh').name, siteFor(site, 'zh').language], ['站点', 'zh']);
  assert.deepEqual([siteFor(site, 'en').name, siteFor(site, 'en').locale], ['Site', 'en-US']);
  assert.equal(siteFor({ name: '站点' }, 'en').name, '站点', 'no English name means no invented one');
  assert.equal(stringsFor('en').readMinutes, 'min read');
  assert.equal(stringsFor('zh').readMinutes, '分钟阅读');
  assert.equal(stringsFor('de').readMinutes, '分钟阅读', 'an unknown language is not a reason to crash');
});

test('i18n: the English title comes from title_en, then from the Dev.to headline, and never from a machine', () => {
  assert.equal(englishTitle({ title: '中文', title_en: 'English' }), 'English');
  assert.equal(englishTitle({ title: '中文', platforms: { devto: { title: 'Dev headline' } } }), 'Dev headline');
  assert.equal(englishTitle({ title: '中文' }), '');
  assert.equal(englishSummary({ summary: '中文摘要', summary_en: 'English summary' }), 'English summary');
});

test('build: the Chinese page gets the copywriting rules and the English page is left alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-engine-prose-'));
  fs.mkdirSync(path.join(dir, 'topics/demo/assets'), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'templates'), path.join(dir, 'templates'));
  fs.writeFileSync(
    path.join(dir, 'topics/demo/source.yaml'),
    [
      'slug: demo',
      'title: "中文标题"',
      'subtitle: "副标题"',
      'summary: "摘要里没有空格：中文abc"',
      'kind: research',
      'date: 2026-09-21',
      'tags: [甲]',
      'platforms:',
      '  devto:',
      '    title: "An English title"',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(dir, 'topics/demo/article.md'), '这段里没有空格：中文abc与数字123。\n');
  fs.writeFileSync(path.join(dir, 'topics/demo/article.en.md'), 'An English — em dash keeps its spaces.\n');
  fs.writeFileSync(path.join(dir, 'topics/demo/evidence.json'), '{"topic":"demo","claims":[]}');
  fs.writeFileSync(path.join(dir, 'topics/demo/cta.yaml'), 'label: "试试"\nurl: https://example.com\n');

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-engine-prose-out-'));
  build({ root: dir, config: { ...loadConfig(ROOT), paths: { topics: 'topics', templates: 'templates', out: outDir } }, outDir, log: () => {} });

  const zh = fs.readFileSync(path.join(outDir, 'site/blog/demo/index.html'), 'utf8');
  assert.match(zh, /中文 abc 与数字 123/, 'Chinese next to Latin or a number gets a space');
  const en = fs.readFileSync(path.join(outDir, 'site/en/blog/demo/index.html'), 'utf8');
  assert.match(en, /An English — em dash keeps its spaces\./, 'English typography must not be "corrected"');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
});

// --- verify (the publish gate) ----------------------------------------------
// These run against a local server rather than the real sources: the machine's
// route to the outside is intermittent, and a gate whose tests depend on the
// network is a gate nobody can trust.
//
// The server runs in its own process on purpose. The verifier fetches with
// execFileSync, which blocks this process's event loop — an in-process server
// could never answer it, and every fetch would time out.
const PORT_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'content-verify-')), 'port');
const SERVER_SOURCE = `
const http = require('http');
const fs = require('fs');
const body = ${JSON.stringify(SERVED_BODY)};
http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}).listen(0, '127.0.0.1', function () { fs.writeFileSync(process.argv[1], String(this.address().port)); });
`;
const serverProc = spawn(process.execPath, ['-e', SERVER_SOURCE, PORT_FILE], { stdio: 'ignore' });
for (let i = 0; i < 100 && !fs.existsSync(PORT_FILE); i += 1) await new Promise((r) => setTimeout(r, 50));
assert.ok(fs.existsSync(PORT_FILE), 'fixture server never reported a port');
const PORT = Number(fs.readFileSync(PORT_FILE, 'utf8'));
const BASE = `http://127.0.0.1:${PORT}/spec`;
const CLOSED = 'http://127.0.0.1:1/gone';

function makeFixture(dir, claims, extra = {}) {
  fs.mkdirSync(path.join(dir, 'topics/fixture'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'topics/fixture/source.yaml'), ['slug: fixture', 'title: "fixture topic"', 'kind: research', 'date: 2026-09-21', 'summary: "fixture"', ''].join('\n'));
  fs.writeFileSync(path.join(dir, 'topics/fixture/cta.yaml'), 'label: "试试"\nurl: https://example.com\n');
  fs.writeFileSync(path.join(dir, 'topics/fixture/evidence.json'), JSON.stringify({ topic: 'fixture', checked_at: '2026-09-21', claims, ...extra }, null, 1));
  return dir;
}

const FIXTURE = path.dirname(PORT_FILE);
const goodClaim = {
  id: 'license',
  claim: '该条目写明模型以 Apache 许可发布。',
  source: BASE,
  quote: 'released under the Apache License',
  verified: true,
};

test('verify: accepts a topic whose claims are structurally sound', () => {
  const dir = makeFixture(path.join(FIXTURE, 'ok'), [goodClaim]);
  const report = verifyTopic(dir, 'fixture', { topicsDir: 'topics' });
  assert.equal(report.ok, true, report.problems.join('; '));
  assert.equal(report.checked, 1);
});

test('verify: refuses a claim with no quote', () => {
  const dir = makeFixture(path.join(FIXTURE, 'noquote'), [{ id: 'x', claim: '这是一条没有引文的断言。', source: BASE }]);
  const report = verifyTopic(dir, 'fixture', { topicsDir: 'topics' });
  assert.equal(report.ok, false);
  assert.match(report.problems.join(' '), /no "quote"/);
});

test('verify: refuses a missing cta.yaml — a topic with no conversion endpoint', () => {
  const dir = makeFixture(path.join(FIXTURE, 'nocta'), [goodClaim]);
  fs.rmSync(path.join(dir, 'topics/fixture/cta.yaml'));
  const report = verifyTopic(dir, 'fixture', { topicsDir: 'topics' });
  assert.equal(report.ok, false);
  assert.match(report.problems.join(' '), /cta\.yaml is missing/);
});

test('verify: refuses a duplicate claim id', () => {
  const dir = makeFixture(path.join(FIXTURE, 'dup'), [goodClaim, { ...goodClaim }]);
  const report = verifyTopic(dir, 'fixture', { topicsDir: 'topics' });
  assert.equal(report.ok, false);
  assert.match(report.problems.join(' '), /duplicate id/);
});

test('verify --online: confirms a quote that really is in the source', () => {
  const dir = makeFixture(path.join(FIXTURE, 'verbatim'), [goodClaim]);
  const report = verifyTopic(dir, 'fixture', { topicsDir: 'topics', online: true });
  assert.equal(report.verbatim, 1, `statuses: ${JSON.stringify(report.verbatimOf)}`);
  assert.equal(report.ok, true, report.problems.join('; '));
});

test('verify --online: catches a quote that is not in the source', () => {
  const dir = makeFixture(path.join(FIXTURE, 'mismatch'), [{ ...goodClaim, id: 'invented', quote: 'this sentence appears nowhere in the served document' }]);
  const report = verifyTopic(dir, 'fixture', { topicsDir: 'topics', online: true });
  assert.equal(report.mismatched, 1);
  assert.equal(report.ok, false);
  assert.match(report.problems.join(' '), /quote not found/);
});

test('verify --online: reports an unreachable source instead of passing it', () => {
  const dead = { ...goodClaim, id: 'dead', source: CLOSED };
  const dir = makeFixture(path.join(FIXTURE, 'unreachable'), [dead]);
  const report = verifyTopic(dir, 'fixture', { topicsDir: 'topics', online: true, retries: 0, timeout: 5 });
  assert.equal(report.unreachable, 1);
  assert.equal(report.verbatim, 0);
  assert.equal(report.ok, true, 'an unreachable source is a warning by default, never a silent pass');
  assert.match(report.warnings.join(' '), /unreachable/);
});

test('verify --online --strict: an unreachable source fails the gate (for CI)', () => {
  const dead = { ...goodClaim, id: 'dead', source: CLOSED };
  const dir = makeFixture(path.join(FIXTURE, 'strict'), [dead]);
  const report = verifyTopic(dir, 'fixture', { topicsDir: 'topics', online: true, strict: true, retries: 0, timeout: 5 });
  assert.equal(report.ok, false);
  assert.match(report.problems.join(' '), /unreachable/);
});

test('verify: the real topics pass the gate offline', () => {
  const { reports, ok } = verifyAll(ROOT, { topicsDir: 'topics' });
  assert.ok(reports.length >= 1);
  assert.equal(ok, true, JSON.stringify(reports.flatMap((r) => r.problems)));
});

// --- hf (publish targeting) -------------------------------------------------
// Only the pure decisions are tested here: the upload itself needs a token and a
// network, and a suite that fails when the Hub is slow is a suite people skip.
test('hf: an explicit hf_repo wins over the configured owner', () => {
  assert.equal(resolveHfTarget('ml-sharp', { hf_repo: 'acme/elsewhere' }, { huggingface: { owner: 'shi9214' } }), 'acme/elsewhere');
  assert.equal(resolveHfTarget('ml-sharp', {}, { huggingface: { owner: 'shi9214' } }), 'shi9214/ml-sharp');
});

test('hf: a missing owner is an error, not a silent wrong namespace', () => {
  assert.throws(() => resolveHfTarget('ml-sharp', {}, {}), /no Hugging Face owner configured/);
});

test('hf: only huggingface artifacts are selected, and a slug filters them', () => {
  const manifest = {
    artifacts: [
      { kind: 'huggingface', path: 'huggingface/ml-sharp/README.md' },
      { kind: 'huggingface', path: 'huggingface/other/README.md' },
      { kind: 'site', path: 'site/index.html' },
      { kind: 'deck', path: 'deck/ml-sharp/deck.pptx' },
    ],
  };
  assert.equal(hfArtifacts(manifest).length, 2);
  assert.deepEqual(hfArtifacts(manifest, ['ml-sharp']).map((a) => a.path), ['huggingface/ml-sharp/README.md']);
});

// --- attribution -------------------------------------------------------------
// The north-star metric is "registered and completed a first generation", and it can only be
// attributed if every published route sends people to a link that names the topic. This is that
// link, so it is asserted here rather than discovered missing in an analytics dashboard.

test('withRef tags a call-to-action URL with the topic it came from', () => {
  assert.equal(withRef('https://www.dlss5nvidia.com', 'ml-sharp'), 'https://www.dlss5nvidia.com/?ref=ml-sharp');
  assert.equal(withRef('https://www.dlss5nvidia.com/editor', 'ru-doc-3x4'), 'https://www.dlss5nvidia.com/editor?ref=ru-doc-3x4');
});

test('withRef keeps an existing query string and never overrides a hand-set ref', () => {
  assert.equal(withRef('https://a.test/x?plan=pro', 'ml-sharp'), 'https://a.test/x?plan=pro&ref=ml-sharp');
  assert.equal(withRef('https://a.test/x?ref=campaign', 'ml-sharp'), 'https://a.test/x?ref=campaign');
});

test('withRef leaves a relative or missing URL alone rather than guessing an origin', () => {
  assert.equal(withRef('/pricing', 'ml-sharp'), '/pricing');
  assert.equal(withRef('', 'ml-sharp'), '');
  assert.equal(withRef(undefined, 'ml-sharp'), undefined);
  assert.equal(withRef('https://a.test/x', ''), 'https://a.test/x');
});

// --- bluesky ----------------------------------------------------------------
// Bluesky is the one platform in the plan that needs no developer app, so the publisher is the
// first half of the social chain that can actually run. Its two failure modes are invisible until
// somebody reads the result in the app: a post one character too long, and a link whose facet
// offsets were counted in characters instead of UTF-8 bytes.

const BS_CONFIG = { site: { baseUrl: 'https://example.test', language: 'en' } };

test('bluesky: the post links to the topic page it belongs to', () => {
  assert.equal(topicLink('ml-sharp', BS_CONFIG), 'https://example.test/topics/ml-sharp/');
  assert.equal(topicLink('ml-sharp', { site: { baseUrl: 'https://a.test/' } }), 'https://a.test/topics/ml-sharp/');
});

test('bluesky: a topic written for X still publishes something true about itself', () => {
  const topic = { slug: 'demo', source: { title: 'Fallback', platforms: { x: { title: 'X headline' } } } };
  const post = composePost(topic, BS_CONFIG);
  assert.ok(post.text.includes('X headline'));
  assert.ok(post.text.endsWith(post.link), post.text);
});

test('bluesky: explicit wording is kept, and the link is added if it was forgotten', () => {
  const withLink = composePost({ slug: 'demo', source: { platforms: { bluesky: { text: 'Hello\n\nhttps://example.test/topics/demo/' } } } }, BS_CONFIG);
  assert.equal(withLink.text, 'Hello\n\nhttps://example.test/topics/demo/');

  const without = composePost({ slug: 'demo', source: { platforms: { bluesky: { text: 'Hello' } } } }, BS_CONFIG);
  assert.ok(without.text.startsWith('Hello'));
  assert.ok(without.text.endsWith('https://example.test/topics/demo/'));
});

test('bluesky: a post over the limit is refused rather than silently truncated', () => {
  const topic = { slug: 'demo', source: { platforms: { bluesky: { text: 'x'.repeat(POST_LIMIT + 1) } } } };
  assert.throws(() => composePost(topic, BS_CONFIG), /300/);
  assert.equal(composePost({ slug: 'demo', source: { platforms: { bluesky: { text: 'x'.repeat(POST_LIMIT - 40) } } } }, BS_CONFIG).length <= POST_LIMIT, true);
});

test('bluesky: the limit counts graphemes, so an emoji is one character and not four', () => {
  assert.equal(graphemeLength('📸'), 1);
  assert.equal(graphemeLength('👩🏽‍💻'), 1);
  assert.equal(graphemeLength('abc'), 3);
  assert.equal(graphemeLength('汉字'), 2);
});

test('bluesky: link facets are UTF-8 byte offsets, which is the whole reason Cyrillic works', () => {
  const text = '汉字 hello https://example.com';
  assert.equal(text.indexOf('https'), 9, 'character offset, which is NOT what the API wants');

  const [facet] = linkFacets(text);
  assert.deepEqual(facet.index, { byteStart: 13, byteEnd: 13 + 'https://example.com'.length });
  assert.notEqual(facet.index.byteStart, 9);
  assert.equal(facet.features[0].uri, 'https://example.com');
  assert.equal(facet.features[0].$type, 'app.bsky.richtext.facet#link');
});

test('bluesky: a sentence-ending period is not part of the address', () => {
  const [facet] = linkFacets('See https://example.com/a.');
  assert.equal(facet.features[0].uri, 'https://example.com/a');
  assert.equal(facet.index.byteEnd, 'See https://example.com/a'.length);
});

test('bluesky: a post without a link carries no facets at all', () => {
  assert.deepEqual(linkFacets('just words'), []);
});

test('bluesky: publishing fails on a missing slug or missing credentials, before any network call', () => {
  assert.throws(() => blueskyPublish({ root: ROOT, config: BS_CONFIG, slugs: [] }), /指定要发布的主题/);
  assert.throws(() => blueskyPublish({ root: ROOT, config: BS_CONFIG, slugs: ['ml-sharp'] }), /缺少凭证/);
  assert.throws(() => createSession({ identifier: '', password: '' }), /missing/);
});

test('bluesky: a dry run prints what it would send and contacts nothing', () => {
  const lines = [];
  const result = blueskyPublish({
    root: ROOT,
    config: BS_CONFIG,
    slugs: ['ml-sharp'],
    dryRun: true,
    log: (line) => lines.push(String(line)),
  });
  assert.equal(result.ok, true);
  assert.ok(lines.some((line) => line.includes('dry-run')), 'a dry run must say so');
  assert.ok(lines.some((line) => line.includes('/topics/ml-sharp/')), 'the post must name its own page');
  assert.ok(lines.some((line) => /\/300 字符/.test(line)), 'the length must be shown before publishing');
});

// --- bluesky images ----------------------------------------------------------
// A post with a picture travels and a post without one does not, so the publisher can attach
// images. The three ways this goes wrong are all silent from the sending side: an image with no
// alt text, an image over the account's megabyte, and a blob that uploaded into a record that
// dropped it — which is why the read-back counts them.

/** A throwaway topic with one asset on disk, so nothing here touches topics/. */
function blueskyTopic({ source, files = { 'assets/demo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) } } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsky-'));
  const dir = path.join(root, 'topics', 'demo');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  for (const [rel, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), bytes);
  fs.writeFileSync(path.join(dir, 'source.yaml'), `title: "Demo"\nsummary: "A demo topic."\n${source}`);
  return { root, topic: loadTopic(root, 'demo') };
}

test('bluesky: an image is listed once, and its alt text is taken from the media list', () => {
  const { root, topic } = blueskyTopic({
    source: [
      'media:',
      '  - file: assets/demo.png',
      '    kind: image',
      '    caption: "动图版"',
      '    alt: "A screenshot of the tool."',
      'platforms:',
      '  bluesky:',
      '    text: "hello"',
      '    images: [assets/demo.png]',
      '',
    ].join('\n'),
  });
  const images = composeImages(topic, { root });
  assert.equal(images.length, 1);
  assert.equal(images[0].alt, 'A screenshot of the tool.');
  assert.equal(images[0].mime, 'image/png');
  assert.equal(images[0].bytes, 4);
  fs.rmSync(root, { recursive: true, force: true });
});

test('bluesky: an image with no alt text anywhere is refused, not posted', () => {
  const { root, topic } = blueskyTopic({
    source: ['platforms:', '  bluesky:', '    text: "hello"', '    images: [assets/demo.png]', ''].join('\n'),
  });
  assert.throws(() => composeImages(topic, { root }), /没有 alt/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('bluesky: an image over the account limit is refused before anything is uploaded', () => {
  const { root, topic } = blueskyTopic({
    files: { 'assets/big.png': Buffer.alloc(MAX_IMAGE_BYTES + 1) },
    source: [
      'media:',
      '  - file: assets/big.png',
      '    alt: "too big"',
      'platforms:',
      '  bluesky:',
      '    images: [assets/big.png]',
      '',
    ].join('\n'),
  });
  assert.throws(() => composeImages(topic, { root }), /超过 Bluesky 的 1000000/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('bluesky: five images are refused, and a missing file says which file', () => {
  const files = {};
  const entries = [];
  for (let i = 0; i < MAX_IMAGES + 1; i += 1) {
    files[`assets/${i}.png`] = Buffer.from([0x89]);
    entries.push(`  - file: assets/${i}.png`, `    alt: "image ${i}"`);
  }
  const { root, topic } = blueskyTopic({
    files,
    source: ['media:', ...entries, 'platforms:', '  bluesky:', `    images: [${Object.keys(files).join(', ')}]`, ''].join('\n'),
  });
  assert.throws(() => composeImages(topic, { root }), new RegExp(`最多 ${MAX_IMAGES} 张`));

  const missing = blueskyTopic({
    source: ['media:', '  - file: assets/nope.png', '    alt: "x"', 'platforms:', '  bluesky:', '    images: [assets/nope.png]', ''].join('\n'),
  });
  assert.throws(() => composeImages(missing.topic, { root: missing.root }), /找不到 assets\/nope\.png/);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(missing.root, { recursive: true, force: true });
});

test('bluesky: the embed keeps the order it was given, and is absent when there are no images', () => {
  const blobs = [{ $type: 'blob', ref: { $link: 'bafyone' } }, { $type: 'blob', ref: { $link: 'bafytwo' } }];
  const embed = imageEmbed([{ alt: 'first' }, { alt: 'second' }], blobs);
  assert.equal(embed.$type, 'app.bsky.embed.images');
  assert.deepEqual(embed.images.map((i) => i.alt), ['first', 'second']);
  assert.equal(embed.images[0].image.ref.$link, 'bafyone');
  assert.equal(imageEmbed([], []), undefined, 'a post with no images must carry no embed at all');
});

test('bluesky: a dry run names the images and their alt text, and contacts nothing', () => {
  const { root } = blueskyTopic({
    source: [
      'media:',
      '  - file: assets/demo.png',
      '    alt: "A screenshot of the tool."',
      'platforms:',
      '  bluesky:',
      '    text: "hello"',
      '    images: [assets/demo.png]',
      '',
    ].join('\n'),
  });
  const lines = [];
  const result = blueskyPublish({ root, config: BS_CONFIG, slugs: ['demo'], dryRun: true, log: (l) => lines.push(String(l)) });
  assert.equal(result.ok, true);
  assert.ok(lines.some((l) => l.includes('1 张图')), 'the dry run must count the images');
  assert.ok(lines.some((l) => l.includes('A screenshot of the tool.')), 'and print the alt text');
  fs.rmSync(root, { recursive: true, force: true });
});

// --- bluesky: several posts, and the record of what already went out --------------
// Posting twice is the one mistake on this platform that cannot be undone quietly: there is no
// edit, and a duplicate on somebody's timeline is the whole of the mistake. So a topic can carry
// more than one post, and what has been sent is remembered by id.

test('bluesky: a topic without posts gets one post, and a topic with posts gets them all', () => {
  assert.deepEqual(blueskyPosts({ slug: 'd', source: {} }).map((p) => p.id), ['main']);
  assert.deepEqual(
    blueskyPosts({ slug: 'd', source: { platforms: { bluesky: { text: 'hi' } } } }).map((p) => [p.id, p.text]),
    [['main', 'hi']],
  );

  const many = blueskyPosts({
    slug: 'demo',
    source: { platforms: { bluesky: { posts: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }] } } },
  });
  assert.deepEqual(many.map((p) => p.id), ['a', 'b']);
  assert.deepEqual(many.map((p) => p.text), ['one', 'two']);
});

test('bluesky: posts with duplicate ids are refused, because the ledger remembers ids', () => {
  const topic = { slug: 'demo', source: { platforms: { bluesky: { posts: [{ id: 'x' }, { id: 'x' }] } } } };
  assert.throws(() => blueskyPosts(topic), /重复/);
  assert.throws(() => blueskyPosts({ slug: 'demo', source: { platforms: { bluesky: { posts: [] } } } }), /非空列表/);
});

test('bluesky: a corrupt ledger stops the run rather than re-sending everything', () => {
  const { root } = blueskyTopic({ source: 'platforms:\n  bluesky:\n    text: "hello"\n' });
  fs.mkdirSync(path.join(root, 'data', 'published'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'published', 'bluesky.json'), '{ not json');
  assert.throws(() => readLedger(root), /读不出来/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('bluesky: a post already in the ledger is skipped, and the dry run says which', () => {
  const { root } = blueskyTopic({
    source: [
      'platforms:',
      '  bluesky:',
      '    posts:',
      '      - id: first',
      '        text: "already out"',
      '      - id: second',
      '        text: "not out yet"',
      '',
    ].join('\n'),
  });
  fs.mkdirSync(path.join(root, 'data', 'published'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'data', 'published', 'bluesky.json'),
    `${JSON.stringify({ 'demo#first': { uri: 'at://x', url: 'https://bsky.app/profile/x/post/1', at: '2026-09-24T00:00:00.000Z' } }, null, 2)}\n`,
  );

  const lines = [];
  const result = blueskyPublish({ root, config: BS_CONFIG, slugs: ['demo'], dryRun: true, log: (l) => lines.push(String(l)) });
  assert.equal(result.ok, true);
  assert.equal(result.results.find((r) => r.id === 'first').skipped, true);
  assert.equal(result.results.find((r) => r.id === 'second').skipped, false);
  assert.ok(lines.some((l) => l.includes('demo#first') && l.includes('已发过')), 'the skipped one must say so');
  assert.ok(lines.some((l) => l.includes('会发 1 条，跳过 1 条')), 'and the total must count both');

  const forced = blueskyPublish({ root, config: BS_CONFIG, slugs: ['demo'], dryRun: true, force: true, log: () => {} });
  assert.equal(forced.results.every((r) => r.skipped === false), true, '--force re-sends everything');
  fs.rmSync(root, { recursive: true, force: true });
});

test('bluesky: the ledger key is the topic and the post id, and nothing else', () => {
  assert.equal(postKey('passport-photo', 'demo'), 'passport-photo#demo');
});

// --- wan-i2v (image-to-video) -------------------------------------------------
// The reproduction script behind topics/wan-i2v-first-frame/. What is asserted here is what the
// official reference only implies: the endpoint has no synchronous mode, two of its parameters
// change the bill and neither default is the cheap one, and a task that never finishes must be an
// error rather than an empty file.

test('wan-i2v: duration is an integer range, not a two-value enum', () => {
  const base = ['--image', 'x.png', '--prompt', 'p'];
  assert.equal(parseI2vArgs([...base, '--duration', '7']).duration, 7);
  assert.equal(parseI2vArgs(base).duration, DEFAULT_DURATION);
  assert.throws(() => parseI2vArgs([...base, '--duration', '16']), /整数秒/);
  assert.throws(() => parseI2vArgs([...base, '--duration', '1']), /整数秒/);
  assert.throws(() => parseI2vArgs([...base, '--duration', '5.5']), /整数秒/);
  assert.throws(() => parseI2vArgs([...base, '--resolution', '480P']), /720P \/ 1080P/);
  assert.throws(() => parseI2vArgs(['--prompt', 'p']), /--image/);
});

test('wan-i2v: sound is off unless asked for, because the API default is on and costs double', () => {
  assert.equal(parseI2vArgs(['--image', 'x.png', '--prompt', 'p']).audio, false);
  assert.equal(parseI2vArgs(['--image', 'x.png', '--prompt', 'p', '--audio', 'true']).audio, true);
});

test('wan-i2v: an unknown image format is refused before anything is uploaded', () => {
  assert.equal(mimeFor('room.JPEG'), 'image/jpeg');
  assert.equal(mimeFor('room.webp'), 'image/webp');
  assert.throws(() => mimeFor('room.tiff'), /不认识的图片格式/);
  assert.throws(() => mimeFor('room'), /不认识的图片格式/);
});

test('wan-i2v: task states are classified, and a dead task never becomes a video', () => {
  assert.equal(classifyTask({ task_status: 'SUCCEEDED', video_url: 'https://x/v.mp4' }).state, 'done');
  for (const status of ['PENDING', 'RUNNING']) {
    assert.equal(classifyTask({ task_status: status }).state, 'waiting', status);
  }
  for (const status of ['FAILED', 'CANCELED', 'UNKNOWN']) {
    assert.equal(classifyTask({ task_status: status }).state, 'failed', status);
  }
  assert.equal(classifyTask({}).state, 'failed', 'an unrecognised status is a failure, not a wait');
});

test('wan-i2v: the request carries the async header, the resolution and the silent flag', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wan-i2v-'));
  const image = path.join(dir, 'room.png');
  fs.writeFileSync(image, Buffer.from('not really a png'));
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (String(url).includes('/video-synthesis')) return { json: async () => ({ output: { task_id: 'task_1' } }) };
    return { json: async () => ({ output: { task_status: 'SUCCEEDED', video_url: 'https://example.test/v.mp4' } }) };
  };
  const result = await i2vGenerate({ image, prompt: 'slow dolly in', key: 'test-key', fetchImpl, sleepImpl: async () => {}, now: () => 0 });

  const submit = calls[0];
  assert.equal(submit.options.headers['X-DashScope-Async'], 'enable', 'without this header the call is rejected');
  const body = JSON.parse(submit.options.body);
  assert.equal(body.model, 'wan2.6-i2v-flash');
  assert.deepEqual(body.parameters, { resolution: '720P', duration: 5, audio: false });
  assert.ok(body.input.img_url.startsWith('data:image/png;base64,'), 'a local file is inlined, no upload step');
  assert.equal(calls[1].url, 'https://dashscope.aliyuncs.com/api/v1/tasks/task_1');
  assert.equal(result.polls, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wan-i2v: a task that never finishes is an error, not an empty file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wan-i2v-'));
  const image = path.join(dir, 'room.jpg');
  fs.writeFileSync(image, Buffer.from('x'));
  let polls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('/video-synthesis')) return { json: async () => ({ output: { task_id: 'task_2' } }) };
    polls += 1;
    if (polls === 3) return { json: async () => ({ output: { task_status: 'FAILED', code: 'InvalidParameter' } }) };
    return { json: async () => ({ output: { task_status: 'RUNNING' } }) };
  };
  await assert.rejects(() => i2vGenerate({ image, prompt: 'p', key: 'k', fetchImpl, sleepImpl: async () => {} }), /FAILED \(InvalidParameter\)/);

  const stalls = async (url) => (
    String(url).includes('/video-synthesis')
      ? { json: async () => ({ output: { task_id: 'task_3' } }) }
      : { json: async () => ({ output: { task_status: 'PENDING' } }) }
  );
  await assert.rejects(() => i2vGenerate({ image, prompt: 'p', key: 'k', fetchImpl: stalls, sleepImpl: async () => {} }), /等待超时/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wan-i2v: a missing key fails before any request leaves the machine', async () => {
  await assert.rejects(() => i2vGenerate({ image: 'x.png', prompt: 'p', key: '' }), /缺少凭证/);
});

// --- devto ------------------------------------------------------------------
// Dev.to needs one API key and nothing else, which makes it the second platform the chain can
// actually reach. What is asserted here is the part a 422 would otherwise teach us in production:
// tags are strictly lowercase alphanumeric, the body must be the compiled article rather than a
// file with front matter, and the canonical URL must carry the same `ref` as every other route.

const DEVTO_CONFIG = { site: { baseUrl: 'https://example.test' }, paths: { topics: 'topics', out: '' } };

test('devto: tags are made legal instead of failing the publish', () => {
  assert.deepEqual(devtoTags(['3D vision', 'Apple', 'gaussian splatting']), ['3dvision', 'apple', 'gaussiansplatting']);
  assert.deepEqual(devtoTags(['apple', 'Apple']), ['apple'], 'case-folded duplicates collapse');
  assert.deepEqual(devtoTags(['x'.repeat(TAG_MAX + 1), 'ok']), ['ok'], 'an over-long tag is dropped, not truncated');
  assert.equal(devtoTags(['a', 'b', 'c', 'd', 'e']).length, TAG_LIMIT, 'never more than four');
  assert.deepEqual(devtoTags([]), []);
  assert.deepEqual(devtoTags(undefined), []);
});

test('devto: front matter is stripped, since the API takes a body and not a file', () => {
  assert.equal(stripFrontMatter('---\ntitle: "x"\nslug: demo\n---\n\n# Body\n'), '# Body\n');
  assert.equal(stripFrontMatter('# Body\n'), '# Body\n');
  assert.equal(stripFrontMatter(''), '');
});

test('devto: the article points search engines back at the site, while the call to action keeps the ref', () => {
  const article = composeArticle({
    slug: 'demo',
    source: { title: 'Demo', summary: 'One\n  line  only', tags: ['3D vision', 'Apple'] },
    markdown: '---\ntitle: "Demo"\n---\n\n# Body\n\nGo to https://www.dlss5nvidia.com/?ref=demo\n',
    config: DEVTO_CONFIG,
  });
  assert.equal(article.title, 'Demo');
  assert.equal(article.canonical_url, 'https://example.test/blog/demo/', 'the canonical must match what the site itself declares');
  assert.equal(article.description, 'One line only');
  assert.deepEqual(article.tags, ['3dvision', 'apple']);
  assert.equal(article.published, true);
  assert.ok(article.body_markdown.startsWith('# Body'), 'the body is the compiled article');
  assert.ok(!article.body_markdown.includes('title: "Demo"'), 'front matter must not be sent');
  assert.ok(article.body_markdown.includes('?ref=demo'), 'the call to action keeps its ref');
});

test('devto: topic-relative images become URLs a reader of the copy can actually fetch', () => {
  const body = absolutizeAssets('看这张 ![输入](assets/input-render.jpg)\n\n<img src="assets/motion.jpg">', 'demo', DEVTO_CONFIG);
  assert.match(body, /\]\(https:\/\/example\.test\/assets\/demo\/input-render\.jpg\)/);
  assert.match(body, /src="https:\/\/example\.test\/assets\/demo\/motion\.jpg"/);
  assert.equal(absolutizeAssets('![x](https://cdn.test/x.png)', 'demo', DEVTO_CONFIG), '![x](https://cdn.test/x.png)');
});

test('devto: a Chinese topic gets the English tags written for Dev.to, not an empty list', () => {
  const article = composeArticle({
    slug: 'demo',
    source: { title: '演示', tags: ['视频生成', '图生视频'], platforms: { devto: { tags: ['ai', 'video generation'] } } },
    markdown: '# Body\n',
    config: DEVTO_CONFIG,
  });
  assert.deepEqual(article.tags, ['ai', 'videogeneration']);
  assert.deepEqual(devtoTags(['视频生成']), [], 'a Chinese tag normalizes to nothing, which is why the override exists');
});

test('devto: an empty or oversized article is refused before any network call', () => {
  assert.throws(() => composeArticle({ slug: 'x', source: { title: 'X' }, markdown: '---\na: 1\n---\n', config: DEVTO_CONFIG }), /文章是空的/);
  assert.throws(() => composeArticle({ slug: 'x', source: { title: 'X' }, markdown: 'y'.repeat(BODY_MAX + 1), config: DEVTO_CONFIG }), /上限/);
});

test('devto: only compiled markdown articles are candidates, and a slug is honoured', () => {
  const manifest = {
    artifacts: [
      { path: 'blog/a.md', kind: 'blog' },
      { path: 'site/blog/a/index.html', kind: 'blog' },
      { path: 'huggingface/a/README.md', kind: 'huggingface' },
      { path: 'site/topics/b/index.html', kind: 'site' },
    ],
  };
  assert.deepEqual(devtoArtifacts(manifest, undefined).map((a) => a.path), ['blog/a.md']);
  assert.deepEqual(devtoArtifacts(manifest, ['a']).map((a) => a.path), ['blog/a.md']);
  assert.deepEqual(devtoArtifacts(manifest, ['b']), []);
  assert.deepEqual(devtoArtifacts(undefined, undefined), []);
});

test('devto: publishing fails on a missing key or a missing build, before any network call', () => {
  assert.throws(() => devtoPublish({ root: ROOT, config: DEVTO_CONFIG, manifest: { artifacts: [] }, slugs: [] }), /缺少凭证/);
  assert.throws(
    () => devtoPublish({ root: ROOT, config: DEVTO_CONFIG, manifest: { artifacts: [] }, slugs: [], apiKey: 'k', dryRun: true }),
    /先跑 content build/,
  );
  assert.throws(
    () => devtoPublish({ root: ROOT, config: DEVTO_CONFIG, manifest: { artifacts: [] }, slugs: ['demo'], apiKey: 'k' }),
    /没有编译好的文章/,
  );
});

test('devto: the English body is what goes out, and the canonical points at the English page', () => {
  const artifacts = devtoArtifacts(
    {
      artifacts: [
        { path: 'blog/wan-i2v-first-frame.md', kind: 'blog', tier: 'A' },
        { path: 'blog/wan-i2v-first-frame.en.md', kind: 'blog', tier: 'A' },
        { path: 'blog/ml-sharp.md', kind: 'blog', tier: 'A' },
      ],
    },
    [],
  );
  const paths = artifacts.map((a) => a.path);
  assert.deepEqual(paths, ['blog/wan-i2v-first-frame.en.md', 'blog/ml-sharp.md'], 'one article per topic, English first');
  // The slug has to survive the second extension, or the .en copy publishes as a topic called
  // "wan-i2v-first-frame.en".
  assert.equal(slugFromArtifact('blog/wan-i2v-first-frame.en.md'), 'wan-i2v-first-frame');
  assert.equal(isEnglishArtifact('blog/x.en.md'), true);
  assert.equal(isEnglishArtifact('blog/x.md'), false);
  assert.equal(
    canonicalUrl('demo', { site: { baseUrl: 'https://example.test' } }, { english: true }),
    'https://example.test/en/blog/demo/',
  );
});

test('devto: a dry run prints the title, tags and canonical URL, and contacts nothing', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devto-'));
  fs.mkdirSync(path.join(outDir, 'blog'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'blog', 'ml-sharp.md'), '---\ntitle: "x"\n---\n\n# Body\n\nSee https://www.dlss5nvidia.com/?ref=ml-sharp\n');

  const config = { site: { baseUrl: 'https://example.test' }, paths: { topics: 'topics', out: outDir } };
  const lines = [];
  const result = devtoPublish({
    root: ROOT,
    config,
    manifest: { artifacts: [{ path: 'blog/ml-sharp.md', kind: 'blog', tier: 'A' }] },
    slugs: [],
    dryRun: true,
    log: (line) => lines.push(String(line)),
  });
  fs.rmSync(outDir, { recursive: true, force: true });

  assert.equal(result.ok, true);
  const printed = lines.join('\n');
  assert.ok(lines.some((line) => line.includes('dry-run')), 'a dry run must say so');
  assert.match(printed, /title:\s+SHARP/);
  assert.match(printed, /canonical:\s+https:\/\/example\.test\/blog\/ml-sharp\/$/m);
  assert.match(printed, /tags:\s+\S/, 'the tags that will be submitted must be visible');
  assert.match(printed, /# Body/, 'the body preview comes from the compiled article');
});

// --- images -----------------------------------------------------------------
// The backends that need no model are tested for real; the model backend is tested against a local
// server, because a machine's route to an image API is exactly as reliable as its route to
// anything else, and a test that needs the network is a test nobody runs.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * A JPEG that carries only the segments `imageSizeOf` reads: SOI, a JFIF APP0 and an SOF0 with the
 * frame size, then EOI. Nothing here decodes it — the tests assert the size the header declares.
 */
function jpegWithSize(width, height) {
  const u16 = (value) => {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16BE(value);
    return bytes;
  };
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    Buffer.from([0xff, 0xe0]), // APP0
    u16(16),
    Buffer.from('JFIF\0', 'latin1'),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    Buffer.from([0xff, 0xc0]), // SOF0
    u16(17),
    Buffer.from([0x08]), // sample precision
    u16(height),
    u16(width),
    Buffer.from([0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]),
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

const IMAGE_SOURCE = [
  'slug: demo',
  'title: "单张图的秒级合成"',
  'subtitle: "一段副标题"',
  'kind: research',
  'date: 2026-09-21',
  'summary: "摘要"',
  'tags: [甲, 乙]',
  'platforms:',
  '  devto:',
  '    title: "Instant synthesis from a single image"',
  '    tags: [ai, video]',
  '',
].join('\n');

function imageTopic(source = IMAGE_SOURCE, { article = '## 它解决什么问题\n\n正文。\n' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-images-'));
  fs.mkdirSync(path.join(dir, 'topics/demo/assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'topics/demo/source.yaml'), source);
  fs.writeFileSync(path.join(dir, 'topics/demo/article.md'), article);
  fs.writeFileSync(path.join(dir, 'topics/demo/evidence.json'), '{"topic":"demo","claims":[]}');
  fs.writeFileSync(path.join(dir, 'topics/demo/cta.yaml'), 'label: "试试"\nurl: https://example.com\n');
  return { dir, topic: loadTopic(dir, 'demo', { topicsDir: 'topics' }) };
}

test('images: every topic gets a cover, and an English one only when an English title exists', () => {
  const { dir, topic } = imageTopic();
  const jobs = planImages(topic, { site: { name: 'AI Research Notes', author: 'wang' } });
  const ids = jobs.map((j) => j.id);
  assert.deepEqual(ids, ['cover', 'cover-en']);
  assert.equal(jobs[0].file, 'assets/og.png');
  assert.equal(jobs[1].file, 'assets/og.en.png');
  assert.equal(jobs[0].card.title, '单张图的秒级合成');
  assert.equal(jobs[1].card.title, 'Instant synthesis from a single image');
  assert.equal(jobs[0].width, COVER_WIDTH);
  assert.equal(jobs[0].height, COVER_HEIGHT);
  assert.equal(jobs[0].backend, 'card', 'the cover must not need a model to exist');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('images: a topic with no English title gets no English cover, and no model is asked for one', () => {
  const { dir, topic } = imageTopic(IMAGE_SOURCE.replace('    title: "Instant synthesis from a single image"\n', ''));
  const jobs = planImages(topic, {});
  assert.deepEqual(jobs.map((j) => j.id), ['cover']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('images: the English card takes the English tags, never the Chinese ones', () => {
  const { dir, topic } = imageTopic();
  const [, english] = planImages(topic, {});
  assert.deepEqual(english.card.tags, ['ai', 'video']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('images: a declared illustration is planned with a prompt and defaults to a model backend', () => {
  const source = `${IMAGE_SOURCE}images:\n  - id: bill\n    prompt: "一张画着账单的插画"\n    caption: "账单"\n    width: 900\n    height: 600\n`;
  const { dir, topic } = imageTopic(source);
  const job = planImages(topic, {}).find((j) => j.id === 'bill');
  assert.equal(job.file, 'assets/bill.png');
  assert.equal(job.kind, 'illustration');
  assert.equal(job.backend, 'qwen');
  assert.equal(job.width, 900);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('images: whatever a title contains is escaped before it reaches the card', () => {
  const html = coverCardHtml({
    width: 1200,
    height: 630,
    card: { title: '<script>alert(1)</script>', kicker: 'a & b', dek: '', tags: [], author: '', site: 'S', lang: 'zh', date: '' },
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'a title must never become markup');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b/);
});

test('images: a Chinese title is not given the Latin negative tracking', () => {
  const card = (title) => coverCardHtml({ width: 1200, height: 630, card: { title, kicker: '', dek: '', tags: [], author: '', site: '', lang: 'zh', date: '' } });
  assert.match(card('中文标题'), /letter-spacing: 0;/);
  assert.match(card('A Latin title'), /letter-spacing: -0\.025em;/);
});

test('images: an asset the article points at but that is absent is reported', () => {
  const { dir, topic } = imageTopic(IMAGE_SOURCE, {
    article: '## x\n\n![图](assets/missing.png)\n\n<img src="assets/also-missing.jpg">\n',
  });
  assert.deepEqual(missingAssets(topic), ['assets/also-missing.jpg', 'assets/missing.png']);
  fs.writeFileSync(path.join(dir, 'topics/demo/assets/missing.png'), TINY_PNG);
  assert.deepEqual(missingAssets(topic), ['assets/also-missing.jpg']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('images: the cover on disk is found, and is absent until it is generated', () => {
  const { dir, topic } = imageTopic();
  assert.equal(coverOf(topic), null);
  assert.equal(englishCoverOf(topic), null);
  fs.writeFileSync(path.join(dir, 'topics/demo/assets/og.png'), TINY_PNG);
  fs.writeFileSync(path.join(dir, 'topics/demo/assets/og.en.png'), TINY_PNG);
  assert.equal(coverOf(topic).rel, 'og.png');
  assert.equal(englishCoverOf(topic).rel, 'og.en.png');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('images: the qwen backend posts the prompt and writes the image the API returns', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: TINY_PNG.toString('base64') }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const config = {
    site: { baseUrl: 'https://example.test' },
    images: { backend: 'qwen', qwen: { endpoint: `http://127.0.0.1:${port}/v1/images`, apiKeyEnv: 'TEST_IMAGE_KEY', model: 'qwen-image-2.1' } },
  };
  process.env.TEST_IMAGE_KEY = 'test-key';
  const { dir, topic } = imageTopic();
  const topicWithPrompt = { ...topic, source: { ...topic.source, images: [{ id: 'illo', prompt: '一张插画', backend: 'qwen' }] } };

  const result = await renderImages({ root: dir, config, topics: [topicWithPrompt], backend: 'qwen', only: ['illo'], log: () => {} });
  server.close();

  assert.equal(result.failed.length, 0, JSON.stringify(result.failed));
  assert.equal(result.rendered.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'topics/demo/assets/illo.png')), TINY_PNG);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].auth, 'Bearer test-key', 'the key comes from the environment, never the file');
  assert.equal(seen[0].body.prompt, '一张插画');
  assert.equal(seen[0].body.model, 'qwen-image-2.1');

  const provenance = JSON.parse(fs.readFileSync(path.join(dir, 'topics/demo/images.json'), 'utf8'));
  assert.equal(provenance.images[0].id, 'illo');
  assert.equal(provenance.images[0].model, 'qwen-image-2.1');
  assert.equal(provenance.images[0].prompt, '一张插画');
  delete process.env.TEST_IMAGE_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('images: covers and illustrations pick their backend separately', () => {
  const config = { images: { backend: 'command', coverBackend: 'card', illustrationBackend: 'cloudflare' } };
  assert.equal(defaultBackend(config, 'cover'), 'card');
  assert.equal(defaultBackend(config, 'illustration'), 'cloudflare');
  // Nothing set for the other kind: the global backend, then the built-in default.
  assert.equal(defaultBackend({ images: { backend: 'command' } }, 'illustration'), 'command');
  assert.equal(defaultBackend({}, 'cover'), 'card', 'a cover must never need a model');
  assert.equal(defaultBackend({}, 'illustration'), 'qwen');

  const source = `${IMAGE_SOURCE}images:\n  - id: bill\n    prompt: "一张画着账单的插画"\n`;
  const { dir, topic } = imageTopic(source);
  const jobs = planImages(topic, config);
  assert.equal(jobs.find((j) => j.id === 'cover').backend, 'card');
  assert.equal(jobs.find((j) => j.id === 'bill').backend, 'cloudflare');
  // FLUX hands back a JPEG whatever the job is called, so the plan asks for the name it will write.
  assert.equal(jobs.find((j) => j.id === 'bill').file, 'assets/bill.jpg');
  assert.equal(jobs.find((j) => j.id === 'cover').file, 'assets/og.png');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('images: the size of a PNG or a JPEG is read from the file, not assumed', () => {
  assert.deepEqual(imageSizeOf(TINY_PNG), { width: 1, height: 1 });
  assert.deepEqual(imageSizeOf(jpegWithSize(1200, 624)), { width: 1200, height: 624 });
  assert.equal(imageSizeOf(Buffer.from('this is not an image, it is a sentence')), null);
  assert.equal(imageSizeOf(Buffer.alloc(4)), null);
});

test('images: the cloudflare backend posts a multipart form and names the file after what arrives', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result: { image: jpegWithSize(1024, 576).toString('base64') } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const config = {
    images: {
      cloudflare: {
        baseUrl: `http://127.0.0.1:${port}/client/v4/accounts`,
        model: '@cf/black-forest-labs/flux-2-klein-9b',
        steps: 4,
        accountIdEnv: 'TEST_CF_ACCOUNT',
        apiKeyEnv: 'TEST_CF_TOKEN',
      },
    },
  };
  process.env.TEST_CF_ACCOUNT = 'account-123';
  process.env.TEST_CF_TOKEN = 'test-token';

  const { dir, topic } = imageTopic();
  // Deliberately planned as `.png`: the backend must correct the name to the format it was handed.
  const withIllustration = { ...topic, source: { ...topic.source, images: [{ id: 'illo', prompt: '一张插画', file: 'assets/illo.png' }] } };
  const result = await renderImages({ root: dir, config, topics: [withIllustration], backend: 'cloudflare', only: ['illo'], log: () => {} });
  server.close();

  assert.equal(result.failed.length, 0, JSON.stringify(result.failed));
  assert.equal(result.rendered[0].file, 'assets/illo.jpg');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'topics/demo/assets/illo.jpg')), jpegWithSize(1024, 576));
  assert.equal(fs.existsSync(path.join(dir, 'topics/demo/assets/illo.png')), false, 'a stray .png would shadow the real file in the article');

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/client/v4/accounts/account-123/ai/run/@cf/black-forest-labs/flux-2-klein-9b');
  assert.equal(seen[0].auth, 'Bearer test-token', 'the key comes from the environment, never the file');
  assert.match(seen[0].type, /^multipart\/form-data; boundary=/);
  assert.match(seen[0].body, /name="prompt"\r\n\r\n一张插画/, 'the form carries the prompt as a field, not as JSON');
  assert.match(seen[0].body, /name="steps"\r\n\r\n4/);

  const provenance = JSON.parse(fs.readFileSync(path.join(dir, 'topics/demo/images.json'), 'utf8'));
  assert.equal(provenance.images[0].file, 'assets/illo.jpg');
  assert.equal(provenance.images[0].backend, 'cloudflare');
  assert.equal(provenance.images[0].model, '@cf/black-forest-labs/flux-2-klein-9b');
  assert.equal(provenance.images[0].size, '1024×576', 'the size recorded is the one that came back');
  delete process.env.TEST_CF_ACCOUNT;
  delete process.env.TEST_CF_TOKEN;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('images: a cloudflare failure names the missing variable or the API error, and writes nothing', async () => {
  const { dir, topic } = imageTopic();
  const withIllustration = { ...topic, source: { ...topic.source, images: [{ id: 'illo', prompt: '一张插画' }] } };

  const noKey = await renderImages({ root: dir, config: { images: { cloudflare: { accountIdEnv: 'TEST_CF_MISSING', apiKeyEnv: 'TEST_CF_MISSING' } } }, topics: [withIllustration], backend: 'cloudflare', only: ['illo'], log: () => {} });
  assert.match(noKey.failed[0].reason, /TEST_CF_MISSING is not set/);
  assert.equal(fs.existsSync(path.join(dir, 'topics/demo/assets/illo.jpg')), false);

  const server = http.createServer((_req, res) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errors: [{ message: 'AiError: Bad input' }], success: false }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.TEST_CF_ACCOUNT = 'account-123';
  process.env.TEST_CF_TOKEN = 'test-token';
  const bad = await renderImages({
    root: dir,
    config: { images: { cloudflare: { baseUrl: `http://127.0.0.1:${server.address().port}`, accountIdEnv: 'TEST_CF_ACCOUNT', apiKeyEnv: 'TEST_CF_TOKEN' } } },
    topics: [withIllustration],
    backend: 'cloudflare',
    only: ['illo'],
    log: () => {},
  });
  server.close();
  assert.match(bad.failed[0].reason, /HTTP 400: .*Bad input/);
  assert.equal(fs.existsSync(path.join(dir, 'topics/demo/assets/illo.jpg')), false);
  delete process.env.TEST_CF_ACCOUNT;
  delete process.env.TEST_CF_TOKEN;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('images: a model backend with no endpoint says so instead of writing an empty file', async () => {
  const { dir, topic } = imageTopic();
  const result = await renderImages({ root: dir, config: { images: {} }, topics: [topic], backend: 'qwen', log: () => {} });
  assert.equal(result.failed.length, 2, 'both the Chinese and the English cover report');
  assert.match(result.failed[0].reason, /endpoint/);
  assert.equal(fs.existsSync(path.join(dir, 'topics/demo/assets/og.png')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('images: the command backend hands the prompt and the output path to any command', async () => {
  const { dir, topic } = imageTopic();
  const source = path.join(dir, 'tiny.png');
  fs.writeFileSync(source, TINY_PNG);
  const config = { images: { command: `cp '${source}' '{out}'` } };
  const result = await renderImages({ root: dir, config, topics: [topic], backend: 'command', only: ['cover'], log: () => {} });
  assert.deepEqual(result.failed, []);
  assert.ok(fs.existsSync(path.join(dir, 'topics/demo/assets/og.png')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('images: an image already on disk is kept, so a rebuild cannot overwrite a reviewed cover', async () => {
  const { dir, topic } = imageTopic();
  const file = path.join(dir, 'topics/demo/assets/og.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from('kept'));
  const result = await renderImages({ root: dir, config: {}, topics: [topic], backend: 'command', only: ['cover'], log: () => {} });
  assert.equal(result.rendered.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), 'kept');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('images: dev.to is handed the English cover when one exists', () => {
  const { dir, topic } = imageTopic();
  const config = { site: { baseUrl: 'https://example.test' } };
  assert.equal(coverUrlOf(topic, config), undefined);
  fs.writeFileSync(path.join(dir, 'topics/demo/assets/og.png'), TINY_PNG);
  assert.equal(coverUrlOf(topic, config), 'https://example.test/assets/demo/og.png');
  fs.writeFileSync(path.join(dir, 'topics/demo/assets/og.en.png'), TINY_PNG);
  assert.equal(coverUrlOf(topic, config), 'https://example.test/assets/demo/og.en.png');
  fs.rmSync(dir, { recursive: true, force: true });
});

// `main_image`, not `cover_image`: the older name is still accepted by the API with a 201 and
// stores nothing, which is how three articles went out with no cover at all.
test('images: a cover is sent to dev.to as main_image, and a topic without one omits the field', () => {
  const withCover = composeArticle({
    slug: 'demo',
    source: parseYaml(IMAGE_SOURCE),
    markdown: '---\ntitle: x\n---\n\n# Body\n',
    config: { site: { baseUrl: 'https://example.test' } },
    coverUrl: 'https://example.test/assets/demo/og.en.png',
  });
  assert.equal(withCover.main_image, 'https://example.test/assets/demo/og.en.png');
  const without = composeArticle({
    slug: 'demo',
    source: parseYaml(IMAGE_SOURCE),
    markdown: '---\ntitle: x\n---\n\n# Body\n',
    config: { site: { baseUrl: 'https://example.test' } },
  });
  assert.ok(!('main_image' in without));
  assert.ok(!('cover_image' in without), 'the deprecated field must not be sent alongside it');
});

if (chromePath()) {
  test('images: the card backend really renders a 1200×630 png with the local Chrome', async () => {
    const { dir, topic } = imageTopic();
    const result = await renderImages({ root: dir, config: {}, topics: [topic], backend: 'card', only: ['cover'], log: () => {} });
    assert.deepEqual(result.failed, []);
    const png = path.join(dir, 'topics/demo/assets/og.png');
    const header = fs.readFileSync(png).subarray(16, 24);
    assert.equal(header.readUInt32BE(0), 1200);
    assert.equal(header.readUInt32BE(4), 630);
    fs.rmSync(dir, { recursive: true, force: true });
  });
} else {
  console.log('· 跳过 card 后端渲染测试：本机没有 Chrome/Chromium');
}

// --- typography -------------------------------------------------------------
test('typography: Chinese next to Latin or a number gets exactly one space', () => {
  assert.equal(spaceCjk('中文abc123'), '中文 abc123');
  assert.equal(spaceCjk('wan2.6-i2v-flash只需要一张首帧图'), 'wan2.6-i2v-flash 只需要一张首帧图');
  assert.equal(spaceCjk('用HDMI线接上27英寸的屏幕'), '用 HDMI 线接上 27 英寸的屏幕');
});

test('typography: a halfwidth sign never splits a token the author wrote whole', () => {
  assert.equal(spaceCjk('1024×768的效果图'), '1024×768 的效果图');
  assert.equal(spaceCjk('新 MacBook Pro 有 15%的 CPU 提升'), '新 MacBook Pro 有 15%的 CPU 提升');
  assert.equal(spaceCjk('中文(foo)'), '中文(foo)');
});

test('typography: full-width punctuation keeps no space on either side', () => {
  assert.equal(spaceCjk('中文 ，好'), '中文，好');
  assert.equal(spaceCjk('中文 。'), '中文。');
  assert.equal(spaceCjk('中文 ！'), '中文！');
  assert.equal(spaceCjk('中文 ；'), '中文；');
  assert.equal(spaceCjk('中文 ：'), '中文：');
  assert.equal(spaceCjk('中文 ？'), '中文？');
  assert.equal(spaceCjk('中文 ）'), '中文）');
  assert.equal(spaceCjk('中文 》'), '中文》');
  // The em dash is the one mark the pass leaves alone: these articles space it out on purpose,
  // and `word — word` is correct English. See FULLWIDTH_PUNCT in src/typography.mjs.
  assert.equal(spaceCjk('那个 AAC 音轨不是我们要的 —— 是没人告诉模型不要'), '那个 AAC 音轨不是我们要的 —— 是没人告诉模型不要');
  assert.equal(spaceCjk('H.264 ，是半角标点旁边的），也是'), 'H.264，是半角标点旁边的），也是');
});

test('typography: pure Chinese and pure English come back unchanged', () => {
  assert.equal(spaceCjk('这是一段纯中文的句子。'), '这是一段纯中文的句子。');
  assert.equal(spaceCjk('Stay hungry, stay foolish. 100% done'), 'Stay hungry, stay foolish. 100% done');
});

test('typography: a space that is already there is never doubled or trimmed', () => {
  assert.equal(spaceCjk('中文 abc'), '中文 abc');
  assert.equal(spaceCjk('中文  abc'), '中文  abc');
  assert.equal(spaceCjk('abc  中文'), 'abc  中文');
});

test('typography: empty input, whitespace only, and non-strings', () => {
  assert.equal(spaceCjk(''), '');
  assert.equal(spaceCjk(null), '');
  assert.equal(spaceCjk(undefined), '');
  assert.equal(spaceCjk('   '), '   ');
});

test('typography: indentation, blank lines and line breaks are left alone', () => {
  const source = '  缩进abc\n\n中文abc\n   中文abc  ';
  assert.equal(spaceCjk(source), '  缩进 abc\n\n中文 abc\n   中文 abc  ');
});

test('typography: running spaceCjk twice changes nothing the second time', () => {
  const samples = [
    '中文abc123',
    '一张 1024×768 的室内效果图，一句运动提示词。',
    '那个 AAC 音轨不是我们要的 —— 是没人告诉模型不要',
    '中文 ，好！',
    '中文 abc 中文 中文',
    'English only, with 15% and a dash - here',
  ];
  for (const sample of samples) {
    const once = spaceCjk(sample);
    assert.equal(spaceCjk(once), once, sample);
  }
});

test('typography html: attributes and urls survive, the visible text is spaced', () => {
  assert.equal(spaceCjkHtml('<a href="https://x.dev/a-b">中文link</a>'), '<a href="https://x.dev/a-b">中文 link</a>');
  assert.equal(spaceCjkHtml('<img src="中文abc.png" alt="中文abc">'), '<img src="中文abc.png" alt="中文abc">');
  assert.equal(spaceCjkHtml('<h1 id="中文abc">中文abc</h1>'), '<h1 id="中文abc">中文 abc</h1>');
});

test('typography html: code, pre, kbd and samp are never rewritten', () => {
  assert.equal(spaceCjkHtml('<code>中文abc</code>'), '<code>中文abc</code>');
  assert.equal(
    spaceCjkHtml('<pre><code class="language-js">const s = "中文abc";\n</code></pre>'),
    '<pre><code class="language-js">const s = "中文abc";\n</code></pre>',
  );
  assert.equal(spaceCjkHtml('<kbd>Ctrl+中文</kbd>'), '<kbd>Ctrl+中文</kbd>');
  assert.equal(spaceCjkHtml('<samp>中文abc</samp>'), '<samp>中文abc</samp>');
});

test('typography html: script and style bodies are copied as they are', () => {
  assert.equal(
    spaceCjkHtml('<script>var tag = "中文abc";</script>中文abc'),
    '<script>var tag = "中文abc";</script>中文 abc',
  );
  assert.equal(spaceCjkHtml('<style>.a::after{content:"中文abc"}</style>'), '<style>.a::after{content:"中文abc"}</style>');
});

test('typography html: entities are rewritten in place, never unescaped and re-escaped', () => {
  assert.equal(spaceCjkHtml('<p>AT&amp;T 与中文abc</p>'), '<p>AT&amp;T 与中文 abc</p>');
  assert.equal(spaceCjkHtml('<p>中文 &lt;tag&gt; 中文</p>'), '<p>中文 &lt;tag&gt; 中文</p>');
  assert.equal(spaceCjkHtml('<p>&#39;中文abc&#39;</p>'), '<p>&#39;中文 abc&#39;</p>');
  assert.ok(!spaceCjkHtml('<p>a &amp; b，中文abc</p>').includes('&amp;amp;'));
});

test('typography html: a quoted ">" inside an attribute is not the end of the tag', () => {
  const html = '<img src="a.png" alt="a > b 中文abc">中文abc';
  assert.equal(spaceCjkHtml(html), '<img src="a.png" alt="a > b 中文abc">中文 abc');
});

test('typography html: a mark cut off from its neighbours by inline markup is still squeezed', () => {
  assert.equal(
    spaceCjkHtml('<p>输出就是 <strong>1108×830</strong> ：91.96 万像素。</p>'),
    '<p>输出就是 <strong>1108×830</strong>：91.96 万像素。</p>',
  );
  assert.equal(spaceCjkHtml('<p><a href="/x">中文link</a> ：是</p>'), '<p><a href="/x">中文 link</a>：是</p>');
  // The em dash is the exception, and it has to stay one across a tag boundary too.
  assert.equal(
    spaceCjkHtml('<p>输出就是 <strong>1108×830</strong> —— 91.96 万像素。</p>'),
    '<p>输出就是 <strong>1108×830</strong> —— 91.96 万像素。</p>',
  );
});

test('typography html: whitespace at the edge of a block is not touched', () => {
  assert.equal(spaceCjkHtml('<p> 中文abc </p>'), '<p> 中文 abc </p>');
  assert.equal(spaceCjkHtml('<li>\n  中文abc\n</li>'), '<li>\n  中文 abc\n</li>');
  assert.equal(spaceCjkHtml('<p><br>\n中文abc</p>'), '<p><br>\n中文 abc</p>');
});

test('typography html: running spaceCjkHtml twice changes nothing the second time', () => {
  const samples = [
    '<p>中文abc，好</p>',
    '<ul>\n<li>中文abc</li>\n<li><code>中文abc</code>中文abc</li>\n</ul>',
    '<a href="/a-b">中文link</a> 与 <strong>中文abc</strong>',
    '<p>中文 &lt;tag&gt;&amp;中文abc</p>',
    '<p>输出就是 <strong>1108×830</strong> —— 91.96 万像素。</p>',
  ];
  for (const sample of samples) {
    const once = spaceCjkHtml(sample);
    assert.equal(spaceCjkHtml(once), once, sample);
  }
});

test('typography: a rendered paragraph is spaced without breaking its markup', () => {
  const html = renderMarkdown('一张 1024×768的效果图，模型wan2.6只需要一张首帧图。\n\n在LeanCloud上，数据存储是围绕`AVObject`进行的。\n');
  assert.equal(
    html,
    '<p>一张 1024×768的效果图，模型wan2.6只需要一张首帧图。</p>\n<p>在LeanCloud上，数据存储是围绕<code>AVObject</code>进行的。</p>',
  );
  assert.equal(
    spaceCjkHtml(html),
    '<p>一张 1024×768 的效果图，模型 wan2.6 只需要一张首帧图。</p>\n<p>在 LeanCloud 上，数据存储是围绕<code>AVObject</code>进行的。</p>',
  );
});

// --- lint (the copywriting gate) ---------------------------------------------
test('lint: the spacing, punctuation and quote rules fire on what they should', () => {
  const rules = (text) => lintText(text).map((p) => p.rule);
  assert.deepEqual(rules('把一张1024×768的效果图'), ['cjk-latin-space', 'cjk-latin-space']);
  assert.deepEqual(rules('wan2.6-i2v-flash只需要一张首帧图'), ['cjk-latin-space']);
  assert.deepEqual(rules('中文 ，好'), ['fullwidth-punct-space']);
  assert.deepEqual(rules('iPhone ，好开心！'), ['fullwidth-punct-space']);
  assert.deepEqual(rules('这是一句感叹！！'), ['repeated-punct']);
  assert.deepEqual(rules('他说“这是一段话”'), ['curly-quotes', 'curly-quotes']);
});

test('lint: correct copy passes, and the deliberate exceptions stay exceptions', () => {
  const rules = (text) => lintText(text).map((p) => p.rule);
  assert.deepEqual(rules('正常的中英混排 100% 没问题。'), []);
  assert.deepEqual(rules('他说「这是一段话」'), []);
  // `……` and `——` are legitimate repetitions, and a spaced em dash is the author's choice.
  assert.deepEqual(rules('他想了一会儿……那个 —— 是破折号'), []);
  // A space that closes a markdown table cell is syntax, not prose.
  assert.deepEqual(rules('| 单条成本 | ¥1.50（本该是 ¥0.75） |'), []);
});

test('lint: code, inline code, link targets and table rules are masked out', () => {
  const masked = maskMarkdown(
    ['# 标题', '', '`code 中文abc` 与 中文abc', '', '```js', 'const a = 1; 中文abc', '```', '', '[文档](https://example.com/中文abc)', ''].join('\n'),
  );
  assert.ok(!masked.includes('中文abc`'), 'inline code is masked');
  assert.ok(!masked.includes('const a = 1'), 'a fenced block is masked');
  assert.ok(!masked.includes('https://example.com'), 'a link target is masked');
  assert.ok(masked.includes('与 中文abc'), 'the prose around it is not');
  // Line numbers are read off the masked text, so its shape has to match the original exactly.
  assert.equal(masked.split('\n').length, 10);
});

test('lint: a topic with a missing asset fails and a missing cover only warns', () => {
  const { dir, topic } = imageTopic(IMAGE_SOURCE, { article: '## x\n\n![图](assets/gone.png)\n' });
  fs.writeFileSync(path.join(dir, 'topics/demo/cta.yaml'), 'headline: "标题里没有空格:中文abc"\nlabel: "试试"\nurl: https://example.com\n');
  const report = lintTopic(dir, 'demo');
  assert.equal(report.problems.length, 2, report.problems.join(' | '));
  assert.ok(report.problems.some((p) => p.includes('assets/gone.png')));
  assert.ok(report.problems.some((p) => p.includes('cta.yaml headline')));
  assert.ok(report.warnings.some((w) => w.includes('封面')));
  assert.equal(topic.slug, 'demo');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lint: the compiled topics pass their own gate', () => {
  const { reports, ok } = lintAll(ROOT, { log: () => {} });
  assert.ok(reports.length >= 2);
  assert.ok(ok, reports.flatMap((r) => r.problems).join(' | '));
});

// --- feedback (the read-only sweep after publishing) ---------------------------
// Every case here is offline: the sweep takes its transport as an argument, so the tests hand it
// fixtures and a request that is not in the fixture fails the test instead of hitting the network.
const FEEDBACK_BASE = loadConfig(ROOT).site.baseUrl.replace(/\/+$/, '');

/** The appview's shape, trimmed to the fields the sweep reads. */
function feedPost({ rkey, createdAt, text, link, likeCount = 0 }) {
  return {
    post: {
      uri: `at://did:plc:3abc/app.bsky.feed.post/${rkey}`,
      author: { handle: DEFAULT_HANDLE, did: 'did:plc:3abc' },
      record: {
        createdAt,
        text,
        ...(link ? { facets: [{ features: [{ $type: 'app.bsky.richtext.facet#link', uri: link }], index: { byteStart: 0, byteEnd: 1 } }] } : {}),
      },
      likeCount,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
      bookmarkCount: 0,
    },
  };
}

function fakeTransport(routes) {
  const asked = [];
  return {
    asked,
    json: (url) => {
      asked.push(url);
      for (const [fragment, value] of Object.entries(routes)) {
        if (url.includes(fragment)) return Promise.resolve(value);
      }
      return Promise.reject(new Error(`unexpected request: ${url}`));
    },
  };
}

const FEEDBACK_ROUTES = {
  '/articles/me/published': [
    {
      id: 4714972,
      title: 'Image-to-video in three parameters',
      url: 'https://dev.to/dlss/image-to-video-27ll',
      canonical_url: `${FEEDBACK_BASE}/blog/wan-i2v-first-frame/`,
      published_timestamp: '2026-09-22T10:09:33Z',
      page_views_count: 0,
      public_reactions_count: 0,
      comments_count: 0,
      user: { username: 'dlss', user_id: 4137297 },
    },
    {
      id: 4714731,
      title: 'SHARP：单张图的秒级 3D 高斯视图合成',
      url: 'https://dev.to/dlss/sharp-9a1',
      canonical_url: `${FEEDBACK_BASE}/en/blog/ml-sharp/`,
      published_timestamp: '2026-09-22T09:48:32Z',
      page_views_count: 4,
      public_reactions_count: 0,
      comments_count: 0,
    },
    // Not ours: the canonical points at somebody else's blog.
    { id: 999, title: 'Elsewhere', canonical_url: 'https://example.com/blog/elsewhere/', page_views_count: 10 },
  ],
  '/analytics/totals': {
    page_views: { total: 4, average_read_time_in_seconds: 30, total_read_time_in_seconds: 120 },
    reactions: { total: 0, like: 0 },
    comments: { total: 0 },
    follows: { total: 0 },
  },
  '/analytics/historical': { '2026-09-22': { page_views: { total: 4 } } },
  'getProfile?actor=': { handle: DEFAULT_HANDLE, did: 'did:plc:3abc', followersCount: 12, followsCount: 24, postsCount: 13 },
  'getAuthorFeed?actor=': {
    feed: [
      feedPost({ rkey: '3mw3ybt3v6o2l', createdAt: '2026-09-22T10:09:20.817Z', text: 'Wan 2.6 image-to-video, five seconds.', link: `${FEEDBACK_BASE}/topics/wan-i2v-first-frame/` }),
      feedPost({ rkey: '3mw3t223ifg2x', createdAt: '2026-09-22T08:35:28.674Z', text: "Apple's SHARP, one photo in.", link: `${FEEDBACK_BASE}/topics/ml-sharp/`, likeCount: 3 }),
      feedPost({ rkey: '3mouh6wwnjr25', createdAt: '2026-06-22T08:18:31.001Z', text: '인테리어 업체 부르기 전, 이 사진 한 장 보세요. RenVi #인테리어' }),
    ],
  },
  'getLikes?uri=': { likes: [{ actor: { handle: 'fan.bsky.social', did: 'did:plc:fan' }, indexedAt: '2026-09-22T11:00:00Z' }] },
};

test('feedback: an article is joined to its topic through the canonical URL it was published with', () => {
  assert.equal(slugFromCanonical(`${FEEDBACK_BASE}/blog/ml-sharp/`, FEEDBACK_BASE), 'ml-sharp');
  assert.equal(slugFromCanonical(`${FEEDBACK_BASE}/en/blog/wan-i2v-first-frame/`, FEEDBACK_BASE), 'wan-i2v-first-frame');
  assert.equal(slugFromCanonical(`${FEEDBACK_BASE}/blog/ml-sharp/?ref=ml-sharp`, FEEDBACK_BASE), 'ml-sharp');
  // The topic page and an article on somebody else's blog are not this site's blog canonical.
  assert.equal(slugFromCanonical(`${FEEDBACK_BASE}/topics/ml-sharp/`, FEEDBACK_BASE), null);
  assert.equal(slugFromCanonical('https://dev.to/dlss/copy-9a1', FEEDBACK_BASE), null);
  assert.equal(slugFromCanonical(null, FEEDBACK_BASE), null);
});

test('feedback: a Bluesky post is joined through the topic link it carries, never by its wording', () => {
  const post = feedPost({ rkey: '3mw3ybt3v6o2l', createdAt: '2026-09-22T10:09:20.817Z', text: 'Wan 2.6.', link: `${FEEDBACK_BASE}/topics/wan-i2v-first-frame/` }).post;
  assert.equal(slugFromPost(post, FEEDBACK_BASE), 'wan-i2v-first-frame');
  // The facet is what carries the link; the text may have been trimmed by a client.
  assert.equal(slugFromPost({ ...post, record: { ...post.record, text: 'trimmed' } }, FEEDBACK_BASE), 'wan-i2v-first-frame');
  assert.equal(
    slugFromPost({ ...post, record: { createdAt: post.record.createdAt, text: `看这里 ${FEEDBACK_BASE}/topics/ml-sharp/?x=1 谢谢` } }, FEEDBACK_BASE),
    'ml-sharp',
  );
  const foreign = feedPost({ rkey: '3mouh6wwnjr25', createdAt: '2026-06-22T08:18:31.001Z', text: '인테리어 업체 부르기 전 RenVi' }).post;
  assert.equal(slugFromPost(foreign, FEEDBACK_BASE), null);
});

test('feedback: the record shapes carry the numbers, and a number the platform withheld stays null', () => {
  const article = FEEDBACK_ROUTES['/articles/me/published'][0];
  const record = devtoRecord(article, { topic: 'wan-i2v-first-frame', fetchedAt: '2026-09-23T09:00:00Z' });
  assert.equal(record.topic, 'wan-i2v-first-frame');
  assert.equal(record.channel, 'devto');
  assert.equal(record.external_id, 4714972);
  assert.equal(record.canonical_url, `${FEEDBACK_BASE}/blog/wan-i2v-first-frame/`);
  assert.deepEqual(record.metrics, { pageViews: 0, reactions: 0, comments: 0 });
  // A zero is an answer; a null means the key was refused, and the two must not look alike.
  assert.equal(devtoRecord({ id: 1, page_views_count: null }, { topic: 'x', fetchedAt: 'now' }).metrics.pageViews, null);

  const bsky = blueskyRecord(feedPost({ rkey: '3mw3ybt3v6o2l', createdAt: '2026-09-22T10:09:20.817Z', text: 'x' }).post, {
    topic: 'wan-i2v-first-frame',
    fetchedAt: '2026-09-23T09:00:00Z',
    likers: [{ actor: { handle: 'fan.bsky.social', did: 'did:plc:fan' }, indexedAt: '2026-09-22T11:00:00Z' }],
  });
  assert.deepEqual(Object.keys(bsky.metrics), ['likeCount', 'repostCount', 'replyCount', 'quoteCount', 'bookmarkCount']);
  assert.equal(bsky.external_id, 'at://did:plc:3abc/app.bsky.feed.post/3mw3ybt3v6o2l');
  assert.equal(bsky.external_url, `https://bsky.app/profile/${DEFAULT_HANDLE}/post/3mw3ybt3v6o2l`);
  assert.equal(bsky.published_at, '2026-09-22T10:09:20.817Z');
  assert.deepEqual(bsky.likers, [{ handle: 'fan.bsky.social', did: 'did:plc:fan', indexedAt: '2026-09-22T11:00:00Z' }]);
  assert.equal(unitId('ml-sharp', 'bluesky'), 'ml-sharp.bluesky');
});

test('feedback: --dry-run names every endpoint and sends nothing', async () => {
  const transport = fakeTransport({});
  const result = await fetchFeedback({ root: ROOT, config: loadConfig(ROOT), apiKey: 'unused', transport, dryRun: true, log: () => {} });
  assert.ok(result.dryRun);
  assert.equal(transport.asked.length, 0, 'dry-run must not send a request');
  const urls = result.plan.map((r) => r.url).join('\n');
  for (const fragment of ['/articles/me/published', '/analytics/totals', '/analytics/historical?start=', 'getProfile?actor=', 'getAuthorFeed?actor=', 'getLikes?uri=']) {
    assert.ok(urls.includes(fragment), `the plan mentions ${fragment}`);
  }
  // The history window is the seven days up to and including today.
  const historical = result.plan.find((r) => r.url.includes('historical')).url.split('/analytics/historical')[1];
  assert.equal(historical, `?start=${dateKey(new Date(), -6)}&end=${dateKey(new Date(), 0)}`);
});

test('feedback: one file per content unit, and a second run the same day overwrites it', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-'));
  try {
    const first = await fetchFeedback({
      root: ROOT,
      config: loadConfig(ROOT),
      outDir,
      apiKey: 'test',
      transport: fakeTransport(FEEDBACK_ROUTES),
      now: new Date('2026-09-23T09:00:00Z'),
      log: () => {},
    });
    assert.deepEqual(
      first.records.map((r) => unitId(r.topic, r.channel)),
      ['ml-sharp.bluesky', 'ml-sharp.devto', 'wan-i2v-first-frame.bluesky', 'wan-i2v-first-frame.devto'],
    );
    assert.deepEqual(fs.readdirSync(outDir).sort(), ['_account.json', 'ml-sharp.bluesky.json', 'ml-sharp.devto.json', 'wan-i2v-first-frame.bluesky.json', 'wan-i2v-first-frame.devto.json']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(outDir, 'ml-sharp.devto.json'), 'utf8')).metrics.pageViews, 4);
    assert.equal(JSON.parse(fs.readFileSync(path.join(outDir, 'ml-sharp.bluesky.json'), 'utf8')).metrics.likeCount, 3);
    // The account-level numbers, which no single content unit owns.
    const account = JSON.parse(fs.readFileSync(path.join(outDir, '_account.json'), 'utf8'));
    assert.equal(account.bluesky.followersCount, 12);
    assert.equal(account.devto.user_id, 4137297);
    assert.equal(account.devto.totals.page_views.total, 4);

    // A remote record with no topic behind it is reported instead of being written as a fake unit.
    assert.ok(first.unmatched.some((u) => u.channel === 'devto' && u.external_id === 999));
    assert.ok(first.unmatched.some((u) => u.channel === 'bluesky' && /RenVi/.test(u.text)));

    await fetchFeedback({
      root: ROOT,
      config: loadConfig(ROOT),
      outDir,
      apiKey: 'test',
      transport: fakeTransport(FEEDBACK_ROUTES),
      now: new Date('2026-09-23T21:00:00Z'),
      log: () => {},
    });
    assert.equal(fs.readdirSync(outDir).length, 5, 'a second run overwrites; it does not append');
    const again = JSON.parse(fs.readFileSync(path.join(outDir, 'ml-sharp.devto.json'), 'utf8'));
    assert.equal(again.topic, 'ml-sharp');
    assert.equal(again.fetched_at, '2026-09-23T21:00:00Z', 'the record was replaced');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('feedback: without a key, or with one channel down, it says so instead of inventing numbers', async () => {
  const transport = fakeTransport({});
  await assert.rejects(
    () => fetchFeedback({ root: ROOT, config: loadConfig(ROOT), outDir: os.tmpdir(), apiKey: undefined, transport, log: () => {} }),
    /DEVTO_API_KEY/,
  );
  assert.equal(transport.asked.length, 0, 'no key means no request at all');

  const partial = await fetchFeedback({
    root: ROOT,
    config: loadConfig(ROOT),
    outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-')),
    apiKey: 'test',
    transport: {
      asked: [],
      json: (url) => (url.includes('dev.to') ? Promise.reject(new Error('dev.to 返回 HTTP 401：unauthorized')) : fakeTransport(FEEDBACK_ROUTES).json(url)),
    },
    log: () => {},
  });
  assert.equal(partial.errors.length, 1);
  assert.match(partial.errors[0].message, /401/);
  assert.ok(partial.records.every((r) => r.channel === 'bluesky'), 'the working channel still lands');
  fs.rmSync(path.dirname(partial.files[0]), { recursive: true, force: true });
});

test('feedback: the summary names the unit and every metric, and the numbers never enter git', () => {
  const line = describe({ topic: 'ml-sharp', channel: 'bluesky', metrics: { likeCount: 0, repostCount: null }, likers: [{ handle: 'fan.bsky.social' }] });
  assert.ok(line.startsWith('ml-sharp.bluesky'));
  assert.ok(line.includes('likeCount 0'));
  assert.ok(line.includes('repostCount —'), 'a withheld metric reads as missing, not as zero');
  assert.ok(line.includes('fan.bsky.social'));
  assert.ok(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').includes(`${FEEDBACK_DIR}/`));
});

await Promise.all(pending);

serverProc.kill();
fs.rmSync(FIXTURE, { recursive: true, force: true });

console.log(failures ? `\n${failures} test(s) failed` : `\nall tests passed`);
process.exitCode = failures ? 1 : 0;
