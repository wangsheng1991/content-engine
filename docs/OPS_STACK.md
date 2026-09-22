# 运营工具与 Skill 选型 v1 —— 一句话 → 高质量内容 → 发出去

日期：2026-09-21
目标接口：**一句话进，内容出，而且发出去。**
配套：`docs/GROWTH_PLAN.md`（做什么）、`docs/TOOL_RADAR.md`（做哪个词）、本文件（用什么做）
执行手册：agent skill `content-ops`

---

## 0. 判定标准（为什么这么选）

不是"哪个工具好"，而是三条硬标准：

1. **在这台机器上真的能跑。**`npm registry` 是坏的（`ERR_SSL_CIPHER_OPERATION_FAILED`，装不了包），所以一律选**零安装依赖**的方案；能用的东西只有：node 24、pandoc、ffmpeg、docker/docker-compose、git/gh、Playwright（在 `shared_env/playwright`，chromium-1161）、python3（无第三方包）。
2. **质量能由机器判定，而不是靠人重读。**一句话出稿意味着没人会再核一遍来源。所以必须有闸门：`content verify` —— 每条 claim 必须带一段**能在它自己的 source 里逐字找到**的 `quote`。
3. **发布路径今天就是通的。**Tier A 全自动，Tier B 停在草稿；需要凭证的地方明写成凭证，而不是"以后再接"。

---

## 1. 一句话在这里变成什么

```
一句话（"写一篇 <主题>"）
  │
  ├─① 取证      真实长尾/前排证据 → evidence.json（每条 claim 一个 source + 一段 quote）
  ├─② 成稿      topics/<slug>/：source.yaml · article.md · README.md · slides.md · cta.yaml · video.yaml
  ├─③ 闸门      content verify        ← 不通过就不许往下走
  ├─④ 编译      content build         ← Tier A（可自动发布）/ Tier B（草稿）
  ├─⑤ 发布      Tier A → git push → GitHub Pages ；content publish --hf → Hugging Face
  │              Tier B → 草稿（平台按凭证决定自动或人工）
  └─⑥ 自检      浏览器核对线上页面（零 console/网络错误、深色、窄屏）
```

最终产物是 `<slug>` 一个目录，**它就是"内容"本身**：网站页、博客、RSS、GitHub README、HF 卡片、PPT、视频脚本、四个平台草稿全部由它编译出来。改内容 = 改这个目录，重新 build。

---

## 2. 工具选型

| 环节 | 选定 | 为什么是它（不是别的） | 状态 |
|---|---|---|---|
| 需求取证 | `research/tool-radar/radar.py`（Google 补全） | 唯一能在这里直接拿到的、证明"需求真的存在"的第一方证据；无需 key | ✅ 已验证 |
| 竞争取证 | `research/tool-radar/serp-brave.mjs`（真 Chrome 走 Brave） | Google 对本机出口 IP 返回 `google.com/sorry`；Bing 非英文结果按首字符解析，不可用 | ✅ 已验证 |
| 页面抓取 | `firecrawl` skill（curl） | 有 key 后最省事；**当前缺 key**，暂用 curl + Python 顶替 | ⚠️ 缺 key |
| 成稿/编译 | `content-engine`（本仓库） | 零依赖、契约固定、Tier A/B 边界已经写进代码 | ✅ 已验证 |
| **质量闸门** | **`content verify`（本仓库，本次新增）** | 把"高质量"从口号变成能被 CI 拦下来的检查 | ✅ 12 项测试全过 |
| 站点/博客/RSS | `content build` → GitHub Pages | 推 main 即上线，已实测 | ✅ 线上 200 |
| 技术资产 | GitHub 仓库（自动）；Hugging Face（`content publish --hf`） | 飞轮的锚点，downloads/likes 是可验证指标 | ✅ 已验证 |
| PPT | pandoc → `deck.pptx` | 本机有 pandoc；输出过 `unzip -t` 校验 | ✅ 已验证 |
| 视频 | `video.yaml` → storyboard.json + ffmpeg | 先只到脚本与分镜，别假装能一键出片 | ✅ 到脚本 |
| 海外社媒排程 | RenVi：`ops/n8n-postiz`（n8n + Postiz，docker） | 走官方 API 排程 Pinterest/IG/TikTok/X/YouTube；已建好 | ⚠️ 待连账号（选型实测见 `docs/SOCIAL_STACK.md`） |
| 定时/触发 | `penguin schedule` | 本机 CLI 直接可加定时任务 | ✅ 可用 |
| 发布后自检 | `shared_env/playwright/*` | 真浏览器核对，避免"推上去了但页面是坏的" | ✅ 已验证 |

**一句结论**：除了 Hugging Face 上传和平台排程，**整条链今天就能跑通**，且不需要装任何新依赖。

---

## 3. Skill 选型

| 环节 | skill | 为什么是它 |
|---|---|---|
| **本流水线本身** | **`content-ops`（本次新增）** | 把"一句话→发布"固定成任何会话都能照做的步骤，不用每次重新推导 |
| 改代码/排查 | `software-engineering` | content-engine 的改动要走它自己的测试 |
| 页面视觉 | `web-design` | 模板已遵循该规范；新增工具页必须继续遵循 |
| 取证补充 | `firecrawl` | 有 key 后替代手写抓取 |
| 演示稿 | `bento-slides` | 需要 HTML 演示稿时用；pptx 仍归 pandoc |
| 复盘数据 | `data-analysis` | 每周按 `content_id` 算转化 |
| 定时与多任务 | `penguin-orchestration` | 批量跑主题、定时触发、跨会话编排 |
| 图像/语音生成 | `unified-llm-api` | 依赖 `@prismshadow/agenthub`，**需先确认能装**（npm 目前坏） |
| 训练与部署 | `llamafactory` / `vllm` / `ollama` | 阶段 2 的场景 LoRA、自有模型serving，现在不动 |

