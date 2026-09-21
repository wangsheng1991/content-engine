# 免费工具雷达 v1 —— 「AI 图像领域的 TikTok Downloader」候选清单

日期：2026-09-21
证据：`research/tool-radar/autocomplete-2026-09-21.json`（脚本 `research/tool-radar/radar.py`，可重跑）
配套：`docs/GROWTH_PLAN.md` §5 阶段 1B（引擎 B）
适用：`dlss5nvidia.com`（主）、`houseplusplus.com` 渲见 RenVi（第 7 节）

---

## 0. 结论先行

1. **名单有，但只有 3 个族是真正的"TikTok Downloader 级"普适需求**：`restore-old-photo`、`remove-background`、`passport-photo` —— 它们在全部 9 种语言的补全里都有 ≥5 条真实长尾。其余 9 个族只在部分语言成立（矩阵见 §2）。

2. **普适 ≠ 能赚钱，也 ≠ 能拿到结果。**下载器类品类最容易漏掉的是第四条：「用户手上的东西离钱只有一步」——下载器用户要的是白拿别人的副本，流量再大也换不成付费。AI 图像里符合这一条的是最不"性感"的品类：**证件照/护照照**。用户今天就在照相馆花钱拍、有截止日期、有硬性规格。
   而且这个判断不止来自需求侧：**§11 的前排实测显示 `passport photo online` 的前十全是单一用途小站、没有 Canva/Adobe/Google，俄语 "3 на 4" 的规格位上几乎全是小玩家，甚至有一家线下照相馆在同一页抢位置。**需求、竞争、付费意愿三条独立证据在证件照上收敛——**这是全名单里"拿到结果"概率最高的一个。**

3. **一个必须马上接受的坏消息：这一整层需求正在被 Canva、Photoshop 和 Gemini 收编。**108 个（族 × 语言）组合里有 **40 个**的补全中直接点名了一个现有工具 —— `canva` 出现在 17 个（en/es/pt/id/vi/ja）、`photoshop` 16 个（en/es/pt/id/vi/zh）、`gemini` 12 个（es/pt/id/vi/ja/en）、`chatgpt` 7 个、`iphone` 9 个，另有 `word`/`パワポ`/`ペイント`/`小画家`/`ppt`（原文见 §5）。也就是说：**"免费改图"这个卖点正在被 Google 和 Canva 免费送掉**，照抄 Navos 的"免费工具 × 多语言 × 程序化变体"公式，在今天会遇到一个 2023 年不存在的对手。工具层不能赢在"免费"，只能赢在"**交付物**"—— 一个可以直接拿去用、能过审、能打印、能上传到平台的成品文件。Google 不会做"智利 RUT 规格的证件照"。

4. **dlss5 今天就能服务的族**：增强/放大、去模糊、老照片修复、上色、证件照、职业照、海报、头像（`mode: 'edit'` 的 prompt 驱动编辑）。
   今天的两个硬边界：无 alpha 通道（出不了透明 PNG）、`ENHANCE_MAX_EDGE = 1536`（出不了真 4K，且 `flux-klein` 是**重绘型**编辑模型，不是真正的逐像素超分——`src/config/enhance.ts` 的注释和 `docs/alphanet-superres-endpoint.md` 都写明了）。
   **但这两个边界是采购问题，不是路线问题**：要买什么、按什么顺序买，见 §12。唯一不能妥协的是口径——在能力补齐之前，不要用 1536px 的引擎去承诺 4K。

5. **`product-photo` 是文章不是工具。**它只有 4/9 语言有补全，而且长尾全是"**怎么拍**"（`como tirar foto de produto com fundo branco`、`cara foto produk background putih`、`cách chụp ảnh sản phẩm nền trắng`）—— 搜索者是摄影师/卖家本人，不是找编辑工具的人。这类词的价值是给工具页喂内链，不是做工具。

6. **RenVi 是另一套独立的族**：`interior-design`（7/9）。它的长尾按**房间类型**（卧室/浴室/3x3 米房）和**输入方式**（按照片/按户型图/按平面图）切分，这正好就是它的程序化矩阵。

---

## 1. 方法：这份名单的证据是什么，不是什么

