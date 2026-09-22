#!/usr/bin/env node
// content — the CLI over the compiler.
//
//   content build [slug...] [--all] [--site-only] [--out dist]
//   content publish [--git] [--dry-run]
//   content new <slug> [--title "..."]
//   content list
//   content serve [--port 4173]
//   content --help
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, loadConfig, scaffoldTopic } from '../src/build.mjs';
import { gitPublish, publishReport, readManifest } from '../src/publish.mjs';
import { serve } from '../src/serve.mjs';
import { listTopicSlugs, loadTopic } from '../src/topic.mjs';
import { verifyAll } from '../src/verify.mjs';
import { hfPublish } from '../src/hf.mjs';
import { BACKENDS, chromePath, coverOf, renderImages } from '../src/images.mjs';
import { blueskyPublish } from '../src/bluesky.mjs';
import { devtoPublish } from '../src/devto.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      if (inline !== undefined) flags[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
      else flags[key] = true;
    } else rest.push(arg);
  }
  return { flags, rest };
}

const HELP = `content — GitHub-first content engine

用法:
  content build [slug...] [--all] [--site-only] [--out <dir>]
  content images [slug...] [--backend card|qwen|command] [--only <id,...>] [--force] [--dry-run]
  content verify [slug...] [--online] [--strict]
  content publish [--git] [--dry-run] [--hf] [--bluesky [<slug>...]] [--devto [<slug>...]] [--draft]
                  [--repo <owner/name>] [--public]
  content new <slug> [--title "..."] [--date YYYY-MM-DD]
  content list
  content serve [--port 4173] [--dir <dir>]
  content --help

约定:
  topics/<slug>/ 是唯一内容源；dist/ 全部由 content build 生成，不手改。
  Tier A 产物（网站/GitHub/Hugging Face/RSS）可全自动发布；
  Tier B 产物（小红书/Reddit/X/知乎/PPT/视频脚本）一律停在草稿等人工确认。

  content images 生成封面与插画，写进 topics/<slug>/assets/ —— 是随主题提交的源文件，不是
  dist/ 产物。因为 CI 在 ubuntu 上编译站点，既没有 Chrome 也没有中文字体，构建期生成的图会
  悄悄从线上站点消失。已有图片默认沿用，--force 才重画。
  后端三选一：card（默认，用本机 Chrome 把标题排成 1200×630 的卡片截图，零依赖、不需要任何
  模型）、qwen（把 prompt 发给图像 API，endpoint/model 在 content.config.json 的 images.qwen）、
  command（把 {prompt} {out} {width} {height} 填进任意命令）。插画写在 source.yaml 的 images: 里，
  正文用 assets/<id>.png 引用即可。

  content publish --bluesky <slug> 单列：Bluesky 是这套平台里唯一用账号自己的 app password
  就能发的，凭证放 vault（BLUESKY_HANDLE / BLUESKY_APP_PASSWORD），发布后回读公开接口确认。

  content publish --devto <slug> 发长文：只需一个 DEVTO_API_KEY（账号设置里自己生成，无审核）。
  正文取 dist 里编译好的 blog/<slug>.md（含证据与已带 ?ref= 的 CTA），用 canonical_url 指回
  自己的站点，搜索引擎的功劳记在站点上而不是复制品上。加 --draft 先存草稿，先加 --dry-run 看标题标签。
  有封面时一并作为 cover_image 发过去（优先英文版封面），Dev.to 会把它转存到自己的 CDN，
  所以站点要先部署好再发这一条。

  content verify 是发布前的质量闸门：每条 claim 必须带一段能在它自己的
  source 里逐字找到的 quote。默认只做不需要联网的结构检查；加 --online
  才回源逐字核对（本机到源站的路由时好时坏，取不到的源报 unreachable，
  不会被当成通过）；CI 里用 --online --strict 让取不到也失败。
`;

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const { flags, rest } = parseArgs(argv);
  const config = loadConfig(ROOT);

  switch (command) {
    case 'build': {
      const manifest = build({
        root: ROOT,
        config,
        slugs: rest.length ? rest : undefined,
        siteOnly: Boolean(flags['site-only']),
        outDir: flags.out ? path.resolve(ROOT, flags.out) : undefined,
        log: (line) => console.log(line),
      });
      const tierA = manifest.artifacts.filter((a) => a.tier === 'A').length;
      const tierB = manifest.artifacts.filter((a) => a.tier === 'B').length;
      console.log(`\n构建完成：${manifest.topics.length} 个主题，Tier A ${tierA} 个 / Tier B ${tierB} 个产物`);
      for (const note of manifest.notes) console.log(`  · ${note}`);
      console.log(`输出目录：${path.relative(ROOT, path.join(ROOT, flags.out ?? config.paths.out))}/`);
      break;
    }
    case 'verify': {
      const online = Boolean(flags.online);
      const strict = Boolean(flags.strict);
      const { reports, ok } = verifyAll(ROOT, {
        topicsDir: config.paths.topics,
        slugs: rest.length ? rest : undefined,
        online,
        strict,
        log: (line) => console.log(line),
      });
      for (const report of reports) {
        const mark = report.ok ? '✓' : '✗';
        const bits = [`${report.checked} 条 claim`];
        if (online) {
          bits.push(`逐字命中 ${report.verbatim}`, `对不上 ${report.mismatched}`);
          if (report.unreachable) bits.push(`取不到 ${report.unreachable}`);
        }
        console.log(`${mark} ${report.slug.padEnd(24)} ${bits.join('  ')}`);
        for (const problem of report.problems) console.log(`    问题：${problem}`);
        for (const warning of report.warnings) console.log(`    注意：${warning}`);
      }
      console.log('');
      console.log(ok
        ? `闸门通过：${reports.length} 个主题${online ? '（已回源逐字核对）' : '（仅结构检查，未回源）'}`
        : `闸门未通过：${reports.filter((r) => !r.ok).length}/${reports.length} 个主题有问题`);
      if (!ok) process.exitCode = 1;
      break;
    }
    case 'publish': {
      const manifest = readManifest(ROOT, config);
      publishReport({ manifest, log: console.log });
      if (flags.hf) {
        const token = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN;
        hfPublish({
          root: ROOT,
          config,
          manifest,
          slugs: rest.length ? rest : undefined,
          repoOverride: typeof flags.repo === 'string' ? flags.repo : undefined,
          isPrivate: !flags.public,
          token,
          dryRun: Boolean(flags['dry-run']),
          log: console.log,
        });
      }
      if (flags.bluesky) {
        // `--bluesky <slug>` and `--bluesky` plus a positional slug both work: the argument parser
        // swallows the first token after the flag, so a bare slug would otherwise vanish.
        const blueSlugs = [...(typeof flags.bluesky === 'string' ? [flags.bluesky] : []), ...rest];
        blueskyPublish({
          root: ROOT,
          config,
          slugs: blueSlugs,
          identifier: process.env.BLUESKY_HANDLE || process.env.BLUESKY_IDENTIFIER,
          password: process.env.BLUESKY_APP_PASSWORD,
          dryRun: Boolean(flags['dry-run']),
          log: console.log,
        });
      }
      if (flags.devto) {
        // Same argument-parser quirk as --bluesky: a bare slug lands in `rest`.
        const devtoSlugs = [...(typeof flags.devto === 'string' ? [flags.devto] : []), ...rest];
        devtoPublish({
          root: ROOT,
          config,
          manifest,
          slugs: devtoSlugs,
          apiKey: process.env.DEVTO_API_KEY,
          draft: Boolean(flags.draft),
          dryRun: Boolean(flags['dry-run']),
          log: console.log,
        });
      }
      if (flags.git || flags['dry-run']) {
        // A build can be inspected from a copy that is not a repository (a mirrored
        // workspace, a CI scratch dir). Report that instead of throwing.
        if (!fs.existsSync(path.join(ROOT, '.git'))) {
          console.log('git: 当前目录不是 git 仓库，跳过提交');
        } else {
          gitPublish({
            root: ROOT,
            dryRun: Boolean(flags['dry-run']),
            message: `content: publish${rest.length ? ` ${rest.join(', ')}` : ''}`,
            log: console.log,
          });
        }
      }
      break;
    }
    case 'images': {
      const slugs = rest.length ? rest : listTopicSlugs(ROOT, config.paths.topics);
      const topics = slugs.map((slug) => loadTopic(ROOT, slug, { topicsDir: config.paths.topics }));
      const backend = typeof flags.backend === 'string' ? flags.backend : undefined;
      if (backend && !BACKENDS.includes(backend)) {
        throw new Error(`未知的图像后端 "${backend}" —— 可选：${BACKENDS.join(' / ')}`);
      }
      if ((backend ?? config.images?.backend) === 'card' && !chromePath()) {
        console.log('提示：本机没找到 Chrome/Chromium，card 后端需要它（可用 CHROME_PATH 指定）');
      }
      const result = await renderImages({
        root: ROOT,
        config,
        topics,
        backend,
        only: typeof flags.only === 'string' ? flags.only.split(',') : [],
        force: Boolean(flags.force),
        dryRun: Boolean(flags['dry-run']),
        log: console.log,
      });
      console.log('');
      console.log(
        `图像：新生成 ${result.rendered.length} 张，沿用 ${result.skipped.length} 张，失败 ${result.failed.length} 张`,
      );
      for (const item of result.failed) console.log(`  ✗ ${item.slug}/${item.id}：${item.reason}`);
      console.log('图像写在 topics/<slug>/assets/ 里，是随主题一起提交的源文件 —— dist/ 每次重建都会清空。');
      break;
    }
    case 'new': {
      const slug = rest[0];
      if (!slug) throw new Error('usage: content new <slug>');
      const dir = scaffoldTopic(ROOT, slug, { topicsDir: config.paths.topics, title: flags.title ?? slug, date: flags.date });
      console.log(`已创建主题骨架：${path.relative(ROOT, dir)}`);
      break;
    }
    case 'list': {
      for (const slug of listTopicSlugs(ROOT, config.paths.topics)) {
        const topic = loadTopic(ROOT, slug, { topicsDir: config.paths.topics });
        const parts = [
          `article ${topic.article ? '✓' : '—'}`,
          `cover ${coverOf(topic) ? '✓' : '—'}`,
          `readme ${topic.readme ? '✓' : '—'}`,
          `slides ${topic.slides ? '✓' : '—'}`,
          `video ${topic.video ? '✓' : '—'}`,
          `evidence ${topic.evidence?.claims?.length ?? 0}`,
        ];
        console.log(`${slug.padEnd(24)} ${topic.source.status}  ${parts.join('  ')}`);
      }
      break;
    }
    case 'serve': {
      await serve({
        dir: path.resolve(ROOT, flags.dir ?? path.join(config.paths.out, 'site')),
        port: Number(flags.port ?? 4173),
      });
      break;
    }
    case 'help':
    case '--help':
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`unknown command: ${command}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
});
