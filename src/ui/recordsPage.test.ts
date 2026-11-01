// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toWorkout, type Workout, type WindowRecord } from "matrix-workouts-core";
import { EFFORT_GROUPS, machineRecords, suggestNext, renderRecordsPage } from "./recordsPage.js";
import { RECORD_WINDOWS_SECONDS } from "./records.js";
import type { RiderSetting } from "./star.js";

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

const NO_RIDER: RiderSetting = { weightKg: null, sex: null, source: "profile" };

const settle = () => new Promise((done) => setTimeout(done, 0));

describe("machineRecords", () => {
  it("keeps each machine type's records apart, most-ridden first", () => {
    const machines = machineRecords(all(), SINCE);
    expect(machines.map((m) => m.machineType)).toEqual(["upright_bike", "recumbent_bike"]);
    expect(machines[1]?.workouts.length).toBe(1);
    expect(machines[0]?.records.map((r) => r.windowSeconds)).toEqual([...RECORD_WINDOWS_SECONDS]);
  });

  it("groups every judged duration exactly once", () => {
    expect(EFFORT_GROUPS.flatMap((g) => g.windows).sort((a, b) => a - b)).toEqual([...RECORD_WINDOWS_SECONDS]);
  });
});

describe("suggestNext", () => {
  it("picks the old record that recent form is closest to", () => {
    const target = suggestNext(
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
    const target = suggestNext(recordsOf([ride("new", "2026-09-10", 200, 6)]));
    expect(target).toEqual({ kind: "first", windowSeconds: 300 });
  });

  it("suggests revisiting a record with no recent effort at that duration", () => {
    const target = suggestNext(
      recordsOf([ride("long", "2026-08-01", 200, 361), ride("short", "2026-09-10", 250, 6)]),
    );
    expect(target?.kind).toBe("revisit");
    if (target?.kind === "revisit") expect(target.record.windowSeconds).toBe(300);
  });

  it("has nothing to suggest when every record is recent and every duration covered", () => {
    expect(suggestNext(recordsOf([ride("all", "2026-09-10", 200, 361)]))).toBeNull();
  });
});

describe("renderRecordsPage", () => {
  const now = new Date("2026-10-27T00:00:00Z"); // eight weeks after SINCE

  it("loads, then shows a section per machine type with a target", async () => {
    const page = renderRecordsPage(Promise.resolve({ workouts: all(), truncated: false, excluded: [], targets: [], rider: NO_RIDER }), {
      onShowStock: () => {},
      now,
    });
    expect(page.textContent).toContain("Loading your history");
    await settle();
    const sections = page.querySelectorAll(".recordspage");
    expect(sections).toHaveLength(2);
    expect(sections[0]?.querySelector(".target")?.textContent).toMatch(/Suggested next|record/);
    // The fixtures end on 13 Sep: the recumbent ride, in July, is not recent.
    expect(sections[1]?.textContent).toContain("No rides on this machine in the last 8 weeks");
  });

  it("links every record to its ride", async () => {
    const workouts = all();
    const page = renderRecordsPage(Promise.resolve({ workouts, truncated: false, excluded: [], targets: [], rider: NO_RIDER }), { onShowStock: () => {}, now });
    await settle();
    const ids = new Set(workouts.map((w) => w.routeId));
    const links = [...page.querySelectorAll<HTMLAnchorElement>(".recordtable a")];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(ids.has(link.getAttribute("href")!.replace("/workouts/", ""))).toBe(true);
  });

  it("says when the history is incomplete, and when it could not be loaded", async () => {
    const partial = renderRecordsPage(Promise.resolve({ workouts: all(), truncated: true, excluded: [], targets: [], rider: NO_RIDER }), {
      onShowStock: () => {},
      now,
    });
    const failed = renderRecordsPage(Promise.reject(new Error("no token")), { onShowStock: () => {}, now });
    await settle();
    expect(partial.textContent).toContain("more history than it sent");
    expect(failed.textContent).toContain("Could not load your history");
  });

  it("leaves excluded rides out of every record, lists them, and can count them again", async () => {
    const bad = ride("bad", "2026-09-05", 900, 6);
    const good = ride("good", "2026-09-06", 200, 6);
    const included: string[] = [];
    const page = renderRecordsPage(
      Promise.resolve({ workouts: [bad, good], truncated: false, excluded: [{ id: "bad", startedAt: bad.startedAt }], targets: [], rider: NO_RIDER }),
      { onShowStock: () => {}, onInclude: (id) => included.push(id), now },
    );
    await settle();
    const minute = [...page.querySelectorAll(".recordtable tbody tr")].find((tr) => tr.querySelector("th")?.textContent === "1 min");
    expect(minute?.textContent).toContain("200 W");
    expect(minute?.textContent).not.toContain("900 W");
    const list = page.querySelector(".excludedrides")!;
    expect(list.textContent).toContain("1 left out of every record");
    list.querySelector<HTMLButtonElement>("li button")!.click();
    expect(included).toEqual(["bad"]);
  });

  it("excludes the ride a record came from", async () => {
    const excluded: string[] = [];
    const page = renderRecordsPage(Promise.resolve({ workouts: all(), truncated: false, excluded: [], targets: [], rider: NO_RIDER }), {
      onShowStock: () => {},
      onExclude: (ride) => excluded.push(ride.id),
      now,
    });
    await settle();
    const button = page.querySelector<HTMLButtonElement>(".excludeeffort")!;
    expect(button.getAttribute("aria-label")).toMatch(/^Exclude the ride of /);
    button.click();
    expect(excluded).toHaveLength(1);
    expect(page.querySelector(".excludedrides")).toBeNull();
  });

  it("sets a target above the best only, and shows open and reached targets", async () => {
    const set: unknown[] = [];
    const cleared: unknown[] = [];
    const rides = [ride("a", "2026-09-01", 200, 6), ride("b", "2026-09-20", 230, 6)];
    const targets = [
      { machineType: "upright_bike", windowSeconds: 30, watts: 220, setAt: new Date("2026-09-10T00:00:00Z") },
      { machineType: "upright_bike", windowSeconds: 60, watts: 260, setAt: new Date("2026-09-10T00:00:00Z") },
    ];
    const page = renderRecordsPage(Promise.resolve({ workouts: rides, truncated: false, excluded: [], targets, rider: NO_RIDER }), {
      onShowStock: () => {},
      onSetTarget: (t) => set.push(t),
      onClearTarget: (s) => cleared.push(s),
      now,
    });
    await settle();
    const row = (label: string) =>
      [...page.querySelectorAll(".milestonetable tr")].find((tr) => tr.querySelector("th")?.textContent === label)!;

    expect(row("30 s").textContent).toContain("✓ Your 220 W reached");
    expect(row("1 min").textContent).toContain("Your target 260 W, 30 W to go");
    row("1 min").querySelector<HTMLButtonElement>(".owntarget button")!.click();
    expect(cleared).toEqual([{ machineType: "upright_bike", windowSeconds: 60 }]);

    // 5 min was never ridden: any whole number of watts is above "no best".
    row("5 min").querySelector<HTMLButtonElement>(".owntarget button")!.click();
    const input = row("5 min").querySelector("input")!;
    input.value = "180";
    row("5 min").querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(set).toEqual([{ machineType: "upright_bike", windowSeconds: 300, watts: 180 }]);
  });

  it("says when a target is already below the best, from a ride before it was set", async () => {
    // The 300 W ride was excluded when the 250 W target was set, then counted again.
    const rides = [ride("old", "2026-09-01", 300, 6), ride("new", "2026-09-20", 240, 6)];
    const targets = [{ machineType: "upright_bike", windowSeconds: 60, watts: 250, setAt: new Date("2026-09-10T00:00:00Z") }];
    const page = renderRecordsPage(Promise.resolve({ workouts: rides, truncated: false, excluded: [], targets, rider: NO_RIDER }), {
      onShowStock: () => {},
      now,
    });
    await settle();
    const row = [...page.querySelectorAll(".milestonetable tr")].find((tr) => tr.querySelector("th")?.textContent === "1 min")!;
    const cell = row.querySelector(".owntarget")!.textContent;
    expect(cell).toContain("is below your best of 300 W, from a ride before you set it");
    expect(cell).not.toContain("to go");
  });

  it("refuses a target at or below the current best, and says why", async () => {
    const set: unknown[] = [];
    const page = renderRecordsPage(
      Promise.resolve({ workouts: [ride("a", "2026-09-01", 200, 6)], truncated: false, excluded: [], targets: [], rider: NO_RIDER }),
      { onShowStock: () => {}, onSetTarget: (t) => set.push(t), now },
    );
    await settle();
    const row = [...page.querySelectorAll(".milestonetable tr")].find((tr) => tr.querySelector("th")?.textContent === "1 min")!;
    row.querySelector<HTMLButtonElement>(".owntarget button")!.click();
    row.querySelector("input")!.value = "200";
    row.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(set).toEqual([]);
    expect(row.querySelector(".formerror")?.textContent).toContain("Above your best of 200 W");
  });

  it("names the milestones an exclusion withdrew", async () => {
    const glitch = ride("glitch", "2026-09-01", 410, 6);
    const real = ride("real", "2026-09-05", 230, 6);
    const page = renderRecordsPage(
      Promise.resolve({ workouts: [glitch, real], truncated: false, excluded: [{ id: "glitch", startedAt: glitch.startedAt }], targets: [], rider: NO_RIDER }),
      { onShowStock: () => {}, now },
    );
    await settle();
    const note = page.querySelector(".milestones .changes")?.textContent ?? "";
    expect(note).toContain("1 min: 250 W, 275 W, 300 W, 325 W, 350 W, 375 W, 400 W withdrawn, 9 now dated to a later ride");
  });

  it("offers a way back only when opened from a ride", () => {
    let back = 0;
    const fromRide = renderRecordsPage(new Promise(() => {}), { onShowStock: () => {}, onBackToRide: () => back++, now });
    fromRide.querySelector<HTMLButtonElement>(".backtoride")!.click();
    expect(back).toBe(1);
    expect(renderRecordsPage(new Promise(() => {}), { onShowStock: () => {}, now }).querySelector(".backtoride")).toBeNull();
  });
});

describe("power-skills star", () => {
  const now = new Date("2026-09-20T00:00:00Z");
  const rides = [ride("old", "2026-07-01", 300, 360), ride("new", "2026-09-10", 240, 360)];
  const render = (rider: RiderSetting, onSetRider?: (r: { weightKg: number; sex: "male" | "female" }) => void) =>
    renderRecordsPage({ workouts: rides, truncated: false, excluded: [], targets: [], rider }, { onShowStock: () => {}, onSetRider, now });
  const labels = (page: HTMLElement) => [...page.querySelectorAll(".starchart .spokelabel")].map((t) => t.textContent);
  const press = (page: HTMLElement, name: string) =>
    [...page.querySelectorAll<HTMLButtonElement>(".startoggle button")].find((b) => b.textContent === name)!.click();

  it("opens against the ceiling when the rider's weight and table are known", () => {
    const page = render({ weightKg: 80, sex: "male", source: "profile" });
    // 240 W for 5 min against 0.9 × 6.8 W/kg × 80 kg = 489.6 W.
    expect(labels(page)).toContain("5 min 49%");
    expect(page.querySelector(".starchart .alltime")).not.toBeNull();
    expect(page.querySelector(".ridernote")!.textContent).toContain("80 kg, men's table, from your Matrix profile");
    expect(page.querySelector(".powerskills .explain")!.textContent).toMatch(/^A ceiling, not a measurement/);
  });

  it("switches to the rider's own best, where the record is 100%", () => {
    const page = render({ weightKg: 80, sex: "male", source: "settings" });
    press(page, "vs your best");
    expect(labels(page)).toContain("5 min 80%");
    expect(page.querySelector(".starchart .alltime")).toBeNull();
    expect(page.querySelector(".ridernote")).toBeNull();
  });

  it("draws a spoke past the ceiling in the machine colour", () => {
    const page = render({ weightKg: 30, sex: "female", source: "settings" });
    expect(page.querySelectorAll(".starchart circle.past").length).toBeGreaterThan(0);
    expect(page.querySelector(".starchart .pct.reached")).not.toBeNull();
  });

  it("asks for weight and table instead of guessing them, and saves what is typed", () => {
    const saved: unknown[] = [];
    const page = render({ weightKg: null, sex: "male", source: "profile" }, (r) => saved.push(r));
    expect(page.querySelector(".starchart")).not.toBeNull();
    press(page, "vs ceiling");
    expect(page.querySelector(".starchart")).toBeNull();
    const form = page.querySelector<HTMLFormElement>(".riderform")!;
    form.querySelector("input")!.value = "500";
    form.requestSubmit();
    expect(form.querySelector(".formerror")!.textContent).toMatch(/30 to 200/);
    form.querySelector("input")!.value = "72.5";
    form.requestSubmit();
    expect(saved).toEqual([{ weightKg: 72.5, sex: "male" }]);
  });

  it("leaves a duration no ride covered out of the shape and says so", () => {
    const short = [ride("a", "2026-09-10", 250, 6)];
    const page = renderRecordsPage(
      { workouts: short, truncated: false, excluded: [], targets: [], rider: { weightKg: 80, sex: "male", source: "settings" } },
      { onShowStock: () => {}, now },
    );
    expect(labels(page).filter((l) => l?.endsWith("–"))).toHaveLength(4);
    expect([...page.querySelectorAll(".starchart .spokedetail")].map((t) => t.textContent)).toContain("not recorded");
    expect(page.querySelectorAll(".starchart circle")).toHaveLength(2);
  });
});
