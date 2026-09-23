# 运营发布系统 · 调研与选型

日期：2026-09-23 ｜ 配套：`REQUIREMENTS.md`（需求）、`docs/OPS_STACK.md`（工具选型）、`docs/SOCIAL_STACK.md`（社媒逐平台实测）

**这份文件回答一个问题**：整套统一运营系统里，**哪些直接拿来用、哪些二次开发、哪些必须自建**。
所有事实来自本次实际拉取的仓库源码、官方文档与真实 API 调用；「已验证」和「只是推测」在 §6 分开列。

---

## 0. 结论先行：三分

### ✅ 直接拿来用（不写一行代码，或只写胶水）

| 用什么 | 干什么 | 成本 | 为什么不是自建 |
|---|---|---|---|
| **Postiz**（`gitroomhq/postiz-app`，AGPL-3.0，36.2k★） | 统一排程、草稿/排期状态、后面某天的可视化面板 | 自建 docker（Postgres + Redis + Temporal，4GB 内存建议） | 它是唯一同时满足「自建 + 纯 HTTP/CLI 驱动 + 平台覆盖广」的；自己写一套排程器要重造 Temporal 的失败重试 |
| **Cloudflare Web Analytics** | 自有站点的浏览量/来源 | 免费 | 已实测账户级 GraphQL 能拉到真实数据；自建 Umami/Plausible/PostHog 都不值（见 §4） |
| **飞书**（已在用） | 看板、周报、审批卡片、人工回填 | 免费 | RenVi 已有 15 个 `feishu-*.mjs` 跑通，再引第二个看板就是浪费 |
| **Dev.to / Bluesky 公开 API** | 发布后反馈 | 免费 / 免认证 | 数据就摆在那儿，抓一下即可；引入任何「分析平台」都是中间商 |

### 🔧 二次开发（主战场，自己写）

| 做什么 | 为什么必须自己写 |
|---|---|
| **`content-engine` 加账本（ledger）** | 没有任何现成系统认识「`topics/<slug>/` 这个内容单元」。账本是这套系统里唯一的新概念，只能在内容引擎里长出来 |
| **`content-engine` 加渠道适配器层** | 现成平台的抽象（Postiz 的 `post/postPending/comment`）**没有 `update`**，架构上就不支持改已发布内容；而且它们不认识我们的 `content_id` |
| **`content-engine` 加反馈采集** | 平台指标必须按 `(topic, channel)` 落库，现成分析工具不认识这个维度 |
| **归因打通**（dlss5 产品侧接收 ref/utm） | 这是产品代码，没有外部方案 |

### ⛔ 不引入（调研过，明确否掉）

| 否掉什么 | 理由 |
|---|---|
| **Mixpost** | Lite 只有 FB/X/Mastodon；Pro（$299 一次性）也没有 Dev.to/Reddit；**主仓库最后提交停在 2026-03-16**（半年），X API 一变动就只能等作者 |
| **n8n / Activepieces / Windmill 当发布底座** | 它们不提供平台账号体系，你得自己接每一个平台 —— 那胶水写在这里和写在 content-engine 里有区别吗？Activepieces 有 social 连接器，但仍是错位用法 |
| **SaaS 聚合**（Ayrshare / Blotato / Publer / Buffer） | Ayrshare $149–599/月且**无 Dev.to**；Blotato $29/月起但白名单**明确不含 Reddit/Dev.to**；Publer 的 API 只卖 Business/Enterprise；Buffer 按频道 $5/$10 计费。都不覆盖你真正需要的两个平台 |
| **自建分析**（PostHog / Plausible / OpenPanel） | PostHog 自建官方标为 unsupported 且要 16GB 内存；Plausible 要 ClickHouse；为两个小站不值 |
| **Ghost 当反馈源** | Ghost Admin API 的端点表里**没有 `/emails/`** —— 邮件打开/点击率拿不到。它的强项是内容站本身，不是反馈 |
| **AiToEarn / social-auto-upload / Wechatsync**（中国平台） | 确实能接小红书/知乎，但要么依赖浏览器登录态（平台改版即失效）、要么开放平台是**电商方向**（实测确认小红书开放平台是 ERP/打单/进销存，没有创作者数据接口）。**现阶段继续人工**，见 §5 |

---

## 1. 判定标准

沿用 `OPS_STACK.md` 的三条，再加两条这套系统特有的：

