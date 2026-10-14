// Turns still poses into looping animations.
//
//   node scripts/animate.mjs [avatar] [--only idle,cheering] [--seconds 3]
//
// Each pose is sent to a video model as both the first and the last frame, on
// a green background, so the clip loops. The clip is saved to
// assets/<avatar>/video/<pose>.mp4, then the green is keyed out and the frames
// become extension/avatars/<avatar>/anim/<pose>.webp. A pose that already has
// an .mp4 is only keyed again, which costs nothing; delete the .mp4 to
// generate it again.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';
import { avatarPaths } from './avatars.mjs';
import { env, requireKey } from './env.mjs';

const API = 'https://openrouter.ai/api/v1/videos';
const FRAME = 720;
const GREEN = { r: 0, g: 255, b: 0 };
const FPS = 15;
const POLL_MS = 10_000;
const TIMEOUT_MS = 20 * 60_000;
const AT_ONCE = 4;
/** How much greener than red and blue a pixel is where it starts to fade, and where it is gone. */
const KEY = { from: 24, to: 80 };
/** The video model's first frames have speckled noise in the background. */
const NOISY_FRAMES = 2;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { only: { type: 'string' }, seconds: { type: 'string', default: '3' } },
});
const avatarId = positionals[0] ?? 'argus';
const seconds = Number(values.seconds);
const model = env.VIDEO_MODEL ?? 'alibaba/wan-2.7';
const paths = avatarPaths(avatarId);
const sheet = JSON.parse(readFileSync(paths.sheetJson, 'utf8'));
const avatar = JSON.parse(readFileSync(paths.avatarJson, 'utf8'));
mkdirSync(paths.video, { recursive: true });
mkdirSync(paths.anim, { recursive: true });

const only = values.only?.split(',');
const unknown = only?.filter((name) => !sheet.poses.some((pose) => pose.name === name)) ?? [];
if (unknown.length) throw new Error(`${paths.sheetJson} has no pose named ${unknown.join(', ')}`);
const poses = sheet.poses.filter((pose) => !only || only.includes(pose.name));
const clip = (pose) => path.join(paths.video, `${pose.name}.mp4`);

const toGenerate = poses.filter((pose) => !existsSync(clip(pose)));
if (toGenerate.length) {
  const perSecond = await pricePerSecond();
  const estimate = perSecond ? ` About $${(toGenerate.length * seconds * perSecond).toFixed(2)}.` : '';
  console.log(`Generating ${toGenerate.length} clips of ${seconds} s with ${model}.${estimate}`);
}

const queue = [...poses];
const failures = [];
await Promise.all(
  Array.from({ length: AT_ONCE }, async () => {
    for (let pose = queue.shift(); pose; pose = queue.shift()) {
      try {
        if (!existsSync(clip(pose))) await generate(pose);
        const file = await keyOut(pose);
        avatar.poses[pose.name].anim = file;
        console.log(`  ${pose.name}: ${file}`);
      } catch (error) {
        failures.push(pose.name);
        console.error(`  ${pose.name}: ${error.message}`);
      }
    }
  }),
);
writeFileSync(paths.avatarJson, `${JSON.stringify(avatar, null, 2)}\n`);
if (failures.length) {
  console.error(`\nFailed: ${failures.join(', ')}. Run again with --only ${failures.join(',')}`);
  process.exitCode = 1;
}

async function pricePerSecond() {
  const { data } = await (await fetch(`${API}/models`)).json();
  const listed = data.find((entry) => entry.id === model);
  if (!listed) throw new Error(`OpenRouter lists no video model named ${model}`);
  return Number(listed.pricing_skus?.duration_seconds) || null;
}

/** Asks the video model for a clip that starts and ends on the pose, and saves it. */
async function generate(pose) {
  const headers = { Authorization: `Bearer ${requireKey()}`, 'Content-Type': 'application/json' };
  const still = await sharp(path.join(paths.out, avatar.poses[pose.name].file))
    .resize(FRAME, FRAME)
    .flatten({ background: GREEN })
    .png()
    .toBuffer();
  const frame = (frame_type) => ({
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${still.toString('base64')}` },
    frame_type,
  });
  const prompt =
    `${sheet.description}. It ${pose.motion}. It stays in the same spot at the same size, ` +
    'and ends in exactly the pose it started in so the clip loops. Locked-off static camera, no zoom. ' +
    'The background is a flat, uniform, pure chroma-key green screen with no floor, no shadow, and nothing else in frame.';

  const submitted = await api(API, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      prompt,
      duration: seconds,
      size: `${FRAME}x${FRAME}`,
      generate_audio: false,
      frame_images: [frame('first_frame'), frame('last_frame')],
    }),
  });

  const deadline = Date.now() + TIMEOUT_MS;
  let job = submitted;
  while (job.status !== 'completed') {
    if (['failed', 'cancelled', 'expired'].includes(job.status)) {
      throw new Error(`video ${job.status}: ${JSON.stringify(job.error ?? job)}`);
    }
    if (Date.now() > deadline) throw new Error(`video ${submitted.id} still ${job.status} after 20 minutes`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    job = await api(new URL(submitted.polling_url, API), { headers });
  }

  const video = await fetch(new URL(job.unsigned_urls[0], API), { headers });
  if (!video.ok) throw new Error(`downloading the video: ${video.status}`);
  writeFileSync(clip(pose), Buffer.from(await video.arrayBuffer()));
}

async function api(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status} ${body?.error?.message ?? JSON.stringify(body)}`);
  return body;
}

/** Decodes the clip, makes its green background transparent, and writes an animated WebP. */
async function keyOut(pose) {
  const { stdout: raw } = await promisify(execFile)(
    ffmpeg,
    ['-v', 'error', '-i', clip(pose), '-vf', `fps=${FPS},scale=${FRAME}:${FRAME}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { encoding: 'buffer', maxBuffer: 2 ** 31 - 1 },
  );
  const frameBytes = FRAME * FRAME * 4;
  const decoded = Math.floor(raw.length / frameBytes);
  if (decoded <= NOISY_FRAMES + 2) throw new Error(`${clip(pose)} decoded to ${decoded} frames`);
  // The loop runs from after the noisy opening to the last frame, which shows the first pose again.
  const loop = raw.subarray(NOISY_FRAMES * frameBytes, decoded * frameBytes);
  const frameCount = decoded - NOISY_FRAMES;

  for (let offset = 0; offset < loop.length; offset += 4) {
    const red = loop[offset];
    const green = loop[offset + 1];
    const blue = loop[offset + 2];
    const other = Math.max(red, blue);
    const excess = green - other;
    if (excess <= 0) continue;
    loop[offset + 1] = other;
    const keep = 1 - Math.min(1, Math.max(0, (excess - KEY.from) / (KEY.to - KEY.from)));
    loop[offset + 3] = Math.round(255 * keep);
  }

  const frames = await Promise.all(
    Array.from({ length: frameCount }, (_, index) =>
      sharp(loop.subarray(index * frameBytes, (index + 1) * frameBytes), {
        raw: { width: FRAME, height: FRAME, channels: 4 },
      })
        .resize(avatar.size, avatar.size)
        .png()
        .toBuffer(),
    ),
  );
  const file = `anim/${pose.name}.webp`;
  await sharp(frames, { join: { animated: true } })
    .webp({ quality: 80, alphaQuality: 90, loop: 0, delay: frames.map(() => Math.round(1000 / FPS)) })
    .toFile(path.join(paths.out, file));
  return file;
}
