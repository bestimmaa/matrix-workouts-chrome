import styles from "../ui/styles.css?inline";
import { documentStyles } from "../ui/documentStyles.js";
import { APP_KEY, TOKENS_KEY, type SaveAppMessage, type StravaApp, type StravaTokens } from "../background/strava.js";

/**
 * The options page: where the rider's own Strava app is entered, and where everything
 * the Strava upload keeps in `chrome.storage` can be seen and cleared. Writes go
 * through the service worker, which owns that storage; this page only reads it to
 * show the status.
 *
 * It shows the callback domain to register, because that is the one value the rider
 * cannot look up anywhere else: it is this extension's id, which Chrome derives from
 * the folder it was loaded from.
 *
 * It wears the view's own tokens, read from the same stylesheet, so the two cannot
 * drift apart.
 */

const tokens = document.createElement("style");
tokens.textContent = documentStyles(styles);
document.head.prepend(tokens);

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const form = byId<HTMLFormElement>("app");
const clientId = byId<HTMLInputElement>("clientId");
const clientSecret = byId<HTMLInputElement>("clientSecret");
const saved = byId<HTMLElement>("saved");
const status = byId<HTMLElement>("status");

byId<HTMLElement>("callback").textContent = new URL(chrome.identity.getRedirectURL()).host;

async function show(): Promise<void> {
  const stored = await chrome.storage.local.get([APP_KEY, TOKENS_KEY]);
  const app = stored[APP_KEY] as StravaApp | undefined;
  const connected = stored[TOKENS_KEY] as StravaTokens | undefined;
  clientId.value = app?.clientId ?? "";
  clientSecret.value = app?.clientSecret ?? "";
  status.textContent = connected
    ? "Connected. Uploads go straight to your account."
    : app
      ? "Not connected yet. The first upload asks you to connect."
      : "Not set up.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const app: StravaApp = { clientId: clientId.value.trim(), clientSecret: clientSecret.value.trim() };
  if (!app.clientId || !app.clientSecret) {
    saved.textContent = " Both fields are needed.";
    return;
  }
  const message: SaveAppMessage = { type: "stravaSaveApp", app };
  await chrome.runtime.sendMessage(message);
  saved.textContent = " Saved.";
  await show();
});

byId<HTMLButtonElement>("disconnect").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "stravaDisconnect" });
  saved.textContent = "";
  await show();
});

void show();
