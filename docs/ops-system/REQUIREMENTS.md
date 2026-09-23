# 运营发布系统 · 需求整理

日期：2026-09-23 ｜ 版本：v2（v1 写于 2026-09-22，本次把「文档里怎么写」和「机器上实际在跑什么」分开重写了一遍）

这份文件是**需求的唯一事实来源**。调研与选型判断在 `LANDSCAPE.md`（同目录）。

**基线（这些是已经做过的决定，本文不重开）**：

| 已有决定 | 在哪个文件 |
|---|---|
| 整条流水线的工具选型 | `docs/OPS_STACK.md` |
| 社媒用哪个开源项目（选了 Postiz） | `docs/SOCIAL_STACK.md` |
| 做什么内容、按什么词做 | `docs/GROWTH_PLAN.md`、`docs/TOOL_RADAR.md` |
| 运营节奏、平台配额、北极星 | RenVi `docs/OPERATIONS_SYSTEM_V2.md` |

---

## 一、一句话

> 把「内容已经做出来了」到「知道它有没有用」之间的那一段变成一条流水线：
> **一个队列、一本账、一块看板**，并且每一步都能被我用命令行驱动。

现在缺的不是内容生产能力，是**记录**和**回收**。

---

## 二、现状：设计 vs 实跑

上一版这份文档只看了「仓库里写了什么」。这一版把三个仓库实际翻了一遍，下面每一行都是**机器上的事实**，不是文档里的愿望。

| 环节 | 设计（文档里怎么写） | 实跑（机器上是什么） | 差距 |
|---|---|---|---|
| 内容编译 | `topics/<slug>/` 一个目录编译出全部产物 | ✅ 真在跑：CI 绿、线上 200 | 无 |
| 站点部署 | push → GitHub Actions → Pages | ✅ content-engine 有 workflow；⚠️ **dlss5 和 RenVi 根本没有 `.github/`**，靠 Vercel 的 git 集成 | 三条互不相通的管道，没有统一入口 |
| 长文分发 | `content publish --devto <slug>` | ✅ 账号 `dlss` 上已有 **2 篇已发布**（`4714972`、`4714731`）；⚠️ 代码只 `POST`，**不能更新** | 改不了已发布内容；其中 `4714731` 正文还是中文 |
| 短帖分发 | `content publish --bluesky <slug>` | ✅ 真跑通，`wangsheng199.bsky.social`，13 帖 | 无 |
| 海外排程 | RenVi `ops/n8n-postiz`（n8n + Postiz，docker） | ⚠️ **compose 建好了，账号未连**，README 自述「账号未连」 | 基建在空转，占了 5678/4007 两个端口 |
| 运营看板 | （RenVi 事实标准）飞书 | ✅ RenVi 有 **15 个 `scripts/feishu-*.mjs`**，人工回填曝光/互动/注册/首图 | 只有 RenVi，且靠人工抄 |
| 反馈回收 | RenVi 要求每周复盘 | ✅ `scripts/bluesky-insights.mjs` **已经在拉** Bluesky 每帖赞/转/评 + **点赞者名单**，覆盖式写进飞书文档 | 只覆盖了 Bluesky 一家；Dev.to、自有站点、产品侧全空 |
| 归因 | 内容侧 CTA 自动带 `?ref=<slug>`（`src/util.mjs` 的 `withRef`）；RenVi 要求用 `utm_*` | ⚠️ content-engine 注入的是 `?ref=`，RenVi 体系用的是 `utm_*` —— **两套协议**；产品侧 `dlss5main/src/lib/acquisition.ts` **不存在** | 埋点断在最后一跳 |
| 北极星 | 每周由内容带来的「注册并完成首张出图」用户数 | ✅ dlss5 的 `image_operations/{id}` 集合**已经带 `uid` + `createdAt`**，首图事件天然存在，不需要新增埋点；RenVi 侧靠飞书人工 | 数据在库里，但没跟内容 join 起来 |
| 发布账本 | 无设计 | ❌ **完全没有** | `dist/manifest.json` 是构建清单、每次 build 重算、`dist/` 还被 gitignore —— 等于没有记忆 |
| 排期 | Bluesky 用 launchd/cron 每天一条 | ⚠️ 半自动，其他平台全靠人记 | 没有统一队列 |

**三条结论：**

