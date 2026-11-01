// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSIST_KEY, loadCachedWorkouts } from "matrix-workouts-core";

/*
 * The history request goes through the service worker, which is not here. Its
 * stand-in answers with the cached rides, and counts how often it is asked.
 */
const loadHistory = vi.hoisted(() => vi.fn());
vi.mock("./history.js", () => ({ loadHistory }));

/*
 * The content script's lifecycle: where the pill goes, when the sheet is filled, and
 * what navigation does to an open or a closed view. `main.ts` starts itself when it
 * is imported, so it is imported once, after the page and the `chrome` stand-in are
 * in place, and the tests run in order against that one instance — which is also
 * how it lives in a tab.
 *
 * Navigation here is `pushState`, which fires no event: it is caught by the poll,
 * which is the one path AGENTS.md says must always work.
 */

const HOST = "#full-matrix-workouts-root";
/** Two cached rides whose route id is their workout id. */
const SPRINT = "6aa2d8a88d2b6d09c62953f0";
const VIRTUAL = "6aa67d338d2b6d09c6412d7b";
const POLL_MS = 300;

const persistRoot = readFileSync(resolve(process.cwd(), "fixtures/persist-root.json"), "utf8");

/** The same blob with one ride moved onto a machine this extension does not handle. */
function withTreadmill(id: string): string {
  const root = JSON.parse(persistRoot) as Record<string, string>;
  const store = JSON.parse(root["userStore"]!) as { workouts: Record<string, unknown>[] };
  for (const w of store.workouts) if (w["workoutId"] === id) w["machineType"] = "treadmill";
  return JSON.stringify({ ...root, userStore: JSON.stringify(store) });
}

let toggle: () => void;

/** Let the history promise and the section's `then` run. */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

beforeAll(async () => {
  localStorage.setItem(PERSIST_KEY, persistRoot);
  vi.useFakeTimers();
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: (listener: (message: unknown) => void) => {
          toggle = () => listener({ type: "toggleSurface" });
        },
      },
    },
  });
  await import("./main.js");
});

function go(path: string): void {
  history.pushState({}, "", path);
  vi.advanceTimersByTime(POLL_MS);
}

const host = () => document.querySelector<HTMLElement>(HOST);
const inShadow = <T extends HTMLElement>(selector: string) => host()?.shadowRoot?.querySelector<T>(selector) ?? null;
const sheet = () => inShadow(".sheet")!;
const pill = () => inShadow<HTMLButtonElement>(".launcher")!;
const band = () => sheet().querySelector("h1")?.textContent;
const showStock = () => sheet().querySelector<HTMLButtonElement>(".back")!.click();

beforeEach(() => {
  localStorage.setItem(PERSIST_KEY, persistRoot);
  loadHistory.mockImplementation(async () => ({
    workouts: loadCachedWorkouts(localStorage),
    truncated: false,
    skipped: 0,
  }));
  go("/");
  expect(host()).toBeNull();
});

describe("the content script", () => {
  it("puts a collapsed pill on a cached ride, and nothing anywhere else", () => {
    go(`/workouts/${SPRINT}`);
    expect(pill().hidden).toBe(false);
    expect(sheet().hidden).toBe(true);
    // Nothing is parsed or drawn until the pill is used.
    expect(sheet().childElementCount).toBe(0);

    go("/workouts");
    expect(host()).toBeNull();
  });

  it("fills the sheet on open, keeps an open view on the route, and a closed one closed", () => {
    go(`/workouts/${SPRINT}`);
    pill().click();
    expect(sheet().hidden).toBe(false);
    expect(band()).toBe("Upright bike · Sprint 8");

    // Open, the view follows the route to the next ride.
    go(`/workouts/${VIRTUAL}`);
    expect(sheet().hidden).toBe(false);
    expect(band()).toBe("Upright bike · Virtual Active");

    // Closed, navigation never expands; the pill brings the new ride up.
    showStock();
    expect(sheet().hidden).toBe(true);
    go(`/workouts/${SPRINT}`);
    expect(sheet().hidden).toBe(true);
    pill().click();
    expect(band()).toBe("Upright bike · Sprint 8");
  });

  it("hands the page back to a pill, and the toolbar icon toggles the same sheet", () => {
    go(`/workouts/${SPRINT}`);
    toggle();
    expect(sheet().hidden).toBe(false);
    toggle();
    expect(sheet().hidden).toBe(true);
    expect(pill().hidden).toBe(false);
    pill().click();
    showStock();
    expect(pill().hidden).toBe(false);
  });

  it("opens the records page off the workout route, and leaves nothing behind when closed", async () => {
    toggle();
    expect(band()).toBe("Personal records");
    await settle();
    expect(sheet().textContent).toContain("Upright bike");
    // Opened from the toolbar, not from a ride: there is no ride to go back to.
    expect(sheet().querySelector(".backtoride")).toBeNull();
    // The pill never belongs on a page this extension does not handle, so handing
    // the page back here removes the surface rather than collapsing to one.
    showStock();
    expect(host()).toBeNull();
  });

  it("fetches the history once per tab and fills each ride's records from it", async () => {
    go(`/workouts/${SPRINT}`);
    pill().click();
    const records = () => sheet().querySelector(".records-card")?.textContent ?? "";
    await settle();
    expect(records()).toMatch(/against \d+ earlier rides/);

    go(`/workouts/${VIRTUAL}`);
    expect(records()).toContain("Loading your history");
    await settle();
    expect(records()).toMatch(/against \d+ earlier rides/);
    // Rides were opened in earlier tests as well: one request has served them all.
    expect(loadHistory).toHaveBeenCalledTimes(1);
  });

  it("goes from a ride's records to the records page and back to the ride", async () => {
    go(`/workouts/${SPRINT}`);
    pill().click();
    await settle();
    sheet().querySelector<HTMLButtonElement>(".allrecords")!.click();
    expect(band()).toBe("Personal records");
    await settle();
    expect(sheet().querySelectorAll(".recordspage").length).toBeGreaterThan(0);

    sheet().querySelector<HTMLButtonElement>(".backtoride")!.click();
    expect(band()).toBe("Upright bike · Sprint 8");
    expect(loadHistory).toHaveBeenCalledTimes(1);
  });

  it("gives a ride on another machine no pill, and no pill on the way out either", () => {
    localStorage.setItem(PERSIST_KEY, withTreadmill(SPRINT));
    go(`/workouts/${SPRINT}`);
    expect(host()).toBeNull();

    toggle();
    expect(band()).toMatch(/outside this extension's scope/i);
    showStock();
    expect(host()).toBeNull();
  });
});
