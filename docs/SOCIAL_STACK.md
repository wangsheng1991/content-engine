# 社媒发布链路 —— 选型与实测 v1

日期：2026-09-22
配套：`docs/OPS_STACK.md`（整条流水线的工具选型）、`docs/TOOL_RADAR.md`（做什么内容）

**为什么有这份文件**：整条链路「一句话 → 内容上线」已经通了，但 Tier B（社媒）是断的 ——
草稿生成完了，一份也发不出去。这份文件回答一个问题：**用哪个开源项目把这段接上。**

---

## 0. 结论先行

1. **装什么：`Postiz`（`gitroomhq/postiz-app`）。** 不是新发现 —— RenVi 里 `ops/n8n-postiz/` 早就选了它。实测数据支持这个选择，见 §2。
2. **不要新装 n8n。** 桥接应该在 `content-engine` 里加一条 `content publish --postiz`，用 Postiz 的 Public API，形状和已经验证过的 `--hf` 完全一样（curl 传输 + 回读校验）。多一个容器就多一个会挂的东西。
3. **你需要的 8 个平台里，6 个一步就能通，2 个在任何开源项目里都通不了** —— 见 §3。通不了的那两个是小红书和知乎。

---

## 1. 你实际需要的平台

从两个产品的现状取并集：

| 来源 | 平台 |
|---|---|
| `content-engine` 已生成的草稿 | 小红书、Reddit、X、知乎 |
| RenVi `ops/n8n-postiz` 的目标 | Pinterest、Instagram、TikTok、X、YouTube |

去重后 **8 个**：小红书、Reddit、X、知乎、Pinterest、Instagram、TikTok、YouTube。

---

## 2. 候选清单（实测，2026-09-22）

数据来自 GitHub API，不是二手转述。

| 项目 | ★ | 贡献者 | 提交 | 协议 | 最后推送 | 判定 |
|---|---:|---:|---:|---|---|---|
| **gitroomhq/postiz-app** | 36173 | 75 | 3008 | AGPL-3.0 | 2026-09-22 | ✅ **选它**。唯一一个「人多、推得勤、平台全」三项都过的 |
| getopenpost/openpost | 597 | 12 | 3579 | AGPL-3.0 | 2026-09-22 | ⚠️ 备用。贡献者少但提交极密（100 次提交压在 2 天内），活跃度存疑 |
| trypostit/trypost | 635 | 17 | — | AGPL-3.0 | 2026-09-21 | ⚠️ 备用。11 个 release，节奏正常 |
| brightbeanxyz/brightbean-studio | 2355 | 8 | 592 | AGPL-3.0 | 2026-09-20 | ⚠️ 星多但人少（8 人 592 次提交），2026-03 才建。星数可能是营销来的 |
| inovector/mixpost | 3733 | — | — | MIT | **2026-03-16** | ❌ **已落后半年**，且平台覆盖窄。MIT 是它唯一的优点 |
| gitroomhq/postiz-agent | 488 | — | — | NOASSERTION | 2026-09-21 | 官方 agent CLI，给 Claude/OpenClaw 用 —— 我们用不上 |
| gitroomhq/postiz-n8n | 67 | — | — | MIT | 2025-10-07 | 官方 n8n 节点，但一年没动 |

**协议的实话**：Postiz 是 AGPL-3.0。自用、自托管完全没问题；AGPL 只在**你把它当服务转卖给第三方**时才咬人。你不是要卖排程服务，所以不影响。

---

## 3. 逐平台：到底能不能用官方 API 发

Postiz 的平台清单是从它源码目录 `libraries/nestjs-libraries/src/integrations/social/` 实际读出来的，
不是抄 README 的：

```
bluesky  dev.to  discord  dribbble  facebook  farcaster  gmb(Google商家)  hashnode
instagram(+standalone)  kick  lemmy  linkedin(+page)  mastodon(+custom)  medium
mewe  moltbook  nostr  pinterest  reddit  skool  slack  telegram  threads
tiktok(+business)  tumblr  twitch  vk  whop  wordpress  x  youtube
```

对照你的 8 个平台：

| 平台 | 能不能自动发 | 靠什么 |
|---|---|---|
| **X** | ✅ | Postiz `x.provider.ts`，官方 API |
| **Reddit** | ✅ | Postiz `reddit.provider.ts`，官方 API（**但你之前定的是人工** —— 见 §5） |
| **Pinterest** | ✅ | Postiz `pinterest.provider.ts` |
| **Instagram** | ✅ | Postiz `instagram.provider.ts`（需商业号 + 绑 FB 主页） |
| **TikTok** | ✅ | Postiz `tiktok.provider.ts` + `tiktok.business.provider.ts` |
| **YouTube** | ✅ | Postiz `youtube.provider.ts` |
| **小红书** | ❌ | **没有任何一个项目走官方 API** |
| **知乎** | ❌ | **同上** |

### 小红书那一条，说清楚

我在 GitHub 上把发布类项目搜了一遍，规模大的几个是：

