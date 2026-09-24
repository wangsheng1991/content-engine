// A deliberately small PowerPoint writer. It emits the subset of OOXML this repository needs:
// editable text boxes, simple fills and rules, hyperlinks, and speaker notes. The ZIP container is
// stored rather than deflated; keeping the writer dependency-free matters more than a few kilobytes.
import fs from 'node:fs';
import path from 'node:path';
import { deckPages } from './deck.mjs';
import { parseSlides } from './slides.mjs';
import { ensureDir } from './util.mjs';

export const PPTX_WIDTH = 12192000;
export const PPTX_HEIGHT = 6858000;

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PRESENTATION_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPE_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

const REL = {
  officeDocument: `${OFFICE_REL_NS}/officeDocument`,
  coreProperties: `${OFFICE_REL_NS}/metadata/core-properties`,
  extendedProperties: `${OFFICE_REL_NS}/extended-properties`,
  slide: `${OFFICE_REL_NS}/slide`,
  slideMaster: `${OFFICE_REL_NS}/slideMaster`,
  slideLayout: `${OFFICE_REL_NS}/slideLayout`,
  notesSlide: `${OFFICE_REL_NS}/notesSlide`,
  notesMaster: `${OFFICE_REL_NS}/notesMaster`,
  theme: `${OFFICE_REL_NS}/theme`,
  hyperlink: `${OFFICE_REL_NS}/hyperlink`,
};

const COLORS = {
  ink: '111827',
  brand: '1A73E8',
  hair: 'E5E7EB',
  body: '4B5563',
  faint: '6B7280',
  paper: 'FFFFFF',
  code: 'F9FAFB',
};

function xml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function textFromHtml(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function uint16(value) {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function uint32(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP method 0 (stored) keeps the package writer entirely in Node core. */
function zip(files) {
  const localParts = [];
  const directoryParts = [];
  let offset = 0;

  for (const [filename, contents] of Object.entries(files)) {
    const name = Buffer.from(filename);
    const data = Buffer.from(contents);
    const checksum = crc32(data);
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      uint16(20), uint16(0), uint16(0), uint16(0), uint16(0),
      uint32(checksum), uint32(data.length), uint32(data.length),
      uint16(name.length), uint16(0), name, data,
    ]);
    const directory = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      uint16(20), uint16(20), uint16(0), uint16(0), uint16(0), uint16(0),
      uint32(checksum), uint32(data.length), uint32(data.length),
      uint16(name.length), uint16(0), uint16(0), uint16(0), uint16(0),
      uint32(0), uint32(offset), name,
    ]);
    localParts.push(local);
    directoryParts.push(directory);
    offset += local.length;
  }

  const directory = Buffer.concat(directoryParts);
  const entries = directoryParts.length;
  const end = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    uint16(0), uint16(0),
    uint16(entries), uint16(entries),
    uint32(directory.length), uint32(offset),
    uint16(0),
  ]);
  return Buffer.concat([...localParts, directory, end]);
}

