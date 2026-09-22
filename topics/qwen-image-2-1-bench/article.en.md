There is one sentence in Qwen-Image-2.1's official README that is very easy to scroll past: **use the official prompt-rewriting models to expand short prompts into detailed descriptions**. In our first round, we followed none of it.

That produced an awkward result: asked to draw "a photo of two clocks" using GenEval's original prompt text, it drew one clock. The two other models on the same machine, same card, same seed went 7 for 7.

The point of this article is that **the 4/7 was not a capability ceiling — it was the way we were feeding the model** — and that chasing this down explains why the advertised numbers and hands-on experience disagree.

## The short version

Most of the gap is about *protocol*, not about the model.

The recommended pipeline is three things stacked: **prompt rewriter + 2048² + 40 steps**. Round one used **raw short prompts + 1024² + 20 steps** — none of the three. Rewrite the prompts into enhancer-style long descriptions and **both object-dropping failures pass immediately**, at the same resolution, the same seed, on the same machine, with the prompt as the only variable that moved.

Two things follow. First, this model does not eat terse requests: GenEval's prompts are written for automated scorers and happen to be the worst-case input for the recommended pipeline. Second, estimating your real experience from a leaderboard score means ignoring a whole set of pipeline defaults that sit in between.

## Round one

Three models on one machine, one GPU, one prompt set: the text is verbatim from public benchmarks (GenEval / DPG-Bench / LongText-Bench), same seed.

| | Qwen-Image-2.1 | SenseNova-U1.5 | FLUX.2-klein-KV |
|---|---|---|---|
| Shape | 7B DiT + Qwen3-VL text encoder, RGBA VAE | 8B+8B MoT, 8 steps | 9B distilled + INT4 KV, 4 steps |
| 1024² per image (median) | 52.1 s (20 steps) | 9.8 s | **1.6 s** |
| 2048² per image | 102–111 s | **13 s** | not supported (≤1536) |
| Text rendering · char accuracy | 74.6% | **86.5%** | 40.8% |
| Text rendering · line hits | 25/35 | **26/35** | 4/35 |
| Chinese long text, line hits | **18/20** | **18/20** | 0/20 |
| English long text, line hits | 7/15 | **8/15** | 4/15 |
| GenEval compositional (7) | **4/7** | 7/7 | 7/7 |
| DPG-Bench long description (4) | 2 good / 2 flawed | **4 good** | **4 good** |
| Native transparent RGBA | **✅ unique** | ✗ | ✗ |

The three-way contact sheet:

![GenEval three-way](assets/geneval-3way.jpg)

Qwen's three failures are specific: `a photo of two clocks` drew one clock; `a photo of a purple wine glass and a black apple` dropped the apple entirely; `a photo of a bench` collapsed structurally at 1024².

It also owns two categories outright. **Chinese long text: 18/20 line hits, level with SenseNova**, where FLUX scores 0/20 — its Chinese comes out as a solid block of garbage. And **native transparent RGBA is Qwen-only**; if you need cut-out assets, that alone decides the choice.

One failure mode worth remembering: on dense small text, Qwen **invents entire blocks of plausible-looking fake words**. A chalkboard menu comes out neatly laid out and, up close, entirely fabricated.

## Where the gap actually comes from

| Source of the gap | Weight | Evidence |
|---|---|---|
| **Missing prompt rewriter; raw short prompts used** | largest | ablation fixes 2/2 |
| **Incommensurable metrics**: vendor composite vs per-prompt pass rate | large | their board is a total with no GenEval / DPG split |
| **Different opponent**: INT4 4-step distill vs full FLUX | medium | the klein-KV we ran against is not on that board |
| **Sampling and scoring** | medium | 1 image/prompt, single seed; judged by eye, not Mask2Former |
| **Resolution / steps** | large for structural failures, small for text | bench: broken at 1K, fine at 2K; long-text scores flat |

The second row is worth spelling out: the "small model, big performance" claim rests on **Qwen-Image-Bench, a self-published *composite total***, with **no GenEval or DPG breakdown** — it is not commensurable with "4 of 7 prompts passed".

The official README, meanwhile, is explicit:

> For best results, we recommend using the official **prompt rewriting models** to expand short prompts into detailed, high-quality descriptions.

and states its defaults plainly: `num_inference_steps = 40`, `2048 × 2048`. **Round one followed none of them.**

### Ablation: only the prompt changes

Same machine, same GPU, **2048², 20 steps, seed 42**. The only change is rewriting GenEval's original text into an enhancer-style long description.

![Only the prompt changed](assets/prompt-rewrite.jpg)

- `a photo of two clocks` → original text **still draws one clock**; long description → **exactly two**.
- `a photo of a purple wine glass and a black apple` → apple missing with the original; long description → **both present, colours bound correctly**.

One caveat must travel with this: the right-hand descriptions were **hand-written in the enhancer's style**, and are **not** real output from the official rewriter (a fine-tuned Qwen3.5-VL 9B checkpoint we never deployed). So the result shows that prompt *form* matters enormously — not that the official rewriter would necessarily recover the score.

### Do not treat 2K/40 steps as a cure

Re-running the four long-text prompts with the official recipe (2048²/40 steps), with SenseNova at 2048² as a control:

| LongText-Bench prompt | Qwen 1024²/20 steps | Qwen 2048²/40 steps (official) | SenseNova 2048² |
|---|---|---|---|
| English chalkboard menu | 20.5% · 2/7 | 13.7% · 3/7 | 63.4% · 3/7 |
| English festival poster | 94.4% · 4/5 | 80.6% · 2/5 | 73.3% · 1/5 |
| Chinese slide | 81.5% · 12/12 | 81.1% · 12/12 | 76.9% · 11/12 |
| Chinese festival poster | 90.2% · 3/5 | **98.6% · 4/5** | 97.3% · 4/5 |
| **mean (char accuracy · line hits)** | **71.7% · 72.4%** | **68.5% · 72.4%** | **77.7% · 65.5%** |

