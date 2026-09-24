// The compiler: every artifact in `dist/` is produced from `topics/<slug>/` here.
// No network, no npm dependencies — only Node's standard library (plus pandoc for the deck).
import path from 'node:path';
import fs from 'node:fs';
import { ARTIFACT_TIERS, PLATFORMS } from './platforms.mjs';
import { buildDeck, pandocPath } from './deck.mjs';
import { htmlLangOf, siteFor, stringsFor, englishSummary, englishTitle } from './i18n.mjs';
import { COVER_HEIGHT, COVER_WIDTH, coverOf, englishCoverOf, imageSizeOf, missingAssets } from './images.mjs';
import { extractHeadings, renderMarkdown, toPlainText } from './markdown.mjs';
import { spaceCjkHtml } from './typography.mjs';
import { renderTemplate } from './template.mjs';
import { listTopicSlugs, loadTopic } from './topic.mjs';
import { copyDir, ensureDir, exists, isoNow, joinUrl, readText, sha256, toArray, withRef, writeOut } from './util.mjs';

const ENGINE_VERSION = '0.1.0';

export function loadConfig(root) {
  const file = path.join(root, 'content.config.json');
  if (!exists(file)) throw new Error(`missing ${file}`);
  const config = JSON.parse(readText(file));
  config.site = config.site ?? {};
  config.site.baseUrl = (process.env.CONTENT_BASE_URL || config.site.baseUrl || '').replace(/\/+$/, '');
  config.paths = { topics: 'topics', templates: 'templates', out: 'dist', ...(config.paths ?? {}) };
  return config;
}

function createContext({ root, config, out }) {
  const templateCache = new Map();
  const baseUrl = config.site.baseUrl ?? '';
  const basePath = (() => {
    try {
      const url = new URL(baseUrl);
      return url.pathname.replace(/\/+$/, '');
    } catch {
      return '';
    }
  })();
  const withSlash = (joined, wantTrailing) => (wantTrailing && !joined.endsWith('/') ? `${joined}/` : joined);
  // `base_path` is the site's path prefix without a trailing slash ('', '/content-engine').
  const siteUrl = (p = '') => withSlash(joinUrl(baseUrl, p), p.endsWith('/'));
  const href = (p = '') => (p === '' ? basePath || '/' : withSlash(joinUrl(basePath || '/', p), p.endsWith('/')));
  const tpl = (name, data) => {
    if (!templateCache.has(name)) {
      const file = path.join(root, config.paths.templates, name);
      if (!exists(file)) throw new Error(`missing template: ${file}`);
      templateCache.set(name, readText(file));
    }
    return renderTemplate(templateCache.get(name), data).replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '');
  };
  return { root, config, out, baseUrl, basePath, siteUrl, href, tpl };
}

