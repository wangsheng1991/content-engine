// The compiler: every artifact in `dist/` is produced from `topics/<slug>/` here.
// No network, no npm dependencies — only Node's standard library (plus pandoc for the deck).
import path from 'node:path';
import fs from 'node:fs';
import { ARTIFACT_TIERS, PLATFORMS } from './platforms.mjs';
import { buildDeck, pandocPath } from './deck.mjs';
import { extractHeadings, renderMarkdown, toPlainText } from './markdown.mjs';
import { renderTemplate } from './template.mjs';
import { listTopicSlugs, loadTopic } from './topic.mjs';
import { copyDir, ensureDir, exists, isoNow, joinUrl, readText, sha256, withRef, writeOut } from './util.mjs';

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
  const notes = [];
  const topics = [];

  for (const slug of selected) {
    const topic = loadTopic(root, slug, { topicsDir: config.paths.topics });
    const view = topicView(topic, ctx);
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
      description: view.topic.summary_text,
      canonical: view.topic.url,
    });
    emit(`site/topics/${slug}/index.html`, ctx.tpl('website/topic.html', topicPage), {
      kind: 'site',
      tier: ARTIFACT_TIERS.site,
      source: `${slug}/source.yaml + article.md + evidence.json`,
    });

    if (view.article_html) {
      const blogPage = page(ctx, view, {
        title: `${view.topic.title} · Blog · ${ctx.config.site.name}`,
        description: view.topic.summary_text,
        canonical: view.topic.blog_url,
      });
      emit(`site/blog/${slug}/index.html`, ctx.tpl('website/article.html', blogPage), {
        kind: 'blog',
        tier: ARTIFACT_TIERS.blog,
        source: `${slug}/article.md`,
      });
      emit(`blog/${slug}.md`, view.blog_markdown, { kind: 'blog', tier: ARTIFACT_TIERS.blog, source: `${slug}/article.md` });
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
    log(`${slug}: ${topicArtifacts.length} artifact(s)`);
  }

  // --- Site shell -----------------------------------------------------------
  indexTopics.sort((a, b) => String(b.date).localeCompare(String(a.date)));

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
      page(ctx, { site: ctx.config.site, generated_at: generatedAt, topics: indexTopics }, {
        title: `${ctx.config.site.name} · ${ctx.config.site.tagline}`,
        description: ctx.config.site.description,
        canonical: `${ctx.baseUrl}/`,
      }),
    ),
    'site',
    ARTIFACT_TIERS.site,
  );
  emitShell('site/feed.xml', ctx.tpl('website/feed.xml', { site: ctx.config.site, generated_at: generatedAt, topics: indexTopics }), 'feed', ARTIFACT_TIERS.feed);
  emitShell('site/sitemap.xml', ctx.tpl('website/sitemap.xml', { site: ctx.config.site, generated_at: generatedAt, topics: indexTopics }), 'feed', ARTIFACT_TIERS.feed);
  emitShell('site/robots.txt', ctx.tpl('website/robots.txt', { site: ctx.config.site, baseUrl: ctx.baseUrl }), 'feed', ARTIFACT_TIERS.feed);

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

/** Add the page-level pieces (head, footer, canonical) to a template payload. */
function page(ctx, view, pageInfo) {
  const data = { ...view, base_path: view.base_path ?? ctx.basePath, page: pageInfo };
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

/** Everything a template may read about one topic. */
function topicView(topic, ctx) {
  const view = buildTopicView(topic, ctx);
  view.blog_markdown = blogMarkdown(topic, view);
  return view;
}

function buildTopicView(topic, ctx) {
  const s = topic.source;
  const summaryHtml = s.summary ? renderMarkdown(s.summary) : '';
  const article = topic.article ?? '';
  const articleHtml = article
    ? renderMarkdown(article).replace(/src="assets\//g, `src="${ctx.href(`assets/${topic.slug}/`)}`)
    : '';
  const plainArticle = toPlainText(article);
  const evidence = (topic.evidence?.claims ?? []).map((claim) => ({
    ...claim,
    host: hostOf(claim.source),
    verified: claim.verified !== false,
  }));

  const view = {
    generated_at: isoNow(),
    site: ctx.config.site,
    base_path: ctx.basePath,
    home_url: ctx.siteUrl('/'),
    topic: {
      slug: topic.slug,
      title: s.title,
      subtitle: s.subtitle ?? '',
      kind: s.kind ?? 'research',
      date: String(s.date ?? ''),
      updated: String(s.updated ?? s.date ?? ''),
      status: s.status ?? 'published',
      tags: s.tags ?? [],
      hashtags_zh: (s.hashtags ?? s.tags ?? []).map((t) => `#${String(t).replace(/\s+/g, '')}`).join(' '),
      tags_csv: (s.tags ?? []).join(', '),
      summary: s.summary ?? '',
      summary_html: summaryHtml,
      summary_text: oneLine(s.summary ?? ''),
      key_facts: s.key_facts ?? [],
      links: s.links ?? [],
      canonical: s.canonical ?? {},
      platforms: s.platforms ?? {},
      words: plainArticle ? plainArticle.split(/\s+/).length : 0,
      reading_minutes: Math.max(1, Math.round(plainArticle.length / 500)),
      headings: article ? extractHeadings(article) : [],
      url: ctx.siteUrl(`topics/${topic.slug}/`),
      href: ctx.href(`topics/${topic.slug}/`),
      blog_href: ctx.href(`blog/${topic.slug}/`),
      blog_url: ctx.siteUrl(`blog/${topic.slug}/`),
    },
    evidence,
    cta: topic.cta
      ? {
          ...topic.cta,
          // Every route a topic is published on sends people to the same tagged URL, so the product
          // can tell which topic produced a signup. Without it the north-star metric — registered
          // and completed a first generation — cannot be measured from this side at all.
          url: withRef(topic.cta.url, topic.slug),
          body_html: topic.cta.body ? renderMarkdown(topic.cta.body) : '',
          body_text: oneLine(topic.cta.body ?? ''),
        }
      : null,
  };
  view.article_html = articleHtml;
  view.article_markdown = article;
  view.has_article = Boolean(article);
  view.has_slides = Boolean(topic.slides);
  view.has_video = Boolean(topic.video?.scenes?.length);
  view.readme_markdown = topic.readme ?? ctx.tpl('github/README.md', view);
  return view;
}

function blogMarkdown(topic, view) {
  const front = [
    '---',
    `title: "${view.topic.title}"`,
    `slug: ${topic.slug}`,
    `date: ${view.topic.date}`,
    `updated: ${view.topic.updated}`,
    `tags: [${view.topic.tags.join(', ')}]`,
    view.topic.canonical?.repo ? `repo: ${view.topic.canonical.repo}` : null,
    '---',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');
  const sources = view.evidence.length
    ? `\n\n## 证据\n\n${view.evidence.map((c) => `- ${c.claim} — <${c.source}>`).join('\n')}\n`
    : '';
  const cta = view.cta ? `\n\n---\n\n**${view.cta.headline}**\n\n${view.cta.body_text}\n\n${view.cta.label}: ${view.cta.url}\n` : '';
  return `${front}${topic.article ?? ''}${sources}${cta}`;
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