未选：`agent-evaluation` / `benchmark-design` / `agent-optimization` —— 那是"公开失败案例数据集"阶段的事，不是现在。放在合适的时候再选，比现在装一堆不用强。

---

## 4. 一句话接口

| 你说 | 我做什么 |
|---|---|
| `出稿 <一句话主题>` | ①–⑥ 全跑，Tier A 推上线，Tier B 草稿就位 |
| `全渠道 <一句话主题>` | 出稿 + 各平台草稿与排程（RenVi 走 Postiz；dlss5 待接入） |
| `复盘 <周次>` | 按 `content_id` 出转化表 + 继续/停产决策 |
| `查缺 <主题>` | 只跑取证与闸门，先看这个词值不值得做 |

---

## 5. 凭证矩阵（缺什么、缺了会怎样）

| 要解锁的能力 | 需要的凭证 | 现状 | 补上之后 |
|---|---|---|---|
| 站点自动部署 | gh token（含 `workflow` scope） | ✅ 已具备 | 已解锁，推 main 即上线 |
| HF 模型/数据集卡发布 | `HF_TOKEN` | ✅ **已具备**（2026-09-21，账号 `shi9214`） | 已解锁：`content publish --hf` 已验证可用 |
| 外部页面稳定抓取 | `FIRECRAWL_API_KEY` | ❌ **缺** | 取证更快更稳（现在是 curl 顶替） |
| 海外社媒排程 | Postiz API key + 各平台 OAuth | ⚠️ 基建已建，账号未连 | Pinterest/IG/TikTok/X/YouTube 自动排程 |
| 小红书 | 浏览器登录态 | ❌ 本机 Chrome 未登录 | 生成与同步自动，**发布仍人工** |
| Reddit | —（按规则不自动化） | 人工 | 只自动发现机会 |

**注意一个身份不一致**：GitHub 是 `wangsheng1991`，HF 是 `shi9214`。飞轮的两个锚点挂着两个不同名字，技术人群会把它当成两个人。要么统一，要么建一个 HF 组织当品牌锚点的家（`content.config.json` 的 `huggingface.owner` 一改就切换，`source.yaml` 里也可以逐主题写 `hf_repo` 覆盖）。

补的顺序：**`FIRECRAWL_API_KEY` 一步**，然后定 HF 用哪个身份。

### HF 发布怎么用

```bash
content publish --hf                      # 按 content.config.json 的 owner + 主题 slug 建仓并上传
content publish --hf --dry-run            # 只看会做什么
content publish --hf --repo <owner/name>  # 指定仓库
content publish --hf --public             # 公开（默认私有，避免未经审阅就发出去）
```

默认行为：仓库不存在就建（私有）、上传卡片、**回读比对 sha256**，回读不一致就报失败——"上传成功"不算成功。token 只从环境变量读，从不打印。

---

## 6. 边界（写死，免得反复讨论）

- **Tier B 永不进 `dist/site`**；平台草稿必须人工确认后才离开草稿区。
- **不带 quote 的 claim 不许发布**；`content verify` 在 CI 里是硬闸门。
- **Reddit / 小红书只做生成与同步，发布人工**（平台的自动化条款 + 封号风险）。
- **不做未经请求的 outreach**，不自动建号，不伪装真人。
- **能力没补齐之前不用 1536px 的引擎承诺 4K**。
- **路由层对技术人群必须说"编排多个开源模型的路由层"**，不说"我们自己的模型"。

---

## 7. 已验证 / 未验证

**已验证（实测）**
- `content build` 编译全部主题；`deck.pptx` 由 pandoc 生成。
- `content verify` 通过 12 项测试（含"引文对不上源"、"源取不到不算通过"、"缺 cta 拦下"）；全套测试 **21 项全过**。
- `content verify --online` 对 ml-sharp **10/10 条 claim 回源逐字命中**。
- `git push` → GitHub Actions → GitHub Pages，线上 `HTTP 200`。
- **HF 发布全链路**：建仓 → 上传 → 回读 sha256 一致（4264B）→ 匿名访问 401（确认还是私有）。仓库：`shi9214/ml-sharp`。
- Google 补全取证、Brave SERP 取证在真浏览器里跑通。

**未验证（缺凭证或未接）**
- Postiz 排程实际发出（账号未连）。
- 视频只到脚本层，没有成品视频。
- `unified-llm-api` 的图像生成（`agenthub` 未确认可装）。

**一个必须点明的事实**：`shi9214/ml-sharp` 发布后 downloads 是 **0**。卡片本身不是资产——飞轮要用 downloads 当传播指标，HF 上放的必须是**权重或数据集**（评测集、失败案例集、LoRA），而不是"读书笔记"。`content publish --hf` 打通的是**通道**；下一件事是让通道里有值得下的东西。这一点和 `TOOL_RADAR.md` §12 的能力采购清单是同一件事的两面。
