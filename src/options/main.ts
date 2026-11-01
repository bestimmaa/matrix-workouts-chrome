import tokens from "../ui/tokens.css?inline";
import { chromeStrava } from "../background/chromeStrava.js";
import { APP_KEY, TOKENS_KEY, connection, disconnect, saveApp } from "../background/strava.js";
import { EXCLUDED_KEY, chromeExclusions, include, loadExcluded } from "../content/exclusions.js";
import { TARGETS_KEY, chromeTargets, clearTarget, loadTargets } from "../content/targets.js";
import { RIDER_KEY, chromeRider, loadStoredRider, saveRider } from "../content/rider.js";
import { machineLabel } from "../ui/format.js";
import { windowLabel } from "../ui/records.js";
import { el } from "../ui/svg.js";

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

/* ------------------------------------------- excluded rides and targets */

/**
 * One stored list on the page: a row per entry with its one action, a line when
 * there are none, and a button that clears them all.
 */
function storedList<T>(
  ids: { list: string; none: string; clearAll: string },
  load: () => Promise<T[]>,
  row: (item: T) => { text: string; action: string; onAction: () => unknown },
  clearAll: () => unknown,
): () => Promise<void> {
  const list = byId<HTMLUListElement>(ids.list);
  const none = byId<HTMLElement>(ids.none);
  const clear = byId<HTMLButtonElement>(ids.clearAll);
  clear.addEventListener("click", () => void clearAll());
  return async () => {
    const items = await load();
    list.replaceChildren(
      ...items.map((item) => {
        const { text, action, onAction } = row(item);
        const button = el("button", { type: "button", text: action });
        button.addEventListener("click", () => void onAction());
        return el("li", {}, [el("span", { text }), button]);
      }),
    );
    none.hidden = items.length > 0;
    clear.hidden = items.length === 0;
  };
}

/** The rides excluded from records, each with a way to count it again. */
const showExcluded = storedList(
  { list: "excludedList", none: "excludedNone", clearAll: "clearExcluded" },
  () => loadExcluded(chromeExclusions),
  (ride) => ({
    text: new Date(ride.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    action: "Count again",
    onAction: () => include(chromeExclusions, ride.id),
  }),
  () => chromeExclusions.clear(),
);

/** The rider's own targets, each with a way to clear it. */
const showTargets = storedList(
  { list: "targetList", none: "targetsNone", clearAll: "clearTargets" },
  () => loadTargets(chromeTargets),
  (target) => ({
    text:
      `${machineLabel(target.machineType)}, ${windowLabel(target.windowSeconds)}: ${target.watts} W ` +
      `(set ${new Date(target.setAt).toLocaleDateString(undefined, { dateStyle: "medium" })})`,
    action: "Clear",
    onAction: () => clearTarget(chromeTargets, target),
  }),
  () => chromeTargets.clear(),
);

/* ------------------------------------------------------- the power ceiling */

const riderForm = byId<HTMLFormElement>("riderForm");
const riderWeight = byId<HTMLInputElement>("riderWeight");
const riderSex = byId<HTMLSelectElement>("riderSex");
const riderSaved = byId<HTMLElement>("riderSaved");
const clearRider = byId<HTMLButtonElement>("clearRider");

/** What is stored, in the form. Empty means the records page reads the profile. */
async function showRider(): Promise<void> {
  const stored = await loadStoredRider(chromeRider);
  riderWeight.value = stored ? String(stored.weightKg) : "";
  riderSex.value = stored?.sex ?? "male";
  clearRider.hidden = !stored;
}

riderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveRider(chromeRider, { weightKg: Number(riderWeight.value), sex: riderSex.value === "female" ? "female" : "male" }, new Date());
    riderSaved.textContent = " Saved.";
  } catch {
    riderSaved.textContent = " A weight in kg, 30 to 200.";
  }
});

clearRider.addEventListener("click", async () => {
  await chromeRider.clear();
  riderSaved.textContent = " Cleared. The records page uses your Matrix profile.";
});

// The worker writes this storage while the page may be open: the first upload
// connects, a revoked token disconnects. A ride view excludes a ride. Every change
// here re-renders, this page's own saves included.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (APP_KEY in changes) void show(true);
  else if (TOKENS_KEY in changes) void show(false);
  if (EXCLUDED_KEY in changes) void showExcluded();
  if (TARGETS_KEY in changes) void showTargets();
void showRider();
  if (RIDER_KEY in changes) void showRider();
});

void show(true);
void showExcluded();
void showTargets();
void showRider();
