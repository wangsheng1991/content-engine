// The project's own test suite: `node tests/run.mjs` (also `npm test`).
// Covers the three from-scratch parsers and then compiles the real topics
// end to end into a throwaway directory, asserting the artifacts on disk.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, loadConfig } from '../src/build.mjs';
import {
  COVER_HEIGHT,
  COVER_WIDTH,
  chromePath,
  coverOf,
  coverCardHtml,
  englishCoverOf,
  missingAssets,
  planImages,
  renderImages,
} from '../src/images.mjs';
import { extractHeadings, renderMarkdown, toPlainText } from '../src/markdown.mjs';
import { renderTemplate } from '../src/template.mjs';
import { loadTopic } from '../src/topic.mjs';
import { parseYaml } from '../src/yaml.mjs';
import { verifyAll, verifyTopic } from '../src/verify.mjs';
import { withRef } from '../src/util.mjs';
import { hfArtifacts, resolveHfTarget } from '../src/hf.mjs';
import { POST_LIMIT, blueskyPublish, composePost, createSession, graphemeLength, linkFacets, topicLink } from '../src/bluesky.mjs';
import {
  BODY_MAX,
  TAG_LIMIT,
  TAG_MAX,
  absolutizeAssets,
  composeArticle,
  coverUrlOf,
  devtoArtifacts,
  devtoPublish,
  devtoTags,
  stripFrontMatter,
} from '../src/devto.mjs';
import {
  DEFAULT_DURATION,
  classifyTask,
  generate as i2vGenerate,
  mimeFor,
  parseArgs as parseI2vArgs,
} from '../scripts/wan-i2v.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Stands in for a real source page in the verify tests below. */
const SERVED_BODY = [
  'Specification sheet.',
  'The catalogue entry states that the model is released under the Apache License',
  'and ships 1.7B parameters at a 5.9 GB footprint.',
].join(' ');

let failures = 0;

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
  assert.match(page, /<html lang="zh">/);
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

test('images: a cover is sent to dev.to as cover_image, and a topic without one omits the field', () => {
  const withCover = composeArticle({
    slug: 'demo',
    source: parseYaml(IMAGE_SOURCE),
    markdown: '---\ntitle: x\n---\n\n# Body\n',
    config: { site: { baseUrl: 'https://example.test' } },
    coverUrl: 'https://example.test/assets/demo/og.en.png',
  });
  assert.equal(withCover.cover_image, 'https://example.test/assets/demo/og.en.png');
  const without = composeArticle({
    slug: 'demo',
    source: parseYaml(IMAGE_SOURCE),
    markdown: '---\ntitle: x\n---\n\n# Body\n',
    config: { site: { baseUrl: 'https://example.test' } },
  });
  assert.ok(!('cover_image' in without));
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

await Promise.all(pending);

serverProc.kill();
fs.rmSync(FIXTURE, { recursive: true, force: true });

console.log(failures ? `\n${failures} test(s) failed` : `\nall tests passed`);
process.exitCode = failures ? 1 : 0;