1. **在这台机器上真能跑**（零/低安装成本）
2. **质量能由机器判定**（有闸门，不靠人重读）
3. **发布路径今天就是通的**（不写「以后再接」）
4. 🆕 **我能用 curl 走完**（`REQUIREMENTS.md` R8）：建草稿 → 排期 → 发布 → 查数据，全部有 API/CLI
5. 🆕 **不制造第二个真相来源**：每个新组件都要回答「它跟现有系统里哪个东西职责重叠」

按第 5 条，`ops/n8n-postiz`、飞书、Postiz 三者里，**只有飞书是不可替代的**（看板），Postiz 是可选增强，n8n 是纯冗余。

---

## 2. 候选全景

### 2.1 统一发布 / 排程平台

| 项目 | 许可 | 平台覆盖（★ = 你关心的） | 脚本可驱动 | 活跃度 | 判定 |
|---|---|---|---|---|---|
| **Postiz** | AGPL-3.0 | 34 个。★Bluesky（app password，免开发者应用）、★Dev.to（API key）、★Reddit、★X、WordPress、Medium、Hashnode | **最强**：Public REST + 官方 CLI（全 JSON 输出）+ MCP + n8n 节点 + Node SDK | 36,214★，2026-09-23 | ✅ **选它** |
| Mixpost | MIT / Pro $299 | Lite：FB/X/Mastodon。Pro 加 IG/LI/YT/TikTok/Pinterest/Threads/Bluesky。**无 Dev.to、无 Reddit** | 有 REST，但 API 属 Pro 权益 | 3,734★，**2026-03-16** | ❌ 不活跃 + 缺平台 |
| Ayrshare | 闭源 SaaS | ★Reddit/★X/★Bluesky，**无 Dev.to** | 纯 API，最完整 | 商业 | ❌ $149–599/月 |
| Blotato | 闭源 SaaS | ★X/★Bluesky，**白名单穷举且不含 Reddit/Dev.to** | 文档对 agent 极友好 | 商业 | ❌ 平台不够 |
| Publer | 闭源 SaaS | ★X/★Bluesky/WordPress，无 Reddit/Dev.to | 有 API，**仅 Business/Enterprise** | 商业 | ❌ 门槛 |
| Buffer | 闭源 SaaS | ★X/★Bluesky，无 Reddit/Dev.to | GraphQL + CLI，Free 档 1 key | 商业 | ⚠️ 备选 |
| BrightBean Studio | AGPL-3.0 | ★Bluesky、★**Dev.to**（唯一内置 Dev.to 的自建平台） | **未找到 REST API 文档** | 2,361★，2026-09-20 | ⚠️ 只适合「想要 UI 但不想运维」 |
| OpenPost / TryPost | AGPL-3.0 | 未深查 | 未查 | 均活跃 | ⚠️ 备胎 |

**协议的实话**：Postiz 是 AGPL-3.0。自用、自托管完全没问题；AGPL 只在你**把它当服务转卖**时才咬人。你不卖排程服务。

**Postiz 的两个硬事实**（读源码得到，不是抄 README）：

- provider 接口只有 `post / postPending / comment`（`social.integrations.interface.ts`）——**架构上不支持更新已发布内容**。
- 分析只覆盖 10 个平台，**不含 Bluesky、Dev.to、Reddit**——所以反馈别指望它。

这两条正好把「反馈」和「更新」推回我们自己的代码里，和 §0 的结论一致。

### 2.2 编排 / 自动化工具

| 工具 | 许可 | 判断 |
|---|---|---|
| n8n | fair-code（自建免费） | ❌ 核心节点**没有 Bluesky、没有 Dev.to**；它不解决账号体系，只是胶水 |
| Activepieces | MIT（`packages/ee` 除外） | ⚠️ 三者里唯一自带 social 连接器（bluesky/postiz/reddit/twitter/…）。若哪天不想要 Temporal 的 weight，用它 + Postiz piece 做轻量编排 |
| Windmill | AGPLv3 核心 + 专有企业码 | ❌ 无社交连接器，纯脚本调度器。**我们已经有一个脚本执行环境了（这台机器 + penguin schedule）** |

### 2.3 自有站点 / newsletter

