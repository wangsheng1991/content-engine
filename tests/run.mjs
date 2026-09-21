// The project's own test suite: `node tests/run.mjs` (also `npm test`).
// Covers the three from-scratch parsers and then compiles the real topics
// end to end into a throwaway directory, asserting the artifacts on disk.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, loadConfig } from '../src/build.mjs';
import { extractHeadings, renderMarkdown, toPlainText } from '../src/markdown.mjs';
import { renderTemplate } from '../src/template.mjs';
import { parseYaml } from '../src/yaml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}\n    ${error.message.split('\n').join('\n    ')}`);
  }
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

  const feed = fs.readFileSync(path.join(outDir, 'site/feed.xml'), 'utf8');
  assert.ok(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.match(feed, /<item>[\s\S]*<\/item>/);

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

console.log(failures ? `\n${failures} test(s) failed` : `\nall tests passed`);
process.exitCode = failures ? 1 : 0;
