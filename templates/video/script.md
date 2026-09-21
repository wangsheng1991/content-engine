<!-- draft · tier B · 需人工确认后拍摄/剪辑 · 由 content-engine 从 topics/{{ topic.slug }}/video.yaml 生成于 {{ generated_at }} -->

# {{ video.title }}

- 目标时长：{{ video.target_seconds }} 秒（实际分镜合计 {{ video.total_seconds }} 秒）
- 分镜数：{{ video.scene_count }}
- 素材来源：`topics/{{ topic.slug }}/video.yaml`，画面与口播一一对应

| # | 时间码 | 屏上文字 | 画面 | 口播 |
| --- | --- | --- | --- | --- |
{{#each video.scenes}}| {{ index }} | {{ start }}–{{ end }}s | {{ onscreen }} | {{ visual }} | {{ voiceover_lines.0 }} |
{{/each}}

## 逐镜口播

{{#each video.scenes}}
### {{ index }}. {{ id }} · {{ start }}–{{ end }}s

**屏上文字**：{{ onscreen }}

**画面**：{{ visual }}

**口播**：
{{#each voiceover_lines}}- {{ this }}
{{/each}}
{{/each}}
{{#if cta}}
## 落点

{{ cta.body_text }}

结尾口播建议：{{ cta.label }} —— {{ cta.url }}
{{/if}}
