// Drives the extension in Chrome for Testing against a stand-in for Jev.
//
//   node e2e/run.mjs
//
// Screenshots land in e2e/artifacts/.

import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ARTIFACTS = path.join(ROOT, 'e2e', 'artifacts');
const SLACK_MS = 15_000;
mkdirSync(ARTIFACTS, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, label);
  console.log(`  ok  ${label}`);
}

async function until(label, probe, timeoutMs = SLACK_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(100);
  }
}

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

/** Answers like Jev, choosing the mood from the page title. */
async function serveJev() {
  const requests = [];
  const { server, origin } = await listen(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', 'authorization, content-type');
    if (request.method === 'OPTIONS') return response.end();
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    requests.push({ authorization: request.headers.authorization, body });

    const title = body.state.page_title;
    const choice = title.includes('Merged') ? 'cheering' : title.includes('Login') ? 'peeking' : 'idle';
    const probabilities = Object.fromEntries(Object.keys(body.questions.mood.criteria).map((id) => [id, 0]));
    Object.assign(probabilities, { curious: 0.09, grumpy: 0.05, [choice]: 0.86 });
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        id: 'gen-dec-test',
        model: body.model,
        provider: 'TypeSafe',
        answers: { mood: { type: 'choice', choice, confidence: 0.8, probabilities } },
        usage: { input_tokens: 700, output_tokens: 40, cost: 0.00003 },
      }),
    );
  });
  return { requests, endpoint: `${origin}/api/alpha/decisions`, close: () => server.close() };
}

