# Browser Mascot

A mascot that sits in a corner of every page and reacts to what you are doing.
[Jev](https://openrouter.ai/docs/guides/community/jev), a System One decision
model, picks its mood from a fixed list through OpenRouter.

## Setup

1. Create a file named `.env` in this folder containing `OPENROUTER_API_KEY=` followed by your OpenRouter key.
2. `npm run env` copies it to `extension/env.local.json`, which the extension reads.
3. In `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and pick `extension/`.

After changing `.env`, run `npm run env` again and reload the extension.

## Using it

- The mascot sits on the page itself, pinned to the window. Drag it anywhere;
  it stays there on every tab and page, and snaps to an edge when dropped close
  to one.
- Click the mascot, or the toolbar button, to open its speech bubble: what Jev
  thought, the avatar picker, size, and every pose to try.
- Tabs that were open before the extension loaded get the mascot too.
- Chrome keeps extensions off its own pages, such as a new tab, and off the Web
  Store. There the toolbar button shows the mascot in the toolbar popup.

## How a mood is chosen

`background.js` watches tab switches, page loads, scrolling, and a one-minute
tick. Each one becomes a small state object: site, page title, local time,
minutes on the site, tab switches and screens scrolled in the last minute, open
tabs, and whether audio is playing. It leaves out the mood now showing: told
its last answer, Jev repeats it. `jev.js` sends that state with one Choice
question whose options are the moods in `moods.js`. Jev returns a probability
for each mood. Below 30% the mascot stays idle, and a new mood has to beat the
current one by 10 points.

The site and page title of the active tab leave your machine on every decision.
Page content does not. After two minutes without input and with nothing playing,
the mascot sleeps and no calls are made.

A decision costs about $0.00005. `background.js` stops at 3000 a day, about $0.15.

## Commands

| Command | What it does |
| - | - |
| `npm run env` | Copies the key from `.env` into the extension |
| `npm run ask` | Replays a session of tab switches through Jev and prints each mood, to check `moods.js` after editing it |
| `npm run cut [avatar]` | Cuts `assets/<avatar>/sheet.png` into poses |
| `npm run animate [avatar] -- --only idle,cheering` | Animates poses with a video model; without `--only`, all of them |
| `npm test` | Unit tests |
| `npm run e2e` | Drives the extension in Chrome against a stand-in for Jev |
| `node e2e/live.mjs` | Loads the extension with the real key and prints what Jev decides on a few real pages |

## Animations

`npm run animate` sends each pose to Wan 2.7 as both the first and the last
frame of a 3-second clip on a green background, so the clip loops. It keeps the
clip in `assets/<avatar>/video/`, which git ignores, keys out the green, and writes an animated
WebP to `extension/avatars/<avatar>/anim/`. Wan 2.7 costs $0.10 per second, so
all 20 poses cost about $6. A pose with no animation shows its still image with
a breathing motion.

## Adding an avatar

1. Put a transparent sprite sheet at `assets/<id>/sheet.png`.
2. Write `assets/<id>/sheet.json` like `assets/argus/sheet.json`, naming the
   poses in reading order. A pose is shown for the mood with the same name in
   `extension/moods.js`; Jev is only offered moods the avatar has a pose for.
3. `npm run cut <id>`, then optionally `npm run animate <id>`.

The avatar then appears in the mascot's picker.
