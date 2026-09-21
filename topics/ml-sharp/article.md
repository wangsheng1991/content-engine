单目视图合成要解决的问题很直接：给你一张照片，生成它附近视角的新画面，而且要看起来像真的。难的地方在于，一张照片没有视差，深度、遮挡、反射都缺信息。此前的做法往往要在「更真」和「更快」之间做取舍。

Apple 的 SHARP 给出的答案是把取舍绕开：不一步步重建场景，而是让神经网络把整张照片直接读成一份 3D 表示。

## SHARP 在做什么

按官方仓库 README 的描述，SHARP 接收一张照片，回归出这个场景的 3D 高斯（3D Gaussian）表示参数。整个过程是一次神经网络前馈，在标准 GPU 上耗时不到 1 秒。生成的 3D 高斯表示随后可以被实时渲染，输出附近视角的高分辨率写实图像。

README 还提到两点对开发者很关键：

第一，这个表示是 metric 的，带绝对尺度，因此支持米制相机运动——你给出的相机位移是有物理单位的，而不是一个随意缩放的相对量。

第二，坐标约定遵循 OpenCV（x 向右、y 向下、z 向前），而 3DGS 场景中心大致位于 (0, 0, +z)。这意味着把 `.ply` 交给第三方渲染器时，需要自己缩放和旋转，把场景重新居中。

按 README 的描述，整个过程不针对单个场景做迭代优化，而是一次前馈就把参数吐出来。这一点对工程上的意义很直接：推理路径短，你不需要为每张新图重新跑一轮训练式的流程。

## 关键数字一览

| 维度 | 此前最佳模型 | SHARP |
| --- | --- | --- |
| LPIPS | README 未给出绝对值，作为对比基准 | 相对降低 25–34% |
| DISTS | README 未给出绝对值，作为对比基准 | 相对降低 21–43% |
| 合成耗时 | README 未给出绝对值，作为对比基准 | 降低三个数量级；标准 GPU 上不到 1 秒 |
| 生成方式 | README 未说明 | 单次前馈（single feedforward pass） |
| 输出形式 | README 未说明 | 3D 高斯泼溅（3DGS），`.ply` 文件，兼容公共渲染器 |
| 泛化能力 | README 未说明 | 论文称具备跨数据集的鲁棒零样本泛化 |

表格里凡是 README 没写的，就空着，不替论文补数字。这些百分比描述的是相对此前最佳模型的改善幅度，不是绝对分值——LPIPS 和 DISTS 都是越低越好，所以「降低」是好事，但 README 没有给出绝对分值，这里也就不做换算。

## 从仓库到第一条预测命令

README 给出的上手路径很常规：建环境、装依赖、跑 CLI。

```bash
conda create -n sharp python=3.13
pip install -r requirements.txt
sharp --help
```

权重不需要手动准备：第一次运行时模型 checkpoint 会自动下载，并缓存在 `~/.cache/torch/hub/checkpoints/`。如果你更想自己管理权重，README 也给了直接下载 `.pt` 文件的方式，再用 `-c` 参数把本地 checkpoint 指给命令。

真正的推理只有一行：

```bash
sharp predict -i /path/to/input/images -o /path/to/output/gaussians
```

输出目录里是 3D 高斯泼溅文件。如果你还想额外拿到一条相机轨迹的视频，加上 `--render`；也可以从中间结果出发单独渲染：

```bash
sharp predict -i /path/to/input/images -o /path/to/output/gaussians --render
sharp render -i /path/to/output/gaussians -o /path/to/output/renderings
```

## 适合谁用，以及现在还不能做什么

按 README 的描述，它的定位是「单张图进、附近视角出」：适合照片量少、没有多视角采集条件，但又想要可自由换视角画面的场景，也适合把已有图像资产快速转成可实时渲染的 3D 资产。因为表示带绝对尺度，涉及真实位移的场景也能对得上单位。

另一个按 README 可以合理推断的好处来自耗时：既然单次前馈不到 1 秒，这一步就有可能放进交互式流程里，而不用当成一次离线批处理任务。不过 README 没有给出吞吐、并发或显存方面的数据，真要拿它做线上服务，还是得自己压测。

局限同样来自 README，写清楚比夸大更有用：

- 高斯预测本身在 CPU、CUDA、MPS 上都能跑，但用 `--render` 渲染相机轨迹视频目前要求 CUDA GPU，也就是说只有 CUDA 机器能直接出视频；
- gsplat 渲染器首次启动时初始化要等一会儿；
- 接第三方 3DGS 渲染器需要按上面的坐标系约定缩放旋转、重新居中；
- README 把定量与定性评估都指向论文和项目页，本页只复述 README 与摘要里的数字，不做额外推断。

## 自己跑一遍

```bash
conda create -n sharp python=3.13
pip install -r requirements.txt
sharp --help
sharp predict -i /path/to/input/images -o /path/to/output/gaussians
```

把 `-i` 换成你自己的图片目录，权重会在首次运行时自动下载。如果你的目标只是先把手里图片的质量提上去，也可以直接在线试 AI 图像增强，不必先跑通本地环境。
