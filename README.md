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
                 └── assets/
                          │
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
node bin/content.mjs list                  # what each topic has
node bin/content.mjs new my-topic          # scaffold a topic directory
node bin/content.mjs serve                 # preview dist/site at :4173
node bin/content.mjs publish               # report what ships and what waits
node bin/content.mjs publish --git         # commit + push the source of truth
node tests/run.mjs                         # the test suite (npm test)
```

There are **no npm dependencies** — everything (YAML subset parser, markdown
renderer, template engine, static server) is in `src/` against Node's standard
library. The only external tool is `pandoc`, used when present to turn
`deck/<slug>/slides.md` into a real `.pptx`; without it the markdown deck and the
outline are still produced and the skip is reported in `dist/manifest.json`.

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
bin/content.mjs        CLI: build / publish / new / list / serve
src/build.mjs          the compiler and the artifact manifest
src/topic.mjs          topic loading + validation
src/yaml.mjs           restricted YAML parser
src/markdown.mjs       restricted markdown renderer
src/template.mjs       mustache-subset template engine
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