**是什么**
- 来源：Google 自动补全（`suggestqueries.google.com/complete/search`，`client=firefox`），2026-09-21 采集。
- 规模：12 个工具族 × 9 种语言（`en es pt id vi ru ja ko zh`）= 108 个 head term，共 **899 条真实补全**。
- 每个语言用**该语言的母语 head term**，而不是英文直译（例如 `увеличить разрешение фото`、`nâng cấp ảnh`、`图片放大`）——直译会采到不存在的需求。
- 补全存在 = 这个说法被反复输入。这足以证明"**需求存在**"，并且直接给出了**真实长尾**（长尾才是要变成页面的东西）。

**不是什么（必须记住）**
- **不是搜索量。**没有搜索量、没有竞争度、没有 CPC。本机没有任何关键词工具，`npm` 装不了包（registry 报 `ERR_SSL_CIPHER_OPERATION_FAILED`）。
- 因此下面的梯队按 **证据广度 × 商业意图 × 我们的能力** 排序 —— **不是按流量排序**。谁要是把 §2 的计数当流量读，就会排错先做什么。
- **补数据的两条路**（都不需要新工具）：
  1. dlss5 的 GSC 已有 3 个月真实查询（`docs/SEARCH_CONSOLE_AUDIT_2026-09-20.md`），可以直接给出"哪个国家、哪种意图真的在点"。
  2. 手动 SERP 抽查：对 head term 逐个看前 10 页是谁、是不是程序化农场、有没有工具站排名。**这一步不做，任何工具名单都只是假设。**

**反面证据也记了**：有 7 个 (族 × 语言) 组合返回 0 条补全（`unblur/ja`、`colorize/ko`、`product-photo/ja,ko,zh`、`ai-headshot/ru`、`ai-theme-photo/zh`）。0 补全说明**我用的那个说法没人这么打**，不等于需求不存在 —— 但它是"这个词不能当 head term、不能拿去做页面标题"的硬证据。

---

## 2. 证据矩阵（有多少种语言真的在搜）

每格是该语言下采集到的补全条数。`≥5` 视为该语言有稳定需求。

| 族 | en | es | pt | id | vi | ru | ja | ko | zh | ≥5 的语言数 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| restore-old-photo | 19 | 11 | 11 | 14 | 11 | 11 | 6 | 7 | 11 | **9** |
| remove-background | 11 | 11 | 12 | 11 | 11 | 11 | 7 | 12 | 10 | **9** |
| passport-photo | 11 | 10 | 11 | 10 | 10 | 11 | 9 | 10 | 11 | **9** |
| ai-avatar | 11 | 11 | 10 | 10 | 10 | 10 | 10 | 10 | 2 | 8 |
| ai-headshot | 11 | 7 | 10 | 5 | 10 | 0 | 7 | 11 | 11 | 8 |
| upscale | 11 | 11 | 10 | 10 | 11 | 12 | 2 | 3 | 11 | 7 |
| ai-poster | 11 | 5 | 4 | 13 | 10 | 3 | 10 | 10 | 6 | 7 |
| interior-design | 11 | 5 | 6 | 11 | 11 | 10 | 1 | 4 | 11 | 7 |
| ai-theme-photo | 11 | 11 | 11 | 8 | 1 | 3 | 7 | 12 | 0 | 6 |
| unblur | 11 | 10 | 1 | 10 | 15 | 11 | 0 | 1 | 9 | 6 |
| colorize | 19 | 14 | 10 | 4 | 8 | 12 | 1 | 0 | 3 | 5 |
| product-photo | 8 | 2 | 5 | 5 | 6 | 1 | 0 | 0 | 0 | 4 |

**读法**：上 3 行是"全世界都在搜"；中段是"在 5–8 种语言成立"（值得做，但首发只铺有证据的那几种语言）；`product-photo` 是"我原本以为它是工具，其实它是话题"。

---

## 3. 「TikTok Downloader」类比的四个条件（我们加第五条）

Navos 的武器不是"工具站"，而是找到了一类同时满足四个条件的品类。把条件写清楚，才能判断 AI 图像里谁对应：

