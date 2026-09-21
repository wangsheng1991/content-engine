// Deck compilation goes through pandoc when it is installed; without it the
// markdown deck is still emitted and the .pptx step is reported as skipped.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ensureDir, exists } from './util.mjs';

export function pandocPath() {
  try {
    execFileSync('pandoc', ['--version'], { stdio: 'ignore' });
    return 'pandoc';
  } catch {
    return null;
  }
}

/** Convert an already-compiled slides.md into a real .pptx via pandoc. */
export function buildDeck({ bin, input, title, outFile, log = () => {} }) {
  if (!bin) return { built: false, reason: 'pandoc not installed' };
  if (!exists(input)) return { built: false, reason: `deck source missing: ${input}` };
  ensureDir(path.dirname(outFile));
  try {
    execFileSync(
      bin,
      [input, '-o', outFile, '-f', 'markdown', '-t', 'pptx', '--slide-level=2', '--metadata', `title=${title}`],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    log(`deck: ${outFile}`);
    return { built: true, file: outFile };
  } catch (error) {
    return { built: false, reason: String(error.stderr || error.message).trim().slice(0, 400) };
  }
}
