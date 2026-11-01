// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toWorkout, type Workout } from "matrix-workouts-core";
import { RECORD_WINDOWS_SECONDS, compareRide, recordsSection, windowLabel } from "./records.js";

const FIXTURES = resolve(process.cwd(), "fixtures");
const all = (): Workout[] =>
  readdirSync(FIXTURES)
    .filter((name) => /^raw-.*\.json$/.test(name))
    .map((name) => toWorkout(JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")) as Record<string, unknown>));

const RECUMBENT = "6a6368cb18e8655524dbb05d";
const VIRTUAL = "6aa67d338d2b6d09c6412d7b"; // 13 Sep, the latest upright fixture

/** A ride of `watts` held for `samples` full samples. */
function ride(id: string, day: string, watts: number, samples: number): Workout {
  const sample = (power: number, duration: number) => ({ duration, power, distance: 0, averageDistance: 0 });
  return toWorkout({
    workoutId: id,
    workoutTime: `${day}T07:00:00.000Z`,
    machineType: "upright_bike",
    duration: samples * 10,
    distance: 0,
    intervals: [...Array.from({ length: samples }, () => sample(watts, 10)), sample(0, 0)],
  });
}

const text = (comparison: ReturnType<typeof compareRide>): string => {
  const section = recordsSection();
  section.show(comparison);
  return section.root.textContent ?? "";
};

describe("compareRide", () => {
  it("compares only rides on the same machine type, and only earlier ones", () => {
    const rides = all();
    const recumbent = rides.find((w) => w.id === RECUMBENT)!;
    // The only recumbent ride: nothing to compare against, so everything it covers is a first.
    const alone = compareRide(recumbent, rides);
    expect(alone.compared).toBe(0);
    expect(alone.records.every((r) => r.outcome === "first" || r.outcome === "not-covered")).toBe(true);

    const latest = rides.find((w) => w.id === VIRTUAL)!;
    const upright = rides.filter((w) => w.machineType === "upright_bike" && w.startedAt < latest.startedAt);
    expect(compareRide(latest, rides).compared).toBe(upright.length);
  });

  it("never judges a 10 s window: one sample is not a sprint peak", () => {
    expect(RECORD_WINDOWS_SECONDS).not.toContain(10);
    expect(compareRide(ride("a", "2026-09-01", 200, 6), []).records.map((r) => r.windowSeconds)).toEqual([
      ...RECORD_WINDOWS_SECONDS,
    ]);
  });
});

describe("recordsSection", () => {
  const old = ride("old", "2026-09-01", 200, 6);

  it("starts loading, so the dashboard never waits on the history", () => {
    expect(recordsSection().root.textContent).toContain("Loading your history");
  });

  it("names a new best with the record it beat, and links to that ride", () => {
    const section = recordsSection();
    section.show(compareRide(ride("new", "2026-09-08", 230, 6), [old]));
    const line = [...section.root.querySelectorAll("li")].find((li) => li.textContent?.includes("New 1 min best"));
    expect(line?.textContent).toContain("230 W");
    expect(line?.textContent).toContain("up 30 W on 200 W");
    expect(line?.querySelector("a")?.getAttribute("href")).toBe(`/workouts/${old.routeId}`);
  });

  it("calls a first effort a first, not a record", () => {
    // 5 minutes at 150 W: below the 1 min record, but the first ride to hold 5 min.
    const out = text(compareRide(ride("long", "2026-09-08", 150, 30), [old]));
    expect(out).toContain("First 5 min effort 150 W");
    expect(out).not.toContain("New 5 min best");
    expect(out).not.toContain("New 1 min best");
  });

  it("shows the nearest target when nothing was won", () => {
    const out = text(compareRide(ride("easy", "2026-09-08", 190, 6), [old]));
    expect(out).toContain("No new records on this ride.");
    expect(out).toContain("10 W short of your 200 W");
  });

  it("says when the history is incomplete", () => {
    const out = text(compareRide(ride("new", "2026-09-08", 230, 6), [old], true));
    expect(out).toContain("history incomplete");
  });

  it("fails quietly, with the ride still on screen", () => {
    const section = recordsSection();
    section.fail();
    expect(section.root.textContent).toContain("Could not load your history");
  });

  it("labels windows the way a rider reads them", () => {
    expect(RECORD_WINDOWS_SECONDS.map(windowLabel)).toEqual(["30 s", "1 min", "5 min", "10 min", "20 min", "60 min"]);
  });
});
