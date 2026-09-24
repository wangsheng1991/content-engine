<!-- draft · tier B · 需人工确认后发布 · 由 content-engine 从 topics/{{{topic.slug}}}/ 生成于 {{{generated_at}}} -->

# {{{platform.title}}}

{{{topic.summary_text}}}

## 为什么值得关注

{{{topic.subtitle}}}

## 关键数据

| 维度 | 数值 |
| --- | --- |
{{#each topic.key_facts}}| {{{label}}} | {{{value}}} |
{{/each}}

## 展开顺序

{{#each topic.headings}}- H{{{level}}} · {{{text}}}
{{/each}}

## 证据来源

{{#each evidence}}- {{{claim}}} —— {{{source}}}
{{/each}}

{{#if topic.media}}## 配的素材

{{#each topic.media}}- {{{file}}}（{{{kind}}}）—— {{{caption}}}
{{/each}}
{{/if}}
## 相关链接

{{#each topic.links}}- {{{label}}}：{{{url}}}
{{/each}}
{{#if cta}}

---

{{{cta.headline}}}

{{{cta.body_text}}}

{{{cta.label}}}：{{{cta.url}}}
{{/if}}