| # | 条件 | 下载器为什么满足 | AI 图像里谁满足 |
|---|---|---|---|
| 1 | **普遍需求**：每种语言都有人搜 | ✅ 全语言 | 见 §2，只有 3 个族全绿 |
| 2 | **技术已商品化**：开源/API 就能做，无需自研 | ✅ yt-dlp | ✅ 图像编辑就是调模型 |
| 3 | **零学习成本**：贴链接→出文件 | ✅ | ✅ |
| 4 | **平台 ToS 允许** | ❌ **不满足** | 必须逐个审（§8） |
| 5 | **用户手上的东西离钱只有一步** | ❌ 用户要的是白拿副本 | **这才是分水岭** |

**第 5 条是本报告的核心判断**。下载器的流量之所以换不成钱，是因为用户的目标本身就是"不付钱拿到别处的副本"。AI 图像里满足第 5 条的品类有一个共同特征：**替代的是一次真实付费，且产出物有下游用途**：

- 证件照 → 今天在照相馆/店里花钱拍，**且明天就要交**
- 职业照 → LinkedIn 头图，已有 $20–40 的成熟付费市场（补全里的 `ai headshot generator reddit` / `reviews` / `kiwi` 就是用户在比价）
- 老照片修复 → 情感驱动，愿意为**一张**付费（`colorize`/`restore` 的长尾几乎不带 "free" 的绝对优势）
- 商品图/房源图 → 卖家要靠它成交，是**成本项**不是娱乐项

**反例（流量再大也不做）**：`ai-theme-photo` 这类娱乐换装（`edit foto ai tema kemerdekaan` / `tema natal` / `tema mafia`），以及换脸、明星、去水印 —— 用户没有付费动机，还可能踩平台条款。

> 这一条也直接回答了 `GROWTH_PLAN.md` §10 的决策 5：「工具用户 = 付费用户」这个未验证前提，**用证件照来验证最便宜**，因为在证件照这个品类里前提几乎是自明的。如果连证件照的"工具页 → 注册 → 首图"都跑不出转化，引擎 B 就该停。

---

## 4. 候选清单（分梯队，含各族能变成什么页面）

### 第一梯队 —— 建议首发（即 `GROWTH_PLAN.md` 阶段 1B 的第一批）

| 族 | slug | 为什么是它 | 付费动作 |
|---|---|---|---|
| 证件照/护照照 | `passport-photo` | 9/9 需求 + 用户今天在付钱 + 规格驱动 + 有截止日期 | 打印版/高清版/多国规格/加急 |
| 老照片修复 | `old-photo-restoration` | 需求最广（19 条 en 补全）+ 情感付费 + 结果震撼适合传播 | 更高分辨率、批量、上色（捆绑） |
| 职业照 | `ai-headshot` | 已有成熟付费市场，用户在主动比价 | 成套（多背景/多表情）、商用授权 |
| 图像增强/放大 | `image-upscaler` | dlss5 主业，GSC 已证实有真实点击 | 批量、更大尺寸、无水印 |

### 第二梯队 —— 第一梯队跑出数据后加

| 族 | slug | 前置条件 |
|---|---|---|
| 去背景 | `remove-background` | **必须先补 alpha 通道能力**，或改口径为"白底/换底色" |
| 上色 | `photo-colorize` | 捆绑进老照片修复，不单独做入口 |
| 去模糊 | `unblur-photo` | 证据只在 6 种语言成立，`ja`/`ko` 补齐说法后再铺 |
| 海报生成 | `ai-poster-generator` | 需求分散（面试/学术/活动），做通用入口 + 场景模板 |
| 头像生成 | `ai-avatar` | 8/9，但 `zh` 无补全；娱乐属性强，付费弱，只做流量入口 |

### 第三梯队 —— 先做内容，不做工具

| 族 | 处理方式 |
|---|---|
| 白底商品图 | 写文章承接"怎么拍"（`como tirar foto de produto com fundo branco` 等），内链到 `remove-background` |
| 娱乐换装特效 | 不做（§8） |
| 室内设计 | 交给 RenVi（§7） |

---

## 5. 长尾模式：程序化变体的真正来源

这是本报告最有操作性的部分。同一个 head term 在不同语言里，**重复出现同一批修饰词**。这批修饰词就是页面的模板变量，也是 Navos 那 496 个工具页的真实构造方式。

