import { emptyActivity, scrolled, summarize, visit } from './activity.js';
import { askJev, buildRequest, pickMood } from './jev.js';
import { ASLEEP, moodLabel } from './moods.js';
import { loadAvatar, loadEnv, loadSettings, saveSettings, today } from './settings.js';

/** Wait this long after an event so a burst of events becomes one decision. */
const DEBOUNCE_MS = 1500;
const MIN_GAP_MS = 5000;
/** Scrolling reports arrive every few seconds; they ask for a decision less often. */
const SCROLL_GAP_MS = 20_000;
const IDLE_SECONDS = 120;
/** Stops a runaway loop from spending money. About $0.15 at Jev's price. */
const MAX_CALLS_PER_DAY = 3000;

let timer = null;
let lastDecisionAt = 0;
let activityQueue = Promise.resolve();

chrome.idle.setDetectionInterval(IDLE_SECONDS);

chrome.runtime.onInstalled.addListener(async () => {
  await saveSettings(await loadSettings());
  startTicking();
  // Chrome only adds the mascot to pages loaded from now on; tabs already open get it here.
  for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
    addMascot(tab.id).catch(() => {});
  }
});
chrome.runtime.onStartup.addListener(startTicking);

// The toolbar button calls the mascot over and opens its panel.
chrome.action.onClicked.addListener(async (tab) => {
  const settings = await loadSettings();
  if (!settings.enabled) await saveSettings({ ...settings, enabled: true });
  const openPanel = () => chrome.tabs.sendMessage(tab.id, { type: 'open-panel' });
  try {
    await openPanel().catch(() => addMascot(tab.id).then(openPanel));
  } catch {
    // Chrome keeps extensions off its own pages and the Web Store, so there
    // the mascot shows in the toolbar popup instead.
    await chrome.action.setPopup({ tabId: tab.id, popup: 'mascot.html' });
    await chrome.action.openPopup();
    await chrome.action.setPopup({ tabId: tab.id, popup: '' });
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) seeTab(tab, 'switched_tab');
});

chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (tab.active && (change.status === 'complete' || change.url)) seeTab(tab, 'opened_page');
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) schedule('switched_window');
});

chrome.alarms.onAlarm.addListener(() => schedule('still_here'));

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === 'active') schedule('came_back');
  else if (await userIsAway()) showMood({ id: ASLEEP });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'preview') showMood({ id: message.id });
  if (message.type !== 'scrolled' || !sender.tab?.active) return;
  updateActivity((activity) => scrolled(activity, message.screens, Date.now()));
  if (Date.now() - lastDecisionAt > SCROLL_GAP_MS) schedule('scrolling');
});

function addMascot(tabId) {
  return chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

function startTicking() {
  chrome.alarms.create('tick', { periodInMinutes: 1 });
}

function seeTab(tab, event) {
  const site = siteOf(tab.url);
  if (!site) return;
  updateActivity((activity) => visit(activity, site, Date.now(), event === 'switched_tab'));
  schedule(event);
}

function schedule(event) {
  clearTimeout(timer);
  const wait = Math.max(DEBOUNCE_MS, lastDecisionAt + MIN_GAP_MS - Date.now());
  timer = setTimeout(() => decide(event).catch(report), wait);
}

async function decide(event) {
  const settings = await loadSettings();
  if (!settings.enabled) return;
  if (await userIsAway()) return showMood({ id: ASLEEP });

  const tab = await activeTab();
  const site = siteOf(tab?.url);
  if (!site) return;

  const env = await loadEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('No OpenRouter key. Add it to .env, run `npm run env`, then reload the extension.');
  }
  const stats = await loadStats();
  if (stats.calls >= MAX_CALLS_PER_DAY) {
    throw new Error(`Reached today's limit of ${MAX_CALLS_PER_DAY} decisions.`);
  }

  lastDecisionAt = Date.now();
  const now = new Date();
  // The state leaves out the mood now showing. Told its last answer, Jev repeats it.
  const state = {
    event,
    site,
    page_title: tab.title,
    local_time: now.toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' }),
    ...summarize(await updateActivity(() => {}), now.getTime()),
    open_tabs: (await chrome.tabs.query({})).length,
    audio_playing: Boolean(tab.audible),
  };

  const avatar = await loadAvatar(settings.avatar);
  const request = buildRequest(state, Object.keys(avatar.poses), env.JEV_MODEL);
  const { answer, cost } = await askJev({ endpoint: env.JEV_ENDPOINT, key: env.OPENROUTER_API_KEY, request });

  const ranked = Object.entries(answer.probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, probability]) => ({ label: moodLabel(id), probability }));
  await chrome.storage.local.set({
    stats: { ...stats, calls: stats.calls + 1, cost: stats.cost + cost },
    lastDecision: { at: Date.now(), state, ranked },
    lastError: null,
  });
  const { mood: showing } = await chrome.storage.local.get('mood');
  await showMood(pickMood(answer, showing?.id));
}

/** No input for a while, unless something is playing: watching a video is not being away. */
async function userIsAway() {
  const state = await chrome.idle.queryState(IDLE_SECONDS);
  if (state === 'active') return false;
  return state === 'locked' || !(await activeTab())?.audible;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

/**
 * Every mascot on every page watches `mood` in storage. `probability` is
 * absent when Jev did not make the call.
 */
function showMood({ id, probability = null }) {
  return chrome.storage.local.set({ mood: { id, label: moodLabel(id), probability, at: Date.now() } });
}

async function loadStats() {
  const { stats } = await chrome.storage.local.get('stats');
  return stats?.day === today() ? stats : { day: today(), calls: 0, cost: 0 };
}

/** Applies `change` to the stored activity, one change at a time, and returns the result. */
function updateActivity(change) {
  const result = activityQueue.then(async () => {
    const { activity = emptyActivity() } = await chrome.storage.session.get('activity');
    change(activity);
    await chrome.storage.session.set({ activity });
    return activity;
  });
  activityQueue = result.catch(() => {});
  return result;
}

function siteOf(url) {
  if (!url?.startsWith('http')) return null;
  return new URL(url).hostname.replace(/^www\./, '');
}

function report(error) {
  console.warn(error);
  chrome.storage.local.set({ lastError: { at: Date.now(), message: error.message } });
}
