// The pre-publish check: the rules the compiler cannot apply for you.
//
// `src/typography.mjs` fixes the spacing inside the article body on its way into HTML — but the title,
// the subtitle, the summary, the key facts and the call to action never go through it, and neither do
// the platform drafts. Those are the strings a reader sees first (the link preview, the card, the
// post), so they are exactly where a missing space costs the most.
//
// The rules are sparanoid/chinese-copywriting-guidelines (MIT). Only the ones a pure function can
// judge are here: 中西文之间加空格、全角标点两边不留空格、不重复标点、直角引号. Anything requiring a
// decision about meaning — 半角/全角互换、专有名词大小写、数字与单位 — is deliberately absent, because a
// checker that guesses is a checker people learn to ignore.
import path from 'node:path';
import { missingAssets } from './images.mjs';
import { exists, listDirs, readText, readTextIfExists } from './util.mjs';
import { parseYaml } from './yaml.mjs';

const CJK = '\\u3005\\u3007\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff';
/** Full-width marks that must not have a space beside them. The em dash is excluded — see typography.mjs. */
const FULLWIDTH = '，。！？；：、（）【】《》“”‘’「」『』〈〉〔〕…·';
/** Marks that legitimately double: `……` and `——`. */
const REPEATABLE = new Set(['…', '—']);
/** The full-width marks that must not double, i.e. all of them except the two above. */
const NON_REPEATABLE = [...FULLWIDTH].filter((mark) => !REPEATABLE.has(mark)).join('');

export const RULES = [
  'cjk-latin-space',
  'fullwidth-punct-space',
  'repeated-punct',
  'curly-quotes',
];

const CHECKS = [
  {
    id: 'cjk-latin-space',
    // A space is what makes `中文abc` readable; the guidelines ask for one on each side.
    pattern: new RegExp(`(?:[${CJK}][A-Za-z0-9]|[A-Za-z0-9][${CJK}])`, 'g'),
    fix: '中英文/数字之间加一个空格',
  },
  {
    id: 'fullwidth-punct-space',
    // The space has to be *between the mark and a word*, not just next to the mark: `） |` closes a
    // markdown table cell, and a rule that shouts about markdown syntax is a rule people switch off.
    pattern: new RegExp(`(?:[${CJK}A-Za-z0-9][ \\t]+[${FULLWIDTH}]|[${FULLWIDTH}][ \\t]+[${CJK}A-Za-z0-9])`, 'g'),
    fix: '全角标点两边不要留空格',
  },
  {
    id: 'repeated-punct',
    pattern: new RegExp(`([${NON_REPEATABLE}])\\1`, 'g'),
    fix: '同一个标点不要连用',
  },
  {
    id: 'curly-quotes',
    pattern: /[“”]/g,
    fix: '中文正文里用直角引号「」',
  },
];

/**
 * Blank out the parts of a markdown document that are not prose, keeping every other character in
 * place so that line and column numbers still point at the real file.
 *
 * The blank is NUL, not a space: a masked code span sitting between `一、` and `是` would turn a
 * perfectly good line into a "space before full-width punctuation" finding. NUL is in none of the
 * character classes the checks look at, so the boundary simply disappears — which is what a masked
 * region should do.
 */
const MASK = '\u0000';

