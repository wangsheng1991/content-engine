// Minimal CommonMark-flavoured renderer for the subset the topic files use:
// ATX headings, fenced code, blockquotes, GFM tables, nested lists, hr,
// paragraphs, and inline code / emphasis / links / images / bare autolinks.
import { escapeHtml, slugify } from './util.mjs';

const FENCE = /^(```+|~~~+)\s*([A-Za-z0-9+#._-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;

/** Render markdown to an HTML fragment. */
export function renderMarkdown(source) {
  const lines = stripComments(String(source ?? '')).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const lang = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : '';
      const body = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i += 1; // closing fence (or EOF)
      out.push(`<pre><code${lang}>${escapeHtml(body.join('\n'))}\n</code></pre>`);
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      out.push(`<h${level} id="${slugify(text)}">${inline(text)}</h${level}>`);
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    if (TABLE_ROW.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const { html, next } = renderTable(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>\n${renderMarkdown(body.join('\n'))}\n</blockquote>`);
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const { html, next } = renderList(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const body = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines, i)) body.push(lines[i++]);
    out.push(`<p>${inline(body.join('\n'))}</p>`);
  }

  return out.join('\n');
}

function isBlockStart(lines, i) {
  if (i > 0 && /^\s*$/.test(lines[i - 1] ?? '')) return false;
  const line = lines[i];
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    /^\s*>/.test(line) ||
    LIST_ITEM.test(line) ||
    (TABLE_ROW.test(line) && isTableSeparator(lines[i + 1] ?? ''))
  );
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line ?? '');
}

function splitRow(row) {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function renderTable(lines, start) {
  const header = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
  let i = start + 2;
  const rows = [];
  while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(splitRow(lines[i++]));

  const cell = (text, index, tag) => {
    const align = aligns[index];
    return `<${tag}${align ? ` style="text-align:${align}"` : ''}>${inline(text)}</${tag}>`;
  };
  const head = header.map((h, idx) => cell(h, idx, 'th')).join('');
  const body = rows
    .map((row) => `<tr>${row.map((c, idx) => cell(c, idx, 'td')).join('')}</tr>`)
    .join('\n');
  return {
    html: `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`,
    next: i,
  };
}

function renderList(lines, start) {
  const items = [];
  let i = start;
  while (i < lines.length) {
    const match = lines[i].match(LIST_ITEM);
    if (!match) {
      if (/^\s*$/.test(lines[i])) break;
      if (items.length && /^\s{2,}\S/.test(lines[i])) {
        items[items.length - 1].push(lines[i].trim());
        i += 1;
        continue;
      }
      break;
    }
    items.push([match[3]]);
    i += 1;
  }
  const ordered = /^\d/.test(lines[start].match(LIST_ITEM)[2]);
  const tag = ordered ? 'ol' : 'ul';
  const html = `<${tag}>\n${items
    .map((parts) => `<li>${inline(parts.join(' '))}</li>`)
    .join('\n')}\n</${tag}>`;
  return { html, next: i };
}

function stripComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, '');
}

/** Inline formatting; HTML is escaped first, code spans are protected. */
export function inline(text) {
  const codes = [];
  let out = String(text).replace(/`([^`]+)`/g, (_m, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  out = escapeHtml(out);
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_m, alt, src, title) => `<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ''}>`,
  );
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_m, label, href, title) =>
      `<a href="${href}"${title ? ` title="${title}"` : ''}${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`,
  );
  out = out.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:])/g,
    (_m, prefix, url) => `${prefix}<a href="${url}" target="_blank" rel="noopener">${url}</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s.,;:)!?]|$)/g, '$1<em>$2</em>');

  return out.replace(/\u0000(\d+)\u0000/g, (_m, idx) => `<code>${escapeHtml(codes[Number(idx)])}</code>`);
}

/** `[{ level, text, id }]` for every ATX heading, ignoring fenced code. */
export function extractHeadings(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const headings = [];
  let inFence = null;
  for (const line of lines) {
    const fence = line.match(FENCE);
    if (fence) {
      inFence = inFence ? null : fence[1][0];
      continue;
    }
    if (inFence) continue;
    const heading = line.match(HEADING);
    if (heading) headings.push({ level: heading[1].length, text: heading[2], id: slugify(heading[2]) });
  }
  return headings;
}

/** Rough plain-text rendering, for word counts and social previews. */
export function toPlainText(source) {
  return String(source ?? '')
    .replace(FENCE_GLOBAL, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>~]/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const FENCE_GLOBAL = /```[\s\S]*?```/g;
