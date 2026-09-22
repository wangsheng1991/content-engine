#!/usr/bin/env node
// Turn one still into a short shot with 通义万相 (Wan / Qwen family) image-to-video.
//
// This is the reproduction script for the write-up in `topics/wan-i2v-first-frame/`: it is the
// smallest complete version of the pipeline, with the measurements the article quotes written out
// as a JSON log rather than described in prose.
//
// Two properties are the whole reason it looks the way it does:
//
//   * The submission endpoint is **asynchronous only**. The API answers with a `task_id` and the
//     video is collected by polling; there is no synchronous call to wait on, and asking for one
//     is answered with an error rather than a video.
//   * A local file is inlined as a `data:` URI, so the script needs no object storage and no
//     network round trip to publish the input.
//
// Credentials come from the environment (`QWEN_API_KEY`, or `DASHSCOPE_API_KEY`) and are never
// printed. Usage:
//
//   node scripts/wan-i2v.mjs --image <file> --prompt "<motion prompt>" [--out <dir>]
//                            [--resolution 720P] [--duration 5] [--audio true] [--log <file.json>]
import fs from 'node:fs';
import path from 'node:path';

const SUBMIT_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
const taskUrl = (id) => `https://dashscope.aliyuncs.com/api/v1/tasks/${id}`;

/** The API polls its own queue; this is how often we ask, and how long we are willing to. */
export const POLL_INTERVAL_MS = 8000;
export const MAX_POLLS = 40;

/**
 * Both of these change the bill, and both have a default that is not the cheap one:
 *
 *   * `resolution` — wan2.6-i2v-flash accepts 720P and 1080P, and the API's default is 1080P.
 *   * `audio`      — the API's default is `true` (with sound), which costs exactly double.
 *
 * So the script writes both into the request instead of leaving them to the server. A 5-second
 * silent 720P clip is ¥0.75; the same clip with sound is ¥1.50.
 */
export const RESOLUTIONS = ['720P', '1080P'];
export const MIN_DURATION = 2;
export const MAX_DURATION = 15;
export const DEFAULT_DURATION = 5;

export function mimeFor(file) {
  const ext = path.extname(String(file)).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  throw new Error(`不认识的图片格式：${ext || '(无扩展名)'}`);
}

export function dataUri(file) {
  return `data:${mimeFor(file)};base64,${fs.readFileSync(file).toString('base64')}`;
}

/**
 * One poll's answer, classified. `UNKNOWN` is a failure rather than a wait: the task is not
 * queued, running or finished, it does not exist (a task id is only valid for 24 hours).
 */
export function classifyTask(output) {
  const status = output?.task_status;
  if (status === 'SUCCEEDED') return { state: 'done', url: output.video_url, raw: output };
  if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
    return { state: 'failed', reason: `${status}${output?.code ? ` (${output.code})` : ''}` };
  }
  if (status === 'PENDING' || status === 'RUNNING') return { state: 'waiting', status };
  return { state: 'failed', reason: `无法识别的任务状态：${String(status)}` };
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`无法识别的参数：${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} 缺少取值`);
    args[key.slice(2)] = value;
    i += 1;
  }
  args.duration = Number(args.duration ?? DEFAULT_DURATION);
  args.resolution = args.resolution ?? '720P';
  args.audio = args.audio === 'true';
  if (!args.image) throw new Error('缺少 --image <file>');
  if (!args.prompt) throw new Error('缺少 --prompt "<motion prompt>"');
  if (!Number.isInteger(args.duration) || args.duration < MIN_DURATION || args.duration > MAX_DURATION) {
    throw new Error(`--duration 只能是 ${MIN_DURATION}～${MAX_DURATION} 之间的整数秒（wan2.6-i2v-flash 的实际取值范围）`);
  }
  if (!RESOLUTIONS.includes(args.resolution)) throw new Error(`--resolution 只能是 ${RESOLUTIONS.join(' / ')}`);
  return args;
}

/**
 * Submit one job and wait for it. Returns the honest record of what happened — including how long
 * it actually took, which is the number the write-up quotes and the one nobody can guess.
 */
export async function generate({
  image,
  prompt,
  resolution = '720P',
  duration = DEFAULT_DURATION,
  // Sent explicitly: the API's own default is `true`, and silence is half the price.
  audio = false,
  key = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY,
  fetchImpl = fetch,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  log = () => {},
} = {}) {
  if (!key) throw new Error('缺少凭证 —— QWEN_API_KEY（或 DASHSCOPE_API_KEY）放进环境变量后重试');
  if (!Number.isInteger(duration) || duration < MIN_DURATION || duration > MAX_DURATION) {
    throw new Error(`--duration 只能是 ${MIN_DURATION}～${MAX_DURATION} 之间的整数秒`);
  }

  const startedAt = new Date();
  const submit = await fetchImpl(SUBMIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      // Without this header the request is rejected: this endpoint has no synchronous mode.
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: 'wan2.6-i2v-flash',
      input: { prompt, img_url: dataUri(image) },
      parameters: { resolution, duration, audio },
    }),
  });
  const submitted = await submit.json();
  const taskId = submitted?.output?.task_id;
  if (!taskId) {
    throw new Error(`提交失败：${submitted?.message ?? submitted?.code ?? JSON.stringify(submitted).slice(0, 200)}`);
  }
  log(`已提交 ${taskId}`);
  const submittedAtMs = now();

  let polls = 0;
  for (; polls < MAX_POLLS; polls += 1) {
    const answer = await (await fetchImpl(taskUrl(taskId), { headers: { Authorization: `Bearer ${key}` } })).json();
    const verdict = classifyTask(answer?.output);
    if (verdict.state === 'done') {
      const seconds = (now() - submittedAtMs) / 1000;
      log(`完成：${polls + 1} 次轮询，${seconds.toFixed(1)} 秒`);
      return { taskId, polls: polls + 1, seconds, url: verdict.url, submittedAt: startedAt.toISOString(), resolution, duration };
    }
    if (verdict.state === 'failed') throw new Error(`任务失败：${verdict.reason}`);
    if (polls < MAX_POLLS - 1) await sleepImpl(POLL_INTERVAL_MS);
  }
  throw new Error(`等待超时：轮询 ${MAX_POLLS} 次（约 ${(MAX_POLLS * POLL_INTERVAL_MS) / 60000} 分钟）仍未完成`);
}

/** Download the finished file and record what actually came back. */
export async function download(url, outFile, { fetchImpl = fetch } = {}) {
  const bytes = Buffer.from(await (await fetchImpl(url)).arrayBuffer());
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, bytes);
  return { bytes: bytes.length, megabytes: Number((bytes.length / 1024 / 1024).toFixed(2)) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.out ?? path.join('research', 'wan-i2v', 'out');
  const result = await generate({ ...args, log: console.log });
  const file = path.join(outDir, `${path.basename(args.image, path.extname(args.image))}-${result.duration}s.mp4`);
  const file_ = await download(result.url, file);
  const record = {
    run_at: result.submittedAt,
    model: 'wan2.6-i2v-flash',
    input: path.basename(args.image),
    prompt: args.prompt,
    requested: { resolution: result.resolution, duration: result.duration, audio: Boolean(args.audio) },
    outcome: { task_id: result.taskId, polls: result.polls, seconds: Number(result.seconds.toFixed(1)) },
    file: { path: file, bytes: file_.bytes, megabytes: file_.megabytes },
  };
  console.log(JSON.stringify(record, null, 2));
  if (args.log) {
    fs.mkdirSync(path.dirname(args.log), { recursive: true });
    fs.writeFileSync(args.log, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`已写入 ${args.log}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  });
}