export function maskMarkdown(markdown) {
  let fenced = false;
  return String(markdown ?? '')
    .split('\n')
    .map((line) => {
      const blank = (m) => MASK.repeat(m.length);
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return blank(line);
      }
      if (fenced) return blank(line);
      return line
        .replace(/`[^`]*`/g, blank)
        .replace(/\]\([^)]*\)/g, blank)
        .replace(/^\s{4,}.*$/, blank)
        .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/, blank);
    })
    .join('\n');
}

/** Every problem one string contains, with the offset so the caller can point at a line. */
export function lintText(text) {
  const problems = [];
  for (const check of CHECKS) {
    for (const match of String(text ?? '').matchAll(check.pattern)) {
      problems.push({ rule: check.id, fix: check.fix, found: match[0], index: match.index });
    }
  }
  return problems;
}

/** The strings in `source.yaml` / `cta.yaml` that are prose rather than identifiers. */
function proseFields(source, cta) {
  const fields = [];
  const add = (where, value) => {
    if (typeof value === 'string' && value.trim()) fields.push({ where, value });
  };
  add('source.yaml title', source.title);
  add('source.yaml subtitle', source.subtitle);
  add('source.yaml summary', source.summary);
  for (const [index, fact] of (source.key_facts ?? []).entries()) {
    if (typeof fact !== 'object' || fact === null) continue;
    add(`source.yaml key_facts[${index}].label`, fact.label);
    add(`source.yaml key_facts[${index}].value`, fact.value);
  }
  for (const [index, link] of (source.links ?? []).entries()) {
    if (typeof link !== 'object' || link === null) continue;
    add(`source.yaml links[${index}].label`, link.label);
  }
  add('cta.yaml headline', cta?.headline);
  add('cta.yaml body', cta?.body);
  add('cta.yaml label', cta?.label);
  for (const [platform, override] of Object.entries(source.platforms ?? {})) {
    if (typeof override !== 'object' || override === null) continue;
    for (const key of ['title', 'hook', 'text']) add(`source.yaml platforms.${platform}.${key}`, override[key]);
  }
  return fields;
}

function lineOf(text, index) {
  return String(text).slice(0, index).split('\n').length;
}

/**
 * Check one topic. Problems fail a publish; warnings are things worth knowing.
 *
 * The English fields are checked only for the rules that hold in both languages — the spacing rules
 * and the quote style are about Chinese, and an English article written `word — word` is correct.
 */
export function lintTopic(root, slug, { topicsDir = 'topics' } = {}) {
  const dir = path.join(root, topicsDir, slug);
  const source = parseYaml(readText(path.join(dir, 'source.yaml')), { file: `${slug}/source.yaml` });
  const cta = readTextIfExists(path.join(dir, 'cta.yaml')) ? parseYaml(readText(path.join(dir, 'cta.yaml')), { file: `${slug}/cta.yaml` }) : null;
  const problems = [];
  const warnings = [];

  for (const field of proseFields(source, cta)) {
    for (const problem of lintText(field.value)) {
      problems.push(`${slug}: ${field.where} — ${problem.fix}（${JSON.stringify(problem.found)}）`);
    }
  }

  const article = readTextIfExists(path.join(dir, 'article.md'));
  if (article) {
    const masked = maskMarkdown(article);
    for (const problem of lintText(masked)) {
      problems.push(`${slug}: article.md:${lineOf(masked, problem.index)} — ${problem.fix}（${JSON.stringify(problem.found.trim())}）`);
    }
  }

  // An English body is not held to the Chinese rules — `word — word` is correct there — but doubled
  // punctuation and curly quotes are mistakes in either language.
  const english = readTextIfExists(path.join(dir, 'article.en.md'));
  if (english) {
    const bilingual = lintText(maskMarkdown(english)).filter((p) => p.rule === 'repeated-punct' || p.rule === 'curly-quotes');
    for (const problem of bilingual) warnings.push(`${slug}: article.en.md — ${problem.fix}（${JSON.stringify(problem.found)}）`);
  }

  for (const missing of missingAssets({ dir, article })) {
    problems.push(`${slug}: article.md 引用了不存在的图片 ${missing} — 先跑 content images`);
  }
  if (!exists(path.join(dir, 'assets/og.png')) && !exists(path.join(dir, 'assets/og.jpg'))) {
    warnings.push(`${slug}: 没有封面图，分享链接会是白板 —— 跑 content images ${slug}`);
  }

  return { slug, problems, warnings };
}

export function lintAll(root, { topicsDir = 'topics', slugs, log = () => {} } = {}) {
  const target = slugs?.length ? slugs : listDirs(path.join(root, topicsDir));
  const reports = target.map((slug) => lintTopic(root, slug, { topicsDir }));
  const ok = reports.every((report) => report.problems.length === 0);
  for (const report of reports) {
    log(`${report.problems.length ? '✗' : '✓'} ${report.slug.padEnd(24)} ${report.problems.length ? `${report.problems.length} 个问题` : '通过'}`);
    for (const problem of report.problems) log(`    问题：${problem}`);
    for (const warning of report.warnings) log(`    注意：${warning}`);
  }
  return { reports, ok };
}

