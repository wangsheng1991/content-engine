<!-- draft · tier B · 需人工确认后发布 · 由 content-engine 从 topics/{{ topic.slug }}/ 生成于 {{ generated_at }} -->
<!-- 配图建议：正文前 3 秒内用一张「输入图 → 3D 场景」的对比图；图片需另配，不在本文件内 -->

# {{ platform.title }}

{{ platform.hook }}

{{ topic.subtitle }}

为什么值得看 👇
{{#each topic.key_facts}}· {{ label }}：{{ value }}
{{/each}}
一句话原理：不是一步步重建，而是让模型一次前馈就回归出场景的 3D 高斯表示。

想自己跑的话，仓库里一条命令就能试：
`sharp predict -i 输入图目录 -o 输出目录`

仓库和论文都在这里 👉 {{ topic.canonical.repo }}

{{ cta.headline }}
{{ cta.body_text }}
{{ cta.label }} 👉 {{ cta.url }}

{{ topic.hashtags_zh }}