function relationships(items) {
  const body = items.map((item) => {
    const external = item.external ? ' TargetMode="External"' : '';
    return `<Relationship Id="${xml(item.id)}" Type="${xml(item.type)}" Target="${xml(item.target)}"${external}/>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_REL_NS}">${body}</Relationships>`;
}

/** OOXML coordinates are whole EMU. A fitted slide multiplies by a fraction, so round at the edge. */
function transform({ x, y, w, h }) {
  return `<a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm>`;
}

function fill(color) {
  return color ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : '<a:noFill/>';
}

function shapeProperties(box, { fillColor = null, rounded = false, lineColor = null } = {}) {
  const geometry = `<a:prstGeom prst="${rounded ? 'roundRect' : 'rect'}"><a:avLst/></a:prstGeom>`;
  const line = lineColor
    ? `<a:ln><a:solidFill><a:srgbClr val="${lineColor}"/></a:solidFill></a:ln>`
    : '<a:ln><a:noFill/></a:ln>';
  return `<p:spPr>${transform(box)}${geometry}${fill(fillColor)}${line}</p:spPr>`;
}

function runProperties({ size, color, bold = false, code = false, linkId = null }) {
  const font = code ? 'Menlo' : 'Helvetica Neue';
  const link = linkId ? `<a:hlinkClick r:id="${linkId}"/>` : '';
  return `<a:rPr lang="zh-CN" sz="${Math.round(size * 100)}"${bold ? ' b="1"' : ''}>`
    + `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`
    + `<a:latin typeface="${font}"/><a:ea typeface="PingFang SC"/>${link}</a:rPr>`;
}

function textRun(text, style) {
  if (!text) return '';
  return `<a:r>${runProperties(style)}<a:t>${xml(text)}</a:t></a:r>`;
}

// OOXML does not perform the browser's line layout for us. These conservative widths reserve a
// little more room than the real fonts need, which is preferable to letting a wrapped line touch
// the next shape on a slide.
function estimatedLineCount(text, width, size, { code = false } = {}) {
  const available = width / (size * 12700);
  const lines = String(text ?? '').split('\n');
  return lines.reduce((total, line) => {
    let used = 0;
    let count = 1;
    for (const character of line) {
      const wide = /[^\x00-\x7f]/u.test(character);
      used += wide ? 1 : code ? 0.6 : 0.5;
      if (used > available) {
        count += 1;
        used = wide ? 1 : code ? 0.6 : 0.5;
      }
    }
    return total + count;
  }, 0);
}

function lineHeight(size) {
  return Math.round(size * 1.25 * 12700);
}

function inlineRuns(html, baseStyle, links) {
  const source = String(html ?? '').replace(/\n/g, ' ');
  const tags = /(<strong>|<\/strong>|<code>|<\/code>|<a\b[^>]*>|<\/a>)/gi;
  const runs = [];
  let bold = Boolean(baseStyle.bold);
  let code = Boolean(baseStyle.code);
  let linkId = null;
  let cursor = 0;

  for (const match of source.matchAll(tags)) {
    if (match.index > cursor) {
      runs.push(textRun(textFromHtml(source.slice(cursor, match.index)), { ...baseStyle, bold, code, linkId }));
    }
    const tag = match[0];
    const lower = tag.toLowerCase();
    if (lower === '<strong>') bold = true;
    else if (lower === '</strong>') bold = Boolean(baseStyle.bold);
    else if (lower === '<code>') code = true;
    else if (lower === '</code>') code = Boolean(baseStyle.code);
    else if (lower.startsWith('<a')) {
      const href = tag.match(/href="([^"]+)"/i)?.[1];
      linkId = href ? links.idFor(textFromHtml(href)) : null;
    } else if (lower === '</a>') linkId = null;
    cursor = match.index + tag.length;
  }
  if (cursor < source.length) {
    runs.push(textRun(textFromHtml(source.slice(cursor)), { ...baseStyle, bold, code, linkId }));
  }
  return runs.join('');
}

function paragraph(runs, { level = 0, bullet = false, margin = 0, align = null } = {}) {
  const indent = level ? 500000 : 300000;
  const bulletXml = bullet ? '<a:buChar char="•"/>' : '<a:buNone/>';
  const alignment = align ? ` algn="${align}"` : '';
  return `<a:p><a:pPr lvl="${level}" marL="${bullet ? indent : margin}" indent="${bullet ? -180000 : 0}"${alignment}>${bulletXml}</a:pPr>${runs}<a:endParaRPr lang="zh-CN"/></a:p>`;
}

function textShape(id, box, paragraphs, {
  fillColor = null,
  lineColor = null,
  rounded = false,
  margin = 0,
  vertical = 'top',
  name = `Text ${id}`,
  placeholder = null,
} = {}) {
  const ph = placeholder ? `<p:ph type="${placeholder.type}" idx="${placeholder.idx}"/>` : '';
  const inset = Math.round(margin);
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>`
    + `${shapeProperties(box, { fillColor, lineColor, rounded })}`
    + `<p:txBody><a:bodyPr wrap="square" anchor="${vertical}" lIns="${inset}" rIns="${inset}" tIns="${inset}" bIns="${inset}"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function plainTextShape(id, box, text, style, options = {}) {
  const body = String(text ?? '').split('\n').map((line) => paragraph(textRun(line, style), { align: options.align })).join('');
  return textShape(id, box, body, options);
}

function lineShape(id, x, y, w, color = COLORS.hair) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Rule ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${transform({ x, y, w, h: 0 })}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="9525"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></p:spPr></p:sp>`;
}

function linkRegistry() {
  const urls = [];
  return {
    idFor(url) {
      let index = urls.indexOf(url);
      if (index === -1) index = urls.push(url) - 1;
      return `rIdLink${index + 1}`;
    },
    relationships() {
      return urls.map((url, index) => ({ id: `rIdLink${index + 1}`, type: REL.hyperlink, target: url, external: true }));
    },
  };
}

function parseBlocks(html) {
  return String(html ?? '').match(/<(?:pre|table|ul|ol|p)\b[\s\S]*?<\/(?:pre|table|ul|ol|p)>/gi) ?? [];
}

function codeBlockShape(id, block, y, scale = 1) {
  const code = textFromHtml(block.replace(/^<pre[^>]*><code[^>]*>|<\/code><\/pre>$/gi, ''));
  const size = 18.5 * scale;
  const textWidth = 10392000 - 360000;
  const lines = estimatedLineCount(code, textWidth, size, { code: true });
  const runs = code.split(/\n/).map((line) => paragraph(textRun(line, {
    size,
    color: COLORS.ink,
    code: true,
  }))).join('');
  const height = Math.max(650000 * scale, lines * lineHeight(size) + 360000 * scale);
  return {
    xml: textShape(id, { x: 900000, y, w: 10392000, h: height }, runs, {
      fillColor: COLORS.code,
      lineColor: COLORS.hair,
      rounded: true,
      margin: 180000,
    }),
    height,
  };
}

function listShapes(block, startId, y, links, scale = 1) {
  const shapes = [];
  let id = startId;
  let cursor = y;
  // If nested HTML is supplied, the number of open lists gives the one supported sub-level.
  const tokens = block.match(/<\/?(?:ul|ol|li)\b[^>]*>|[^<]+|<(?:strong|code|a)\b[^>]*>|<\/(?:strong|code|a)>/gi) ?? [];
  let level = -1;
  let item = '';
  let itemLevel = 0;
  for (const token of tokens) {
    if (/^<(?:ul|ol)\b/i.test(token)) level += 1;
    else if (/^<\/(?:ul|ol)>/i.test(token)) level -= 1;
    else if (/^<li\b/i.test(token)) { item = ''; itemLevel = Math.max(0, Math.min(1, level)); }
    else if (/^<\/li>/i.test(token)) {
      const size = (itemLevel ? 20.5 : 23.5) * scale;
      const width = 10392000 - (itemLevel ? 680000 : 480000);
      const lines = estimatedLineCount(textFromHtml(item), width, size);
      const height = Math.max(lineHeight(size) * lines + 100000 * scale, 360000 * scale);
      const runs = inlineRuns(item, { size, color: COLORS.body }, links);
      shapes.push(textShape(id, { x: 900000, y: cursor, w: 10392000, h: height }, paragraph(runs, { bullet: true, level: itemLevel })));
      id += 1;
      cursor += height + (itemLevel ? 90000 : 120000) * scale;
    } else item += token;
  }
  return { xml: shapes.join(''), nextId: id, height: cursor - y };
}

function tableShapes(block, startId, y, links, scale = 1) {
  const rows = [...block.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((match) => (
    [...match[1].matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi)].map((cell) => ({ header: cell[1].toLowerCase() === 'th', html: cell[2] }))
  ));
  const columns = Math.max(1, ...rows.map((row) => row.length));
  const width = Math.floor(10392000 / columns);
  const rowHeights = rows.map((row) => {
    const maxTextHeight = Math.max(1, ...row.map((cell) => {
      const size = (cell.header ? 17.5 : 20.5) * scale;
      return estimatedLineCount(textFromHtml(cell.html), width - 180000, size) * lineHeight(size);
    }));
    return Math.max(300000 * scale, maxTextHeight + 120000 * scale);
  });
  const shapes = [];
  let id = startId;

  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      const runs = inlineRuns(cell.html, {
        size: (cell.header ? 17.5 : 20.5) * scale,
        color: cell.header ? COLORS.ink : COLORS.body,
        bold: cell.header,
      }, links);
      shapes.push(textShape(id, {
        x: 900000 + columnIndex * width,
        y: y + rowHeights.slice(0, rowIndex).reduce((sum, value) => sum + value, 0),
        w: width,
        h: rowHeights[rowIndex],
      }, paragraph(runs), { margin: 90000 * scale }));
      id += 1;
    });
    if (rowIndex < rows.length - 1) {
      shapes.push(lineShape(id, 900000, y + rowHeights.slice(0, rowIndex + 1).reduce((sum, value) => sum + value, 0), 10392000));
      id += 1;
    }
  });
  return { xml: shapes.join(''), nextId: id, height: rowHeights.reduce((sum, value) => sum + value, 0) };
}

function bodyShapes(html, startId, links) {
  const blocks = parseBlocks(html);
  const available = 6370000 - 2350000;
  const measure = (scale) => blocks.reduce((total, block) => {
    if (/^<pre/i.test(block)) return total + codeBlockHeight(block, scale) + 150000 * scale;
    if (/^<table/i.test(block)) return total + tableBlockHeight(block, scale) + 150000 * scale;
    if (/^<(?:ul|ol)/i.test(block)) return total + listBlockHeight(block, scale);
    return total + paragraphBlockHeight(block, scale) + 60000 * scale;
  }, 0);
  const natural = measure(1);
  const scale = natural > available ? Math.max(0.72, available / natural) : 1;
  const shapes = [];
  let id = startId;
  let y = 2350000;

  for (const block of blocks) {
    if (/^<pre/i.test(block)) {
      const code = codeBlockShape(id, block, y, scale);
      shapes.push(code.xml);
      id += 1;
      y += code.height + 150000 * scale;
    } else if (/^<table/i.test(block)) {
      const table = tableShapes(block, id, y, links, scale);
      shapes.push(table.xml);
      id = table.nextId;
      y += table.height + 150000 * scale;
    } else if (/^<(?:ul|ol)/i.test(block)) {
      const list = listShapes(block, id, y, links, scale);
      shapes.push(list.xml);
      id = list.nextId;
      y += list.height;
    } else {
      const inner = block.replace(/^<p[^>]*>|<\/p>$/gi, '');
      const size = 23.5 * scale;
      const lines = estimatedLineCount(textFromHtml(inner), 10392000, size);
      const height = Math.max(400000 * scale, lines * lineHeight(size) + 100000 * scale);
      const runs = inlineRuns(inner, { size, color: COLORS.body }, links);
      shapes.push(textShape(id, { x: 900000, y, w: 10392000, h: height }, paragraph(runs)));
      id += 1;
      y += height + 60000 * scale;
    }
  }
  return { xml: shapes.join(''), nextId: id };
}

function codeBlockHeight(block, scale) {
  const code = textFromHtml(block.replace(/^<pre[^>]*><code[^>]*>|<\/code><\/pre>$/gi, ''));
  const size = 18.5 * scale;
  return Math.max(650000 * scale, estimatedLineCount(code, 10392000 - 360000, size, { code: true }) * lineHeight(size) + 360000 * scale);
}

function listBlockHeight(block, scale) {
  const items = [...block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
  return items.reduce((total, match) => {
    const nested = /<ul\b|<ol\b/i.test(match[1]);
    const size = (nested ? 20.5 : 23.5) * scale;
    const lines = estimatedLineCount(textFromHtml(match[1]), 10392000 - (nested ? 680000 : 480000), size);
    return total + Math.max(lineHeight(size) * lines + 100000 * scale, 360000 * scale) + (nested ? 90000 : 120000) * scale;
  }, 0);
}

function tableBlockHeight(block, scale) {
  const rows = [...block.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((match) => [...match[1].matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi)]);
  const columns = Math.max(1, ...rows.map((row) => row.length));
  const width = Math.floor(10392000 / columns);
  return rows.reduce((total, row) => {
    const textHeight = Math.max(1, ...row.map((cell) => {
      const size = (cell[1].toLowerCase() === 'th' ? 17.5 : 20.5) * scale;
      return estimatedLineCount(textFromHtml(cell[2]), width - 180000, size) * lineHeight(size);
    }));
    return total + Math.max(300000 * scale, textHeight + 120000 * scale);
  }, 0);
}

function paragraphBlockHeight(block, scale) {
  const inner = block.replace(/^<p[^>]*>|<\/p>$/gi, '');
  const size = 23.5 * scale;
  return Math.max(400000 * scale, estimatedLineCount(textFromHtml(inner), 10392000, size) * lineHeight(size) + 100000 * scale);
}

function slideXml(page) {
  const cover = page.number === 0;
  const links = linkRegistry();
  const shapes = [];
  let id = 2;

  shapes.push(textShape(id++, { x: 0, y: 0, w: PPTX_WIDTH, h: PPTX_HEIGHT }, '', { fillColor: COLORS.paper, name: 'Background' }));
  shapes.push(plainTextShape(id++, { x: 700000, y: 350000, w: 650000, h: 650000 }, 'AI', {
    size: 18, color: COLORS.paper, bold: true,
  }, { fillColor: COLORS.ink, rounded: true, vertical: 'ctr', align: 'ctr', name: 'Mark' }));
  shapes.push(plainTextShape(id++, { x: 1500000, y: 410000, w: 6500000, h: 400000 }, page.deck_title, {
    size: 13.5, color: COLORS.body, bold: true,
  }));
  if (!cover) {
    shapes.push(plainTextShape(id++, { x: 10600000, y: 410000, w: 1200000, h: 400000 }, page.counter, {
      size: 13.5, color: COLORS.faint,
    }));
  }

  shapes.push(plainTextShape(id++, {
    x: 700000, y: cover ? 2100000 : 1370000, w: 10800000, h: cover ? 1200000 : 850000,
  }, page.title, { size: cover ? 58 : 50, color: COLORS.ink, bold: true }, { name: cover ? 'Title' : 'Slide title' }));

  if (cover && page.lead) {
    const lead = page.lead.replace(/^<p[^>]*>|<\/p>$/gi, '');
    const runs = inlineRuns(lead, { size: 28, color: COLORS.body }, links);
    shapes.push(textShape(id++, { x: 700000, y: 3550000, w: 10800000, h: 1200000 }, paragraph(runs), { name: 'Lead' }));
  } else if (!cover) {
    const body = bodyShapes(page.body, id, links);
    shapes.push(body.xml);
    id = body.nextId;
  }

  shapes.push(lineShape(id++, 700000, 6370000, 10800000));
  shapes.push(plainTextShape(id++, { x: 700000, y: 6460000, w: 7000000, h: 270000 }, page.footer, {
    size: 13, color: COLORS.faint,
  }));
  shapes.push(plainTextShape(id, { x: 9500000, y: 6460000, w: 2000000, h: 270000 }, page.tag, {
    size: 13, color: COLORS.faint,
  }));

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<p:sld xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL_NS}" xmlns:p="${PRESENTATION_NS}">`
    + '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
    + `${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  return { document, hyperlinkRels: links.relationships() };
}

function notesSlideXml(notes) {
  const runs = notes.split('\n').map((line) => paragraph(textRun(line, { size: 14, color: COLORS.ink }))).join('');
  const body = textShape(2, { x: 685800, y: 3657600, w: 5486400, h: 4114800 }, runs, {
    name: 'Notes Placeholder 2', placeholder: { type: 'body', idx: 1 },
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<p:notes xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL_NS}" xmlns:p="${PRESENTATION_NS}">`
    + '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + `<p:grpSpPr/>${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

function contentTypes(pages) {
  const slides = pages.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  const notes = pages.map((page, index) => page.notes
    ? `<Override PartName="/ppt/notesSlides/notesSlide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`
    : '').join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${CONTENT_TYPE_NS}">`
    + '<Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
    + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
    + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
    + '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>'
    + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + `${slides}${notes}</Types>`;
}

function presentationXml(pages) {
  const slideIds = pages.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 3}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<p:presentation xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL_NS}" xmlns:p="${PRESENTATION_NS}">`
    + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
    + '<p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst>'
    + `<p:sldIdLst>${slideIds}</p:sldIdLst>`
    + `<p:sldSz cx="${PPTX_WIDTH}" cy="${PPTX_HEIGHT}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/>`
    + '<p:defaultTextStyle/></p:presentation>';
}

