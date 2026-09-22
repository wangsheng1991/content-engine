// The handful of words the site shell needs in each language.
//
// Only the *chrome* lives here — nav labels, section headings, button text. The content itself never
// does: an English page is an English `article.en.md`, not a translated template. Keeping the two
// apart is what stops a half-translated page from ever being publishable.
import { isPlainObject } from './util.mjs';

export const DEFAULT_LANG = 'zh';

/** Languages the engine can render chrome for. A topic only appears in one if it has the article. */
export const LANGS = ['zh', 'en'];

const STRINGS = {
  zh: {
    htmlLang: 'zh',
    ogLocale: 'zh_CN',
    readMinutes: '分钟阅读',
    viewRepo: '查看仓库',
    paper: '论文',
    fullArticle: '完整长文',
    evidence: '证据',
    verified: '已核验',
    links: '链接',
    topicPage: '主题页',
    blogEyebrow: 'Blog',
    topicEyebrow: '主题',
    englishVersion: 'English',
    chineseVersion: '中文',
    toggleTheme: '切换深色模式',
    compiledFrom: '本页由 content-engine 从 <code>topics/</code> 的母内容编译生成',
    feedLink: 'RSS',
    allTopics: '全部主题',
  },
  en: {
    htmlLang: 'en',
    ogLocale: 'en_US',
    readMinutes: 'min read',
    viewRepo: 'View repository',
    paper: 'Paper',
    fullArticle: 'Full article',
    evidence: 'Evidence',
    verified: 'verified',
    links: 'Links',
    topicPage: 'Topic page',
    blogEyebrow: 'Blog',
    topicEyebrow: 'Topic',
    englishVersion: 'English',
    chineseVersion: '中文',
    toggleTheme: 'Toggle dark mode',
    compiledFrom: 'Compiled by content-engine from the source content in <code>topics/</code>',
    feedLink: 'RSS',
    allTopics: 'All topics',
  },
};

export function stringsFor(lang) {
  return STRINGS[normalizeLang(lang)] ?? STRINGS[DEFAULT_LANG];
}

export function normalizeLang(lang) {
  const value = String(lang ?? '').toLowerCase();
  if (value.startsWith('en')) return 'en';
  return DEFAULT_LANG;
}

/**
 * The English title of a topic, or '' when it has none.
 *
 * `platforms.devto.title` counts because a topic that already carries an English headline for Dev.to
 * has, in effect, decided what it is called in English. A topic that carries neither has no English
 * page at all — inventing a title is how a site ends up with half-English pages.
 */
export function englishTitle(source = {}) {
  const s = isPlainObject(source) ? source : {};
  return String(s.title_en ?? s.platforms?.devto?.title ?? '').trim();
}

export function englishSummary(source = {}) {
  const s = isPlainObject(source) ? source : {};
  return String(s.summary_en ?? '').trim();
}

/** The `hrefLang` attribute value a search engine expects for this language. */
export function htmlLangOf(lang) {
  return lang === 'en' ? 'en' : 'zh-CN';
}

/**
 * The site-level strings in the language being rendered.
 *
 * `content.config.json` keeps the Chinese values in `site.name` / `tagline` / `description` and the
 * English ones in `*_en`; a Chinese-language site that never publishes in English needs no extra
 * keys, and an English page never falls back to Chinese prose inside its own header.
 */
export function siteFor(configSite = {}, lang = DEFAULT_LANG) {
  const site = isPlainObject(configSite) ? configSite : {};
  if (normalizeLang(lang) !== 'en') return { ...site, language: site.language ?? DEFAULT_LANG, locale: site.locale ?? 'zh-CN' };
  return {
    ...site,
    name: site.name_en ?? site.name,
    tagline: site.tagline_en ?? site.tagline,
    description: site.description_en ?? site.description,
    language: 'en',
    locale: site.locale_en ?? 'en-US',
  };
}
