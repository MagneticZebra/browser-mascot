export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  avatar: 'argus',
  /** Width of the mascot's canvas in CSS pixels. */
  size: 120,
  /** Distances from the nearest edges of the window, so the spot survives a resize. */
  position: { side: 'right', x: 0, vertical: 'bottom', y: 0 },
});

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

export const saveSettings = (settings) => chrome.storage.local.set({ settings });

/** What `npm run env` copied out of .env. Empty when it has not run. */
export async function loadEnv() {
  try {
    const response = await fetch(chrome.runtime.getURL('env.local.json'));
    return await response.json();
  } catch {
    return {};
  }
}

export async function loadAvatar(id) {
  const response = await fetch(chrome.runtime.getURL(`avatars/${id}/avatar.json`));
  return response.json();
}

export const today = (now = new Date()) => now.toLocaleDateString('en-CA');
