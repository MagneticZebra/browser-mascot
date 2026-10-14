// Cuts assets/<avatar>/sheet.png into one square PNG per pose.
//
//   node scripts/cut-sprites.mjs [avatar]
//
// Poses are found by their alpha channel, not by a grid: each large opaque
// blob is a body, and loose marks (sparkles, "Zz", "?") join the nearest body.
// assets/<avatar>/sheet.json names the poses in reading order.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, avatarPaths, registerAvatar } from './avatars.mjs';

const ALPHA_MIN = 24;
const SPECK_AREA = 12;
const PADDING = 6;
const ICON_SIZES = [16, 32, 48, 128];

const avatarId = process.argv[2] ?? 'argus';
const paths = avatarPaths(avatarId);
const sheet = JSON.parse(readFileSync(paths.sheetJson, 'utf8'));

const { data, info } = await sharp(paths.sheetPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;

const blobs = findBlobs(data, width, height);
const largest = Math.max(...blobs.map((blob) => blob.area));
const bodies = blobs.filter((blob) => blob.area >= largest * 0.25);
if (bodies.length !== sheet.poses.length) {
  throw new Error(`${paths.sheetJson} names ${sheet.poses.length} poses but the sheet has ${bodies.length} bodies`);
}

const sprites = inReadingOrder(bodies).map((body) => ({ body, parts: [body] }));
for (const blob of blobs) {
  if (bodies.includes(blob) || blob.area < SPECK_AREA) continue;
  nearest(sprites, blob).parts.push(blob);
}

// Every pose lands on the same canvas with its body centred on the same
// baseline, so the mascot does not jump when it changes pose.
let halfWidth = 0;
let above = 0;
let below = 0;
for (const sprite of sprites) {
  sprite.box = union(sprite.parts);
  const centre = (sprite.body.x0 + sprite.body.x1) / 2;
  halfWidth = Math.max(halfWidth, centre - sprite.box.x0, sprite.box.x1 - centre);
  above = Math.max(above, sprite.body.y1 - sprite.box.y0);
  below = Math.max(below, sprite.box.y1 - sprite.body.y1);
}
const size = 2 * Math.ceil((Math.max(2 * halfWidth, above + below) + 2 * PADDING) / 2);
const baseline = size - PADDING - Math.ceil(below);

rmSync(paths.poses, { recursive: true, force: true });
mkdirSync(paths.poses, { recursive: true });

const poses = {};
for (const [index, sprite] of sprites.entries()) {
  const pose = sheet.poses[index];
  const { box, body } = sprite;
  const cropWidth = box.x1 - box.x0;
  const cropHeight = box.y1 - box.y0;
  const crop = Buffer.alloc(cropWidth * cropHeight * 4);
  for (const part of sprite.parts) {
    for (const pixel of part.pixels) {
      const x = (pixel % width) - box.x0;
      const y = Math.floor(pixel / width) - box.y0;
      data.copy(crop, (y * cropWidth + x) * 4, pixel * 4, pixel * 4 + 4);
    }
  }
  const left = Math.round(size / 2 - ((body.x0 + body.x1) / 2 - box.x0));
  const top = baseline - (body.y1 - box.y0);
  const file = `poses/${pose.name}.png`;
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: crop, raw: { width: cropWidth, height: cropHeight, channels: 4 }, left, top }])
    .png()
    .toFile(path.join(paths.out, file));
  poses[pose.name] = { file, box: [left, top, left + cropWidth, top + cropHeight] };
  if (pose.edge) poses[pose.name].edge = pose.edge;
  if (existsSync(path.join(paths.anim, `${pose.name}.webp`))) poses[pose.name].anim = `anim/${pose.name}.webp`;
}

writeFileSync(
  paths.avatarJson,
  `${JSON.stringify({ id: sheet.id, name: sheet.name, size, poses }, null, 2)}\n`,
);
registerAvatar(sheet.id, sheet.name);

if (avatarId === 'argus') {
  const icons = path.join(ROOT, 'extension', 'icons');
  mkdirSync(icons, { recursive: true });
  const [x0, y0, x1, y1] = poses.idle.box;
  const side = Math.max(x1 - x0, y1 - y0);
  const idle = await sharp(path.join(paths.out, poses.idle.file))
    .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .resize(side, side, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  for (const px of ICON_SIZES) {
    await sharp(idle).resize(px, px).png().toFile(path.join(icons, `icon-${px}.png`));
  }
}

console.log(`${sheet.name}: ${sprites.length} poses at ${size}x${size} -> ${path.relative(ROOT, paths.out)}`);

/** Connected regions of visible pixels, 8-connected. */
function findBlobs(rgba, w, h) {
  const seen = new Uint8Array(w * h);
  const visible = (pixel) => rgba[pixel * 4 + 3] >= ALPHA_MIN;
  const found = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !visible(start)) continue;
    const pixels = [start];
    seen[start] = 1;
    const blob = { x0: w, y0: h, x1: 0, y1: 0, pixels };
    for (let head = 0; head < pixels.length; head++) {
      const x = pixels[head] % w;
      const y = Math.floor(pixels[head] / w);
      blob.x0 = Math.min(blob.x0, x);
      blob.y0 = Math.min(blob.y0, y);
      blob.x1 = Math.max(blob.x1, x + 1);
      blob.y1 = Math.max(blob.y1, y + 1);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const next = ny * w + nx;
          if (seen[next] || !visible(next)) continue;
          seen[next] = 1;
          pixels.push(next);
        }
      }
    }
    blob.area = pixels.length;
    found.push(blob);
  }
  return found;
}

function inReadingOrder(bodies) {
  const byY = [...bodies].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
  const rows = [];
  for (const body of byY) {
    const row = rows.at(-1);
    const centre = (body.y0 + body.y1) / 2;
    if (row && centre < row.bottom) row.bodies.push(body);
    else rows.push({ bottom: body.y1, bodies: [body] });
  }
  return rows.flatMap((row) => row.bodies.sort((a, b) => a.x0 - b.x0));
}

function nearest(sprites, blob) {
  const gap = (a, b) =>
    Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1));
  return sprites.reduce((best, sprite) => (gap(sprite.body, blob) < gap(best.body, blob) ? sprite : best));
}

function union(parts) {
  return {
    x0: Math.min(...parts.map((part) => part.x0)),
    y0: Math.min(...parts.map((part) => part.y0)),
    x1: Math.max(...parts.map((part) => part.x1)),
    y1: Math.max(...parts.map((part) => part.y1)),
  };
}
