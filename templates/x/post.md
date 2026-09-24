<!-- draft · tier B · 需人工确认后发布 · 由 content-engine 从 topics/{{{topic.slug}}}/ 生成于 {{{generated_at}}} -->
<!-- 每条 ≤ 280 字符；逐条发布或粘进线程工具。第一条带图/视频，纯文字的线程在这里没人点。 -->

1/ {{{platform.title}}}

2/ {{{topic.summary_text_en}}}

3/ Key numbers
{{#each topic.key_facts}}- {{{label}}}: {{{value}}}
{{/each}}

{{#if topic.media}}4/ Attach this to 1/
{{#each topic.media}}- {{{file}}} ({{{kind}}}) — {{{caption_en}}}
{{/each}}
{{/if}}
{{#if platform.extra}}{{{platform.extra}}}
{{/if}}
{{#if cta_en}}{{{cta_en.label}}}: {{{cta_en.url}}}
{{/if}}