| 方案 | 许可 / 成本 | 判定 |
|---|---|---|
| **Cloudflare Web Analytics** | 免费 | ✅ 站点分析选它（已实测 GraphQL 通道） |
| GA4 | 免费，已在两站 | ⚠️ 已有，但 Data API 要建服务账号，比 Cloudflare 麻烦；留作二选 |
| Umami | MIT，Node + Postgres | ⚠️ 若坚决要自建，只考虑它；注意**云版免费档不给 API**（要 Pro $20/月） |
| Ghost | MIT 核心 | ❌ 反馈读不到（无 `/emails/` 端点） |
| WordPress | GPLv2+ | ⚠️ 作为「可脚本发布的 CMS」成立，但**不是社交聚合** |
| **Listmonk** | AGPLv3，单二进制 + 一个 Postgres | ✅ 若要自建邮件，它最轻，API 直接给 `views`/`clicks`/`sent` |
| **Buttondown** | 商业 SaaS，按活跃订阅者计费 | ✅ 零运维，**RSS-to-Email** 能把「RSS 订阅数结构性拿不到」转成「邮件打开/点击可测」 |
| FeedHive / dlvr.it | 商业 SaaS | ❌ RSS→社交这条路 Postiz 自带，不用再引 |

### 2.4 中国平台

| 方案 | 许可 | 判断 |
|---|---|---|
| AiToEarn | MIT，26.3k★ | ⚠️ 有开放平台 REST（含**更新已发布内容**、重试失败），14 平台含小红书/抖音/B站/视频号。**但开放平台文档挂在它的云服务域名下，自建实例是否提供同一套 API 未验证** |
| social-auto-upload | MIT，15.1k★ | ⚠️ CLI（`sau xiaohongshu upload-note …`）+ 自带 agent skills，Playwright 走登录态。**平台改版即失效，无 SLA** |
| Wechatsync / PostBot / xhs_ai_publisher | GPL-3.0 / Apache-2.0 | ⚠️ 浏览器扩展形态，草稿优先。知乎目前最现实的通道 |

**判断：现阶段不引入。** 理由见 §5。

---

## 3. 逐层判断

### 3.1 发布平台层 → Postiz，**直接用**（但排在后面）

**为什么**：它是唯一同时满足「自建 + curl 全流程 + 覆盖 X/Reddit/WordPress」的。公开 API 把 `Create Post / Change Post Status(draft↔schedule) / List Posts / Post Analytics / Get Missing Content` 全暴露成 REST，官方 CLI 命令「All commands output JSON」，MCP、Node SDK、n8n 节点齐全 —— 完全满足 R8。

**什么时候不起它**：它管的平台（X/IG/TikTok/YouTube/Pinterest）**现在一个都没在发**。起一套 4GB 的 docker 只为了一本目前不需要的账，是负收益。等真要发 X 时再起（D5）。

**接法（沿用 `SOCIAL_STACK.md` §0.5 的结论）**：在 content-engine 加 `content publish --postiz`，形状和已验证的 `--hf` / `--bluesky` 一样。**不要 n8n**。

**自建 Postiz 的真实代价**：它**不**帮你绕过 X / Meta 的开发者应用。自托管时 X、Instagram、TikTok、YouTube、Pinterest、Reddit **每一个都要你亲自去注册应用**。免开发者应用的只有 Bluesky / Dev.to / Medium / Hashnode / WordPress / Mastodon 这批 —— 而这批里，**Bluesky 和 Dev.to 我们已经直连了**。

### 3.2 反馈层 → 平台公开 API **自己拉**，站点用 Cloudflare

这是本次调研最实在的产出。三条线全部实测过：

**Dev.to（免费，唯一给浏览量的平台）**
```
GET /api/articles/me/published       → page_views_count / public_reactions_count / comments_count
GET /api/analytics/totals            → 聚合：views、average_read_time_in_seconds、reactions 分类、follows.total
GET /api/analytics/historical        → 按天的同一结构（文档里没突出写，实测 200）
GET /api/comments?a_id=<id>          → 评论正文（免认证）
```
注意：`page_views_count` **只在带 `api-key` 的 `/api/articles/me*` 里给值**，公开接口里是 `null`。

**Bluesky（免认证，但没有展示量）**
```
app.bsky.actor.getProfile?actor=<handle>          → followersCount / followsCount / postsCount
app.bsky.feed.getAuthorFeed?actor=<handle>        → 每帖 like/repost/reply/quote/bookmark 数
app.bsky.feed.getLikes?uri= / getRepostedBy?uri=  → 谁点的赞、谁转的（最有价值的线索）
```
**没有展示量**——三种返回里都不存在这个字段。不要把它设成目标。

