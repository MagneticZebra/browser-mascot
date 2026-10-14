// Loads the real extension with the real key and shows what Jev decides on a
// few real pages. Costs a fraction of a cent.
//
//   node e2e/live.mjs

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGES = [
  'https://en.wikipedia.org/wiki/William_Stanley_Jevons',
  'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array',
  'https://www.allrecipes.com/',
];

const browser = await puppeteer.launch({
  headless: true,
  userDataDir: mkdtempSync(path.join(tmpdir(), 'browser-mascot-live-')),
  enableExtensions: [path.join(ROOT, 'extension')],
  defaultViewport: { width: 1280, height: 800 },
});
try {
  const target = await browser.waitForTarget((candidate) => candidate.type() === 'service_worker');
  const worker = await target.worker();
  await worker.evaluate(() => {
    chrome.idle.queryState = async () => 'active';
  });
  const page = await browser.newPage();
  for (const url of PAGES) {
    const before = await worker.evaluate(async () => (await chrome.storage.local.get('lastDecision')).lastDecision?.at ?? 0);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 30_000;
    let stored;
    do {
      await new Promise((resolve) => setTimeout(resolve, 500));
      stored = await worker.evaluate(() => chrome.storage.local.get(['lastDecision', 'lastError', 'mood', 'stats']));
    } while (!stored.lastError && !(stored.lastDecision?.at > before) && Date.now() < deadline);
    const shown = await page.evaluate(() => document.querySelector('[data-browser-mascot]')?.shadowRoot.querySelector('.figure img').src.split('/avatars/')[1] ?? null);
    const ranked = stored.lastDecision?.ranked.map(({ label, probability }) => `${label} ${Math.round(probability * 100)}%`).join(', ');
    console.log(`${new URL(url).hostname}\n  mood: ${stored.mood?.label}  (${ranked})\n  drawn: ${shown}\n  error: ${stored.lastError?.message ?? 'none'}  spent today: $${stored.stats?.cost.toFixed(6)}`);
  }
  await page.screenshot({ path: path.join(ROOT, 'e2e', 'artifacts', 'live.png') });
} finally {
  await browser.close();
}
