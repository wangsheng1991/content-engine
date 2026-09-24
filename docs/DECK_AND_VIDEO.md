# 做视频与做 PPT：一次调研，和它落在本仓库里的结果

写这份文档的原因：这套引擎能把一个主题编译成网站、长文、RSS、GitHub README 和平台草稿，但
「演示」这一格一直是空的。`slides.md` 只有 pandoc 一条出口，`video.yaml` 只写出
`storyboard.json` 和 `script.md`，而没有人拿着这两份文件去录视频。所以先看别人怎么做，再决定
这里做什么、不做什么。

调研时间：2026-09-24。搜索走 `https://search.brave.com/search?q=…`（本机可达、服务端渲染），
结果按下面的顺序读。

## 一、文章转视频这一类：全是 SaaS

搜 "convert blog post to video"、"article to video AI" 这一串关键词，回来的东西高度同质：

| 产品 | 它卖的是什么 |
| --- | --- |
| Descript | 把文稿当时间轴编辑，导出视频 |
| Revid.ai | 长文/链接 → 短视频，托管生成 |
| VEED | 在线编辑器，模板化 |
| HeyGen / Synthesia | 数字人口播，按分钟计费 |

共同点：**渲染在别人机器上，产物在别人账号里，价钱按分钟算**。对本仓库来说还有一条更致命的——
它们不进 git，不能重跑，改了稿子之后哪一版发出去过就说不清了。这里已经有的东西
（`evidence.json` 一句话一条出处、`data/published/` 记账、构建可复现）恰恰是它们的反面。

结论：不接。

## 二、本地能跑的两条路

### 2.1 Marp CLI（marp-team/marp-cli）

- markdown 加少量 front-matter → HTML / PDF / PPTX / PNG，是这类需求里最成熟的 CLI。
- **它导出的 pptx 是「每页一张图」**（导出链路是 markdown → HTML → 截图 → 塞进 pptx 壳），
  这一点很重要：说明「图片式 pptx」不是偷懒，而是这个品类里公认的取舍——保住版式，放弃可编辑。
- 代价：npm 依赖，且渲染需要浏览器。本仓库的 `package.json` 里 dependencies 为空，README 明说
  no npm dependencies，CI 也不跑 `npm install`。为一个出口破坏这个前提不划算。

### 2.2 PptxGenJS（gitbrent/PptxGenJS）

- 纯 JS 写真正的 OOXML，产出可编辑的 .pptx，无需浏览器，Node 直接跑。
- 但它同样是 npm 依赖，而且「可编辑」的另一面是这里没有设计语言：默认版面是素色的，要好看就得
  自己写一整套版式代码。手写最小 OOXML 也可以做到零依赖，但样板多、出错面大，收益只有「可编辑」
  这一条。

### 2.3 Playwright / Puppeteer → 产品演示视频

社区里做产品演示视频的常见做法：脚本驱动浏览器操作真实界面，逐帧截图，再拼成视频。这套本仓库已经
实践过一次（passport-photo 的 `demo.mp4`），脚本留在
`shared_env/playwright/passport-demo.mjs`。它适合「演示一个真实工具怎么用」，不适合「把一篇长文的
论点讲一遍」——后者需要的是幻灯片，不是录屏。

### 2.4 ffmpeg 的图片序列 + 旁白

Ken Burns（缓慢推近）、图片轮播这类配方在 ffmpeg 生态里是现成的：`-loop 1 -t N -i frame.png`
配 `concat` 滤镜即可。本机 ffmpeg 7.1.1 带 libx264 / aac。macOS 自带 `say`，中文音色有
Tingting（zh_CN）和 Mei-Jia（zh_TW），可以离线合成旁白并测出真实时长。这条路零新依赖。

## 三、决定

**幻灯片、图片和视频，全部从 `slides.md` 一份源出，做成 `content deck` 一条命令，零新依赖。**

```
topics/<slug>/slides.md
        │
        ├── content build ──→ deck/<slug>/slides.md · outline.json · deck.pptx（pandoc，可编辑）
        │
        └── content deck ───→ deck/<slug>/deck.html   一份能翻、能分享、能打印的文档
                              deck/<slug>/slides/NN.png  每页一张（小红书轮播）
                              deck/<slug>/deck.pdf      同一份 HTML 经 Chrome 打印
                              deck/<slug>/deck.mp4      图片序列 + 旁白，时长跟着旁白走
```

为什么是 HTML 而不是 pptx 当主产物：

1. **零依赖。** 渲染用本机 Chrome，编码用本机 ffmpeg，两条路都已经在为别的产物服务。
2. **一份源出四个东西。** HTML/PDF/PNG/MP4 共用同一套版式规则（`templates/deck/slide.css`，
   尺寸全用 rem，1rem = 画布宽度的 1%），所以 16:9 和 3:4 不会各长歪一套。
3. **图片式是刻意的。** 上面 Marp 的例子说明这个品类接受「每页一张图」。要可编辑的 pptx，pandoc
   那条老路还在，两个出口各管一件事。

## 四、旁白就是演讲者备注

pandoc 会把 `::: notes` 的 div 放进 pptx 的演讲者备注。同一段文字，`content deck --video --voice`
时用 `say` 读出来当音轨，**页面停留多久由读出来多长决定**（再加 0.4 秒换气），不是猜一个秒数。
于是「先写旁白」变成一件有回报的事：视频长度自己就对了，而且 pptx 里也顺手有了备注。

没写旁白的页按 `--seconds`（默认 5 秒）停留；`say` 只在 macOS 上有，别的平台上视频是静音而不是失败。

## 五、没做的，和为什么

- **不接 SaaS 转视频**：产物进不了 git，重跑不了。
- **不引 PptxGenJS / Marp**：会破坏零依赖这个前提，收益只有「可编辑」；那个出口 pandoc 已经有了。
- **不做数字人 / TTS 云服务**：本机 `say` 够用，且离线、可重跑。要更好的音色时，`--voice` 换个
  音色名即可，接口已经在那儿了。
- **不做自动配乐、转场、字幕**：现在没有证据说明需要它们；轮播图 + 旁白已经能覆盖
  「把一篇长文讲一遍」这个真实需求。
