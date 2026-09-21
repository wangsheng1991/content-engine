<!-- draft · tier B · 需人工确认后发布 · 由 content-engine 从 topics/{{ topic.slug }}/ 生成于 {{ generated_at }} -->
<!-- 每条 ≤ 280 字符；逐条发布或粘进线程工具 -->

# {{ platform.title }}

1/ {{ platform.title }}

2/ {{ topic.summary_text }}

3/ 关键数字
{{#each topic.key_facts}}- {{ label }}: {{ value }}
{{/each}}

4/ 仓库：{{ topic.canonical.repo }}
论文：{{ topic.canonical.paper }}
{{#if cta}}
{{ cta.label }}：{{ cta.url }}
{{/if}}
