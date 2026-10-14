// Replays a session of tab switches through Jev, with the request and the
// rules the extension uses, and prints the mood after each one. Run it after
// editing the criteria in extension/moods.js: a healthy run changes mood on
// most switches and uses many different moods.
//
//   node scripts/ask-jev.mjs

import { readFileSync } from 'node:fs';
import { askJev, buildRequest, pickMood } from '../extension/jev.js';
import { avatarPaths } from './avatars.mjs';
import { env, requireKey } from './env.mjs';

const tabs = [
  ['mail.google.com', 'Inbox (12) - you@example.com - Gmail'],
  ['github.com', 'robert/browser-mascot: A mascot that reacts to what you do'],
  ['youtube.com', 'YouTube'],
  ['youtube.com', 'Lofi hip hop radio - beats to relax/study to - YouTube', { audio_playing: true }],
  ['x.com', 'Home / X'],
  ['reddit.com', 'Reddit - The heart of the internet', { minutes_on_site: 41, screens_scrolled_last_minute: 14 }],
  ['google.com', 'best mechanical keyboard 2026 - Google Search'],
  ['amazon.ca', 'Amazon.ca Shopping Cart'],
  ['news.ycombinator.com', 'Hacker News'],
  ['claude.ai', 'Claude'],
  ['linkedin.com', 'Feed | LinkedIn'],
  ['docs.google.com', 'Q4 planning - Google Docs', { minutes_on_site: 18, tab_switches_last_minute: 0 }],
  ['netflix.com', 'Home - Netflix'],
  ['calendar.google.com', 'Google Calendar - Week of October 12, 2026'],
  ['nytimes.com', 'The New York Times - Breaking News, US News, World News and Videos'],
  ['easyweb.td.com', 'EasyWeb'],
  ['open.spotify.com', 'Spotify - Web Player: Music for everyone'],
  ['stackoverflow.com', 'javascript - How do I return the response from an asynchronous call? - Stack Overflow'],
  ['ubereats.com', 'Order Food Online | Food Delivery App | Uber Eats'],
  ['openrouter.ai', 'Activity | OpenRouter'],
  ['github.com', 'Pull requests · robert/browser-mascot'],
  ['wikipedia.org', 'Jevons paradox - Wikipedia'],
];

const key = requireKey();
const poseNames = Object.keys(JSON.parse(readFileSync(avatarPaths('argus').avatarJson, 'utf8')).poses);
const seen = new Set();
let showing = 'idle';
let changes = 0;
let spent = 0;
for (const [site, page_title, extra] of tabs) {
  const state = {
    event: 'switched_tab',
    site,
    page_title,
    local_time: 'Tuesday 21:30',
    minutes_on_site: 0,
    tab_switches_last_minute: 3,
    screens_scrolled_last_minute: 0,
    open_tabs: 22,
    audio_playing: false,
    ...extra,
  };
  const { answer, cost } = await askJev({ key, request: buildRequest(state, poseNames, env.JEV_MODEL) });
  spent += cost;
  const next = pickMood(answer, showing).id;
  const top = Object.entries(answer.probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, probability]) => `${id} ${Math.round(probability * 100)}%`)
    .join(', ');
  console.log(`${site.padEnd(22)} ${next === showing ? '   ' : '-> '}${next.padEnd(10)} (${top})`);
  if (next !== showing) changes += 1;
  showing = next;
  seen.add(next);
}
console.log(`\nThe mood changed on ${changes} of ${tabs.length} switches and used ${seen.size} moods. Cost $${spent.toFixed(6)}.`);
