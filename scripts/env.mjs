import path from 'node:path';
import { ROOT } from './avatars.mjs';

process.loadEnvFile(path.join(ROOT, '.env'));

export const env = process.env;

export function requireKey() {
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is empty. Paste your key into .env.');
  return env.OPENROUTER_API_KEY;
}
