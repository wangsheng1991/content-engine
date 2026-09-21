// `content publish` never posts anything by itself: it reports exactly which
// artifacts are safe to ship (tier A) and which ones wait for a human (tier B),
// and optionally commits the source of truth to git.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PLATFORMS } from './platforms.mjs';
import { exists, isoNow, readJson } from './util.mjs';

export function readManifest(root, config) {
  const file = path.join(root, config.paths.out, 'manifest.json');
  if (!exists(file)) throw new Error(`no build found at ${file} — run "content build" first`);
  return readJson(file);
}

export function publishReport({ manifest, log = console.log }) {
  const tierA = manifest.artifacts.filter((a) => a.tier === 'A');
  const tierB = manifest.artifacts.filter((a) => a.tier === 'B');

  log(`build ${manifest.generated_at} · base ${manifest.base_url}`);
  log('');
  log(`Tier A — 全自动（${tierA.length} 个产物）`);
  for (const artifact of tierA) log(`  ✓ ${artifact.path}  [${artifact.kind}]`);
  log('');
  log(`Tier B — 需人工确认（${tierB.length} 个产物）`);
  for (const artifact of tierB) {
    const platform = PLATFORMS.find((p) => artifact.kind === `draft:${p.id}`);
    log(`  → ${artifact.path}  [${artifact.kind}]${platform ? ` — ${platform.approval}` : ''}`);
  }
  if (manifest.deck_engine === null && tierB.some((a) => a.kind === 'deck')) {
    log('  ! deck.pptx 未生成：本机没有 pandoc，只有 slides.md/outline.json');
  }
  for (const note of manifest.notes ?? []) log(`  · ${note}`);
  log('');
  log('Tier A 的产物可直接部署：GitHub Actions 把 dist/site/ 发布为 GitHub Pages；');
  log('dist/github、dist/huggingface、dist/blog 交给各自的 workflow 或 hf upload。');
  return { tierA, tierB };
}

/** Commit the source of truth (never the build output) when --git is passed. */
export function gitPublish({ root, message, log = console.log, dryRun = false }) {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const status = run(['status', '--porcelain']);
  if (!status) {
    log('git: 工作区干净，没有需要提交的内容');
    return { committed: false };
  }
  const summary = `${status.split('\n').length} 个文件变更`;
  if (dryRun) {
    log(`git: 将提交 ${summary}（dry-run，未执行）`);
    return { committed: false, dryRun: true };
  }
  run(['add', '-A']);
  run(['commit', '-m', message ?? `content: publish (${isoNow()})`]);
  let pushed = false;
  try {
    const remotes = run(['remote']);
    if (remotes.split('\n').includes('origin')) {
      run(['push']);
      pushed = true;
    }
  } catch (error) {
    log(`git: 提交完成，推送失败 — ${String(error.message).split('\n')[0]}`);
  }
  log(`git: 已提交 ${summary}${pushed ? '，已推送到 origin' : ''}`);
  return { committed: true, pushed };
}
