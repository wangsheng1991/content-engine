// Chinese typography, settled while compiling.
//
// Why this is build-time code and not a browser helper: spacing is a property of
// the text, not of the view. Fixing it here means the site, the RSS feed, the
// dev.to body, the deck and the Hugging Face card all come out the same, and the
// published page keeps the single script it already has (the theme switch).
//
// The rules are sparanoid/chinese-copywriting-guidelines (MIT, README.zh-Hans.md).
// Covered:
//   - 中英文之间需要增加空格         -> insertSpacesBetweenCjkAndLatin
//   - 中文与数字之间需要增加空格      -> the same function; digits are Latin here
//   - 全角标点与其他字符之间不加空格   -> dropSpacesBesideFullwidthPunctuation
// Not covered, on purpose:
//   - 数字与单位之间需要增加空格 (`20TB` -> `20 TB`, `10Gbps` -> `10 Gbps`). Telling
//     a unit from a word depends on knowing the word; a rule that guesses would
//     also rewrite `wan2.6` and `H.264`, and a broken identifier is a worse
//     outcome than a missing space. Whoever writes the sentence decides.
//   - 全角与半角互转、直角引号、不重复使用标点、专有名词大小写、链接之间增加空格.
//     Each needs judgement about meaning (is this a product name? is this English
//     sentence quoted whole?) that a string function cannot have. None of them is
//     why this module exists.
//
// Two conservative choices worth naming, both pinned by tests:
//   - Only `[A-Za-z0-9]` counts as Latin for *inserting* a space. The halfwidth
//     signs (`% $ + - . , ! ? : ; ' " ( ) [ ] < > ~ / @ # & * = | ^`) do not: they
//     sit on both sides of a boundary (`×`, `-` in `wan2.6-i2v-flash`, `%` in
//     `15%`), so treating them as letters would push spaces into things that read
//     as one token. They only take part in the squeezing below.
//   - A space beside a full-width mark is dropped whatever sits on the other
//     side, not just when that side is Chinese — the guidelines rule is 全角标点与
//     其他字符 (`iPhone ，` -> `iPhone，`), and a full-width mark is itself the
//     evidence that a Chinese sentence is being written.
//   - Only the HTML pass looks across a tag boundary, and only when squeezing:
//     `<strong>1108×830</strong>，91.96` is one mark split in two by the emphasis
//     the author added, so the spaces around it go. Inserting a space that way
//     is not done at all — see spaceCjkHtml.
//   - The em dash is left alone: see FULLWIDTH_PUNCT.

/** The halfwidth characters that count as Latin when deciding to insert a space. */
const LATIN_OR_DIGIT = /[A-Za-z0-9]/;

/** Halfwidth signs; listed in the guidelines' character set, but only enough to keep a space. */
const HALFWIDTH_SYMBOL = /[%+\-.,!?:;'"()\[\]<>~\/@#&*=|^$]/;

/** Han (including extension A and the compatibility block) plus kana, and 々 / 〇. */
const CJK = /[\u3005\u3007\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * Marks that already space themselves out; a space next to one of these is always excess.
 *
 * The em dash is deliberately NOT in this set, unlike in the guidelines' own example. `——` is the one
 * full-width mark these articles set off with spaces on purpose (a dozen occurrences, in a voice the
 * author chose), and squeezing it also corrupts English: `word — word` is correct English typography
 * and would come back as `word—word`. Every other mark here is unambiguous.
 */
const FULLWIDTH_PUNCT = /[，。！？；：、（）【】《》“”‘’「」『』〈〉〔〕…·]/;

/** True for a blank that lives inside a line; newlines and \r are never touched. */
function isInlineSpace(ch) {
  return ch === ' ' || ch === '\t';
}

function isCjk(ch) {
  return CJK.test(ch);
}

function isLatinOrDigit(ch) {
  return LATIN_OR_DIGIT.test(ch);
}

function isFullwidthPunct(ch) {
  return FULLWIDTH_PUNCT.test(ch);
}

/**
 * Insert one space wherever Chinese and Latin/number meet directly.
 *
 * Only adjacent characters are compared, so a space that is already there is
 * never doubled, and because a space separates the pair the pass is its own
 * fixed point — that is what makes `spaceCjk` idempotent.
 */
function insertSpacesBetweenCjkAndLatin(chars) {
  const out = [];
  for (const ch of chars) {
    const previous = out[out.length - 1];
    const meets = previous !== undefined
      && ((isCjk(previous) && isLatinOrDigit(ch)) || (isLatinOrDigit(previous) && isCjk(ch)));
    if (meets) out.push(' ');
    out.push(ch);
  }
  return out;
}

/**
 * Drop the blanks that sit next to a full-width mark: `中文 ，` -> `中文，`.
 *
 * `visibleBefore` is the character the reader sees just before this run — null
 * for plain text, and set by the HTML pass when the text follows inline markup.
 *
 * A run is only dropped when there is a character on both sides of it, which is
 * what keeps leading indentation and trailing blanks intact: a run that follows a
 * newline, or that opens the fragment, has no neighbour and is left exactly as it
 * was found. Multi-space runs stay put everywhere else, where the author may have
 * aligned something on purpose.
 */
function dropSpacesBesideFullwidthPunctuation(chars, visibleBefore = null) {
  const out = [];
  for (let i = 0; i < chars.length; i += 1) {
    if (!isInlineSpace(chars[i])) {
      out.push(chars[i]);
      continue;
    }
    let end = i;
    while (end < chars.length && isInlineSpace(chars[end])) end += 1;
    const before = out.length ? out[out.length - 1] : visibleBefore;
    const after = chars[end];
    const besideMark = before != null && after !== undefined
      && (isFullwidthPunct(before) || isFullwidthPunct(after));
    if (!besideMark) {
      for (let j = i; j < end; j += 1) out.push(chars[j]);
    }
    i = end - 1;
  }
  return out;
}

/**
 * Both rules over one run of text.
 *
 * `visibleBefore` is the character the reader sees in front of this run. It is
 * null for plain text and for a fragment that opens a block; the HTML pass passes
 * it on after an inline element, so a space written on the far side of `</strong>`
 * still counts as sitting next to the mark it precedes. It feeds the squeezing
 * rule only: inserting a space across a tag boundary is where a pass like this
 * starts guessing at markup, and a guess there is how a link text ends up with a
 * space in the middle of it.
 */
function spaceText(text, visibleBefore = null) {
  const source = String(text ?? '');
  if (source === '') return '';
  const chars = Array.from(source);
  return insertSpacesBetweenCjkAndLatin(dropSpacesBesideFullwidthPunctuation(chars, visibleBefore)).join('');
}

/** Space between Chinese and Latin, and none between Chinese and full-width punctuation. */
export function spaceCjk(text) {
  return spaceText(text);
}

/** The last character a reader sees in this run, or null when it holds only blanks. */
function lastVisibleChar(text) {
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (!isInlineSpace(ch) && ch !== '\n' && ch !== '\r') return ch;
  }
  return null;
}

/** Elements that flow inside a sentence, so neither hides the character before them. */
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'cite', 'code', 'del', 'em', 'i', 'img', 'kbd', 'mark',
  'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'wbr',
]);

