import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INDEX = path.join(ROOT, 'extension', 'avatars', 'index.json');

export function avatarPaths(id) {
  const source = path.join(ROOT, 'assets', id);
  const out = path.join(ROOT, 'extension', 'avatars', id);
  return {
    sheetPng: path.join(source, 'sheet.png'),
    sheetJson: path.join(source, 'sheet.json'),
    video: path.join(source, 'video'),
    out,
    poses: path.join(out, 'poses'),
    anim: path.join(out, 'anim'),
    avatarJson: path.join(out, 'avatar.json'),
  };
}

/** Adds the avatar to the list the options page offers. */
export function registerAvatar(id, name) {
  const avatars = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : [];
  const at = avatars.findIndex((avatar) => avatar.id === id);
  avatars[at === -1 ? avatars.length : at] = { id, name };
  writeFileSync(INDEX, `${JSON.stringify(avatars, null, 2)}\n`);
}
