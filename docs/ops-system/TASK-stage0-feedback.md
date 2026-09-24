# 阶段 0 工单：开站点统计 + 写反馈抓取脚本

日期：2026-09-23 ｜ 上游：`REQUIREMENTS.md` §六 阶段 0、`LANDSCAPE.md` §3.2

> **执行结果（2026-09-24）**
>
> - **任务 B（反馈脚本）✅ 完成**：`src/feedback.mjs` + `content feedback`，一个 `(topic, channel)` 一个文件，落在被忽略的 `data/feedback/`。测试 103 项全过。
> - **任务 A（Cloudflare 统计）✅ 三个站点已建**：
>   - `dlss5nvidia.com`（橙云）—— 站点 `227cfc84…`，`auto_install` 已启用，**线上已确认注入**，无需改任何代码。
>   - `houseplusplus.com`（灰云）—— 站点 `71a2397a…`，**必须把 beacon 贴进产品源码**，待定。
>   - 内容站 `wangsheng1991.github.io` —— 站点 `38a1a7a4…`，beacon 已进 `templates/website/_head.html`。
> - **踩到的两个坑**（下次直接用）：① 创建站点时，橙云要传 `zone_tag`，灰云要传 `host` —— 只传 `host` + `auto_install` 会报 `10022 autoInstallInvalid`，而不是权限错；② 验证注入时 curl 必须带浏览器式的 `Accept: text/html` 和 `Sec-Fetch-Mode: navigate`，否则 Cloudflare 不注入，会误判成「没生效」。

**这份是交给执行者（人或 AI）干活的说明书。** 两件事，都不涉及任何发布动作、不改产品代码、不花钱。
做完之后，系统第一次能回答「发出去的东西有没有人看」。

---

## 前置条件

- **工作目录**：`~/code/content-engine`（public 仓库，**任何情况下不许把密钥写进去**）
- **代理必须设好**，否则所有网络请求都会失败：
  ```bash
  export https_proxy=http://127.0.0.1:1082 http_proxy=http://127.0.0.1:1082
  ```
- **仓库约定**（必须遵守）：
  - **零 npm 依赖**。不许 `npm install` 任何东西，只用 Node 24 标准库。
  - 模块放 `src/`，CLI 子命令加在 `bin/content.mjs`（参照已有的 `case 'publish'`）。
  - 测试放 `tests/`，跑 `npm test`（= `node tests/run.mjs`）必须全绿。
- **绝对禁止**：打印密钥值、把密钥写进文件、把密钥提交进 git、`rm -rf`。

### 凭证（名字如下，值不要看、不要打印）

| 用途 | 环境变量 | 从哪来 |
|---|---|---|
| Cloudflare API | `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` | agent vault，执行时自动注入 |
| Dev.to | `DEVTO_API_KEY` | agent vault；备份在 `~/Desktop/project/key/paypay/env.txt` **第 48 行** |
| Bluesky | 不需要 | 公开接口 |

如果环境变量没注入，**停下来报告**，不要去找别的地方翻密钥。

---

## 任务 A：给三个站点开 Cloudflare Web Analytics

**为什么**：站点浏览量是「有人真的点进来了」最直接的证据，免费，而且数据能用脚本查（账户级 GraphQL 已实测通）。

**现状（已验证，别重复调查）**：

- 账户里有 13 个 active zone，全是 Free 计划。
- **只有两个站点开着 CWA**：`moneybackmyhome.ccwu.cc`、`token2any.com`。
- 要开的三个：
  - `dlss5nvidia.com` — zone id `0f87034be3b98309223c3efc87dd12fd`
  - `houseplusplus.com` — zone id `7259054e17055bb624b12b27e2790e8e`
  - `wangsheng1991.github.io/content-engine`（GitHub Pages，**不在 Cloudflare 账户里**，只能手动贴代码）

**怎么做**：

1. **两个产品站**（走 Cloudflare 代理的 zone）：后台 **Web Analytics → 添加站点 → 选自己的域名**，打开自动注入，**产品代码一行都不用改**。
   - 想用 API：`GET /client/v4/accounts/{account_id}/rum/site_info/list` 是已验证可用的；**创建站点的端点在官方文档里查过再调，不要凭印象猜路径**。
2. **内容站**（GitHub Pages，没走 Cloudflare 代理）：CWA 支持非代理站点，但要手动贴 beacon。
   - 拿到该站点的 `site_token` 后，把下面这段插进 `templates/website/_head.html` 的 `</head>` 前面（约第 145 行）：
     ```html
     <script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "粘这里"}'></script>
     ```
   - 插完跑 `npm test`，再 `node bin/content.mjs build --all` 确认页面正常。
   - **说明**：这个 token 会出现在公开 HTML 里，**它本来就是公开的**，不是密钥——不要为它搞什么加密。

**验收**：
- `GET /client/v4/accounts/{account_id}/rum/site_info/list` 里能看到三个站点。
- 用 GraphQL 查 `rumPageloadEventsAdaptiveGroups`，能返回 `dlss5nvidia.com` / `houseplusplus.com` 的真实数字。
  ```bash
  POST https://api.cloudflare.com/client/v4/graphql
  # query: { viewer { accounts(filter:{accountTag:"$ACCOUNT"}) {
  #   rumPageloadEventsAdaptiveGroups(limit:20, filter:{date_geq:"2026-09-01"}) {
  #     count dimensions { requestPath } } } } }
  ```
