"Enhance" is one of those words that hides at least four different jobs: super-resolution, denoising, re-rendering in place, and re-composing the frame entirely. They produce very different files, and almost nobody shows you which one they ran.

So I measured one. Not by reading a marketing page — by pulling the public example from the command line, keeping both files, and printing their SHA-256. Here is everything that came out of it.

## The run

The tool is a browser image enhancer; this example is a small Node script in its public repo that fetches one **cached** example pair the site already serves to guests. No account, no credits, no uploads, and nothing of yours is sent anywhere:

```sh
node bin/enhance-example.mjs --sample sample1 --out ./out
```

My copy of that run, on 2026-10-30:

```
catalog: 5033 ms · cached=true
input.jpg     0.15 MiB   812 ms  sha256:19d965fed4699633…
output.webp   0.13 MiB  5377 ms  sha256:229b802a24474dd6…
```

Three HTTP requests — catalog, input, output. **No inference happened on my machine, and no credit was spent.** The millisecond figures are network waits, not model time; treat them as nothing more than "these three requests are not slow".

## What actually changed

Both files, measured rather than described:

| | input | output |
|---|---|---|
| file | `input.jpg` | `output.webp` |
| bytes | 154,319 | 134,222 |
| dimensions | 1200×768 | **1200×768** |
| SHA-256 | `19d965fed4699633e9b6faae738fd678592ca5098a47f1535388ef133c2fc28a` | `229b802a24474dd6c8df6ddac02afb454b7563fe3dfcada76c25dfceac89e708` |

![The same kitchen frame: the slider sweeps between the source JPEG and the re-rendered WebP](assets/before-after.gif)

<small>The pair this article is about, as a slider: source on one side, re-rendered output on the other, same 1200×768 frame.</small>

Same dimensions in, same dimensions out. That is the whole headline, and it rules out the interpretation most people bring to the word: **this is not upscaling**. It is the same frame, redrawn.

The site's own FAQ is explicit about the ceiling: the longest output edge is capped at 1536 pixels, target factors are 2 / 4, and the requested scale is reduced to fit that cap. So even for your own uploads there is no path to "4K from a thumbnail" here.

## Two caveats worth more than the numbers

**1. Sample pairs do not generalise.** A second example in the same repo takes a 1670×1152 JPEG and returns a 1024×1024 WebP — different geometry, which means its before/after slider is not pixel-aligned. If you are judging an enhancer, check whether the pair you are shown preserves the frame; a geometry change can flatter any comparison.

**2. This is not an NVIDIA DLSS runtime.** The name is confusing, so it is worth stating plainly: nothing here installs, patches or replaces an `nvngx_dlss*` file, and no game is involved. It re-renders a supplied image and hands it back.

## Why hashes

A before/after image on a landing page is unfalsifiable: you cannot tell whether the "after" was produced by the tool, by a different model, or by hand. A file hash is checkable years later by anyone who kept the file. That is the whole reason the example ships with `compare.html` — a single self-contained page with a slider and both hashes, so the pair can be re-verified without trusting the README that describes it.

If you build anything in this space, the cheapest credibility you can add is exactly this: keep the input, keep the output, publish both hashes, and say which process produced them.

## Reproducing it

```sh
git clone https://github.com/wangsheng1991/dlss5-visual-enhancer
cd dlss5-visual-enhancer
node bin/enhance-example.mjs --sample sample1 --out ./out
shasum -a 256 out/input.jpg out/output.webp
```

Node 18+, zero dependencies. Your hashes should match the table above; if they do not, the example was re-generated and the README should say so.

If you want to run your *own* screenshot through it rather than a cached sample, that is the signed-in flow on the site — one credit per task, and new accounts start with free credits. That is where the 1536-pixel edge cap and 2/4 factors apply.
