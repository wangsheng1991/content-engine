<!-- draft · tier B · approve before posting · generated from topics/{{ topic.slug }}/ at {{ generated_at }} -->
<!-- Read the target subreddit's rules first. Do not use this for unsolicited outreach or automated posting. -->

# {{ platform.title }}

{{ platform.hook }}

**TL;DR** — {{ topic.summary_text }}

**What it actually does**
{{#each topic.key_facts}}- {{ label }}: {{ value }}
{{/each}}

**Why I think it is worth a look**

{{ topic.subtitle }}

**Running it**

```bash
conda create -n sharp python=3.13
conda activate sharp
pip install -r requirements.txt
sharp predict -i /path/to/input/images -o /path/to/output/gaussians
```

**Sources**
{{#each evidence}}
> {{ claim }}
> — {{ source }}
{{/each}}
{{ topic.canonical.repo }} — official repository
{{ topic.canonical.paper }} — paper
{{ topic.canonical.project }} — project page with video comparisons

*Notes compiled with a small content engine; corrections welcome on any detail.*
{{#if cta}}

---

*Disclosure: I work on [{{ cta.label }}]({{ cta.url }}), an online AI image editor — unrelated to this project's release, mentioned because the notes are hosted there.*
{{/if}}