1. **「从内容到产物」这一段已经很好，不用动。** `topics/` 那个单一事实来源是整个系统里最值钱的资产。
2. **「从产物到效果」整段是空的** —— 但比上一版以为的空得少：Bluesky 的反馈和飞书看板其实已经在跑，**缺的是把它们接成一条线，而不是从零造**。
3. **最大的隐性成本是「没有账本」。** 没有它，就会重复发、改不了已发的、反馈数据也没法 join 回内容。这是 P0 里的 P0。

### 既有文档里已经过时的两处

- `OPS_STACK.md` 的凭证矩阵写 `DEVTO_API_KEY` ❌ 缺 —— **已经具备**（vault，Dev.to 上两篇已发布就是证据），本次已顺手改正。
- `SOCIAL_STACK.md` §10 的「Dev.to 长文发布 = 只差 key」同样已过时，实现状态以上表为准。

`LANDSCAPE.md` 取代 `SOCIAL_STACK.md` 成为选型的最新结论；`SOCIAL_STACK.md` 里的**逐平台可发性实测**（§2、§3、§9）仍然是有效参考，不重做。

---

## 三、需求

### R1 · 发布账本（P0 —— 其他一切的前提）

每个 `(topic, channel)` 一条记录，至少：

- `status`：`planned` / `drafted` / `queued` / `published` / `failed` / `skipped`
- `external_id`：Dev.to 的 article id、Bluesky 的 at-uri、X 的 tweet id……
- `external_url`
- `published_at`、`last_checked_at`
- `content_sha256`：**发出去的**正文/文案的哈希 —— 用来判断「源内容改了，线上还是旧的」
- `channel_variant`：同一主题在不同渠道是不同文案

**为什么是 P0**：没有它 → ① 重复发；② 改不了已发布的内容；③ 反馈数据 join 不回内容，R6/R7 无从谈起。

### R2 · 渠道适配器（P0）

统一接口，每个渠道一个实现：

```
plan(topic, config)      -> 这个渠道该发什么
publish(payload)         -> { externalId, url }
update(externalId, ...)  -> 改已发布的内容
metrics(externalId)      -> { views, likes, replies, ... }
state(externalId)        -> 还在不在、被删没有
```

分两档，沿用现有 Tier 概念：

- **Tier A（机器全自动）**：GitHub Pages、Hugging Face、Dev.to、Bluesky
- **Tier B（人工确认后手动发，但系统要记账和提醒）**：X、Reddit、小红书、知乎

**Tier B 不是不做，是不能「假装做了」。** 系统对它的职责是：文案备好、提醒到位、发完人工回填「已发 + 链接」，从此它和 Tier A 在账本里一样可查。

> 现状提醒：`ops/n8n-postiz` 把 Tier B 里 X/IG/TikTok/YouTube/Pinterest 的**排程**已经框进去了，但它连不上账号，而且它管的平台和 Tier B 的「人工」平台是两批。两者不要混为一谈。

### R3 · 排期与队列（P1）

运营的日常是错峰（见 `OPERATIONS_SYSTEM_V2.md`：小红书 1/天、Bluesky 1/天、Reddit 2–3/周）。
需要：定时、延迟、每渠道独立时间、失败重试、失败 3 次熔断。

**放在哪跑**见 D3。

### R4 · 审批回路（P1）

Tier B 的草稿要有人点头，**必须能在手机上完成**，否则「记得去看」= 不会去看。

最低可行形态：一条飞书卡片带草稿全文 + 「发 / 改 / 弃」。**不要做一个需要登录的后台。**

> 已经见过一个反面样板：`ops/n8n-postiz` 就是一个部署完没人登录的后台。系统里每多一个需要主动访问的界面，就多一处会荒废的地方。

### R5 · 状态与告警（P1）

- 发布失败要立刻知道（现在失败只是终端里一行字，CI 里没人看）
- 更隐蔽的：**源内容改了但线上还是旧的**（`content_sha256` 干这个）
- 渠道侧异常：帖子被删、账号被限流

### R6 · 反馈回收（P1 —— 你说的「拿到反馈」）

调研（`LANDSCAPE.md` §3.2 与 `feedback-loop` 实测）已经把这件事查穿了，结论直接写死：

**能全自动拿到的（三选三，都免费或近免费）**