| 修饰维度 | 各语言原始证据（verbatim） | 能变成什么 |
|---|---|---|
| **免费** | `free` · `gratis` · `grátis`/`gratuito` · `gratis` · `miễn phí` · `бесплатно` · `無料` · `무료` · `免费` | 工具页的默认卖点（但要配额度闸门，见 §6） |
| **在线/网页** | `online` · `online gratis` · `online grátis` · `online` · `online` · `онлайн` · `サイト`/`web`/`ブラウザ` · `사이트` · `在线`/`线上`/`网站` | 每族一个在线工具页，标题必须带本地说法 |
| **AI / 神经网络** | `ai` · `ia` · `ia`/`ai` · `ai` · `bằng ai` · `нейросеть` · `ai` · `ai` · `ai` | "vs 传统 PS 做法"的正文段落 |
| **对比现有工具** | `canva`(17 个组合：en/es/pt/id/vi/ja) · `photoshop`/`фотошоп`/`ps`(16：en/es/pt/id/vi/zh) · `gemini`(12：en/es/pt/id/vi/ja) · `chatgpt`(7) · `word`/`パワポ`/`ペイント`/`小画家`/`ppt` · `iphone`(9：含 ja/zh) | **`/tools/<slug>-vs-canva`、`-vs-photoshop`、`-vs-gemini`**，只在有补全证据的语言做 |
| **质量不打折** | `quality` · `sin perder calidad` · `sem perder qualidade` · `agar tidak pecah`/`hd` · `без потери качества` · `高画質` · `清晰` | 页面的第一句价值主张（也是付费升级点） |
| **输出规格** | `png` · `300 dpi` · `4k`/`8k` · `3x4`/`4x4`/`2x3`/`3 на 4` · `fondo blanco`/`latar merah`/`белый фон`/`nền trắng` | **`/tools/passport-photo/<spec>` 规格页**：`4x4-chile`、`3x4-latar-merah`、`2x3-jas`、`3-na-4` |
| **合规 / 可用性** | `requirements`/`legit`/`cost`/`reviews` · `バレる` · `可以用吗` · `деловой` | 独立的"规格与合规"章节，这是**信任页**不是营销页 |
| **按自己的照片** | `from photo` · `de tu foto`/`con mi foto` · `từ ảnh thật` · `из фото`/`по фото` · `com minha foto` | 上传即用（免注册是关键，见 §6） |
| **设备** | `iphone` · `android` · `app`/`aplikasi`/`ứng dụng` · `アプリ`/`어플` · `快捷指令` | 移动端优先的第一屏 |

**最有价值的两个发现（原样引用）：**

证件照的长尾暴露了真实的付费场景 —— 智利人需要把 RUT 号印在照片上、印尼人需要红底/蓝底和「穿西装」的版本、俄罗斯人要"3 на 4"和"带角标"、韩国人要能当身份证件用：

```
foto carnet online con nombre y rut          (es, 智利 RUT 号)
foto carnet online chile / peru              (es, 按国家)
foto 3x4 online grátis sem marca d'água      (pt, 不要水印 → 这就是付费点)
pas foto online latar merah / latar biru / jas / 2x3   (id, 底色/西装/规格)
фото на документы онлайн 3 на 4 / белый фон / с уголком (ru, 规格/白底/角标)
passport photo online cost / legit / reviews  (en, 在比价和在验证)
```

而市场最大的疑虑不是"效果好不好"，是"**能不能用**"：

```
ai 証明写真 バレる          (ja: AI 证件照会被看出来吗)
ai证件照 可以用吗 / 护照     (zh: 能用来办护照吗)
ai 증명사진 민증 디시 / 이력서 (ko: 能用于身份证/简历吗)
```

→ **结论：赢家是一个"合规级证件照工具"，不是一个"好看的 AI 照片工具"。**用规格合规 + 可打印成品 + 不合规退费来回答这个疑虑。这是 Google 和 Canva 不会做的事，也是这个品类唯一的护城河。

---

## 6. dlss5 的能力对照与改造清单

