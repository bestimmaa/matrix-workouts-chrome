import { APP_KEY, TOKENS_KEY, type StravaApp, type StravaTokens } from "../background/strava.js";

/**
 * The options page: where the rider's own Strava app is entered, and where everything
 * the Strava upload keeps in `chrome.storage` can be seen and cleared.
 *
 * It shows the callback domain to register, because that is the one value the rider
 * cannot look up anywhere else: it is this extension's id, which Chrome derives from
 * the folder it was loaded from.
 */

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const form = byId<HTMLFormElement>("app");
const clientId = byId<HTMLInputElement>("clientId");
const clientSecret = byId<HTMLInputElement>("clientSecret");
const saved = byId<HTMLElement>("saved");
const status = byId<HTMLElement>("status");

byId<HTMLElement>("callback").textContent = new URL(chrome.identity.getRedirectURL()).host;

async function show(): Promise<void> {
  const stored = await chrome.storage.local.get(APP_KEY);
  const app = stored[APP_KEY] as StravaApp | undefined;
  clientId.value = app?.clientId ?? "";
  clientSecret.value = app?.clientSecret ?? "";
  const tokens = (await chrome.storage.local.get(TOKENS_KEY))[TOKENS_KEY] as StravaTokens | undefined;
  status.textContent = tokens
    ? "Connected. Uploads go straight to your account."
    : app
      ? "Not connected yet. The first upload asks you to connect."
      : "Not set up.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const app: StravaApp = { clientId: clientId.value.trim(), clientSecret: clientSecret.value.trim() };
  const before = (await chrome.storage.local.get(APP_KEY))[APP_KEY] as StravaApp | undefined;
  await chrome.storage.local.set({ [APP_KEY]: app });
  // Tokens belong to the app that issued them; a different app starts over.
  if (before?.clientId !== app.clientId) await chrome.storage.local.remove(TOKENS_KEY);
  saved.textContent = " Saved.";
  await show();
});

byId<HTMLButtonElement>("disconnect").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "stravaDisconnect" });
  saved.textContent = "";
  await show();
});

void show();
