# SHARP

Apple 开源的 SHARP：给它一张照片，它在不到 1 秒里把这张照片读成一个 3D 场景。今天用几分钟把它讲明白。

## The problem

::: notes
单目视图合成要解决的问题是：给一张照片，生成它附近视角的新画面，而且要像真的。难点在于一张照片没有视差，深度、遮挡、反射这些信息都缺，所以此前的做法常常要在「更真」和「更快」之间二选一。
:::

- One photo in, new viewpoints out is an old open problem.
- A single image has no parallax: depth, occlusion and reflections are unknown.
- Prior approaches trade photorealism against synthesis time.
- Most pipelines rebuild the scene in many steps.

## What SHARP does

::: notes
SHARP 的做法是不一步步重建，而是让神经网络一次前馈，直接回归出这个场景的 3D 高斯表示参数。按 README 的描述，整个过程在标准 GPU 上耗时不到 1 秒。
:::

- Takes a single photograph as input.
- Regresses the parameters of a 3D Gaussian scene representation.
- Runs as one feedforward pass.
- Finishes in less than a second on a standard GPU.

## Why the output is useful

::: notes
得到的高斯表示可以实时渲染，输出附近视角的高分辨率写实图像。结果以 3DGS 的形式落在输出目录里，那些 .ply 文件可以被公开的高斯渲染器直接读。
:::

- The 3D Gaussian representation renders in real time.
- Output is high-resolution photorealistic images for nearby views.
- Results land as 3D gaussian splats (3DGS) in the output folder.
- The `.ply` files are compatible with public 3DGS renderers.

## It is metric

::: notes
有一点容易被忽略：这个表示是 metric 的，带绝对尺度，所以支持米制的相机运动，位移是有物理单位的。坐标遵循 OpenCV 约定：x 向右、y 向下、z 向前，场景中心大致在 (0, 0, +z)。接第三方渲染器时，需要自己缩放和旋转来重新居中。
:::

- The representation is metric, with absolute scale.
- Metric camera movements are supported: displacement has real units.
- Convention follows OpenCV: x right, y down, z forward.
- Scene center is roughly at (0, 0, +z).

## Key numbers

::: notes
效果上，按官方 README 的表述，它在多个数据集上把 LPIPS 降低 25–34%，DISTS 降低 21–43%，对比的是此前的最佳模型。同时合成耗时降低了三个数量级，并且具备跨数据集的鲁棒零样本泛化。注意这些是相对改善的幅度，不是绝对分值。
:::

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

::: notes
上手成本很低。建一个 python=3.13 的环境，装好依赖，跑 sharp --help 确认安装成功。真正的推理只有一行：sharp predict，用 -i 指定输入图片目录，-o 指定输出高斯目录。权重第一次运行会自动下载，缓存在 torch hub 的 checkpoints 目录里。
:::

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

::: notes
想渲染相机轨迹的话，predict 加 --render，再用 sharp render 指定高斯目录和输出目录。高斯预测在 CPU、CUDA 和 MPS 上都能跑，但渲染轨迹视频目前需要 CUDA GPU。gsplat 渲染器首次启动初始化要等一会儿。
:::

```bash
sharp predict -i /path/to/input/images -o /path/to/output/gaussians --render
sharp render -i /path/to/output/gaussians -o /path/to/output/renderings
```

- Gaussian prediction works on CPU, CUDA and MPS.
- Rendering videos via `--render` currently requires a CUDA GPU.
- The gsplat renderer takes a while to initialize on first launch.

## Limitations to know

::: notes
局限也说清楚。渲染轨迹视频目前只有 CUDA 能用，所以 CPU 和 Mac 用户拿不到这一块；第三方渲染器要自己缩放和旋转来重新居中；定量和定性的评估细节在论文和项目页里。上线前记得看 LICENSE 和 LICENSE_MODEL。
:::

- Video rendering is CUDA-only today, so CPU and Mac users miss it.
- Third-party renderers need scaling and rotation to re-center.
- Quantitative and qualitative evaluation live in the paper.
- Check LICENSE and LICENSE_MODEL before shipping anything.

## Try it

::: notes
仓库、论文和项目主页的地址都在屏幕上。先把 sharp predict 指向你自己的照片跑一遍，看看哪些地方站得住。
:::

- Repo: github.com/apple/ml-sharp
- Paper: arXiv 2512.10685
- Project page: apple.github.io/ml-sharp/
- Weights: sharp_2572gikvuh.pt
- Fork it, point `-i` at your own photos, and see what holds up.