> **已经有人在做了**：RenVi 的 `scripts/bluesky-insights.mjs` 就是干这个的（拉每帖赞/转/评 + 点赞者 → 覆盖式写飞书）。新系统的 Bluesky 反馈部分**直接抄它**，不用重写。

**自有站点**
`POST https://api.cloudflare.com/client/v4/graphql` 的 `rumPageloadEventsAdaptiveGroups`，账户级已实测通（用 vault 里的 token 拿到了 `token2any.com` 的真实数字）。
两个坑：
- `dlss5nvidia.com` 和 `houseplusplus.com` 在 Cloudflare 账号里（Free 计划），**但 Web Analytics 没开**（只有 `moneybackmyhome.ccwu.cc` 和 `token2any.com` 开了）。→ 这是阶段 0 的第一个动作。
- 查 zone 级 HTTP 分析会 403，缺 `Zone → Analytics → Read` 权限。

**X（可选，门槛比想象低）**
API 已经改成**按量付费**，不是 $200/月订阅：读帖 $0.005/资源、24 小时内去重、无月最低。每天读自己 100 条帖约 $0.5。
两个隐藏成本：`Post: Create (with URL)` **$0.200/次**（正文里的链接考虑走回复）；non-public 指标**30 天过期**（必须当日归档）。

**只能人工的**

| 平台 | 实测证据 | 怎么办 |
|---|---|---|
| 小红书 | `open.xiaohongshu.com` 是**电商开放平台**（ERP/打单/进销存），无创作者数据接口 | 飞书里留一行，每周手工抄「笔记数/总浏览/总赞藏/涨粉」 |
| 知乎 | `robots.txt` = `User-Agent: * → Disallow: /`；`open.zhihu.com` 返回 422 | 同上 |
| Reddit | 本机全域名 HTTP 000；且 `/dev/api` 全文 `view_count` **命中 0 次**（阅读量字段已消失） | 人工填「分数 + 评论数」即可，对「决定下一篇写什么」够用 |

### 3.3 看板层 → 飞书，**直接用**

RenVi 的 15 个 `feishu-*.mjs` 已经跑通卡片/文档/覆盖式更新。`bluesky-insights.mjs` 甚至已经是一个「Bluesky 互动看板」。
**统一系统只往飞书写，不再造第二个界面**（`REQUIREMENTS.md` R11）。

### 3.4 内容编译层 → content-engine，**不动**

`topics/<slug>/` 一个目录编译出站点/博客/RSS/GitHub/HF/PPT/视频脚本/平台草稿，是整个系统最值钱的抽象。新系统只**消费** `dist/manifest.json`。

### 3.5 调度层 → 见 `REQUIREMENTS.md` D3

倾向本机 launchd（RenVi 的 Bluesky 定时已经这么设计）。理由：所有运营动作的执行地本来就是这台机器（Playwright、docker、凭证都在这儿）。

### 3.6 邮件层（可选）

如果哪天要把「有人真的在看」变成可测数字：**Buttondown 的 RSS-to-Email**（零运维，一条 API 拿到 opens/clicks）或 **Listmonk**（单二进制 + 一个 Postgres，自持）。
判断标准：**打开和点击是人做的动作，浏览量不是**。邮件 > RSS > 网页浏览量。
**现在不做**——没到需要 newsletter 的体量。

---

## 4. 推荐架构

```
   topics/<slug>/                     ← 内容单一事实来源（已有，不动）
        │  content build
        ▼
   content-engine CLI                 ← 唯一的控制面，agent 驱动的入口
        ├── ledger/         每个 (topic, channel) 一条记录、内容哈希、外部 ID
        ├── src/channels/   devto · bluesky · postiz · manual
        ├── feedback/       每日拉指标 → 按 slug 归档 JSON
        └── report/         周报 → docs/reports/ + 飞书
        │
        ├──► GitHub Pages / Hugging Face     现状，不动
        ├──► Dev.to        （直连，支持 PUT 更新）
        ├──► Bluesky       （直连，已通）
        ├──► Postiz ──► X / IG / TikTok / Pinterest / YouTube   （需要时才起）
        └──► 飞书 ──► 小红书 / 知乎 / Reddit 的人工卡片与回填
                     站点分析 ◄── Cloudflare Web Analytics
```

**一句话**：Postiz 负责「它认识的平台的排程」，content-engine 负责「账、内容、反馈、以及一切它驱动得动的东西」，飞书负责「给人看的那一面」。

