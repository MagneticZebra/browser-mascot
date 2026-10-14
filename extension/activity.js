const MINUTE = 60_000;
/** How many sites keep their clock running through a short detour. */
const REMEMBERED_SITES = 6;
/** Leaving a site for less than this does not restart its clock. */
const SHORT_DETOUR = 2 * MINUTE;

export const emptyActivity = () => ({ site: null, visits: [], switches: [], scrolls: [] });

/** The active tab now shows `site`. `switchedTab` is false for a navigation within the tab. */
export function visit(activity, site, now, switchedTab) {
  if (switchedTab) activity.switches = [...lastMinute(activity.switches, now, (at) => at), now];
  if (site === activity.site) return;

  const leaving = activity.visits.find((entry) => entry.site === activity.site);
  if (leaving) leaving.left = now;

  const before = activity.visits.find((entry) => entry.site === site);
  const since = before && now - before.left < SHORT_DETOUR ? before.since : now;
  activity.visits = [
    { site, since, left: now },
    ...activity.visits.filter((entry) => entry.site !== site),
  ].slice(0, REMEMBERED_SITES);
  activity.site = site;
}

export function scrolled(activity, screens, now) {
  activity.scrolls = [...lastMinute(activity.scrolls, now, (scroll) => scroll.at), { at: now, screens }];
}

/** The part of the state Jev sees that comes from history rather than from the tab itself. */
export function summarize(activity, now) {
  const current = activity.visits.find((entry) => entry.site === activity.site);
  const scrolls = lastMinute(activity.scrolls, now, (scroll) => scroll.at);
  return {
    minutes_on_site: current ? Math.floor((now - current.since) / MINUTE) : 0,
    tab_switches_last_minute: lastMinute(activity.switches, now, (at) => at).length,
    screens_scrolled_last_minute: Math.round(scrolls.reduce((sum, scroll) => sum + scroll.screens, 0)),
  };
}

function lastMinute(items, now, at) {
  return items.filter((item) => now - at(item) < MINUTE);
}