| 需求 | 今天的 dlss5 | 结论 |
|---|---|---|
| 放大/增强 | ✅ `mode:'enhance'`，`ENHANCE_MAX_EDGE=1536`，上限 1536px/边，倍数是目标不是承诺 | 可做，但**不能说"4K"、不能说"true super resolution"** |
| 去模糊 / 老照片修复 / 上色 / 证件照 / 职业照 / 海报 / 头像 | ✅ `mode:'edit'`（prompt 驱动重绘，`flux-klein`） | 可做，全部靠 prompt + 后处理 |
| 透明 PNG / 抠图 | ❌ 无 alpha 通道、无抠图模型、唯一上游是 AlphaNet | **`remove-background` 暂缓**，或改口径为"白底/换底色" |
| 4K 输出 | ❌ 硬顶 1536 | 要真 4K 得先接 fal 之类的独立超分（现在只在文章里提到，没接线） |
| 零摩擦试用 | ✅ `server/sample-store.ts` 按 IP/天限次，超额 `429 guest_limit` | **最难的一块已经有了**，工具页可以直接复用 |
| 多语言 | ✅ 8 个语言包（`en-US zh-CN ja ko ru uk id et`） | 已具备 |
| 语言前缀路由 + hreflang | ❌ 只有 `/en|/zh` 的 blog 路由（`vercel.json`） | **引擎 B 的前置，必须先做** |
| `/tools/*` 矩阵 | ❌ 0 个 | 待建 |

**先铺哪几种语言？不看补全，看 GSC。** dlss5 自己三个月的真实点击国家是：美国 87、**俄罗斯 66、德国 50**、印度 37、**巴西 36、印尼 34、伊朗 33、波兰 31、乌克兰 29**、英国 27 —— 前十里有七个是非英语国家，而且按 `docs/SEARCH_CONSOLE_AUDIT_2026-09-20.md` 的原话，「俄罗斯、德国、印度尼西亚和乌克兰的 CTR 在 10% 左右或更高」。第一方数据比任何第三方工具都硬。

→ 建议铺语言顺序：**`en` → `ru` → `id` → `pt-BR` → `uk` → 其余**（`ru`/`id`/`uk` 的语言包已经有了，等于零翻译成本就能兑现）。

---

## 7. RenVi（渲见）：室内设计矩阵

`interior-design` 7/9 语言成立，且长尾的切分维度非常清楚 —— 这些直接就是页面：

| 切分维度 | 原始证据 | 页面 |
|---|---|---|
| 按照片 | `дизайн интерьера по фото нейросеть`(ru) · `thiết kế nội thất bằng ai`(vi) | `/tools/ai-interior-design`（上传房间照片） |
| 按户型图 | `нейросеть дизайн интерьера по планировке квартиры`(ru) · `ai 室内 设计 平面图`(zh) | `/tools/ai-floor-plan-to-3d` |
| 按房间类型 | `desain kamar tidur ai`(id 卧室) · `desain kamar mandi ai`(浴室) · `decorar habitacion con ia`(es 房间) · `decorar sala com ia`(pt 客厅) | `/tools/ai-<room>-design` × {bedroom, bathroom, living-room, kitchen} |
| 按尺寸 | `desain kamar 3x3 ai`(id, 3×3 米房间) | `/tools/ai-room-design/3x3` 等尺寸变体 |
| 按场景 | `thiết kế nội thất airbnb`(vi) · `desain rumah ai gratis`(id 整屋) | `/tools/airbnb-listing-design`（房东是付费用户） |
| 竞品 | `ai室内设计大师`(zh 竞品品牌) · `인테리어 디자인 ai 대체`(ko, "替代") | 对比页 |

RenVi 的产品本身就做"上传房间照片→重新设计"，所以这些页面全部是**现有能力的排列组合**，不需要新模型。注意 `ru` 和 `vi` 的证据强度高于 `ja`/`ko`，与 dlss5 的 GSC 结论一致。

---

## 8. 排除清单（明确不做，写下来免得反复讨论）

1. **平台下载器 / 去水印类**（TikTok、Instagram、YouTube 下载，去水印）—— 违反平台 ToS，且正是"用户目标=不付钱"的品类。**Navos 做它，我们不抄这一块。**
2. **换脸 / 明星 / 政治人物** —— 法律与平台双重风险。
3. **娱乐换装特效**（`ai-theme-photo` 那类）—— 无付费动机，只消耗免费额度。
4. **纯翻译拼接的页面** —— Google"规模化内容滥用"政策明确惩罚没有真实功能的页面。**每个工具页背后必须真的能出结果**，翻译只是外壳。
5. **拿 1536px 的能力去承诺 4K** —— 不是政策风险，是信誉风险，且第一批用户会立刻流失。
6. **把路由层称为"我们自己的模型"** —— 对技术人群必须说"编排多个开源模型的路由层"（`GROWTH_PLAN.md` §8.1）。

