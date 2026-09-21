# {{ topic.title }}
{{#if topic.subtitle}}

> {{ topic.subtitle}}
{{/if}}

{{ topic.summary_text }}

## Key facts
{{#each topic.key_facts}}- **{{ label }}**: {{ value }}
{{/each}}
{{#if evidence.length}}

## Evidence
{{#each evidence}}- {{ claim }} — [{{ host }}]({{ source }})
{{/each}}
{{/if}}
{{#if topic.links}}

## Links
{{#each topic.links}}- [{{ label }}]({{ url }})
{{/each}}
{{/if}}
{{#if cta}}

## More

{{ cta.body_text }}

[{{ cta.label }}]({{ cta.url }})
{{/if}}

---

Compiled from `topics/{{ topic.slug }}/` by content-engine. Every claim above links to its source.