---

## 5. 为什么中国平台现阶段不引入

三条都成立才值得引入，而它们三条都不全：

1. **有 API 吗** —— 小红书/知乎都没有创作者数据 API（实测）。social-auto-upload 走的是浏览器登录态，**平台改版即失效**。
2. **收益覆盖成本吗** —— 小红书、抖音现在是**人工发布**（`OPERATIONS_SYSTEM_V2.md` 明确写「生成和同步自动，发布人工」）。自动化发布能省的时间，小于维护 cookie、对抗风控的成本。
3. **会引入第二个真相来源吗** —— 会。AiToEarn 自带一套排程与状态，和 content-engine 的账本冲突。

**做法**：继续人工发，但**把「人工发」变成系统里可查的一步**——飞书卡片 + 发完回填链接 + 进账本。这样它和 Tier A 在报表里一样可见。这正是 `REQUIREMENTS.md` R2 对 Tier B 的定位。

**留一个口子**：如果小红书真的成了主转化渠道（`OPERATIONS_SYSTEM_V2.md` 说它是「中文主转化」），再评估 AiToEarn（**前提是先验证自建实例是否暴露开放平台 API**）或 social-auto-upload。

---

## 6. 已被验证 / 只是推测

### 已验证（本次实际拉到文件或发起过请求）

- Postiz：AGPL-3.0、34 平台与连接方式、依赖 Postgres/Redis/Temporal、公开 API 端点全集、CLI 全 JSON 输出、分析不含 Bluesky/Dev.to/Reddit、provider 无 update —— 来自仓库源码与官方文档。
- Mixpost：Lite 的三个 provider 目录、Pro 平台清单、$299/$1,199 定价、最后提交 2026-03-16。
- Ayrshare / Blotato / Publer / Buffer 的平台清单与定价档位（Buffer 逐频道、Ayrshare $149/299/599+）。
- n8n 的社交节点清单（无 Bluesky / Dev.to 核心节点）与 Sustainable Use License；Activepieces 的 community pieces 含 bluesky/postiz/reddit；Windmill 无社交连接器。
- Ghost Admin API 端点表**无 `/emails/`**；Listmonk 的 campaign 统计端点；Buttondown 的 `/v1/emails/{id}/analytics` 字段表。
- **Dev.to 真实调用**：`/api/users/me`、`/api/articles/me/published`、`/api/analytics/totals`、`/api/analytics/historical` 全部 200，且确认 `page_views_count` 只在鉴权接口里给值。
- **Bluesky 真实调用**：`getProfile`（followers 12）、`getAuthorFeed`、`getLikes`、`getRepostedBy` 全部 200 且免认证；`searchPosts` 匿名 403；确认**无展示量字段**。
- **Cloudflare 真实调用**：账户级 `rumPageloadEventsAdaptiveGroups` 返回真实数字；`rum/site_info/list` 确认两个产品站**未开** CWA；zone 级分析 403（缺权限）。
- **小红书/知乎**：`open.xiaohongshu.com` 是电商开放平台；知乎 robots `Disallow: /`；`open.zhihu.com` 422。
- **Reddit**：本机全域名 000；`/dev/api` 全文 `view_count` 0 命中；现行 100 QPM；商业用途需审批。
- 自建分析的许可证与量级：Umami MIT、Plausible AGPL-3.0、PostHog 自建标 unsupported 且 16GB 起。

### 只是推测 / 未验证（不要当结论用）

- **AiToEarn 自建实例是否暴露同等开放平台 API** —— 文档挂在云服务域名下，未在仓库找到自建 API 说明。
- **BrightBean Studio 是否有可用 REST API** —— 只看到 Django admin，脚本驱动性存疑。
- **FeedHive 是否支持 X / Bluesky / Reddit** —— 只取到 8 个平台的证据。
- **dlvr.it 的价格与是否有 API** —— 被 Cloudflare 拦，未证实。
- **Publer 的具体价格** —— 页面客户端渲染。
- **Postiz 自建在 macOS 上的实际资源占用** —— 官方数字（2GB 下限 / 4GB 建议）未实地验证。
- **X API 未真实调用** —— 手上无凭证，只读了官方文档（`docs.x.com` 的 `.md` 页面），没有编造「实测」。
- **小红书/知乎工具的长期可用性** —— 全部依赖浏览器会话，平台改版即失效，无 SLA。
