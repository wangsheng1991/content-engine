// A mustache-flavoured template renderer, restricted on purpose so that the
// `templates/` tree stays readable and cannot smuggle logic into content files.
//
//   {{ path.to.value }}          HTML-escaped interpolation
//   {{{ path.to.value }}}        raw interpolation
//   {{#if path}} … {{else}} … {{/if}}
//   {{#each path}} … {{/each}}   `{{this}}`, `{{@index}}`, `{{@first}}`, `{{@last}}`
//   {{! comment }}
import { escapeHtml, lookup } from './util.mjs';

export function renderTemplate(template, data = {}) {
  const { nodes } = parse(String(template ?? ''));
  return renderNodes(nodes, [data]);
}

function parse(source) {
  const re = /\{\{\{([\s\S]*?)\}\}\}|\{\{([\s\S]*?)\}\}/g;
  const root = { children: [] };
  const stack = [root];
  let last = 0;
  let match;

  const push = (node) => stack[stack.length - 1].children.push(node);

  while ((match = re.exec(source))) {
    if (match.index > last) push({ type: 'text', value: source.slice(last, match.index) });
    last = re.lastIndex;
    const raw = match[1] !== undefined;
    const body = (match[1] ?? match[2]).trim();

    if (body.startsWith('!')) continue;
    if (body.startsWith('#if ') || body.startsWith('#each ')) {
      const kind = body.slice(1, body.indexOf(' '));
      const node = { type: kind, path: body.slice(body.indexOf(' ') + 1).trim(), children: [], alternate: [] };
      push(node);
      stack.push(node);
      continue;
    }
    if (body === 'else') {
      const node = stack[stack.length - 1];
      if (!node || node.type !== 'if') throw new Error('{{else}} outside of {{#if}}');
      stack.pop();
      node.alternate = node.alternate ?? [];
      // Collected into `node.alternate`; the wrapper is discarded at {{/if}}.
      stack.push({ type: 'block', children: node.alternate });
      continue;
    }
    if (body.startsWith('/')) {
      const node = stack.pop();
      if (!node || node.type === 'root') throw new Error(`unmatched {{${body}}}`);
      if (node.type === 'block') continue;
      continue;
    }
    push({ type: 'var', path: body, raw });
  }

  if (last < source.length) push({ type: 'text', value: source.slice(last) });
  if (stack.length !== 1) throw new Error('unclosed {{#if}} / {{#each}} block');
  return { nodes: root.children };
}

function renderNodes(nodes, scopes) {
  return nodes.map((node) => renderNode(node, scopes)).join('');
}

function renderNode(node, scopes) {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'var': {
      const value = resolve(node.path, scopes);
      if (value === undefined || value === null) return '';
      if (typeof value === 'object') return '';
      return node.raw ? String(value) : escapeHtml(value);
    }
    case 'if': {
      const value = resolve(node.path, scopes);
      return truthy(value) ? renderNodes(node.children, scopes) : renderNodes(node.alternate ?? [], scopes);
    }
    case 'each': {
      const value = resolve(node.path, scopes);
      const items = Array.isArray(value) ? value : [];
      if (items.length === 0) return renderNodes(node.alternate ?? [], scopes);
      return items
        .map((item, index) => {
          const meta = { '@index': index, '@first': index === 0, '@last': index === items.length - 1 };
          const fields = item !== null && typeof item === 'object' ? item : {};
          const scope = { ...fields, ...meta, this: item, '.': item };
          return renderNodes(node.children, [...scopes, scope]);
        })
        .join('');
    }
    default:
      return '';
  }
}

function resolve(path, scopes) {
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    const value = lookup(scopes[i], path);
    if (value !== undefined) return value;
    if (path === 'this' || path === '.') return scopes[i];
  }
  return undefined;
}

function truthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return Boolean(value);
}
