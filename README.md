# content-engine

One topic directory in, a whole distribution set out. `topics/<slug>/` holds the
**mother content** (metadata, long-form article, evidence, call to action); the
compiler turns it into a website, a blog post, an RSS feed, a GitHub README, a
Hugging Face card, a deck, a video script and platform drafts — all from the same
source, so nothing is written twice and every published claim stays traceable to
a link.

```
                 topics/<slug>/            ← the only place content is authored
                 ├── source.yaml           metadata, key facts, platform angles
                 ├── article.md            long-form article
                 ├── README.md             GitHub / Hugging Face facing
                 ├── evidence.json         one claim → one source URL
                 ├── cta.yaml              the call to action
                 ├── slides.md             deck source
                 ├── video.yaml            storyboard + voiceover
                 └── assets/               photos, and the generated covers
                          │                 og.png / og.en.png, images.json
                 content build <slug>
                          │
   ┌──────────────┬───────┴────────┬──────────────┬─────────────┐
   ▼              ▼                ▼              ▼             ▼
 dist/site/   dist/blog/      dist/github/   dist/huggingface/  dist/deck/
 (GitHub      <slug>.md       <slug>/        <slug>/README.md   <slug>/
  Pages)      + feed.xml      README.md                         + dist/video/
              + sitemap.xml                                    + dist/drafts/
```

## Quick start

```bash
node bin/content.mjs build                 # compile every topic into dist/
node bin/content.mjs build ml-sharp        # compile one topic
node bin/content.mjs build --site-only     # tier A only (what CI publishes)
node bin/content.mjs images                # draw the missing covers
node bin/content.mjs lint                  # the copywriting gate
node bin/content.mjs list                  # what each topic has
node bin/content.mjs new my-topic          # scaffold a topic directory
node bin/content.mjs serve                 # preview dist/site at :4173
node bin/content.mjs publish               # report what ships and what waits
node bin/content.mjs publish --git         # commit + push the source of truth
node tests/run.mjs                         # the test suite (npm test)
```

There are **no npm dependencies** — everything (YAML subset parser, markdown
renderer, template engine, static server, cover-image cards) is in `src/` against
Node's standard library. The external tools are `pandoc`, used when present to
turn `deck/<slug>/slides.md` into a real `.pptx`, and a local **Chrome/Chromium**,
used by the default image backend; without either, the skip is reported in
`dist/manifest.json` and everything else still builds.

## Cover images

Every topic gets a 1200×630 cover, and it is **source, not build output**: it
lives in `topics/<slug>/assets/og.png` and is committed with the topic. CI builds
the site on an ubuntu runner with no Chrome and no Chinese system font, so a
cover drawn during the build would quietly disappear from the deployed site while
looking fine locally.

```bash
node bin/content.mjs images                 # draw what is missing, keep the rest
node bin/content.mjs images wan-i2v-first-frame --force
node bin/content.mjs images --dry-run       # say what would be drawn, touch nothing
```

Three backends, picked per topic or per illustration:

| Backend | What it does | Needs |
| --- | --- | --- |
| `card` (default) | Lays the title out as HTML and screenshots it with the local Chrome | a local Chrome/Chromium |
| `qwen` | POSTs a prompt to an image API and writes what comes back | `images.qwen.endpoint` + a key in the named env var |
| `command` | Runs any command you already have, with `{prompt} {out} {width} {height}` filled in | that command |

The `card` backend is the reason a cover is never blocked on a model: it is
deterministic, free, and the typographic rules (中西文间距、CJK 不做负字距、标题按长度
分档) live in `src/images.mjs`. When a model is worth paying for, `qwen` is a thin
adapter over the provider's HTTP contract — endpoint, headers, body and the path
to the image in the response all come from `content.config.json`, so pointing it
at a real service is a config change rather than a code change.

An illustration is declared in `source.yaml` and referenced from `article.md` by
its plain relative path:

```yaml
images:
  - id: bill
    prompt: "一张画着两张账单的插画，白色背景"
    caption: "有声和无声的价目差"
```

```markdown
![有声和无声的价目差](assets/bill.png)
```

`content build` reports any `assets/…` path an article points at that does not
exist, and `topics/<slug>/images.json` records how each image was produced —
backend, model, prompt, size and hash.

Covers reach the platforms too: the Chinese card is the site's `og:image`, an
English card is rendered whenever `platforms.devto.title` exists, and Dev.to
receives the English one as `cover_image` (it re-hosts the file, so the site has
to be deployed first — which is the order `content publish` already uses).

## Two gates before anything ships