function presentationRels(pages) {
  return relationships([
    { id: 'rId1', type: REL.slideMaster, target: 'slideMasters/slideMaster1.xml' },
    { id: 'rId2', type: REL.notesMaster, target: 'notesMasters/notesMaster1.xml' },
    ...pages.map((_, index) => ({ id: `rId${index + 3}`, type: REL.slide, target: `slides/slide${index + 1}.xml` })),
  ]);
}

function slideMasterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<p:sldMaster xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL_NS}" xmlns:p="${PRESENTATION_NS}">`
    + '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>'
    + '<p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/>'
    + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>';
}

function slideLayoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<p:sldLayout xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL_NS}" xmlns:p="${PRESENTATION_NS}" type="blank" preserve="1">`
    + '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>'
    + '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
}

function notesMasterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<p:notesMaster xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL_NS}" xmlns:p="${PRESENTATION_NS}">`
    + '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>'
    + '<p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:notesStyle/></p:notesMaster>';
}

function themeXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="${DRAWING_NS}" name="Content Engine"><a:themeElements>`
    + '<a:clrScheme name="Content Engine"><a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="4B5563"/></a:dk2><a:lt2><a:srgbClr val="F9FAFB"/></a:lt2>'
    + '<a:accent1><a:srgbClr val="1A73E8"/></a:accent1><a:accent2><a:srgbClr val="E5E7EB"/></a:accent2><a:accent3><a:srgbClr val="6B7280"/></a:accent3><a:accent4><a:srgbClr val="4B5563"/></a:accent4><a:accent5><a:srgbClr val="111827"/></a:accent5><a:accent6><a:srgbClr val="F9FAFB"/></a:accent6><a:hlink><a:srgbClr val="1A73E8"/></a:hlink><a:folHlink><a:srgbClr val="1A73E8"/></a:folHlink></a:clrScheme>'
    + '<a:fontScheme name="Content Engine"><a:majorFont><a:latin typeface="Helvetica Neue"/><a:ea typeface="PingFang SC"/><a:cs typeface="Helvetica Neue"/></a:majorFont><a:minorFont><a:latin typeface="Helvetica Neue"/><a:ea typeface="PingFang SC"/><a:cs typeface="Helvetica Neue"/></a:minorFont></a:fontScheme>'
    + '<a:fmtScheme name="Content Engine"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>'
    + '</a:themeElements></a:theme>';
}

function docProperties(title, pages) {
  return {
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>content-engine</dc:creator></cp:coreProperties>`,
    'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>content-engine</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${pages}</Slides><Notes>${pages}</Notes></Properties>`,
  };
}

