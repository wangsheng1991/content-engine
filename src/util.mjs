// Small, dependency-free helpers shared by the compiler.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

export function readJson(file) {
  return JSON.parse(readText(file));
}

/** Read a file, returning null instead of throwing when it is absent. */
export function readTextIfExists(file) {
  try {
    return readText(file);
  } catch {
    return null;
  }
}

export function exists(p) {
  return fs.existsSync(p);
}

export function writeOut(file, contents) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, contents);
  return file;
}

export function listDirs(dir) {
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

/** Recursively copy a directory, skipping dotfiles such as .gitkeep. */
export function copyDir(src, dest, { skipDotfiles = true } = {}) {
  if (!exists(src)) return 0;
  let count = 0;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipDotfiles && entry.name.startsWith('.')) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) count += copyDir(from, to, { skipDotfiles });
    else {
      fs.copyFileSync(from, to);
      count += 1;
    }
  }
  return count;
}

export function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ASCII slug for urls and filenames; keeps non-ASCII words readable. */
export function slugify(input) {
  const slug = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

export function joinUrl(...parts) {
  return parts
    .filter((p) => p !== undefined && p !== null && p !== '')
    .map((p, i) => (i === 0 ? String(p).replace(/\/+$/, '') : String(p).replace(/^\/+|\/+$/g, '')))
    .join('/');
}

/**
 * Tag a call-to-action URL with the topic it came from.
 *
 * Every published route carries the same tagged link, which is what lets the product tell which
 * topic produced a signup. The parameter is only added when the URL is already absolute and does
 * not carry a `ref` of its own — a hand-set value wins, and a relative URL is left alone rather
 * than guessed at.
 */
export function withRef(url, ref) {
  if (!url || !ref) return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.searchParams.has('ref')) parsed.searchParams.set('ref', String(ref));
  return parsed.toString();
}

/** ISO-8601 in UTC, seconds precision — used in feeds and manifests. */
export function isoNow(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Resolve a dotted path against an object; `this` and `.` read the key of that name. */
export function lookup(scope, dotted) {
  if (!dotted) return undefined;
  let value = scope;
  for (const key of String(dotted).split('.')) {
    if (value === undefined || value === null) return undefined;
    if (/^\d+$/.test(key) && Array.isArray(value)) value = value[Number(key)];
    else value = value[key];
  }
  return value;
}

export function toArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

/** Minimal glob-free file walk, used by the manifest writer. */
export function walkFiles(dir, base = dir) {
  const out = [];
  if (!exists(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}