`content lint` and `content verify` answer two different questions, and both run in CI.

**`content lint` — is the copy written the way this site writes?** The typography pass in
`src/typography.mjs` fixes the spacing inside the article body on its way into HTML, but the
title, the subtitle, the summary, the key facts and the call to action never go through it — and
those are the strings a reader meets first: the link preview, the cover card, the post. The rules
come from [sparanoid/chinese-copywriting-guidelines](https://github.com/sparanoid/chinese-copywriting-guidelines)
(MIT): 中西文之间加空格, 全角标点两边不留空格, 不重复标点, 中文正文用直角引号「」. Code blocks,
inline code, link targets and table rules are masked out before anything is judged.

```bash
node bin/content.mjs lint
node bin/content.mjs lint wan-i2v-first-frame
```

Deliberately not checked: halfwidth/fullwidth conversion, 数字与单位, proper-noun casing. Each needs
a decision about meaning, and a checker that guesses is a checker people learn to turn off.

**`content verify` — does every claim still exist?** One claim → one source URL, and a quote that
has to appear verbatim in that source. `--online` re-fetches the sources; a source that cannot be
reached is reported as unreachable rather than quietly passing.

## Tier A vs Tier B

Every artifact is tagged in `dist/manifest.json`:

- **Tier A — safe to publish automatically.** The website, the blog/RSS/sitemap,
  the GitHub README, the Hugging Face card. `.github/workflows/pages.yml` uploads
  `dist/site/` as the GitHub Pages artifact on every push to `main`.
- **Tier B — a human approves first.** 小红书 / Reddit / X / 知乎 drafts, the
  deck and the video script. They are written into `dist/drafts/`, `dist/deck/`
  and `dist/video/`, never into `dist/site/`, so a draft cannot leak onto the
  public site by accident. `content publish` is a report, not a poster: it never
  creates an account, never posts, and `--git` only commits this repository.

Reddit in particular: the draft is written for a human to post, and the template
says so. Do not wire it to an automated account.

## Adding a topic

```bash
node bin/content.mjs new flux-interior-lora --title "…"
```

Fill in `source.yaml` (title, summary, `key_facts`, `links`, per-platform angle),
`evidence.json` (one claim → one source URL, with a verbatim quote), `article.md`
and optionally `README.md`, `slides.md`, `video.yaml`. Then `content build`.

`source.yaml` uses a deliberately small YAML dialect: nested maps, `- ` lists,
`|` block scalars, `[a, b]` flow arrays, quoted/plain scalars, `#` comments.
Anchors, aliases and tabs are rejected with a `file:line` error — the parser in
`src/yaml.mjs` is ~270 lines and refuses anything it does not fully understand
rather than guessing.

## GitHub Pages setup

1. Push this repository to GitHub.
2. Set `site.baseUrl` in `content.config.json` to
   `https://<user>.github.io/<repo>` (or override per build with
   `CONTENT_BASE_URL=…`).
3. Settings → Pages → Source: **GitHub Actions**.
4. Push to `main` — the workflow builds every topic, runs the tests, prints the
   artifact report and deploys `dist/site`.

## Layout

```
bin/content.mjs        CLI: build / images / lint / publish / new / list / serve
src/build.mjs          the compiler and the artifact manifest
src/topic.mjs          topic loading + validation
src/yaml.mjs           restricted YAML parser
src/markdown.mjs       restricted markdown renderer
src/template.mjs       mustache-subset template engine
src/images.mjs         covers and illustrations: card / qwen / command backends
src/typography.mjs     中西文间距与全角标点，构建期作用于中文正文
src/lint.mjs           the copywriting gate (sparanoid/chinese-copywriting-guidelines)
src/i18n.mjs           the English routes and the chrome strings for each language
src/deck.mjs           pandoc bridge (deck.pptx)
src/publish.mjs        tier report + optional git commit/push
src/serve.mjs          static preview server
templates/             website/, github/, huggingface/, xiaohongshu/,
                       reddit/, x/, zhihu/, video/
topics/                the content itself
tests/run.mjs          parser + end-to-end tests
dist/                  generated, git-ignored, never edited by hand
```

## Deliberately not automated (yet)

- Posting anything to a platform. Publishing actions are the fragile part: they
  depend on each platform's session, UI and rules, so they get their own skill
  with a human approval step before they touch an account.
- Uploading to Hugging Face. `dist/huggingface/<slug>/README.md` is ready for
  `hf upload`; the token and repository layout are not wired up here.
- Topic discovery. This engine compiles a topic you have already researched; it
  does not decide what to research next.