/** Build a real editable 16:9 PowerPoint presentation from the same slides.md as the HTML deck. */
export function buildPptx({ source, outFile, title = '', slug = '', siteName = '' }) {
  const deck = parseSlides(source);
  const pages = deckPages(deck, { slug, siteName });
  const files = {
    '[Content_Types].xml': contentTypes(pages),
    '_rels/.rels': relationships([
      { id: 'rId1', type: REL.officeDocument, target: 'ppt/presentation.xml' },
      { id: 'rId2', type: REL.coreProperties, target: 'docProps/core.xml' },
      { id: 'rId3', type: REL.extendedProperties, target: 'docProps/app.xml' },
    ]),
    'ppt/presentation.xml': presentationXml(pages),
    'ppt/_rels/presentation.xml.rels': presentationRels(pages),
    'ppt/slideMasters/slideMaster1.xml': slideMasterXml(),
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': relationships([
      { id: 'rId1', type: REL.slideLayout, target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: REL.theme, target: '../theme/theme1.xml' },
    ]),
    'ppt/slideLayouts/slideLayout1.xml': slideLayoutXml(),
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relationships([
      { id: 'rId1', type: REL.slideMaster, target: '../slideMasters/slideMaster1.xml' },
    ]),
    'ppt/notesMasters/notesMaster1.xml': notesMasterXml(),
    'ppt/notesMasters/_rels/notesMaster1.xml.rels': relationships([
      { id: 'rId1', type: REL.theme, target: '../theme/theme1.xml' },
    ]),
    'ppt/theme/theme1.xml': themeXml(),
    ...docProperties(title || deck.title, pages.length),
  };

  pages.forEach((page, index) => {
    const number = index + 1;
    const slide = slideXml(page);
    const slideRels = [
      { id: 'rId1', type: REL.slideLayout, target: '../slideLayouts/slideLayout1.xml' },
      ...(page.notes ? [{ id: 'rId2', type: REL.notesSlide, target: `../notesSlides/notesSlide${number}.xml` }] : []),
      ...slide.hyperlinkRels,
    ];
    files[`ppt/slides/slide${number}.xml`] = slide.document;
    files[`ppt/slides/_rels/slide${number}.xml.rels`] = relationships(slideRels);

    if (page.notes) {
      files[`ppt/notesSlides/notesSlide${number}.xml`] = notesSlideXml(page.notes);
      files[`ppt/notesSlides/_rels/notesSlide${number}.xml.rels`] = relationships([
        { id: 'rId1', type: REL.notesMaster, target: '../notesMasters/notesMaster1.xml' },
        { id: 'rId2', type: REL.slide, target: `../slides/slide${number}.xml` },
      ]);
    }
  });

  ensureDir(path.dirname(outFile));
  fs.writeFileSync(outFile, zip(files));
  return { built: true, file: outFile, pages: pages.length };
}
