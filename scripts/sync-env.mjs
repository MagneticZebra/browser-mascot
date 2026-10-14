// Copies what the extension needs from .env into extension/env.local.json.
// An extension cannot read .env, so run this after editing it, then reload
// the extension.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './avatars.mjs';
import { env } from './env.mjs';

const { OPENROUTER_API_KEY = '', JEV_MODEL } = env;
writeFileSync(
  path.join(ROOT, 'extension', 'env.local.json'),
  `${JSON.stringify({ OPENROUTER_API_KEY, JEV_MODEL }, null, 2)}\n`,
);
console.log(OPENROUTER_API_KEY ? 'Copied the key into the extension.' : 'No key in .env yet; the mascot will stay idle.');
