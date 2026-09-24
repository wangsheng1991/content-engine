<!-- draft · tier B · approve before posting · generated from topics/{{{topic.slug}}}/ at {{{generated_at}}} -->
<!-- Read the target subreddit's rules first. Do not use this for unsolicited outreach or automated posting. -->
<!-- A post with no picture does not travel here. The files below are in topics/{{{topic.slug}}}/assets/ — upload one with the post, do not link to it. -->

# {{{platform.title}}}

{{{platform.hook}}}

**TL;DR** — {{{topic.summary_text_en}}}

**What it actually does**
{{#each topic.key_facts}}- {{{label}}}: {{{value}}}
{{/each}}

{{#if topic.media}}**The picture**

{{#each topic.media}}- `{{{file}}}` ({{{kind}}}) — {{{caption_en}}}
{{/each}}
{{/if}}
{{#if platform.extra}}
{{{platform.extra}}}
{{/if}}
**Sources**
{{#each evidence}}
> {{{claim}}}
> — {{{source}}}
{{/each}}

*Notes compiled with a small content engine; corrections welcome on any detail.*
{{#if cta}}

---

*Disclosure: these notes are hosted on a site of mine, and the call to action above points at its free tool.*
{{/if}}