**Text rendering did not improve, and the cost is 172 s/image against 52 s/image at 1024²/20 steps.**

An honest qualifier: OCR is not fully comparable across resolutions (smaller, more decorative type at 2K — the poster's 94.4% → 80.6% is the font style eating it), so the fair reading is **"no measurable gain"**, not "2K is worse".

*Structural* failures, on the other hand, really are a configuration problem — the bench that collapsed at 1024² is fine at 2048²:

![2K re-test](assets/2k-retest.jpg)

**So keep the two goals apart: for compositional prompts the lever is prompt rewriting, not resolution; for correct text the lever is the model, and more steps buy nothing.**

## A second prompt set: 26 vertical prompts

Public leaderboards measure general capability, which does not answer *"which model should take this job"*. So we wrote our own: **9 domains, 26 prompts**, each carrying its own checkpoints, every model at two sizes (a uniform 1024² for cross-model comparison, plus each model's recommended size) — **156 images**.

| Domain | Pick | Key finding |
|---|---|---|
| Architecture · exterior | any of the three | SenseNova 1024 and FLUX 1536 **hallucinate large signage on glass curtain walls**; Qwen does not |
| Architecture · interior | **SenseNova** | Most stable light layering. At 1024² Qwen drops mood constraints: a night bedroom comes out as daylight |
| Portrait | **SenseNova** (close-ups) / any (group) | The elderly close-up shows the biggest gap: SenseNova is photographic, Qwen visibly smoother |
| App · UI | **SenseNova** | The only one that renders a correct Chinese UI already at 1024² |
| Product · e-commerce | any of the three | Qwen missed "two bottles" at 1024², but its label text is the most accurate |
| Game · icons | **Qwen** (single icon) | Single icons are commercial-grade from all three; **"12 style-consistent line icons" breaks all three** |
| Anime · 2D | Qwen / SenseNova (FLUX out) | On the Chinese poster both write title, subtitle, slot and studio correctly; FLUX garbles the whole block |
| Comic · storyboard | **SenseNova** | Four-panel comic: only it puts each Chinese line **in its own panel** |
| Illustration · picture book | **SenseNova** | Chinese ink-wash: Qwen comes out too faint at both sizes — the negative space swallows the mountains |

The App·UI group is the clearest proof that you cannot pick a model from a leaderboard:

![App UI contact sheet](assets/app-ui.jpg)

At 1024² Qwen **shrinks the whole mockup into a small block in the middle with ghosting**, recovering only at 2048² (line hits 5/12 → 11/12, char accuracy 63.0% → 86.4%). SenseNova is 12/12 at that size to begin with.

The four-panel comic shows the other thing — on one image, two metrics say different things:

![Comic contact sheet](assets/comic.jpg)

Qwen **writes all four lines** (4/4 line hits) but **attaches them to the wrong panels** and mixes in garbled characters, so char accuracy is 34.8%. SenseNova is 100% · 4/4. **Hit rate answers "was the sentence written", char accuracy answers "are the characters right" — this prompt needs both.**

### Latency

| Median of the first 18 prompts | Qwen-Image-2.1 | SenseNova-U1.5 | FLUX.2-klein-KV |
|---|---|---|---|
| 1024² | 53.2 s | 9.8 s | **1.5 s** |
| native size | 113.1 s (2048²) | 13.2 s (2048²) | **3.8 s** (1536²) |

The 8 vertical prompts **added later are not in this table and must not be compared**: card 3 was held by a render-farm job while they ran, so the Qwen arm moved to a borrowed card and used the more memory-frugal `sequential` offload mode throughout — 97 s at 1024² / 208 s at 2048², roughly 2× round one's `model` mode. Offload only changes when weights are staged in and out, not the sampling math, so image quality is unaffected at the same seed, but **the timings are not comparable**, hence excluded.

## Limitations — read these with the numbers

- **One image per prompt, single seed.** A spot check, not a leaderboard score; at n=4–7 a single prompt is ±14%.
- Compositional and long-description prompts were judged **by eye**, not by GenEval's Mask2Former or DPG's mPLUG+CLIP.
- The ablation's long descriptions are hand-written stand-ins, **not** real rewriter output.
- The three models **did not run the same step count** (Qwen 20 / SenseNova 8 / FLUX 4) — "best configuration", not "equal budget".
- The 26 vertical prompts are **self-authored**, not a public benchmark; same one-image-per-prompt caveat.
- The FLUX arm is an **INT4 4-step distilled deployment**, not the full FLUX 2 Pro / Max on that leaderboard.

## If you only want the verdict

- **Renders / portraits / UI mockups / comic panels** → SenseNova, and it is usable at 1024², more than 5× faster than Qwen
- **Anime posters with a big Chinese title, or transparent-background PNGs** → Qwen; it owns both
- **Compositionally complex scenes in Qwen** → turn on prompt rewriting first; do not ask with a terse sentence
- **Strictly consistent multi-element sets** (12 icons, say) → none of the three; plan on post-processing
- **Do not estimate real output quality from a leaderboard total** — a whole set of pipeline defaults sits in between

Prompt text, every generated image, timings and OCR scores are public in [qwen-image-2.1-bench](https://github.com/wangsheng1991/qwen-image-2.1-bench), alongside an [HTML report](https://wangsheng1991.github.io/qwen-image-2.1-bench/) and the [reproduction scripts](https://github.com/wangsheng1991/qwen-image-2.1-bench/tree/main/scripts).