/** Compile every requested topic and the site shell; returns the manifest. */
export function build({ root, config, slugs, siteOnly = false, outDir, log = () => {}, now = new Date() }) {
  const ctx = createContext({ root, config, out: outDir ?? path.join(root, config.paths.out) });
  const generatedAt = isoNow(now);
  const known = listTopicSlugs(root, config.paths.topics);
  const selected = slugs?.length ? slugs.filter((s) => known.includes(s)) : known;
  const missing = (slugs ?? []).filter((s) => !known.includes(s));
  if (missing.length) throw new Error(`unknown topic(s): ${missing.join(', ')}`);
  if (selected.length === 0) throw new Error(`no topics found under ${config.paths.topics}/`);

  const pandoc = siteOnly ? null : pandocPath();
  const artifacts = [];
  const indexTopics = [];
  const englishTopics = [];
  const notes = [];
  const topics = [];

  for (const slug of selected) {
    const topic = loadTopic(root, slug, { topicsDir: config.paths.topics });
    const view = topicView(topic, ctx);
    // A topic with an English body gets a whole second set of routes. Nothing is translated for it:
    // the English page exists because someone wrote `article.en.md`.
    const en = topic.article_en ? topicView(topic, ctx, 'en') : null;
    const topicArtifacts = [];

    const emit = (relPath, contents, { kind, tier, source }) => {
      const file = path.join(ctx.out, relPath);
      writeOut(file, contents);
      const artifact = {
        path: relPath,
        kind,
        tier,
        slug,
        bytes: Buffer.byteLength(contents),
        sha256: sha256(contents).slice(0, 16),
        source,
      };
      topicArtifacts.push(artifact);
      artifacts.push(artifact);
      return artifact;
    };

    // --- Tier A: the site, the blog, the feeds, GitHub, Hugging Face ---------
    const topicPage = page(ctx, view, {
      title: `${view.topic.title} · ${ctx.config.site.name}`,
      og_title: view.topic.title,
      description: view.topic.summary_text,
      canonical: view.topic.url,
      og_type: 'article',
      alternates: alternatesFor(view.topic.url, en?.topic.url),
      lang_switch: en ? langSwitchTo(en.topic, view.t) : null,
    });
    emit(`site/topics/${slug}/index.html`, ctx.tpl('website/topic.html', topicPage), {
      kind: 'site',
      tier: ARTIFACT_TIERS.site,
      source: `${slug}/source.yaml + article.md + evidence.json`,
    });

    if (view.article_html) {
      const blogPage = page(ctx, view, {
        title: `${view.topic.title} · Blog · ${ctx.config.site.name}`,
        og_title: view.topic.title,
        description: view.topic.summary_text,
        canonical: view.topic.blog_url,
        og_type: 'article',
        alternates: alternatesFor(view.topic.blog_url, en?.article_html ? en.topic.blog_url : undefined),
        lang_switch: en?.article_html ? langSwitchTo(en.topic, view.t) : null,
      });
      emit(`site/blog/${slug}/index.html`, ctx.tpl('website/article.html', blogPage), {
        kind: 'blog',
        tier: ARTIFACT_TIERS.blog,
        source: `${slug}/article.md`,
      });
      emit(`blog/${slug}.md`, view.blog_markdown, { kind: 'blog', tier: ARTIFACT_TIERS.blog, source: `${slug}/article.md` });
    }

    // The English side is the article and its index, not a translated copy of the topic page: the key
    // facts, the evidence claims and the link labels are all authored in Chinese, and an English page
    // that shows them would be a Chinese page wearing an `en` attribute.
    if (en?.article_html) {
      const enBlogPage = page(ctx, en, {
        title: `${en.topic.title} · Blog · ${en.site.name}`,
        og_title: en.topic.title,
        description: en.topic.summary_text,
        canonical: en.topic.blog_url,
        og_type: 'article',
        alternates: alternatesFor(view.topic.blog_url, en.topic.blog_url),
        lang_switch: langSwitchTo(view.topic, en.t),
      });
      emit(`site/en/blog/${slug}/index.html`, ctx.tpl('website/article.html', enBlogPage), {
        kind: 'blog',
        tier: ARTIFACT_TIERS.blog,
        source: `${slug}/article.en.md`,
      });
      emit(`blog/${slug}.en.md`, en.blog_markdown, { kind: 'blog', tier: ARTIFACT_TIERS.blog, source: `${slug}/article.en.md` });
    }

    emit(`github/${slug}/README.md`, view.readme_markdown, {
      kind: 'github',
      tier: ARTIFACT_TIERS.github,
      source: topic.readme ? `${slug}/README.md` : 'templates/github/README.md',
    });

    emit(`huggingface/${slug}/README.md`, ctx.tpl('huggingface/README.md', view), {
      kind: 'huggingface',
      tier: ARTIFACT_TIERS.huggingface,
      source: `${slug}/source.yaml + evidence.json`,
    });

    const copied = copyDir(topic.assetsDir, path.join(ctx.out, 'site/assets', slug));
    if (copied) notes.push(`${slug}: copied ${copied} asset file(s)`);

    // A cover is committed source, so a topic without one is a missing image on every platform that
    // renders a link preview. Say it at build time rather than noticing it on someone else's timeline.
    if (!view.topic.has_cover) notes.push(`${slug}: no cover image — run \`content images ${slug}\``);
    // A post with no picture does not travel on any of these platforms: the feed is a race for the
    // thumb, and a wall of text loses it before the first line is read. Said at build time, where
    // it is cheap to fix, rather than noticed after a post nobody clicked.
    if (!view.topic.media.length) notes.push(`${slug}: no media — a text-only post; add a demo video or gif under \`media:\``);
    for (const missing of missingAssets(topic)) notes.push(`${slug}: article.md references ${missing}, which does not exist`);

    if (!siteOnly) {
      // --- Tier B: drafts, deck, video script ---------------------------------
      for (const platform of PLATFORMS) {
        const override = view.topic.platforms?.[platform.id] ?? {};
        emit(
          platform.out(slug),
          ctx.tpl(platform.template, { ...view, platform: { ...platform, ...override }, generated_at: generatedAt }),
          {
            kind: `draft:${platform.id}`,
            tier: platform.tier,
            source: `${slug}/source.yaml + article.md`,
          },
        );
      }

      if (view.has_slides) {
        const outline = slideOutline(topic.slides);
        emit(`deck/${slug}/slides.md`, topic.slides, { kind: 'deck', tier: ARTIFACT_TIERS.deck, source: `${slug}/slides.md` });
        emit(`deck/${slug}/outline.json`, `${JSON.stringify(outline, null, 2)}\n`, {
          kind: 'deck',
          tier: ARTIFACT_TIERS.deck,
          source: `${slug}/slides.md`,
        });
        const pptx = path.join(ctx.out, `deck/${slug}/deck.pptx`);
        const result = buildDeck({
          bin: pandoc,
          input: path.join(ctx.out, `deck/${slug}/slides.md`),
          title: view.topic.title,
          outFile: pptx,
          log,
        });
        if (result.built) {
          const artifact = {
            path: `deck/${slug}/deck.pptx`,
            kind: 'deck',
            tier: ARTIFACT_TIERS.deck,
            slug,
            bytes: byteSize(pptx),
            sha256: '',
            source: `${slug}/slides.md via pandoc`,
          };
          topicArtifacts.push(artifact);
          artifacts.push(artifact);
        } else {
          notes.push(`${slug}: deck.pptx skipped — ${result.reason}`);
        }
      } else {
        notes.push(`${slug}: no slides.md, deck skipped`);
      }

      if (view.has_video) {
        const storyboard = storyboardOf(topic.video, view.topic);
        emit(`video/${slug}/storyboard.json`, `${JSON.stringify(storyboard, null, 2)}\n`, {
          kind: 'video',
          tier: ARTIFACT_TIERS.video,
          source: `${slug}/video.yaml`,
        });
        emit(`video/${slug}/script.md`, ctx.tpl('video/script.md', { ...view, video: storyboard }), {
          kind: 'video',
          tier: ARTIFACT_TIERS.video,
          source: `${slug}/video.yaml`,
        });
      } else {
        notes.push(`${slug}: no video.yaml, video script skipped`);
      }
    }

    topics.push({ slug, title: view.topic.title, date: view.topic.date, kind: view.topic.kind, artifacts: topicArtifacts });
    indexTopics.push(view.topic);
    if (en?.article_html) englishTopics.push(en.topic);
    log(`${slug}: ${topicArtifacts.length} artifact(s)${en ? ' (含英文版)' : ''}`);
  }

  // --- Site shell -----------------------------------------------------------
  indexTopics.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  englishTopics.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const hasEnglishSite = englishTopics.length > 0;

  const shell = [];
  const emitShell = (relPath, contents, kind, tier) => {
    writeOut(path.join(ctx.out, relPath), contents);
    const artifact = {
      path: relPath,
      kind,
      tier,
      slug: null,
      bytes: Buffer.byteLength(contents),
      sha256: sha256(contents).slice(0, 16),
      source: 'content.config.json',
    };
    shell.push(artifact);
    artifacts.push(artifact);
  };

  emitShell(
    'site/index.html',
    ctx.tpl(
      'website/index.html',
      page(ctx, { site: ctx.config.site, generated_at: generatedAt, topics: indexTopics, ...shellView(ctx, 'zh') }, {
        title: `${ctx.config.site.name} · ${ctx.config.site.tagline}`,
        description: ctx.config.site.description,
        canonical: `${ctx.baseUrl}/`,
        alternates: hasEnglishSite ? alternatesFor(`${ctx.baseUrl}/`, `${ctx.baseUrl}/en/`) : [],
        lang_switch: hasEnglishSite ? { href: ctx.href('en/'), lang: 'en', label: stringsFor('zh').englishVersion } : null,
      }),
    ),
    'site',
    ARTIFACT_TIERS.site,
  );
  emitShell('site/feed.xml', ctx.tpl('website/feed.xml', { site: ctx.config.site, generated_at: generatedAt, topics: indexTopics }), 'feed', ARTIFACT_TIERS.feed);
  emitShell('site/sitemap.xml', ctx.tpl('website/sitemap.xml', { site: ctx.config.site, generated_at: generatedAt, topics: indexTopics, english_topics: englishTopics, has_english_site: hasEnglishSite }), 'feed', ARTIFACT_TIERS.feed);
  emitShell('site/robots.txt', ctx.tpl('website/robots.txt', { site: ctx.config.site, baseUrl: ctx.baseUrl }), 'feed', ARTIFACT_TIERS.feed);

  // The English shell is emitted only when there is something in it. An empty /en/ index would be a
  // page that exists to be linked to and has nothing to read.
  if (hasEnglishSite) {
    const enSite = siteFor(ctx.config.site, 'en');
    emitShell(
      'site/en/index.html',
      ctx.tpl(
        'website/index.html',
        page(ctx, { site: enSite, generated_at: generatedAt, topics: englishTopics, ...shellView(ctx, 'en') }, {
          title: `${enSite.name} · ${enSite.tagline}`,
          description: enSite.description,
          canonical: `${ctx.baseUrl}/en/`,
          alternates: alternatesFor(`${ctx.baseUrl}/`, `${ctx.baseUrl}/en/`),
          lang_switch: { href: ctx.href(''), lang: 'zh-CN', label: stringsFor('en').chineseVersion },
        }),
      ),
      'site',
      ARTIFACT_TIERS.site,
    );
    emitShell('site/en/feed.xml', ctx.tpl('website/feed.xml', { site: enSite, generated_at: generatedAt, topics: englishTopics }), 'feed', ARTIFACT_TIERS.feed);
  }

  const manifest = {
    engine: { name: 'content-engine', version: ENGINE_VERSION },
    generated_at: generatedAt,
    base_url: ctx.baseUrl,
    site_only: siteOnly,
    deck_engine: pandoc ? 'pandoc' : null,
    topics: topics.map(({ slug, title, date, kind, artifacts: list }) => ({
      slug,
      title,
      date,
      kind,
      tiers: countTiers(list),
      artifacts: list.map((a) => ({ path: a.path, kind: a.kind, tier: a.tier, bytes: a.bytes })),
    })),
    site: shell.map((a) => ({ path: a.path, kind: a.kind, tier: a.tier, bytes: a.bytes })),
    artifacts,
    notes,
  };
  writeOut(path.join(ctx.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

function countTiers(list) {
  return list.reduce((acc, a) => ({ ...acc, [a.tier]: (acc[a.tier] ?? 0) + 1 }), {});
}

/** The language-independent parts of a view, for the pages that have no topic behind them. */
function shellView(ctx, lang) {
  const english = lang === 'en';
  return {
    lang,
    html_lang: htmlLangOf(lang),
    t: stringsFor(lang),
    home_href: ctx.href(english ? 'en/' : ''),
    feed_href: ctx.href(`${english ? 'en/' : ''}feed.xml`),
  };
}

/**
 * `<link rel="alternate" hreflang>` for a pair of translations.
 *
 * `x-default` points at the Chinese page: it is the one every URL exists in, so it is the safe answer
 * for a reader whose language matches neither.
 */
function alternatesFor(zhUrl, enUrl) {
  if (!enUrl) return [];
  return [
    { hreflang: 'zh-CN', href: zhUrl },
    { hreflang: 'en', href: enUrl },
    { hreflang: 'x-default', href: zhUrl },
  ];
}

function langSwitchTo(target, strings) {
  const english = target.href.includes('/en/');
  return { href: target.href, lang: english ? 'en' : 'zh-CN', label: english ? strings.englishVersion : strings.chineseVersion };
}

/** Add the page-level pieces (head, footer, canonical) to a template payload. */
function page(ctx, view, pageInfo) {
  const data = {
    ...view,
    base_path: view.base_path ?? ctx.basePath,
    page: { og_type: 'website', ...pageInfo },
    alternates: pageInfo.alternates ?? [],
    lang_switch: pageInfo.lang_switch ?? null,
  };
  // A link preview has no room for the site suffix, so it gets the plain title unless a page says
  // otherwise; the <title> element keeps the qualified one.
  data.page.og_title = data.page.og_title ?? data.page.title;
  data.head_html = ctx.tpl('website/_head.html', data);
  data.footer_html = ctx.tpl('website/_footer.html', data);
  return data;
}

function byteSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** Everything a template may read about one topic, in one language. */
function topicView(topic, ctx, lang = 'zh') {
  const view = buildTopicView(topic, ctx, lang);
  view.blog_markdown = blogMarkdown(topic, view, lang);
  return view;
}

function buildTopicView(topic, ctx, lang = 'zh') {
  const s = topic.source;
  const english = lang === 'en';
  const article = (english ? topic.article_en : topic.article) ?? '';
  // An English page with a Chinese description under it is worse than no description: the summary
  // falls back to the article's own opening paragraph rather than to the other language.
  const summary = english ? englishSummary(s) || openingParagraph(article) : s.summary ?? '';
  // The Chinese prose goes through the copywriting rules on its way into HTML — 中英文之间加空格、
  // 全角标点两边不留空格 — and nothing else does. The chrome is written by hand with the spacing it
  // wants, and the English copy is not Chinese: `word — word` is correct there and gets mangled.
  const prose = (text) => (english ? text : spaceCjkHtml(text));
  const summaryHtml = summary ? prose(renderMarkdown(summary)) : '';
  const articleHtml = article
    ? prose(renderMarkdown(article)).replace(/src="assets\//g, `src="${ctx.href(`assets/${topic.slug}/`)}`)
    : '';
  const plainArticle = toPlainText(article);
  const cover = coverOf(topic);
  const coverEn = englishCoverOf(topic);
  const shown = english ? coverEn ?? cover : cover;
  const coverSize = shown ? imageSizeOf(fs.readFileSync(path.join(topic.dir, shown.file))) : null;
  const evidence = (topic.evidence?.claims ?? []).map((claim) => ({
    ...claim,
    host: hostOf(claim.source),
    verified: claim.verified !== false,
  }));
  const pathPrefix = english ? 'en/' : '';
  // There is no English topic page — the article *is* the English page — so on the English side
  // `href` means "where to read this", which is the blog URL. The index template then needs no
  // special case.
  const articlePath = `${pathPrefix}blog/${topic.slug}/`;

  const view = {
    generated_at: isoNow(),
    lang,
    html_lang: htmlLangOf(lang),
    t: stringsFor(lang),
    site: siteFor(ctx.config.site, lang),
    base_path: ctx.basePath,
    home_url: ctx.siteUrl('/'),
    home_href: ctx.href(english ? 'en/' : ''),
    feed_href: ctx.href(`${pathPrefix}feed.xml`),
    has_english_site: false,
    topic: {
      slug: topic.slug,
      title: english ? englishTitle(s) || s.title : s.title,
      subtitle: english ? String(s.subtitle_en ?? '').trim() : s.subtitle ?? '',
      kind: s.kind ?? 'research',
      date: String(s.date ?? ''),
      updated: String(s.updated ?? s.date ?? ''),
      status: s.status ?? 'published',
      // The Chinese tags are prose, not slugs: on the English page they would be a row of glyphs the
      // reader cannot use, so it takes the ASCII tags written for Dev.to instead.
      tags: english ? toArray(s.platforms?.devto?.tags) : s.tags ?? [],
      hashtags_zh: (s.hashtags ?? s.tags ?? []).map((t) => `#${String(t).replace(/\s+/g, '')}`).join(' '),
      tags_csv: (s.tags ?? []).join(', '),
      summary,
      summary_html: summaryHtml,
      summary_text: oneLine(summary),
      // The Tier B drafts are written for the platform, and two of those platforms read English:
      // Reddit and X get the English strings when the topic has them, rather than a Chinese TL;DR.
      title_en: englishTitle(s),
      subtitle_en: String(s.subtitle_en ?? '').trim(),
      summary_text_en: oneLine(englishSummary(s)),
      // The visuals the topic produced: one list, so a draft names the video and the still it
      // actually has instead of carrying a suggestion for an image nobody made.
      media: toArray(s.media),
      key_facts: s.key_facts ?? [],
      links: s.links ?? [],
      canonical: s.canonical ?? {},
      platforms: s.platforms ?? {},
      words: plainArticle ? plainArticle.split(/\s+/).length : 0,
      reading_minutes: Math.max(1, Math.round(plainArticle.length / (english ? 900 : 500))),
      headings: article ? extractHeadings(article) : [],
      url: ctx.siteUrl(english ? articlePath : `${pathPrefix}topics/${topic.slug}/`),
      href: ctx.href(english ? articlePath : `${pathPrefix}topics/${topic.slug}/`),
      // There is no English topic page — key_facts and evidence claims are written in Chinese — so on
      // the English side the blog article has no "topic page" to link to and must not link to itself.
      topic_href: english ? '' : ctx.href(`topics/${topic.slug}/`),
      blog_href: ctx.href(articlePath),
      blog_url: ctx.siteUrl(articlePath),
      // An English page shows the English card: the card is a title card, so the Chinese one would
      // be the only Chinese thing left on an otherwise English page.
      cover_href: shown ? ctx.href(`assets/${topic.slug}/${shown.rel}`) : '',
      cover_url: shown ? ctx.siteUrl(`assets/${topic.slug}/${shown.rel}`) : '',
      // Dev.to is an English platform and picks the cover up from its own field, so an English card
      // is worth rendering whenever one exists; the Chinese card is the fallback, not the default.
      cover_en_url: coverEn ? ctx.siteUrl(`assets/${topic.slug}/${coverEn.rel}`) : cover ? ctx.siteUrl(`assets/${topic.slug}/${cover.rel}`) : '',
      has_cover: Boolean(shown),
      // A model backend can answer with a size slightly off the request, so og:image states what the
      // file on disk really is rather than what was asked for.
      cover_width: coverSize?.width ?? COVER_WIDTH,
      cover_height: coverSize?.height ?? COVER_HEIGHT,
      cover_bytes: shown ? byteSize(path.join(topic.dir, shown.file)) : 0,
    },
    evidence,
    // An English page shows the English call to action when `cta.yaml` carries an `en:` block, and
    // none at all when it does not — a Chinese button under an English article is not a conversion.
    cta: ctaFor(topic.cta, lang, topic.slug),
    // The Reddit and X drafts are English posts: they need the English button even though the view
    // they are rendered from is the Chinese one.
    cta_en: ctaFor(topic.cta, 'en', topic.slug),
  };
  view.article_html = articleHtml;
  view.article_markdown = article;
  view.is_english = english;
  view.has_article = Boolean(article);
  view.has_english_article = Boolean(topic.article_en);
  view.has_slides = Boolean(topic.slides);
  view.has_video = Boolean(topic.video?.scenes?.length);
  view.readme_markdown = topic.readme ?? ctx.tpl('github/README.md', view);
  return view;
}

/**
 * A topic's call to action in one language.
 *
 * Every route a topic is published on sends people to the same tagged URL, so the product can tell
 * which topic produced a signup. Without it the north-star metric — registered and completed a first
 * generation — cannot be measured from this side at all.
 */
function ctaFor(cta, lang, slug) {
  const chosen = lang === 'en' ? cta?.en : cta;
  if (!chosen?.url) return null;
  return {
    ...chosen,
    url: withRef(chosen.url, slug),
    body_html: chosen.body ? renderMarkdown(chosen.body) : '',
    body_text: oneLine(chosen.body ?? ''),
  };
}

/** The article's own opening paragraph, used as the description when a topic declares no summary. */
function openingParagraph(markdown) {
  const paragraphs = String(markdown ?? '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block && !block.startsWith('#') && !block.startsWith('|') && !block.startsWith('```') && !block.startsWith('!['));
  return paragraphs[0] ?? '';
}

function blogMarkdown(topic, view, lang = 'zh') {
  const front = [
    '---',
    `title: "${view.topic.title}"`,
    `slug: ${topic.slug}`,
    `lang: ${lang}`,
    `date: ${view.topic.date}`,
    `updated: ${view.topic.updated}`,
    `tags: [${view.topic.tags.join(', ')}]`,
    view.topic.canonical?.repo ? `repo: ${view.topic.canonical.repo}` : null,
    '---',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');
  // The claims themselves are written in Chinese — they are quotes out of Chinese documentation, and
  // a machine translation of a verbatim quote is no longer verbatim. So the English copy lists the
  // sources as sources, and lets the article's own prose carry the claims.
  const sources = view.evidence.length
    ? lang === 'en'
      ? `\n\n## ${view.t.evidence}\n\n${view.evidence.map((c) => `- ${c.host} — <${c.source}>`).join('\n')}\n`
      : `\n\n## ${view.t.evidence}\n\n${view.evidence.map((c) => `- ${c.claim} — <${c.source}>`).join('\n')}\n`
    : '';
  // `cta.yaml` may carry an `en:` block; without one the English copy simply has no call to action
  // rather than a Chinese button under an English article.
  const callToAction = lang === 'en' ? topic.cta?.en : topic.cta;
  const cta = callToAction
    ? `\n\n---\n\n**${callToAction.headline}**\n\n${oneLine(callToAction.body ?? '')}\n\n${callToAction.label}: ${withRef(callToAction.url, topic.slug)}\n`
    : '';
  return `${front}${view.article_markdown ?? ''}${sources}${cta}`;
}

function slideOutline(markdown) {
  const slides = [];
  let current = null;
  for (const line of String(markdown).split('\n')) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      current = { index: slides.length + 1, title: heading[1].trim(), bullets: [] };
      slides.push(current);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet && current) current.bullets.push(bullet[1].trim());
  }
  return { slides, total: slides.length };
}

function storyboardOf(video, topic) {
  let clock = 0;
  const scenes = (video.scenes ?? []).map((scene, index) => {
    const seconds = Number(scene.seconds) || 0;
    const start = clock;
    clock += seconds;
    return {
      index: index + 1,
      id: scene.id ?? `scene-${index + 1}`,
      seconds,
      start,
      end: clock,
      onscreen: scene.onscreen ?? '',
      visual: scene.visual ?? '',
      voiceover: (scene.voiceover ?? '').trim(),
      voiceover_lines: (scene.voiceover ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    };
  });
  return {
    topic: topic.slug,
    title: video.title ?? topic.title,
    target_seconds: Number(video.target_seconds) || clock,
    total_seconds: clock,
    scene_count: scenes.length,
    scenes,
  };
}

function oneLine(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Create a topic skeleton so a new subject starts from a working state. */
export function scaffoldTopic(root, slug, { topicsDir = 'topics', title = 'TODO title', date } = {}) {
  const dir = path.join(root, topicsDir, slug);
  if (exists(dir)) throw new Error(`topic already exists: ${dir}`);
  ensureDir(dir);
  ensureDir(path.join(dir, 'assets'));
  writeOut(path.join(dir, 'assets/.gitkeep'), '');
  writeOut(
    path.join(dir, 'source.yaml'),
    [
      `slug: ${slug}`,
      `title: "${title}"`,
      'subtitle: ""',
      'kind: research',
      `date: ${date ?? new Date().toISOString().slice(0, 10)}`,
      `updated: ${date ?? new Date().toISOString().slice(0, 10)}`,
      'status: draft',
      'summary: |',
      '  一句话说清这是什么、为什么要看。',
      'tags: []',
      'canonical:',
      '  repo: ',
      '  paper: ',
      'key_facts: []',
      'links: []',
      'platforms:',
      '  xiaohongshu:',
      `    title: ""`,
      '    hook: ""',
      '  reddit:',
      '    title: ""',
      '    hook: ""',
      '',
    ].join('\n'),
  );
  writeOut(
    path.join(dir, 'cta.yaml'),
    ['headline: ""', 'body: |', '  一段行动号召。', 'label: ""', 'url: https://www.dlss5nvidia.com', ''].join('\n'),
  );
  writeOut(
    path.join(dir, 'evidence.json'),
    `${JSON.stringify({ topic: slug, checked_at: new Date().toISOString().slice(0, 10), claims: [] }, null, 2)}\n`,
  );
  writeOut(path.join(dir, 'article.md'), `## 它解决什么问题\n\n## 自己跑一遍\n\n\`\`\`bash\n# TODO\n\`\`\`\n`);
  return dir;
}