/** Elements whose contents are code or markup, never prose, and so must survive byte for byte. */
const PROTECTED = new Set(['code', 'kbd', 'pre', 'samp', 'script', 'style']);

/**
 * The name of the element a tag opens or closes, lowercased; `''` for comments,
 * doctypes and anything else that is not an element.
 */
function tagNameOf(tag) {
  const match = /^<\/?\s*([A-Za-z][A-Za-z0-9-]*)/.exec(tag);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Read one tag starting at `<`, honouring quoted attribute values so that a `>`
 * inside `alt="a > b"` cannot be mistaken for the end of the tag. Returns null
 * for a lone `<` with nothing to close it — that is text, not markup.
 */
function readTag(html, start) {
  if (html.startsWith('<!--', start)) {
    const end = html.indexOf('-->', start + 4);
    return end === -1 ? null : { text: html.slice(start, end + 3), end: end + 3, name: '', closing: false };
  }
  let quote = '';
  for (let i = start + 1; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') {
      const text = html.slice(start, i + 1);
      return { text, end: i + 1, name: tagNameOf(text), closing: text.startsWith('</') };
    }
  }
  return null;
}

/**
 * The offset just past the `</name>` that closes the element opened at `from`, or
 * the end of the input when the fragment never closes it — unclosed code is
 * protected to the end rather than half-processed.
 */
function endOfProtected(html, name, from) {
  const close = new RegExp(`</${name}\\s*>`, 'gi');
  close.lastIndex = from;
  const match = close.exec(html);
  return match ? match.index + match[0].length : html.length;
}

/**
 * Space Chinese in an HTML fragment, rewriting text nodes only.
 *
 * Tag names, attributes and URLs are copied through untouched, as are entities in
 * the text: characters are rewritten in place and never unescaped and re-escaped,
 * so `&amp;` can only leave as `&amp;`. Content of `<code>`, `<pre>`, `<kbd>`,
 * `<samp>`, `<script>` and `<style>` is copied without being looked at.
 *
 * A consequence worth stating: a space is never *inserted* across a tag boundary,
 * so `<code>x</code>中文` keeps the two together, even though a reader sees
 * `x中文` — guessing at a boundary is how a pass like this starts breaking markup.
 * Squeezing does cross inline markup, because the author writing `**1108×830** ——
 * 91.96` meant one space around one dash, and only the `</strong>` splits it.
 */
export function spaceCjkHtml(html) {
  const source = String(html ?? '');
  if (source === '') return '';
  const out = [];
  let i = 0;
  let visibleBefore = null;

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) {
      const text = spaceText(source.slice(i), visibleBefore);
      out.push(text);
      visibleBefore = lastVisibleChar(text) ?? visibleBefore;
      break;
    }
    if (lt > i) {
      const text = spaceText(source.slice(i, lt), visibleBefore);
      out.push(text);
      visibleBefore = lastVisibleChar(text) ?? visibleBefore;
    }

    const tag = readTag(source, lt);
    if (!tag) {
      out.push(spaceText(source.slice(lt), visibleBefore));
      break;
    }
    if (!tag.closing && PROTECTED.has(tag.name)) {
      const end = endOfProtected(source, tag.name, tag.end);
      out.push(source.slice(lt, end));
      visibleBefore = null;
      i = end;
      continue;
    }
    out.push(tag.text);
    // A block element starts a fresh sentence; an inline one does not hide what came before it.
    if (!INLINE.has(tag.name)) visibleBefore = null;
    i = tag.end;
  }

  return out.join('');
}
