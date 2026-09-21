// Localized SERP competition via Brave Search in a real Chrome session.
//
// Google serves "unusual traffic" to this network's exit IP, and Bing (plain HTTP)
// started returning unrelated results for every query once it throttled — its
// non-ASCII SERPs were resolved from the query's first character only. Brave runs
// its own index and is reachable, but rate-limits plain requests, so it goes
// through the browser. The profile copy is throwaway; no running Chrome is touched.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const SRC = path.join(HOME, 'Library/Application Support/Google/Chrome');
const COPY = '/tmp/serp-profile-copy';
const OUT = process.argv[2] ?? '/tmp/serp-brave';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const QUERIES = [
  ['ru', 'фото на документы онлайн 3 на 4'],
  ['ru', 'увеличить разрешение фото онлайн бесплатно'],
  ['id', 'pas foto online latar merah'],
  ['zh', '老照片修复'],
  ['zh', '证件照制作'],
];

fs.mkdirSync(path.join(COPY, 'Default'), { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const copy = (rel) => {
  const from = path.join(SRC, rel);
  if (!fs.existsSync(from)) return;
  const to = path.join(COPY, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, dereference: false, force: true });
};
for (const rel of ['Local State', 'Default/Cookies', 'Default/Preferences', 'Default/Local Storage', 'Default/Session Storage']) copy(rel);

const context = await chromium.launchPersistentContext(COPY, {
  executablePath: CHROME,
  headless: false,
  viewport: { width: 1440, height: 950 },
  args: ['--disable-sync', '--no-first-run', '--no-default-browser-check'],
});
const page = context.pages()[0] ?? (await context.newPage());

const results = [];
for (const [lang, q] of QUERIES) {
  const entry = { lang, query: q, top: [], note: null };
  try {
    await page.goto(`https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`, {
      waitUntil: 'domcontentloaded', timeout: 45000,
    });
    await page.waitForSelector('#results, .snippet, [data-type="web"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const scraped = await page.evaluate(() => {
      const body = (document.body.innerText || '').slice(0, 300);
      const note = /rate limit|too many requests|captcha|verify you/i.test(body) ? body.slice(0, 160) : null;
      const seen = new Set();
      const top = [];
      const scope = document.querySelector('#results') || document.body;
      for (const a of scope.querySelectorAll('a[href^="http"]')) {
        const host = a.hostname.replace(/^www\./, '');
        if (!host || host.endsWith('brave.com') || host.endsWith('brave.com.') === false && host.includes('brave')) continue;
        const t = (a.innerText || '').trim();
        if (!t || t.length < 3) continue;
        const key = host + a.pathname;
        if (seen.has(key)) continue;
        seen.add(key);
        top.push({ host, path: a.pathname.slice(0, 55), title: t.slice(0, 70) });
        if (top.length >= 12) break;
      }
      return { note, top };
    });
    entry.note = scraped.note;
    entry.top = scraped.top;
  } catch (e) {
    entry.note = e.message;
  }
  results.push(entry);
  console.log(`\n[${lang}] ${q}`);
  if (entry.note) console.log('   NOTE:', entry.note);
  for (const r of entry.top.slice(0, 10)) console.log(`   ${r.host}${r.path !== '/' ? r.path : ''}`);
  await page.waitForTimeout(3000);
}

fs.writeFileSync(path.join(OUT, 'serp-brave.json'), JSON.stringify({ collected_at: new Date().toISOString(), results }, null, 1));
await context.close();
