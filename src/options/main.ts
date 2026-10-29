import tokens from "../ui/tokens.css?inline";
import { chromeStrava } from "../background/chromeStrava.js";
import { connection, disconnect, saveApp, touchesConnection } from "../background/strava.js";

/**
 * The options page: where the rider's own Strava app is entered, and where everything
 * the Strava upload keeps in `chrome.storage` can be seen and cleared. It is the
 * extension's own page, so it calls the Strava module directly, which stays the one
 * place that reads or writes that storage.
 *
 * It shows the callback domain to register, because that is the one value the rider
 * cannot look up anywhere else: it is this extension's id, which Chrome derives from
 * the folder it was loaded from.
 *
 * It wears the view's tokens, from the same file, so the two cannot drift apart.
 */

const style = document.createElement("style");
style.textContent = tokens;
document.head.prepend(style);

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const form = byId<HTMLFormElement>("app");
const clientId = byId<HTMLInputElement>("clientId");
const clientSecret = byId<HTMLInputElement>("clientSecret");
const saved = byId<HTMLElement>("saved");
const status = byId<HTMLElement>("status");

byId<HTMLElement>("callback").textContent = new URL(chromeStrava.redirectUri).host;

async function show(): Promise<void> {
  const { app, connected } = await connection(chromeStrava);
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
  const app = { clientId: clientId.value.trim(), clientSecret: clientSecret.value.trim() };
  if (!app.clientId || !app.clientSecret) {
    saved.textContent = " Both fields are needed.";
    return;
  }
  try {
    await saveApp(chromeStrava, app);
    saved.textContent = " Saved.";
  } catch {
    saved.textContent = " Could not save. Try again.";
  }
});

byId<HTMLButtonElement>("disconnect").addEventListener("click", async () => {
  try {
    await disconnect(chromeStrava);
    saved.textContent = "";
  } catch {
    saved.textContent = " Could not forget everything. Try again.";
  }
});

// The worker writes this storage while the page may be open: the first upload
// connects, a revoked token disconnects. Every change here re-renders, this page's
// own saves included.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && touchesConnection(Object.keys(changes))) void show();
});

void show();
