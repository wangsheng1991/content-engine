# SHARP: Sharp Monocular View Synthesis in Less Than a Second

TL;DR — SHARP takes a single photograph and regresses a 3D Gaussian representation of the scene in one feedforward pass, in less than a second on a standard GPU. The output is a metric 3DGS `.ply` that renders photorealistic nearby views in real time.

## What it does

- Input: one photograph. Output: the parameters of a 3D Gaussian representation of the depicted scene.
- The representation is metric, with absolute scale, so metric camera movements are meaningful.
- The produced gaussians render in real time, yielding high-resolution photorealistic images for nearby views.
- Experimental results show robust zero-shot generalization across datasets.

## Key numbers

- Synthesis time: less than a second on a standard GPU via a single feedforward pass.
- LPIPS: reduced by 25–34% versus the best prior model.
- DISTS: reduced by 21–43% versus the best prior model.
- Synthesis time: lowered by three orders of magnitude versus the best prior model.

## Quick start

```bash
conda create -n sharp python=3.13
pip install -r requirements.txt
sharp --help

sharp predict -i /path/to/input/images -o /path/to/output/gaussians
```

The checkpoint is downloaded automatically on first run and cached at `~/.cache/torch/hub/checkpoints/`. To render a camera-trajectory video, add `--render` (currently requires a CUDA GPU), or run `sharp render -i /path/to/output/gaussians -o /path/to/output/renderings`.

## Links

- Project page: [apple.github.io/ml-sharp](https://apple.github.io/ml-sharp/)
- Paper: [arXiv:2512.10685](https://arxiv.org/abs/2512.10685)
- Code: [github.com/apple/ml-sharp](https://github.com/apple/ml-sharp)
- Weights: [sharp_2572gikvuh.pt](https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt)

The 3DGS `.ply` files follow the OpenCV coordinate convention (x right, y down, z forward), with the scene center roughly at (0, 0, +z); third-party renderers need to scale and rotate to re-center.

## Citation

```bibtex
@inproceedings{Sharp2025:arxiv,
  title      = {Sharp Monocular View Synthesis in Less Than a Second},
  author     = {Lars Mescheder and Wei Dong and Shiwei Li and Xuyang Bai and Marcel Santos and Peiyun Hu and Bruno Lecouat and Mingmin Zhen and Ama\"{e}l Delaunoy and Tian Fang and Yanghai Tsin and Stephan R. Richter and Vladlen Koltun},
  journal    = {arXiv preprint arXiv:2512.10685},
  year       = {2025},
  url        = {https://arxiv.org/abs/2512.10685},
}
```