/** A site whose every page takes its title from the `title` query parameter. */
async function serveSite() {
  const { server, origin } = await listen((request, response) => {
    const title = (new URL(request.url, origin).searchParams.get('title') ?? '').replace(/[<&]/g, '');
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><title>${title}</title><body style="height:6000px;font:20px system-ui"><h1>${title}</h1>`);
  });
  return { page: (title) => `${origin}/?title=${encodeURIComponent(title)}`, close: () => server.close() };
}

/** What the mascot on `page` looks like right now, or null when there is none. */
const mascot = (page) =>
  page.evaluate(() => {
    const host = document.querySelector('[data-browser-mascot]');
    if (!host) return null;
    const root = host.shadowRoot;
    const box = host.getBoundingClientRect();
    return {
      pose: root.querySelector('.figure img').src.split('/').pop().split('.')[0],
      label: root.querySelector('.label').textContent,
      near: `${box.top < innerHeight / 2 ? 'top' : 'bottom'}-${box.left < innerWidth / 2 ? 'left' : 'right'}`,
      box: { left: Math.round(box.left), top: Math.round(box.top), right: Math.round(box.right), bottom: Math.round(box.bottom) },
      figure: { left: root.querySelector('.figure').getBoundingClientRect().left, width: root.querySelector('.figure').offsetWidth },
      flipped: root.querySelector('.figure').classList.contains('flip'),
      marked: 'marked' in host.dataset,
      panelOpen: !root.querySelector('.panel').hidden,
      title: root.querySelector('.panel strong').textContent,
      bars: [...root.querySelectorAll('.bar')].map((bar) => bar.textContent),
      avatars: [...root.querySelectorAll('.avatars button')].map((tile) => `${tile.textContent}:${tile.ariaPressed}`),
      poseTiles: root.querySelectorAll('.tiles:not(.avatars) button').length,
      spend: root.querySelector('.spend').textContent,
    };
  });

/** Where on screen an element inside the mascot is. */
const centreOf = (page, selector) =>
  page.evaluate((inner) => {
    const box = document.querySelector('[data-browser-mascot]').shadowRoot.querySelector(inner).getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, selector);

async function clickInside(page, selector) {
  const { x, y } = await centreOf(page, selector);
  await page.mouse.click(x, y);
}

const jev = await serveJev();
const site = await serveSite();
const extensionDirectory = mkdtempSync(path.join(tmpdir(), 'browser-mascot-ext-'));
cpSync(path.join(ROOT, 'extension'), extensionDirectory, { recursive: true });
writeFileSync(
  path.join(extensionDirectory, 'env.local.json'),
  JSON.stringify({ OPENROUTER_API_KEY: 'test-key', JEV_ENDPOINT: jev.endpoint }),
);

const browser = await puppeteer.launch({
  headless: true,
  userDataDir: mkdtempSync(path.join(tmpdir(), 'browser-mascot-profile-')),
  enableExtensions: [extensionDirectory],
  defaultViewport: { width: 1280, height: 800 },
  args: ['--lang=en-US'],
});

try {
  const worker = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'),
    { timeout: SLACK_MS },
  );
  const extensionId = new URL(worker.url()).host;
  // Nobody is at this machine's keyboard, and Chrome would report that.
  await (await worker.worker()).evaluate(() => {
    chrome.idle.queryState = async () => 'active';
  });
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));

  console.log('a page gets a mascot, and Jev is asked about it');
  await page.goto(site.page('Hello'));
  await until('the mascot to appear', () => mascot(page));
  await until('the first decision', async () => (await mascot(page)).label === 'hanging out · 86%');
  const [first] = jev.requests;
  check('the key from .env authorises the call', first.authorization, 'Bearer test-key');
  check('the request names the model', first.body.model, 'typesafe/jev-1.13');
  check('the state says where the user is', [first.body.state.site, first.body.state.page_title], ['127.0.0.1', 'Hello']);
  check('Jev chooses between the 18 moods it can judge', Object.keys(first.body.questions.mood.criteria).length, 18);
  check('the state is the browsing facts, without the mood now showing', Object.keys(first.body.state).sort(), [
    'audio_playing',
    'event',
    'local_time',
    'minutes_on_site',
    'open_tabs',
    'page_title',
    'screens_scrolled_last_minute',
    'site',
    'tab_switches_last_minute',
  ]);
  check('the mascot sits bottom right, idle', pick(await mascot(page), 'pose', 'near'), {
    pose: 'idle',
    near: 'bottom-right',
  });

  console.log('the mood follows what Jev says about the page');
  await page.goto(site.page('Fix race by robert · Pull Request #42 · Merged'));
  await until('the mascot to cheer', async () => (await mascot(page))?.pose === 'cheering');
  check('hovering shows the mood and its probability', (await mascot(page)).label, 'cheering · 86%');
  await page.screenshot({ path: path.join(ARTIFACTS, '1-cheering.png') });

  console.log('clicking the mascot opens its panel');
  await clickInside(page, '.figure img');
  await until('the panel to open', async () => (await mascot(page)).panelOpen);
  await sleep(400);
  const open = await mascot(page);
  check('the panel says what the mascot is doing', open.title, 'Argus is cheering');
  check('the panel ranks what Jev thought', open.bars, ['cheering86%', 'curious9%', 'grumpy5%']);
  check('Argus is the one avatar, selected', open.avatars, ['Argus:true']);
  check('every pose can be tried', open.poseTiles, 20);
  check('the panel counts today\'s spend', open.spend, `${jev.requests.length} decisions today · $${(jev.requests.length * 0.00003).toFixed(4)}`);
  await page.screenshot({ path: path.join(ARTIFACTS, '2-panel.png') });

  console.log('trying a pose shows it everywhere');
  await clickInside(page, '.tiles button[title="cool"]');
  await until('the sunglasses', async () => (await mascot(page)).pose === 'cool');
  check('a pose Jev did not pick has no probability', (await mascot(page)).label, 'in the zone');

  console.log('the size slider resizes the mascot');
  await page.evaluate(() => {
    const slider = document.querySelector('[data-browser-mascot]').shadowRoot.querySelector('input[type="range"]');
    slider.value = '200';
    slider.dispatchEvent(new Event('input'));
  });
  check('the mascot is 200 px wide', await page.evaluate(() => document.querySelector('[data-browser-mascot]').shadowRoot.querySelector('.mascot').offsetWidth), 200);
  check('the panel stays open while resizing', (await mascot(page)).panelOpen, true);

  console.log('dragging pins the mascot wherever it is dropped');
  const storedPosition = async () =>
    (await worker.worker()).evaluate(async () => (await chrome.storage.local.get('settings')).settings.position);
  const drag = async (dx, dy) => {
    const from = await centreOf(page, '.figure img');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
    await page.mouse.up();
  };
  const home = (await mascot(page)).box;
  check('it starts in the bottom right corner', [home.right, home.bottom], [1280, 800]);
  await drag(-880, -480);
  const dropped = { left: home.left - 880, top: home.top - 480, right: home.right - 880, bottom: home.bottom - 480 };
  await until('the mascot to stay where it was dropped', async () => (await mascot(page)).box.left === dropped.left);
  check('it sits exactly where it was dropped', (await mascot(page)).box, dropped);
  check('dragging closes the panel rather than opening it', (await mascot(page)).panelOpen, false);
  check('the spot is stored as distances from the nearest edges', await storedPosition(), {
    side: 'left',
    x: dropped.left,
    vertical: 'top',
    y: dropped.top,
  });
  await page.mouse.click(900, 600);
  await page.mouse.wheel({ deltaY: 1500 });
  await sleep(300);
  check('clicking and scrolling the page leave it pinned in place', (await mascot(page)).box, dropped);

  console.log('a pose drawn against an edge scurries to that edge');
  await page.goto(site.page('EasyWeb Login'));
  await until('the mascot to peek', async () => (await mascot(page))?.pose === 'peeking');
  await sleep(600);
  const peeking = await mascot(page);
  check('a new page keeps the spot', peeking.box, dropped);
  const peek = JSON.parse(readFileSync(path.join(ROOT, 'extension/avatars/argus/avatar.json'), 'utf8'));
  const gap = ((peek.size - peek.poses.peeking.box[2]) / peek.size) * peeking.figure.width;
  check('mirrored, its flat edge meets the left edge of the window', [peeking.flipped, Math.round(peeking.figure.left + gap)], [true, 0]);
  await page.screenshot({ path: path.join(ARTIFACTS, '3-peeking-left-edge.png') });

  console.log('dropped near an edge, the mascot snaps to it');
  await drag(-(dropped.left - 9), 300);
  await until('the mascot to snap', async () => (await mascot(page)).box.left === 0);
  check('the stored spot is flush with the left edge', await storedPosition(), { side: 'left', x: 0, vertical: 'bottom', y: 800 - dropped.bottom - 300 });

  console.log('a window too small for the spot pulls the mascot back into view');
  await page.setViewport({ width: 600, height: 300 });
  await until('the mascot to fit', async () => (await mascot(page)).box.bottom <= 300 && (await mascot(page)).box.top >= 0);
  await page.setViewport({ width: 1280, height: 800 });
  await until('the mascot to return', async () => (await mascot(page)).box.bottom === dropped.bottom + 300);

  console.log('scrolling is reported to Jev');
  // Scrolling alone asks for a decision at most every 20 seconds.
  let wheels = 0;
  const scrolling = await until(
    'a decision about scrolling',
    async () => {
      await page.mouse.wheel({ deltaY: wheels++ % 2 ? -3000 : 3000 });
      return jev.requests.find(({ body }) => body.state.event === 'scrolling');
    },
    40_000,
  );
  check('the state counts the screens scrolled', scrolling.body.state.screens_scrolled_last_minute >= 5, true);
  check('the mascot survives scrolling', (await mascot(page)) !== null, true);

  console.log('Hide me removes the mascot; the toolbar button brings it back with its panel');
  await clickInside(page, '.figure img');
  await until('the panel to open', async () => (await mascot(page)).panelOpen);
  await page.evaluate(() => document.querySelector('[data-browser-mascot]').shadowRoot.querySelector('.hide').click());
  await until('the mascot to go', async () => (await mascot(page)) === null);
  const extension = (await browser.extensions()).get(extensionId);
  await page.triggerExtensionAction(extension);
  await until('the mascot to come back', async () => (await mascot(page))?.panelOpen);

  console.log('where Chrome keeps extensions off the page, the toolbar button shows the mascot in its popup');
  const restricted = await browser.newPage();
  await restricted.goto('chrome://version');
  await restricted.triggerExtensionAction(extension);
  const popup = await browser.waitForTarget((target) => target.url().endsWith('/mascot.html'), { timeout: SLACK_MS });
  const popupPage = await popup.asPage();
  await until('the mascot in the popup', async () => (await mascot(popupPage))?.panelOpen);
  await sleep(400);
  await popupPage.screenshot({ path: path.join(ARTIFACTS, '4-toolbar-popup.png') });
  await restricted.close();

  console.log('tabs that were open before the extension loaded get a mascot too');
  const late = await puppeteer.launch({
    headless: true,
    userDataDir: mkdtempSync(path.join(tmpdir(), 'browser-mascot-profile-')),
    enableExtensions: true,
    defaultViewport: { width: 1280, height: 800 },
  });
  try {
    const already = await late.newPage();
    await already.goto(site.page('Open before the extension'));
    check('no extension, no mascot', await mascot(already), null);
    const installed = await late.installExtension(extensionDirectory);
    await until('the open tab to get a mascot', () => mascot(already));
    await clickInside(already, '.figure img');
    await until('that mascot to answer a click', async () => (await mascot(already)).panelOpen);
    await already.screenshot({ path: path.join(ARTIFACTS, '5-tab-open-before-install.png') });

    // Reloading the extension orphans the mascots it drew; each tab needs exactly one live one back.
    await already.evaluate(() => {
      document.querySelector('[data-browser-mascot]').dataset.marked = '';
    });
    await late.uninstallExtension(installed);
    await late.installExtension(extensionDirectory);
    await until('a fresh mascot to replace the dead one', async () => {
      const hosts = await already.evaluate(() => document.querySelectorAll('[data-browser-mascot]').length);
      return hosts === 1 && (await mascot(already)).marked === false;
    });
    await clickInside(already, '.figure img');
    await until('the fresh mascot to answer a click', async () => (await mascot(already)).panelOpen);
  } finally {
    await late.close();
  }

  check('no page errors', problems, []);
  console.log('\nall checks passed');
} catch (error) {
  // What the extension believed when a check failed.
  const target = browser.targets().find((candidate) => candidate.type() === 'service_worker');
  const worker = await target?.worker();
  const storage = await Promise.race([worker?.evaluate(() => chrome.storage.local.get()), sleep(3000)]).catch(() => null);
  console.error('storage:', JSON.stringify(storage, null, 2));
  console.error('requests to Jev:', jev.requests.length);
  throw error;
} finally {
  await browser.close();
  jev.close();
  site.close();
}

function pick(object, ...keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key]]));
}
