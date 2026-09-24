// The deck video: the same pages, held on screen long enough to be read, with the narration from
// `::: notes` spoken over them.
//
// No new dependency and no service — `say` is part of macOS and ffmpeg is the same encoder the
// screen recordings already go through. The one thing worth being careful about is that the video
// is only as long as the audio, so the timeline is planned from measured narration lengths rather
// than guessed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, writeOut } from './util.mjs';

export const DEFAULT_FPS = 30;
/** How long a page with nothing to say stays up. */
export const DEFAULT_SECONDS = 5;
/** A breath between the end of the narration and the next page. */
export const TAIL_SECONDS = 0.4;
export const DEFAULT_VOICE = process.platform === 'darwin' ? 'Tingting' : null;

export function ffmpegPath() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    return null;
  }
}

export function ffprobePath() {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return 'ffprobe';
  } catch {
    return null;
  }
}

/** `say` exists on macOS and nowhere else; elsewhere the video is silent rather than broken. */
export function sayPath() {
  // `say` has no `--version` to ask, so the only honest probe is the binary being there.
  return process.platform === 'darwin' && fs.existsSync('/usr/bin/say') ? '/usr/bin/say' : null;
}

/**
 * The length of every page in the video.
 *
 * `spoken` maps a page number to how many seconds its narration takes, measured after synthesis.
 * A page with narration runs as long as the voice does; a page without one runs for `seconds`,
 * which is all a still can ask for.
 */
export function planTimeline(pages, { seconds = DEFAULT_SECONDS, tail = TAIL_SECONDS, spoken = {} } = {}) {
  const still = Number(seconds) > 0 ? Number(seconds) : DEFAULT_SECONDS;
  return pages.map((page) => {
    const heard = Number(spoken[page.number]);
    const narrated = Number.isFinite(heard) && heard > 0;
    return {
      number: page.number,
      title: page.title ?? '',
      frame: page.path ?? page.file,
      duration: round2(narrated ? heard + Number(tail ?? TAIL_SECONDS) : still),
      narrated,
    };
  });
}

function round2(value) {
  return Number(Number(value).toFixed(2));
}

export function totalSeconds(timeline) {
  return round2(timeline.reduce((sum, entry) => sum + entry.duration, 0));
}

/** `say` reads the text from a file, so a narration with quotes or dashes needs no escaping. */
export function sayArgs({ voice, rate, outFile, textFile }) {
  const args = [];
  if (voice) args.push('-v', voice);
  if (Number(rate) > 0) args.push('-r', String(Number(rate)));
  args.push('-o', outFile, '-f', textFile);
  return args;
}

/**
 * The ffmpeg argument list, as data.
 *
 * Kept apart from the call so the shape of the timeline can be asserted without encoding a video:
 * every page contributes one looping image input and exactly one audio input, in that order, and
 * the concat filter gets one labelled pair per page.
 */
export function videoArgs({ timeline, audio = {}, size, fps = DEFAULT_FPS, outFile }) {
  const count = timeline.length;
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const entry of timeline) args.push('-loop', '1', '-t', String(entry.duration), '-i', entry.frame);
  for (const entry of timeline) {
    const file = audio[entry.number];
    if (file) args.push('-i', file);
    else args.push('-f', 'lavfi', '-t', String(entry.duration), '-i', 'anullsrc=r=44100:cl=stereo');
  }

  const parts = [];
  timeline.forEach((entry, index) => {
    parts.push(`[${index}:v]fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p[v${index}]`);
    // Every page's audio is padded to the page's length, which is what keeps the concat honest:
    // one page drifting early would put every later slide out of step with its voice.
    parts.push(
      `[${count + index}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:${entry.duration}[a${index}]`,
    );
  });
  parts.push(
    `${timeline.map((_entry, index) => `[v${index}][a${index}]`).join('')}concat=n=${count}:v=1:a=1[vout][aout]`,
  );

  args.push(
    '-filter_complex',
    parts.join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outFile,
  );
  return args;
}

/** How long an audio file actually is, in seconds — the number the timeline is built from. */
export function audioSeconds({ bin, file }) {
  try {
    const out = execFileSync(bin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
      encoding: 'utf8',
    });
    const seconds = Number(String(out).trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

/**
 * Speak every page that has narration into one audio file each.
 *
 * Returns `{ files, seconds, notes }` — the measured durations are what the timeline is built
 * from, so a page whose synthesis failed still gets its full silent length instead of vanishing.
 */
export function narrate({ pages, say, probe, voice, rate, workDir, log = () => {} }) {
  const files = {};
  const seconds = {};
  const notes = [];
  if (!say) return { files, seconds, notes: ['narration skipped — `say` is only available on macOS'] };

  ensureDir(workDir);
  for (const page of pages) {
    const text = String(page.notes ?? '').trim();
    if (!text) continue;
    const outFile = path.join(workDir, `narration-${page.frame}.aiff`);
    const textFile = path.join(workDir, `narration-${page.frame}.txt`);
    writeOut(textFile, `${text}\n`);
    try {
      execFileSync(say, sayArgs({ voice, rate, outFile, textFile }), { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      notes.push(`page ${page.number}: narration failed — ${String(error.stderr || error.message).trim().slice(0, 200)}`);
      continue;
    }
    const length = probe ? audioSeconds({ bin: probe, file: outFile }) : null;
    if (!length) {
      notes.push(`page ${page.number}: narration length could not be measured, page keeps its still length`);
      continue;
    }
    files[page.number] = outFile;
    seconds[page.number] = length;
    log(`  voice ${page.number}: ${length.toFixed(1)}s  ${text.split('\n')[0].slice(0, 48)}`);
  }
  return { files, seconds, notes };
}

/** Encode the timeline into `outFile`. Returns what was written, or why nothing was. */
export function buildVideo({ bin, timeline, audio, size, fps = DEFAULT_FPS, outFile, timeoutMs = 600000 }) {
  if (!bin) return { built: false, reason: 'ffmpeg not installed' };
  if (!timeline.length) return { built: false, reason: 'the timeline is empty' };
  ensureDir(path.dirname(outFile));
  const args = videoArgs({ timeline, audio, size, fps, outFile });
  try {
    execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL' });
  } catch (error) {
    const detail = String(error.stderr || error.message).trim().split('\n').slice(-4).join(' ');
    return { built: false, reason: detail.slice(0, 400) || 'ffmpeg failed' };
  }
  if (!fs.existsSync(outFile)) return { built: false, reason: 'ffmpeg wrote no file' };
  return { built: true, file: outFile };
}
