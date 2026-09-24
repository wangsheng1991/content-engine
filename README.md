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
                 └── assets/               photos, covers and illustrations
                          │                 og.png / og.en.png, hero.jpg, images.json
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
node bin/content.mjs images                # draw the missing covers and illustrations
node bin/content.mjs lint                  # the copywriting gate
node bin/content.mjs list                  # what each topic has
node bin/content.mjs new my-topic          # scaffold a topic directory
node bin/content.mjs serve                 # preview dist/site at :4173
node bin/content.mjs publish               # report what ships and what waits
node bin/content.mjs publish --git         # commit + push the source of truth
node bin/content.mjs feedback              # read the numbers back from Dev.to and Bluesky
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

Four backends, picked per topic or per illustration:

| Backend | What it does | Needs |
| --- | --- | --- |
| `card` (default for covers) | Lays the title out as HTML and screenshots it with the local Chrome | a local Chrome/Chromium |
| `cloudflare` | POSTs the prompt to Cloudflare Workers AI — FLUX.2 [klein] by default — and writes the image it returns | `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the environment |
| `qwen` | POSTs a prompt to an image API and writes what comes back | `images.qwen.endpoint` + a key in the named env var |
| `command` | Runs any command you already have, with `{prompt} {out} {width} {height}` filled in | that command |

`images.coverBackend` and `images.illustrationBackend` pick separately, and each
beats the global `images.backend` — a cover is worth the free typographic card,
while an illustration inside an article is where a picture model earns its keep.

The `card` backend is the reason a cover is never blocked on a model: it is
deterministic, free, and the typographic rules (中西文间距、CJK 不做负字距、标题按长度
分档) live in `src/images.mjs`. When a model is worth paying for, `qwen` is a thin
adapter over the provider's HTTP contract — endpoint, headers, body and the path
to the image in the response all come from `content.config.json`, so pointing it
at a real service is a config change rather than a code change.

## Illustrations

An illustration is declared in `source.yaml` and referenced from `article.md` by
its plain relative path:

```yaml
images:
  - id: bill
    prompt: "一张画着两张账单的插画，白色背景"
    caption: "有声和无声的价目差"
    width: 1024          # optional, default 1024
    height: 576          # optional, default 1024
```

```markdown
![有声和无声的价目差](assets/bill.png)
```

Two things about a model backend are worth knowing before you point one at a
topic. **A prompt that opens with a style word renders a poster**: `editorial
illustration, …` came back as a magazine cover with invented headlines on it, so
say what is in the picture and end with the negatives (`no text, no letters`).
And **the extension follows the bytes, not the request** — Cloudflare answers
with a JPEG whatever the job is called, so a planned `.png` lands as `.jpg` and
`images.json` records the name that was actually written. `content build` reports
any `assets/…` path an article points at that does not exist, so a mismatch is
loud rather than a broken image on the published page.

`topics/<slug>/images.json` records how each image was produced — backend, model,
prompt and its hash, the size that came back, and the file's own hash:

Covers reach the platforms too: the Chinese card is the site's `og:image`, an
English card is rendered whenever `platforms.devto.title` exists, and Dev.to
receives the English one as `main_image` (it re-hosts the file, so the site has
to be deployed first — which is the order `content publish` already uses). The
`og:image:width` / `height` pair is read out of the cover file itself, because a
model backend may answer a pixel or two off the 1200×630 that was requested —
FLUX lays out on 16-pixel blocks, so 630 comes back as 624.

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

## Feedback: did anyone look?

Publishing is a write; this is the read. `content feedback` sweeps the two
channels that carry this content and writes one record per **content unit** — one
`(topic, channel)` pair — into `data/feedback/`:

```bash
node bin/content.mjs feedback --dry-run     # print the endpoints, send nothing
node bin/content.mjs feedback               # sweep both channels and write the files
node bin/content.mjs feedback ml-sharp      # only the topics named
node bin/content.mjs feedback --json        # machine-readable on stdout, files still written
```

```
data/feedback/ml-sharp.devto.json
data/feedback/ml-sharp.bluesky.json
data/feedback/wan-i2v-first-frame.devto.json
data/feedback/wan-i2v-first-frame.bluesky.json
data/feedback/_account.json       # follower counts and Dev.to totals, which no unit owns
```

`data/feedback/` is git-ignored: these numbers change daily and belong to the
sweep, not to the history.

Two things decide what a number means here:

- **Dev.to needs `DEVTO_API_KEY`** (vault). `page_views_count` has a value only
  through the authenticated `/articles/me*` endpoints — the public copy of the
  same article reports `null`. Without the key the command stops before sending
  anything rather than writing zeroes.
- **Bluesky has no view count at all.** Impression data does not exist in the
  public API; do not go looking for it. What it does have is `getLikes`, so the
  record keeps the list of handles that liked a post — a name is a lead.

A remote record is joined back to a topic by **the content's own link**, never by
title or date: Dev.to returns the `canonical_url` the article was published with,
and every Bluesky post carries the topic page the composer appended. Anything on
the account that carries neither is printed as unmatched and not written.

**Running it daily (not installed yet).** Either a PenguinHarness scheduled task
(`<app_data_dir>/agents/<agent_id>/agent_state/schedule/feedback.toml`) with
`prompt = "在 ~/code/content-engine 跑 node bin/content.mjs feedback 并汇报数字"`
and `period = "24h"`, or a launchd agent on this machine:

```xml
<!-- ~/Library/LaunchAgents/com.wangsheng.content-feedback.plist -->
<key>ProgramArguments</key>
<array>
  <string>/bin/bash</string>
  <string>-lc</string>
  <string>cd ~/code/content-engine &amp;&amp; node bin/content.mjs feedback >> /tmp/content-feedback.log 2>&1</string>
</array>
<key>StartCalendarInterval</key>
<dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
```

Neither is set up: the schedule waits until a few days of real numbers exist, so
that the first run has something to compare against. Note the proxy — both need
`https_proxy=http://127.0.0.1:1082` in the environment to reach Dev.to and the
Bluesky appview.

## Layout

```
bin/content.mjs        CLI: build / images / lint / publish / feedback / new / list / serve
src/build.mjs          the compiler and the artifact manifest
src/topic.mjs          topic loading + validation
src/yaml.mjs           restricted YAML parser
src/markdown.mjs       restricted markdown renderer
src/template.mjs       mustache-subset template engine
src/images.mjs         covers and illustrations: card / cloudflare / qwen / command
src/typography.mjs     中西文间距与全角标点，构建期作用于中文正文
src/lint.mjs           the copywriting gate (sparanoid/chinese-copywriting-guidelines)
src/i18n.mjs           the English routes and the chrome strings for each language
src/deck.mjs           pandoc bridge (deck.pptx)
src/publish.mjs        tier report + optional git commit/push
src/feedback.mjs       read the numbers back from Dev.to and Bluesky
src/serve.mjs          static preview server
templates/             website/, github/, huggingface/, xiaohongshu/,
                       reddit/, x/, zhihu/, video/
topics/                the content itself
data/feedback/         the numbers the platforms report, git-ignored
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