- `BetaStreetOmnis/xhs_ai_publisher` 2082★ Apache-2.0 —— PyQt 桌面端 + FastAPI，**复用登录态**
- `ZJU-REAL/Easel` 1293★ —— AI agent，跨平台发布
- `DeliciousBuding/xiaohongshu-skill` 43★ —— **Playwright 自动化，带人工确认闸门**
- `2975647277/xiaohongshu-mcp` —— MCP server，一键发布 + 定时

**全部是浏览器自动化（Playwright / CDP / 复用 Cookie 登录态），一个走官方 API 的都没有。**
这跟你自己早先定的规矩一致：**小红书 = 生成与同步自动，发布人工**。这不是技术偷懒，是封号风险。

知乎同理 —— 我没有搜到任何走官方接口的发布方案。

> 我没有查到可核实的公开说明来断言「小红书开放平台不开放个人笔记发布」这件事本身。
> 从工程上看结论一样：**开源生态里没有这条路，有也只能你自己去开放平台申请。**

---

## 4. 推荐怎么接

**不新建容器，不加 n8n，在 `content-engine` 里加一条命令。**

Postiz 有一套完整的 Public API（`docs.postiz.com/public-api`，实测可访问），端点里有：

```
GET  List Integrations          —— 列出已连的账号
GET  Connect Channel (OAuth)    —— 连账号
GET  Find Available Slot        —— 找下一个排期空位
POST Create Post                —— 发/排一条
PUT  Change Post Status
POST Upload File                —— 传图
GET  Post Analytics / Platform Analytics
```

所以接线形状和已经跑通的 `content publish --hf` 一模一样：

```
dist/drafts/<slug>/<platform>/post.md
        │
        └─ content publish --postiz   →  Postiz Public API  →  平台官方 API
                 （curl 传输 · token 只从环境变量读 · 从不打印 · 回读校验）
```

**为什么是这个形状而不是 n8n**：`--hf` 那条路已经用测试证明过一遍（建仓 → 上传 → 回读 sha256 比对）。
同样的代码形状复制到 Postiz，风险是已知的。n8n 是另一个运行时、另一套凭证、另一处会静默失败的地方。

顺带：Postiz 有 **Post Analytics** 端点。接上之后，「发了多少、被看了多少」这一半就自动有了
（但**「带来多少注册、多少首图」仍然要 dlss5 那边记 `ref`** —— 见下面的坑 3）。

---

## 5. 三个必须提前知道的坑

**① 自托管 Postiz 需要公网回调地址。**
Instagram / TikTok / YouTube / Pinterest 的 OAuth 都要一个平台能访问到的回调 URL。跑在
`localhost:4007` 上，OAuth 会连不上。所以要么：
- 用 **Cloudflare Tunnel** 把本地 Postiz 暴露到一个域名（你有 Cloudflare 账号和 token），或
- 直接用 Postiz Cloud（省事，但要付费、数据在人家那）

**② Reddit 是「能自动」但「不该自动」。**
Postiz 支持 Reddit 官方 API，技术上一步就通。但你早先定的规矩是 Reddit 全程人工 ——
理由不是技术，是 subreddit 版规与封号。这条我不改，只是提醒：**别因为看到它支持就顺手打开。**

**③ 社媒接上了，北星指标还是测不到。**
Postiz 的 analytics 只到「平台侧曝光/互动」。你的北星是**注册并完成首张出图**，
那要把内容的 `ref` 一路带到 dlss5 的注册与首图。所以顺序上：
**社媒解决的是分发量，埋点解决的是「有没有用」。两个都做才有飞轮，只做一个还是传送带。**

---

## 6. 排除

- **不做未授权爬虫/养号类工具**（`MediaCrawler`、各种「养号」「矩阵」项目）—— 与既有规矩冲突，且风险落在账号上。
- **不用二手 SaaS 聚合 API**（一次 key 打多个平台那种）—— 多一层中间商、多一处凭证托管，且它们对小红书的支持同样是灰色。
- **不引入第二个排程器**。Postiz 已经选了，换一个的收益是零。

---

## 7. 复现方式

```bash
# 元数据与平台清单都是这样查出来的（gh 已登录，不用代理）
gh api repos/gitroomhq/postiz-app --jq '.stargazers_count,.license.spdx_id,.pushed_at'
gh api repos/gitroomhq/postiz-app/contents/libraries/nestjs-libraries/src/integrations/social --jq '.[].name'

# 候选对比
gh api -X GET search/repositories -f q='topic:social-media-scheduler' -f sort=stars -f per_page=15 \
  --jq '.items[] | "\(.stargazers_count)\t\(.pushed_at[0:10])\t\(.full_name)"'

# 真实活跃度（星数可以刷，贡献者和提交时间不容易）
gh api "repos/<owner>/<name>/contributors?per_page=1&anon=1" -i | grep -i '^link:'
gh api "repos/<owner>/<name>/commits?per_page=100" --jq '[.[].commit.author.date] | {newest: .[0], oldest: .[-1]}'

# Postiz Public API 文档
curl -sSL https://docs.postiz.com/public-api
```