---

## 9. 缺口与下一步

**已知缺口（诚实标注）**
- 没有搜索量、没有竞争度、没有 CPC。梯队排序是按"证据广度 × 商业意图 × 能力"推的，**未经流量验证**。
- SERP 竞争没有抽查。Navos 的工具页能被索引不代表我们的也能。
- 补全无法区分"想用工具"和"想看教程"（`怎么做/方法/how to` 类长尾很多）。
- `remove-background` 这个 9/9 的强族，卡在我们没有 alpha 能力上。

**下一步（按优先级）**
1. **等 dlss5 首页 metadata 的 7–14 天观察窗口**（GSC 已在 09-20 部署了改动），先不要用旧数据否定它。
2. **手动 SERP 抽查第一梯队 4 个族的 head term**，确认前排是不是程序化农场、有没有空隙。
3. **补 dlss5 的语言前缀路由 + hreflang**（引擎 B 前置，无此项多语言乘数不成立）。
4. **做 1 个工具页样板**：`/tools/passport-photo`（含 1 个规格子页 `3-na-4` 和 1 个对比页 `-vs-canva`），打通 `tool_slug + locale` → 注册 → 首图 的埋点。
5. 用第 4 步的转化率**回答决策 5**：工具用户是不是付费用户。是，则铺满第一梯队；不是，则引擎 B 停手，把资源全给引擎 A。

---

## 10. 复现方式

```bash
python3 research/tool-radar/radar.py research/tool-radar/autocomplete-2026-09-21.json
node research/tool-radar/serp-brave.mjs /tmp/serp-brave   # 需在 shared_env/playwright 下运行
```

需要能访问 `suggestqueries.google.com`（本机直连，不走代理）。非拉丁文字的结果在终端可能显示为乱码，那是编码问题、不是数据问题，用 JSON 文件读即可。

---

## 11. 竞争实测：前排到底是谁（决定"能不能拿到结果"的那一半）

§2 只证明了需求存在。**需求存在只是必要条件**——能不能拿到结果，取决于前排是谁。这一节是实测。

### 方法与被丢弃的数据

| 入口 | 结果 | 处置 |
|---|---|---|
| Bing 纯 HTTP，英文查询 | ✅ 4 个族的前 10 条完整、全部切题 | **采信**（`serp-bing-en-2026-09-21.json`） |
| Bing 纯 HTTP，非英文查询 | ❌ 按 query 的**第一个字符**解析（`老照片修复` 返回"老"的词典页，`pas foto online latar merah` 返回微软帮助页） | 丢弃 |
| Bing 纯 HTTP，重跑 | ❌ 连 ASCII 查询都开始返回无关结果（限流） | 丢弃 |
| Google（真实 Chrome 会话） | ❌ `google.com/sorry` —— 本网络出口 IP 被判定为异常流量 | 丢弃 |
| **Brave Search（真实 Chrome 会话）** | ✅ 4 个本地化查询完整切题，自有索引 | **采信**（`serp-brave-2026-09-21.json`） |

诚实标注：Brave 的索引 ≠ Google 的索引；下面每个结论都标了它来自哪个引擎。**搜索量仍然未知。**

### 英语 head term：前排是"小工具站"还是"巨头"

```
passport photo online
  makepassportphoto.com · passportphotofactory.com · passportphotohub.com ·
  passport-photo.online · idphoto4you.com · passportphotos.com · usps.com ·
  photobooth.online · passportfreephoto.com · passportphotomake.com
  → 10/10 都是单一用途的证件照站，6 个的首页本身就是工具，没有 Canva/Adobe/Google

upscale image
  imgupscaler.com · iloveimg.com · upscale.media · pixelcut.ai · picsart.com ·
  imgupscaler.ai · pixconvert.com · cloudinary.com · img2go.com
  → 全是小工具站（imgupscaler.com 和 imgupscaler.ai 两个域名都在榜，典型的矩阵站）；
    没有品牌壁垒，但非常拥挤

remove background
  remove.bg · photoroom.com · iloveimg.com · pixelcut.ai · picsart.com ·
  canva.com · adobe.com · remove-background.com · removebackgrounds.ai · removebackground.now
  → 品类之王 remove.bg + Canva + Adobe 都在，但仍有三个无名站点挤进前十

ai headshot generator
  canva.com · headshotpro.com · visualgpt.io · headshot.ai · fotor.com ·
  adobe.com · magichour.ai · headshotpro.com · aragon.ai · higgsfield.ai
  → Canva + Adobe + 一批拿了钱的创业公司，最难
```

