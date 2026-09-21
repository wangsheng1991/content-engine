// A deliberately small YAML parser: only the subset that topic files are allowed to use.
//
// Supported: nested maps by indentation, `- ` sequences (scalars and inline maps),
// quoted/plain scalars, numbers, booleans, null, flow arrays `[a, b]`, flow maps
// `{a: 1}`, literal `|`/`|-` and folded `>`/`>-` block scalars, `#` comments.
// Not supported (and rejected with a clear error): anchors/aliases, tags, multi-document
// streams, complex keys, explicit `?` keys. Keeping the dialect small keeps the
// content files predictable and the build reproducible without npm dependencies.

const BLOCK_SCALAR = /^([|>])([+-]?)\d*\s*$/;

export function parseYaml(source, { file = '<yaml>' } = {}) {
  const rawLines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const nodes = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    if (/^\s*$/.test(raw)) continue;
    const indent = raw.match(/^ */)[0].length;
    const withoutIndent = raw.slice(indent);
    if (withoutIndent.startsWith('#')) continue;
    const content = stripComment(withoutIndent);
    if (content.trim() === '') continue;
    if (/\t/.test(raw) || hasAnchor(withoutIndent)) {
      throw yamlError(file, i, 'anchors, aliases and tabs are not part of the supported dialect');
    }
    nodes.push({ indent, content: content.replace(/\s+$/, ''), line: i });
  }

  let pos = 0;

  function parseBlock(indent) {
    const node = nodes[pos];
    if (!node || node.indent < indent) return null;
    if (node.content === '-' || node.content.startsWith('- ')) return parseSequence(node.indent);
    return parseMap(node.indent);
  }

  function parseSequence(indent) {
    const out = [];
    while (pos < nodes.length) {
      const node = nodes[pos];
      if (node.indent !== indent) break;
      if (!(node.content === '-' || node.content.startsWith('- '))) break;
      const rest = node.content.slice(1).trim();
      if (rest === '') {
        pos += 1;
        const next = nodes[pos];
        out.push(next && next.indent > indent ? parseBlock(indent + 1) : null);
        continue;
      }
      const mapKey = matchPair(rest);
      if (mapKey) {
        const keyCol = indent + node.content.indexOf(rest);
        const base = {};
        pos += 1;
        assignPair(base, rest, keyCol, indent);
        while (pos < nodes.length && nodes[pos].indent === keyCol) {
          const inner = nodes[pos];
          if (inner.content === '-' || inner.content.startsWith('- ')) break;
          pos += 1;
          assignPair(base, inner.content, keyCol, keyCol);
        }
        out.push(base);
        continue;
      }
      out.push(parseScalar(rest));
      pos += 1;
    }
    return out;
  }

  function parseMap(indent) {
    const out = {};
    while (pos < nodes.length) {
      const node = nodes[pos];
      if (node.indent !== indent) break;
      if (node.content === '-' || node.content.startsWith('- ')) break;
      const pair = matchPair(node.content);
      if (!pair) throw yamlError(file, node.line, `expected "key: value", got "${node.content}"`);
      pos += 1;
      assignPair(out, node.content, node.indent, indent);
    }
    return out;
  }

  /** Assign `key: value` (or `key:`) read from `text` onto `target`. */
  function assignPair(target, text, keyCol, ownerIndent) {
    const { key, rest } = matchPair(text);
    if (rest === '') {
      const next = nodes[pos];
      if (next && next.indent > keyCol) target[key] = parseBlock(keyCol + 1);
      else if (next && next.indent > ownerIndent && next.content.startsWith('- ')) {
        target[key] = parseSequence(next.indent);
      } else target[key] = null;
      return;
    }
    const block = rest.match(BLOCK_SCALAR);
    if (block) {
      target[key] = readBlockScalar(keyCol, block[1], block[2]);
      return;
    }
    target[key] = parseScalar(rest);
  }

  /** Consume the raw lines that belong to a `|` / `>` block scalar. */
  function readBlockScalar(keyCol, style, chomp) {
    const start = nodes[pos - 1].line + 1;
    const collected = [];
    let last = start - 1;
    for (let i = start; i < rawLines.length; i += 1) {
      const line = rawLines[i];
      if (/^\s*$/.test(line)) {
        collected.push('');
        last = i;
        continue;
      }
      const indent = line.match(/^ */)[0].length;
      if (indent <= keyCol) break;
      collected.push(line);
      last = i;
    }
    while (pos < nodes.length && nodes[pos].line <= last) pos += 1;
    while (collected.length && collected[collected.length - 1] === '') collected.pop();
    const bodyIndent = collected
      .filter((l) => l !== '')
      .reduce((min, l) => Math.min(min, l.match(/^ */)[0].length), Infinity);
    const dedented = collected.map((l) => (l === '' ? '' : l.slice(Number.isFinite(bodyIndent) ? bodyIndent : 0)));
    let value;
    if (style === '|') value = dedented.join('\n');
    else {
      value = '';
      for (const line of dedented) {
        if (line === '') value += '\n';
        else if (value === '' || value.endsWith('\n')) value += line;
        else value += ` ${line}`;
      }
    }
    if (chomp === '-') return value;
    return `${value}\n`;
  }

  const value = nodes.length ? parseBlock(0) : {};
  if (pos < nodes.length) {
    throw yamlError(file, nodes[pos].line, `unexpected indentation in "${nodes[pos].content}"`);
  }
  return value ?? {};
}

function yamlError(file, line, message) {
  return new Error(`${file}:${line + 1}: ${message}`);
}

/** `&anchor` / `*alias` outside quotes — the dialect refuses both. */
function hasAnchor(text) {
  const withoutQuotes = text.replace(/"[^"]*"|'[^']*'/g, '');
  return /(^|\s)[&*]\S*/.test(withoutQuotes);
}

/** Split `key: value` at the first colon that is followed by whitespace or end of line. */
function matchPair(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ':' && (i === text.length - 1 || /\s/.test(text[i + 1]))) {
      const key = unquote(text.slice(0, i).trim());
      if (key === '') return null;
      return { key, rest: text.slice(i + 1).trim() };
    }
  }
  return null;
}

function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}

function unquote(text) {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\');
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function parseScalar(text) {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '~' || trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return parseFlowArray(trimmed);
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return parseFlowMap(trimmed);
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed);
  return unquote(trimmed);
}

/** Split a flow collection on commas that are not inside quotes or brackets. */
function splitFlow(inner) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"') {
        current += inner[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') parts.push(current);
  return parts;
}

function parseFlowArray(text) {
  const inner = text.slice(1, -1).trim();
  if (inner === '') return [];
  return splitFlow(inner).map((part) => parseScalar(part.trim()));
}

function parseFlowMap(text) {
  const inner = text.slice(1, -1).trim();
  if (inner === '') return {};
  const out = {};
  for (const part of splitFlow(inner)) {
    const pair = matchPair(part.trim());
    if (!pair) continue;
    out[pair.key] = pair.rest === '' ? null : parseScalar(pair.rest);
  }
  return out;
}
