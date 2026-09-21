# SHARP

## The problem

- One photo in, new viewpoints out is an old open problem.
- A single image has no parallax: depth, occlusion and reflections are unknown.
- Prior approaches trade photorealism against synthesis time.
- Most pipelines rebuild the scene in many steps.

## What SHARP does

- Takes a single photograph as input.
- Regresses the parameters of a 3D Gaussian scene representation.
- Runs as one feedforward pass.
- Finishes in less than a second on a standard GPU.

## Why the output is useful

- The 3D Gaussian representation renders in real time.
- Output is high-resolution photorealistic images for nearby views.
- Results land as 3D gaussian splats (3DGS) in the output folder.
- The `.ply` files are compatible with public 3DGS renderers.

## It is metric

- The representation is metric, with absolute scale.
- Metric camera movements are supported: displacement has real units.
- Convention follows OpenCV: x right, y down, z forward.
- Scene center is roughly at (0, 0, +z).

## Key numbers

- All comparisons are versus the best prior model.
- LPIPS reduced by 25–34%, DISTS by 21–43%.

| Metric | Versus best prior model |
| --- | --- |
| LPIPS | reduced by 25–34% |
| DISTS | reduced by 21–43% |
| Synthesis time | lowered by three orders of magnitude |

- Synthesis time lowered by three orders of magnitude.
- Robust zero-shot generalization across datasets.
- Relative gains, not absolute scores.

## Quick start

```bash
conda create -n sharp python=3.13
pip install -r requirements.txt
sharp --help
sharp predict -i /path/to/input/images -o /path/to/output/gaussians
```

- The checkpoint downloads automatically on first run.
- It is cached at `~/.cache/torch/hub/checkpoints/`.
- Pass `-c` to use a manually downloaded checkpoint.

## Rendering trajectories

```bash
sharp predict -i /path/to/input/images -o /path/to/output/gaussians --render
sharp render -i /path/to/output/gaussians -o /path/to/output/renderings
```

- Gaussian prediction works on CPU, CUDA and MPS.
- Rendering videos via `--render` currently requires a CUDA GPU.
- The gsplat renderer takes a while to initialize on first launch.

## Limitations to know

- Video rendering is CUDA-only today, so CPU and Mac users miss it.
- Third-party renderers need scaling and rotation to re-center.
- Quantitative and qualitative evaluation live in the paper.
- Check LICENSE and LICENSE_MODEL before shipping anything.

## Try it

- Repo: github.com/apple/ml-sharp
- Paper: arXiv 2512.10685
- Project page: apple.github.io/ml-sharp/
- Weights: sharp_2572gikvuh.pt
- Fork it, point `-i` at your own photos, and see what holds up.