**四条结论：**
1. **`passport photo online` 的前排没有巨头。**十个名额全被单一用途站点占满，而且有一半的"首页即工具"。这跟 `remove background`（品类之王 + 两个巨头）和 `ai headshot`（巨头 + 风投）完全是两种局面。
2. **通用 head term 的前排不是 Google 也不是 Adobe**，而是一堆没有品牌的小工具站（`imgupscaler.com`、`pixconvert.com`、`img2go.com`）。**这说明壁垒是"页面执行"而不是"品牌或资本"**——只要真能把活干完，就有位置。
3. **`ai headshot` 是最不该先做的**：既有 Canva/Adobe，又有一批融资公司。证据广度高（8/9）但拿不到结果。
4. **`remove background` 的难度被高估、但前提是必须补能力**（见 §12）。

### 本地化 SERP：赢家的 URL 结构本身就是答案

Ru（Brave）：

```
фото на документы онлайн 3 на 4
  app.idphoto.me
  photo-visa.online/s/foto-na-3-na-4-onlayn                    ← 规格页
  pokecut.com/ru/instrumenty/foto-3-na-4-onlajn-besplatno      ← 规格页
  aipassportphotos.com/ru-ru/foto-3-na-4                       ← 规格页
  progif.ru/photo-for-documents
  passport-photo.online/ru-kz/foto-30x40-mm                    ← 规格页
  convertilo.ru/images/passport-photo/
  3x4photo.ru/spb/photo-studio-3x4                             ← 一家线下照相馆
  cutout.pro/ru/passport-photo-maker
  photodocs.ru

увеличить разрешение фото онлайн бесплатно
  pixelcut.ai/ru/image-upscaler · iloveimg.com/ru/upscale-image ·
  fabula-ai.com/tools/enhance · watermarkly.com/ru/upscale-image/ ·
  resizepixel.com/ru/resize-image/ · img2go.com/ru/upscale-image ·
  picsart.com/ru/image-upscale/ · momentbook.ru/tools/upscale · airbrush.com/ru/image-enhancer
```

Id / Zh（Brave）：

```
pas foto online latar merah
  image.pi7.org/id/latar-merah-pas-foto        ← 精确规格页
  canva.com/id_id/fitur/background-merah/      ← 大厂已本地化
  remove.bg/id/f/red-background                ← 品类之王已本地化
  photoroom.com/zh/tools/background-remover/red-background
  bikinpro.com/tools/pas-foto-maker · blog.rumahweb.com/... · capcut.com · youtube.com

老照片修复
  evoto.ai/zh-Hant/... · ai.nero.com/zh-cn/photo-restore · jpghd.com/zh ·
  adobe.com/tw/products/firefly/features/ai-photo-restoration.html ·  ← Adobe 已本地化
  picsart.com/zh/... · zhuanlan.zhihu.com/p/709098556 · photogrid.app/zh-cn/... · gaituya.com/...
```

**这是整份报告最重要的一张证据图。**它说明两件事：

1. **在这些市场里赢的人，赢法就是"一个规格一个页 + 一种语言一个目录"**——`/foto-3-na-4`、`/latar-merah-pas-foto`、`/ru/upscale-image`。赢家自己的 URL 结构，把这个机制从假设变成了已验证的事实。我们要做的不是发明一个策略，而是**执行一个已被证明有效的策略**。
2. **执行者几乎都是中小工具站，不是巨头**：`photo-visa.online`、`aipassportphotos.com`、`bikinpro.com`、`progif.ru`、`jpghd.com`、`gaituya.com`。但要注意 id/zh 两个市场里 `canva / remove.bg / photoroom / adobe` **已经建了本地化页面**，而 **ru 的"3 на 4"这个规格位上几乎全是小玩家**。

