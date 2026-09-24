<!-- draft · tier B · 需人工确认后发布 · 由 content-engine 从 topics/{{{topic.slug}}}/ 生成于 {{{generated_at}}} -->
<!-- 配图/视频在下面「素材」一节列着，文件在 topics/{{{topic.slug}}}/assets/ 里 —— 小红书要先图后文，第一条笔记请带上视频 -->

# {{{platform.title}}}

{{{platform.hook}}}

{{{topic.subtitle}}}

为什么值得看 👇
{{#each topic.key_facts}}· {{{label}}}：{{{value}}}
{{/each}}

素材（按平台选一条：小红书优先发视频，其次发动图）
{{#each topic.media}}· {{{file}}}（{{{kind}}}）—— {{{caption}}}
{{/each}}

{{#if platform.extra}}{{{platform.extra}}}
{{/if}}
{{{cta.headline}}}
{{{cta.body_text}}}
{{{cta.label}}} 👉 {{{cta.url}}}

{{{topic.hashtags_zh}}}
