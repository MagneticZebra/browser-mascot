import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyActivity, scrolled, summarize, visit } from '../extension/activity.js';

const MINUTE = 60_000;

test('time on a site counts from when it became the active site', () => {
  const activity = emptyActivity();
  visit(activity, 'reddit.com', 0, true);
  visit(activity, 'reddit.com', 10 * MINUTE, false);
  assert.equal(summarize(activity, 41 * MINUTE).minutes_on_site, 41);
});

test('a short detour to another site does not restart the clock, a long one does', () => {
  const activity = emptyActivity();
  visit(activity, 'reddit.com', 0, true);
  visit(activity, 'github.com', 30 * MINUTE, true);
  visit(activity, 'reddit.com', 31 * MINUTE, true);
  assert.equal(summarize(activity, 40 * MINUTE).minutes_on_site, 40);

  visit(activity, 'github.com', 50 * MINUTE, true);
  visit(activity, 'reddit.com', 55 * MINUTE, true);
  assert.equal(summarize(activity, 58 * MINUTE).minutes_on_site, 3);
});

test('tab switches and scrolling are counted over the last minute only', () => {
  const activity = emptyActivity();
  visit(activity, 'a.com', 0, true);
  visit(activity, 'b.com', 10_000, true);
  visit(activity, 'b.com', 20_000, false);
  scrolled(activity, 3.4, 15_000);
  scrolled(activity, 2.2, 50_000);
  assert.deepEqual(summarize(activity, 55_000), {
    minutes_on_site: 0,
    tab_switches_last_minute: 2,
    screens_scrolled_last_minute: 6,
  });
  assert.deepEqual(summarize(activity, 100_000), {
    minutes_on_site: 1,
    tab_switches_last_minute: 0,
    screens_scrolled_last_minute: 2,
  });
});
