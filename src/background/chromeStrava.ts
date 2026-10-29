import type { StravaDeps } from "./strava.js";

/**
 * What the Strava client stands on in the browser. Shared by the worker, which
 * uploads, and the options page, which saves the app and disconnects: both are the
 * extension's own pages, so both may hold the storage and the identity API.
 */
export const chromeStrava: StravaDeps = {
  fetch: (url, init) => fetch(url, init),
  load: async <T>(key: string) => (await chrome.storage.local.get(key))[key] as T | undefined,
  save: (key, value) => chrome.storage.local.set({ [key]: value }),
  remove: (key) => chrome.storage.local.remove(key),
  authorize: async (url) => {
    const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    if (!redirect) throw new Error("Sign-in was closed.");
    return redirect;
  },
  redirectUri: chrome.identity.getRedirectURL(),
  openSetup: () => chrome.runtime.openOptionsPage(),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