| 渠道 | 能拿到 | 靠什么 |
|---|---|---|
| **Dev.to** | 浏览量、平均阅读秒数、按日曲线、分类点赞、评论正文、**关注增长** | 官方 API，`api-key` 头。**唯一给浏览量的平台** |
| **Bluesky** | like / repost / reply / quote / bookmark、粉丝数、**具体是谁互动了** | AT Protocol 公开 AppView，**完全免认证** |
| **自有站点** | 页面浏览、路径、来源 | Cloudflare Web Analytics 账户级 GraphQL（免费，需先开） |

**只能人工的**：小红书、知乎（无 API，知乎 `robots.txt` 直接 `Disallow: /`）、Reddit（连不上 + 官方不给阅读量 + 需审批）。

**明确的边界**：Bluesky **没有**展示量字段（lexicon 里就不存在）；RSS 订阅数在 GitHub Pages 上**结构性拿不到**。这两件事不要设成目标，否则永远差一格。

产物要求：按 `(topic, channel)` 归档成 JSON，能 join 回 R1 的账本。

### R7 · 报表与决策（P2）

- 周报：这周发了什么、各渠道表现、哪类题目有效
- 落成文件（`docs/reports/`）**并**推到飞书
- 终局不是报表好看，是回答「下一篇写什么、往哪发」

### R8 · Agent 可驱动（P0，非功能但决定性）

**这一条是硬约束，不是加分项**，因为实际干活的是我。

- 每个动作都有 **CLI 或 HTTP API**，不能只有 UI
- 输出机器可读（`--json`），不能只打印给人看的中文
- 幂等：重跑不产生重复发布
- dry-run：任何对外发东西的动作都要能先看一遍

> 判断一个现成项目能不能用，只问一句：**「我能用 curl 走完从建草稿到发布到查数据吗？」**
> 不能，就在它旁边挂一层 API，或者换掉它。

### R9 · 凭证与幂等（P0）

- key 一律走 vault / 环境变量，不进 git，不进日志
- 发布动作必须幂等：靠 R1 的账本 + 内容哈希判断「这条发过没有」

### R10 · 多产品与统一归因（P2）

三个仓库 + 两个产品站 + 一个内容站，现在有**三套互不相通的归因写法**：

- content-engine：CTA 追加 `?ref=<slug>`（`withRef`，已自动注入到站点/博客/HF/每日重编译产物）
- RenVi：`OPERATIONS_SYSTEM_V2.md` 要求 `utm_source/medium/campaign/content`
- dlss5：`docs/ACQUISITION_ATTRIBUTION.md` 写明了接法，但 `src/lib/acquisition.ts` 还不存在

**先统一协议，再谈打通。** 建议：`utm_*` 是行业标准、能被 GA4 直接吃，`?ref=` 是自有约定、更好读。**推荐统一到 `utm_*`（并保留 `ref` 作为 `utm_content` 的值）**，然后：

1. 内容侧改一处（`src/util.mjs` 的 `withRef`）即可全量生效
2. 产品侧按 `dlss5main/docs/ACQUISITION_ATTRIBUTION.md` 落地——注意 `server/job-store.ts:32` 的 `bootstrap()` 是 `if (user.exists) return` 然后 `tx.create`，**天生只写一次**，不用额外去重
3. 报表用 `users.acquisition.utm_content` join `image_operations` 的 `min(createdAt)` = 首图

### R11 · 看板载体 = 飞书，不另造（P1）

RenVi 的 15 个 `feishu-*.mjs` 已经证明飞书能当运营看板：卡片、文档、覆盖式更新都跑通了。
**统一系统不引入第二个看板。** 新增的周报、审批卡片、人工回填表，全部进飞书。

---

## 四、明确不做的事（先划边界）

1. **不重做内容编译。** `topics/` → 产物这一段很好，新系统只消费 `dist/manifest.json`。
2. **不引入第二个排程器。** 已经选了 Postiz（`SOCIAL_STACK.md` §0），就不要再上 n8n / Activepieces / Windmill 当底座。
3. **不无审核地自动发高风险平台。** Reddit / 小红书 / 知乎有社区规则，自动化 outreach 会被封号。
4. **不做内容生成。** 那是 content-engine 的职责。
5. **不做社交 CRM / 客服收件箱。**
6. **不追功能齐全。** 宁可窄而可靠，不要宽而（像绝大多数自建 Postiz 那样）部署完就荒废。
7. **不为「看浏览量」自建分析。** PostHog 自建 16GB 内存起步，Plausible/OpenPanel 要 ClickHouse —— 两个小站不值。要自建只考虑 Umami，否则用免费的 Cloudflare Web Analytics。
8. **不把小红书/知乎接成爬虫。** robots 政策 + cookie 失效 + 403，维护成本不划算。