- **已知坑**：查 zone 级 HTTP 分析（`httpRequestsAdaptiveGroups`）会 403，缺 `Zone → Analytics → Read` 权限。**这次不需要它**，不要为此去改 token 权限。

---

## 任务 B：写反馈抓取脚本

**目标**：每天跑一次，把 Dev.to 和 Bluesky 的反馈数字抓回来，按内容单元存成文件。

**新增**：`src/feedback.mjs` + CLI 子命令 `content feedback`（照 `bin/content.mjs` 里 `case 'publish'` 的写法接进去）。

### B1 · Dev.to —— 唯一给浏览量的平台

请求头：`api-key: $DEVTO_API_KEY` + `Accept: application/vnd.forem.api-v1+json`

| 端点 | 返回什么 |
|---|---|
| `GET /api/articles/me/published` | 每篇：`id`、`page_views_count`、`public_reactions_count`、`comments_count`、`canonical_url`、`published_timestamp` |
| `GET /api/analytics/totals` | `page_views.total`、`average_read_time_in_seconds`、`reactions`（分类）、`comments.total`、`follows.total` |
| `GET /api/analytics/historical?start=YYYY-MM-DD&end=YYYY-MM-DD` | 按天的同一结构 |

- 已知：账号 `dlss`，`user_id` 4137297，已有两篇已发布文章 `4714972`、`4714731`。
- **坑**：`page_views_count` **只在带 `api-key` 的 `/api/articles/me*` 里给值**，公开接口里是 `null`。
- **注意**：现在两篇的数字**全是 0**（新账号、中文内容、没外链）。这是真实观测值，不是 bug，不要为此改代码。

### B2 · Bluesky —— 完全免认证，但没有展示量

Base：`https://public.api.bsky.app/xrpc/`
Handle：**`wangsheng199.bsky.social`**（注意**不是** `wangsheng1991`）

| 端点 | 返回什么 |
|---|---|
| `app.bsky.actor.getProfile?actor=<handle>` | `followersCount`、`followsCount`、`postsCount` |
| `app.bsky.feed.getAuthorFeed?actor=<handle>&limit=50` | 每帖：`uri`、`likeCount`、`repostCount`、`replyCount`、`quoteCount`、`bookmarkCount`、`indexedAt` |
| `app.bsky.feed.getLikes?uri=<at-uri>` | **谁点的赞**（最有价值的线索，值得抓） |

- **明确没有展示量**——公开 API 里根本不存在这个字段。**不要去找**，找不到是对的。
- `searchPosts` 匿名会 403，别用。
- **已经有现成实现可以抄**：`~/code/ark/roomredeginv2/scripts/bluesky-insights.mjs`（已经在跑，拉每帖赞/转/评 + 点赞者）。**只读参考，不要改那个仓库。**

### B3 · 输出格式

- 一个内容单元一条记录，键是 `(topic, channel)`。
- 路径：`data/feedback/<slug>.json`，并把 `data/feedback/` 加进 `.gitignore`（**高频数字不进 git**，只有发布状态该进 git）。
- 结构：
  ```json
  {
    "topic": "ml-sharp",
    "channel": "bluesky",
    "external_id": "at://did:plc:.../app.bsky.feed.post/3mw3ybt3v6o2l",
    "external_url": "https://bsky.app/profile/wangsheng199.bsky.social/post/3mw3ybt3v6o2l",
    "fetched_at": "2026-09-24T09:00:00Z",
    "metrics": { "likeCount": 0, "repostCount": 0, "replyCount": 0, "quoteCount": 0, "bookmarkCount": 0 }
  }
  ```
- 必须有 `--dry-run`（只打印会请求什么，不发请求）和 `--json`（机器可读输出到 stdout）。
- **幂等**：同一天重复跑覆盖同一条，不追加重复记录。

### B4 · 定时

用 `penguin schedule` 或本机 `launchd` 每天一次。**这一步只写进文档，不要现在装**——等脚本跑通、验收过了再说。

---

## 边界：不要做的事

1. **不发任何内容。全部都是只读请求。**
2. 不碰小红书、知乎、Reddit（都没有可用接口，见 `LANDSCAPE.md` §3.2）。
3. 不引入任何 npm 依赖。
4. 不改 `dlss5main` / `roomredeginv2` 的代码（只能读）。
5. 不装 Postiz、不装任何 docker。
6. 不用 `rm -rf`（需要临时目录用 `mktemp -d`）。
7. 不动归因那件事（`?ref=` vs `utm_*`，还没定）。

---

## 验收标准

- [ ] `npm test` 全绿，且新模块有测试覆盖（离线测试，不打真实网络）
- [ ] `node bin/content.mjs feedback --dry-run` 打印出它将请求哪些端点
- [ ] 真跑一次，产出的文件里 **Dev.to 有非空数字**、**Bluesky 有非空数字**（Bluesky 的 followers 当前是 12，可用来对照）
- [ ] 三个站点的 Cloudflare Web Analytics 可查（`rum/site_info/list` 里有，GraphQL 能返回数字）
- [ ] `git status` 里**没有任何密钥**；`data/feedback/` 已被忽略
- [ ] 改动提交成一个 commit，**先不推送**（content-engine 是 public 仓库，推送等确认）

---

## 做完之后，系统多了什么

第一次能回答：「**这篇内容发出去之后，到底有人看吗？**」

之后阶段 1（给 content-engine 加发布账本）就能把这份反馈和「发了什么」join 起来——那才是「哪类题目有效」这个问题的答案。