**还有一条只有这份证据能给出的洞察**：`3x4photo.ru/spb/photo-studio-3x4` —— 一家圣彼得堡的**线下照相馆**排在这个查询的前十。线下付费服务在同一个 SERP 上跟工具站抢位置，**这是"用户正在花钱办这件事"的直接证据**，比任何推测都硬。同一条逻辑也解释了为什么 `passport photo online` 的前排全是"首页即工具"的站点：搜索者要的是**一个答案，不是一款软件**。

### 因此，"较大概率拿到结果"的答案是

**做 `规格 × 语言` 的证件照页面，从俄语的 3:4 开始 —— 而不是做英文的通用工具。**

四条独立证据在这里收敛：

| 证据 | 结论 |
|---|---|
| 补全（§2） | `passport-photo` 9/9 语言有稳定需求 |
| 前排构成（本节） | 英语无巨头、ru 的规格位几乎全是小玩家 |
| 线下照相馆在抢同一个 SERP | 用户此刻正在为这件事付钱 |
| dlss5 自己的 GSC | 俄罗斯是第 2 大点击国家，且 ru 语言包已存在 |

再加一条：**这个品类的护城河是"把活干对"（毫米级裁切、正确底色、可打印的整版、各国规格），而不是模型能力**。这正是 Google 和 Canva 不会做的事，也是我们唯一能守住的东西。

**第一个要拿到的结果，因此应该定义得很小**：一个俄语 `фото 3 на 4` 页面，能真的产出合规可打印的成品 → 被收录 → 排进前排 → 免费额度用完 → 注册 → 首张出图。这一个闭环跑通，后面每一个「规格 × 语言」都是可复制的单元；跑不通，就不要铺 80 个页面。

### 下一步的顺序（按"反馈周期最短"排，不按流量排）

1. **先接住已经在来的需求**（0–2 周，近乎确定的信号）：`/blog` 三个月 1,022 次展示只有 8 次点击、平均排名 21.6，且 sitemap 36 条 URL 只有 9 条被收录；`visual enhancer` 595 次展示 CTR 2.9%、`upscaling` 349 次展示 CTR 2.3%。这些是**已经付过成本的曝光**，转化它们不需要新品类。
2. **然后做那一个证件照闭环**（2–4 周）：一个规格页 + 规格引擎 + 打印输出 + `tool_slug + locale → 注册 → 首图` 埋点。
3. **再谈矩阵**（4 周后）：把 `规格 × 语言` 当乘法单元铺开，用第 2 步的真实转化率决定铺多少。

---

## 12. 能力采购清单（能力是可以买的，按期望值排）

上一版把"我们做不了"当成了排除理由，那是错的排序方式。**能力缺口是采购项，问题只在于先买哪个。**按"解锁多少已验证需求 + 成本"重排：

| 优先级 | 要买的能力 | 解锁什么 | 为什么排这个位置 |
|---|---|---|---|
| **1** | **规格引擎**（各国证件照规格模板 + 毫米级裁切 + 打印整版输出）——**不是模型，是纯代码** | 证件照全族（9/9 语言、无巨头前排、用户已在付钱） | 最便宜（无需推理成本）、转化最高、护城河最真实。**先买这个，甚至不用买模型** |
| **2** | **抠图 / alpha 通道模型** | ① 去背景族（9/9 语言需求）② **证件照的底色替换（红/蓝/白，正好是证件照的硬需求）** | 一个采购同时解锁第 1 和第 3 强的需求族，且第 1 项本来就需要它 |
| **3** | **真 4K 超分**（独立超分模型，现有上游硬顶 1536px） | `upscale to 4k`（英语补全第一梯队）+ dlss5 主业口径的自洽 | 最贵、且它服务的是**最拥挤**的前排（`upscale image` 十个小工具站）；有钱先做 1 和 2 |
| 4 | 视频超分 | Seedance 2.5 工作流（`docs/SEEDANCE25_VIDEO_SUPERRES_PLAN.md` 已写好） | GSC 里视频词只有 2 次展示、0 次点击——**需求还没出现**，不该现在投 |

一句话：**先把 1 和 2 买下来，它们两个合起来覆盖 `passport-photo` + `remove-background` 这两个 9/9 的需求族；第 3 项价格最贵而前排最难，排在后面。**

（§4 第二梯队里"前置条件：必须先补能力"和 §6 里"暂缓"的说法按本节作废——能力是采购项，改为"买什么、什么时候买"。）
