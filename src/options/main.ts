import tokens from "../ui/tokens.css?inline";
import { chromeStrava } from "../background/chromeStrava.js";
import { APP_KEY, TOKENS_KEY, connection, disconnect, saveApp } from "../background/strava.js";
import { EXCLUDED_KEY, chromeExclusions, include, loadExcluded } from "../content/exclusions.js";
import { TARGETS_KEY, chromeTargets, clearTarget, loadTargets } from "../content/targets.js";
import { machineLabel } from "../ui/format.js";
import { windowLabel } from "../ui/records.js";

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

/**
 * What is stored, on the page. The fields are refilled only when the app itself
 * changed: the worker writes the tokens while this page may be open, and a rider
 * halfway through typing a new secret must not have it wiped by an upload finishing
 * in another tab.
 */
async function show(fields: boolean): Promise<void> {
  const { app, connected } = await connection(chromeStrava);
  if (fields) {
    clientId.value = app?.clientId ?? "";
    clientSecret.value = app?.clientSecret ?? "";
  }
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

/* -------------------------------------------------------- excluded rides */

const excludedList = byId<HTMLUListElement>("excludedList");
const excludedNone = byId<HTMLElement>("excludedNone");
const clearExcluded = byId<HTMLButtonElement>("clearExcluded");

/** The rides excluded from records, each with a way to count it again. */
async function showExcluded(): Promise<void> {
  const rides = await loadExcluded(chromeExclusions);
  excludedList.replaceChildren(
    ...rides.map((ride) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = new Date(ride.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Count again";
      button.addEventListener("click", () => void include(chromeExclusions, ride.id));
      item.append(name, button);
      return item;
    }),
  );
  excludedNone.hidden = rides.length > 0;
  clearExcluded.hidden = rides.length === 0;
}

clearExcluded.addEventListener("click", () => void chromeExclusions.clear());

/* --------------------------------------------------------------- targets */

const targetList = byId<HTMLUListElement>("targetList");
const targetsNone = byId<HTMLElement>("targetsNone");
const clearTargets = byId<HTMLButtonElement>("clearTargets");

/** The rider's own targets, each with a way to clear it. */
async function showTargets(): Promise<void> {
  const targets = await loadTargets(chromeTargets);
  targetList.replaceChildren(
    ...targets.map((target) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent =
        `${machineLabel(target.machineType)}, ${windowLabel(target.windowSeconds)}: ${target.watts} W ` +
        `(set ${new Date(target.setAt).toLocaleDateString(undefined, { dateStyle: "medium" })})`;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Clear";
      button.addEventListener("click", () => void clearTarget(chromeTargets, target));
      item.append(name, button);
      return item;
    }),
  );
  targetsNone.hidden = targets.length > 0;
  clearTargets.hidden = targets.length === 0;
}

clearTargets.addEventListener("click", () => void chromeTargets.clear());

// The worker writes this storage while the page may be open: the first upload
// connects, a revoked token disconnects. A ride view excludes a ride. Every change
// here re-renders, this page's own saves included.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (APP_KEY in changes) void show(true);
  else if (TOKENS_KEY in changes) void show(false);
  if (EXCLUDED_KEY in changes) void showExcluded();
  if (TARGETS_KEY in changes) void showTargets();
});

void show(true);
void showExcluded();
void showTargets();
