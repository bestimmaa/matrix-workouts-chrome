// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toWorkout, type Workout, type WindowRecord } from "matrix-workouts-core";
import { EFFORT_GROUPS, machineRecords, nextTarget, renderRecordsPage } from "./recordsPage.js";
import { RECORD_WINDOWS_SECONDS } from "./records.js";

const FIXTURES = resolve(process.cwd(), "fixtures");
const all = (): Workout[] =>
  readdirSync(FIXTURES)
    .filter((name) => /^raw-.*\.json$/.test(name))
    .map((name) => toWorkout(JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")) as Record<string, unknown>));

/** A ride of `watts` held for `samples` full samples. */
function ride(id: string, day: string, watts: number, samples: number, machineType = "upright_bike"): Workout {
  const sample = (power: number, duration: number) => ({ duration, power, distance: 0, averageDistance: 0 });
  return toWorkout({
    workoutId: id,
    workoutTime: `${day}T07:00:00.000Z`,
    machineType,
    duration: samples * 10,
    distance: 0,
    intervals: [...Array.from({ length: samples }, () => sample(watts, 10)), sample(0, 0)],
  });
}

const SINCE = new Date("2026-09-01T00:00:00Z");
const recordsOf = (rides: Workout[]): WindowRecord[] => machineRecords(rides, SINCE)[0]!.records;

const settle = () => new Promise((done) => setTimeout(done, 0));

describe("machineRecords", () => {
  it("keeps each machine type's records apart, most-ridden first", () => {
    const machines = machineRecords(all(), SINCE);
    expect(machines.map((m) => m.machineType)).toEqual(["upright_bike", "recumbent_bike"]);
    expect(machines[1]?.rides).toBe(1);
    expect(machines[0]?.records.map((r) => r.windowSeconds)).toEqual([...RECORD_WINDOWS_SECONDS]);
  });

  it("groups every judged duration exactly once", () => {
    expect(EFFORT_GROUPS.flatMap((g) => g.windows).sort((a, b) => a - b)).toEqual([...RECORD_WINDOWS_SECONDS]);
  });
});

describe("nextTarget", () => {
  it("picks the old record that recent form is closest to", () => {
    const target = nextTarget(
      recordsOf([
        ride("old", "2026-08-01", 300, 360),
        // Recent: 95% of the record for 30 s and 1 min (the only durations it covers).
        ride("new", "2026-09-10", 285, 6),
      ]),
    );
    expect(target?.kind).toBe("beat");
    if (target?.kind === "beat") {
      expect(target.record.windowSeconds).toBe(30);
      expect(target.gapWatts).toBe(15);
    }
  });

  it("asks for a first effort when a duration was never ridden and every record is recent", () => {
    const target = nextTarget(recordsOf([ride("new", "2026-09-10", 200, 6)]));
    expect(target).toEqual({ kind: "first", windowSeconds: 300 });
  });

  it("suggests revisiting a record with no recent effort at that duration", () => {
    const target = nextTarget(
      recordsOf([ride("long", "2026-08-01", 200, 361), ride("short", "2026-09-10", 250, 6)]),
    );
    expect(target?.kind).toBe("revisit");
    if (target?.kind === "revisit") expect(target.record.windowSeconds).toBe(300);
  });

  it("has nothing to suggest when every record is recent and every duration covered", () => {
    expect(nextTarget(recordsOf([ride("all", "2026-09-10", 200, 361)]))).toBeNull();
  });
});

describe("renderRecordsPage", () => {
  const now = new Date("2026-10-27T00:00:00Z"); // eight weeks after SINCE

  it("loads, then shows a section per machine type with a target", async () => {
    const page = renderRecordsPage(Promise.resolve({ workouts: all(), truncated: false }), {
      onShowStock: () => {},
      now,
    });
    expect(page.textContent).toContain("Loading your history");
    await settle();
    const sections = page.querySelectorAll(".recordspage");
    expect(sections).toHaveLength(2);
    expect(sections[0]?.querySelector(".target")?.textContent).toMatch(/Next|record/);
    // The fixtures end on 13 Sep: the recumbent ride, in July, is not recent.
    expect(sections[1]?.textContent).toContain("No rides on this machine in the last 8 weeks");
  });

  it("links every record to its ride", async () => {
    const workouts = all();
    const page = renderRecordsPage(Promise.resolve({ workouts, truncated: false }), { onShowStock: () => {}, now });
    await settle();
    const ids = new Set(workouts.map((w) => w.routeId));
    const links = [...page.querySelectorAll<HTMLAnchorElement>(".recordtable a")];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(ids.has(link.getAttribute("href")!.replace("/workouts/", ""))).toBe(true);
  });

  it("says when the history is incomplete, and when it could not be loaded", async () => {
    const partial = renderRecordsPage(Promise.resolve({ workouts: all(), truncated: true }), {
      onShowStock: () => {},
      now,
    });
    const failed = renderRecordsPage(Promise.reject(new Error("no token")), { onShowStock: () => {}, now });
    await settle();
    expect(partial.textContent).toContain("more history than it sent");
    expect(failed.textContent).toContain("Could not load your history");
  });

  it("offers a way back only when opened from a ride", () => {
    let back = 0;
    const fromRide = renderRecordsPage(new Promise(() => {}), { onShowStock: () => {}, onBackToRide: () => back++, now });
    fromRide.querySelector<HTMLButtonElement>(".backtoride")!.click();
    expect(back).toBe(1);
    expect(renderRecordsPage(new Promise(() => {}), { onShowStock: () => {}, now }).querySelector(".backtoride")).toBeNull();
  });
});