---

## 五、真正待拍板（D1–D6）

上一版列了 D1–D5，其中 **D5 其实已经被 `SOCIAL_STACK.md` 回答了一半**（引入 Postiz，但账本和适配器留在我们手里）。收窄后剩下这些：

### D1 · 仓库形态

- **A. 扩展 `content-engine`**：加 `ledger/` + `src/channels/`。不增加仓库、编译与发布同源；缺点是它从「内容引擎」变成「内容 + 运营」，而且它是 public 仓库。
- **B. 另起 `ops-hub`**：content-engine 保持纯编译，新仓库消费 manifest → 发布 → 收数据。职责清晰、可以私有；缺点是要定跨仓库接口。
- **C. 并进 RenVi 的 `ops/`**：那里已经有 `ops/n8n-postiz`。缺点是它天然只服务 RenVi，dlss5 和 content-engine 是外人。
- **倾向：B。** 理由是这条链迟早要服务三个仓库，而 content-engine 是「内容」仓库。
  **但**如果只想快速见效，A 更省事 —— 账本里没有密钥，公开也只是公开「我发了什么」，和现有公开文档一个性质。

### D2 · 账本存哪

- **A. git 里的 JSON**（每 topic 一个文件）：可 diff、可 review、可回滚。
- **B. SQLite**：可查询、可备份，单文件。
- **倾向：A 存发布意图与状态，B（或直接 JSON 归档）存反馈数字。** 发布动作是低频、需要人看的；反馈是高频、机器读的。两类数据混在一个存储里是麻烦的开始。

### D3 · 调度在哪跑

- **A. 本机 launchd**：免费可控，关机就不跑。RenVi 的 Bluesky 定时已经这么设计。
- **B. GitHub Actions `schedule`**：免费一直在，但最小 5 分钟、不能长跑、跑在别人机器上。
- **C. 常驻小服务 / Worker + Cron**：稳，但要运维。
- **倾向：A 起步**（这台机器本来就是所有运营动作的执行地，Playwright、docker、凭证都在这儿），需要「机器关机也要发」时再把那一小撮挪到 B。

### D4 · 站点反馈用什么

调研已给出答案，这里只剩一个动作要确认：**要不要给 `dlss5nvidia.com`、`houseplusplus.com`、内容站开 Cloudflare Web Analytics？**
免费、不限量、不用 cookie 横幅、数据能脚本查（账户级 GraphQL 已实测通）。**建议开**，这是本次性价比最高的一步。

### D5 · Postiz 什么时候起、起在哪

- RenVi 的 `ops/n8n-postiz` 已经把 compose 写好了（Postiz + n8n + Postgres + Redis + Temporal + ES），端口 5678/4007。
- **问题：这套基建是并进统一系统，还是先废掉？**
- **倾向：先不动它，等真的要用 X/IG/TikTok 时再起 Postiz（并且只起 Postiz，不起 n8n）**——n8n 只是当初的胶水，现在胶水应该是 content-engine 自己。

### D6 · 归因协议（R10 的前置）

`?ref=` 还是 `utm_*`？**倾向 `utm_*`**（GA4 直接支持）。定了之后内容侧改一处、产品侧按 `ACQUISITION_ATTRIBUTION.md` 实现。

---

## 六、下一步（分阶段，先做零成本的）

| 阶段 | 做什么 | 成本 | 依赖 |
|---|---|---|---|
| **0** | 开 Cloudflare Web Analytics（两个产品站 + 内容站） | 免费，1 小时 | 无 |
| **0** | 写 `feedback.mjs`：拉 Dev.to + Bluesky → 按 slug 归档 JSON | 半天，零凭证成本 | 无（RenVi 的 `bluesky-insights.mjs` 可直接借） |
| **1** | 账本 + 幂等 + Dev.to `update()`（顺手解掉线上那篇中文正文） | 1–2 天 | D1、D2 |
| **2** | 周报 → `docs/reports/` + 飞书 | 半天 | 阶段 1 |
| **3** | 起 Postiz、加 `--postiz` 适配器 | 1 天 | D5，以及真的需要 X/IG |
| **4** | 归因打通（dlss5 接收 ref/utm） | 产品侧改动 | D6 |

**阶段 0 现在就能做，不需要任何拍板。**
