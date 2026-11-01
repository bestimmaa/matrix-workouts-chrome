import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toWorkout, type Workout } from "matrix-workouts-core";
import { STEP_WATTS, exclusionChanges, ladder, lowestTarget, milestonesEarnedBy, targetState } from "./milestones.js";

const FIXTURES = resolve(process.cwd(), "fixtures");
const all = (): Workout[] =>
  readdirSync(FIXTURES)
    .filter((name) => /^raw-.*\.json$/.test(name))
    .map((name) => toWorkout(JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")) as Record<string, unknown>));

/** A ride of `watts` held for `samples` full samples. */
function ride(id: string, day: string, watts: number, samples = 6, machineType = "upright_bike"): Workout {
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

const MINUTE = 60;

describe("ladder", () => {
  it("dates each step to the first ride that held it, in date order whatever the input order", () => {
    const a = ride("a", "2026-09-01", 160);
    const b = ride("b", "2026-09-05", 210);
    const steps = ladder([b, a], MINUTE);
    expect(steps.earned.map((m) => [m.watts, m.effort.workoutId])).toEqual([
      [25, "a"], [50, "a"], [75, "a"], [100, "a"], [125, "a"], [150, "a"],
      [175, "b"], [200, "b"],
    ]);
    expect(steps.next).toBe(225);
    expect(steps.best?.workoutId).toBe("b");
  });

  it("counts a step reached when the effort displays at it: 224.6 W rounds to 225", () => {
    expect(ladder([ride("a", "2026-09-01", 224.6)], MINUTE).earned.at(-1)?.watts).toBe(225);
    expect(ladder([ride("a", "2026-09-01", 224.4)], MINUTE).earned.at(-1)?.watts).toBe(200);
  });

  it("does not change who earned a step as later rides arrive", () => {
    const early = [ride("a", "2026-09-01", 160), ride("b", "2026-09-05", 210)];
    const later = [...early, ride("c", "2026-09-09", 300)];
    const before = ladder(early, MINUTE).earned;
    expect(ladder(later, MINUTE).earned.slice(0, before.length)).toEqual(before);
  });

  it("has nothing for a duration no ride covers, and the first step next", () => {
    const steps = ladder([ride("a", "2026-09-01", 200, 6)], 300);
    expect(steps.earned).toEqual([]);
    expect(steps.best).toBeNull();
    expect(steps.next).toBe(STEP_WATTS);
  });

  it("only ever earns multiples of the step on real rides", () => {
    for (const milestone of ladder(all(), 300).earned) expect(milestone.watts % STEP_WATTS).toBe(0);
  });
});

describe("milestonesEarnedBy", () => {
  it("gives a ride its highest new step per duration, and nothing it did not earn first", () => {
    const a = ride("a", "2026-09-01", 160);
    const b = ride("b", "2026-09-05", 210);
    const c = ride("c", "2026-09-09", 205);
    expect(milestonesEarnedBy(b, [a, b], [30, MINUTE]).map((m) => [m.windowSeconds, m.watts])).toEqual([
      [30, 200],
      [MINUTE, 200],
    ]);
    expect(milestonesEarnedBy(c, [a, b, c], [MINUTE])).toEqual([]);
  });
});

describe("exclusionChanges", () => {
  it("moves a step to the next ride that held it, and withdraws one nobody else held", () => {
    const glitch = ride("glitch", "2026-09-01", 410);
    const real = ride("real", "2026-09-05", 230);
    const changes = exclusionChanges([glitch, real], [real], [MINUTE]);
    const moved = changes.filter((c) => c.now);
    const withdrawn = changes.filter((c) => !c.now).map((c) => c.watts);
    expect(moved.every((c) => c.now?.workoutId === "real" && c.was.workoutId === "glitch")).toBe(true);
    expect(moved.map((c) => c.watts)).toEqual([25, 50, 75, 100, 125, 150, 175, 200, 225]);
    expect(withdrawn).toEqual([250, 275, 300, 325, 350, 375, 400]);
  });

  it("reports nothing when nothing is excluded", () => {
    const rides = all();
    expect(exclusionChanges(rides, rides, [30, MINUTE, 300])).toEqual([]);
  });
});

describe("targetState", () => {
  const target = { machineType: "upright_bike", windowSeconds: MINUTE, watts: 220, setAt: new Date("2026-09-03T00:00:00Z") };

  it("is reached by the first ride after it was set that holds it", () => {
    const before = ride("before", "2026-09-01", 250); // before it was set: does not count
    const short = ride("short", "2026-09-04", 219);
    const hit = ride("hit", "2026-09-06", 221);
    const later = ride("later", "2026-09-08", 260);
    expect(targetState(target, [before, short, later, hit]).reachedBy?.workoutId).toBe("hit");
    expect(targetState(target, [before, short]).reachedBy).toBeNull();
  });

  it("counts only rides on its own machine type", () => {
    const recumbent = ride("r", "2026-09-06", 300, 6, "recumbent_bike");
    expect(targetState(target, [recumbent]).reachedBy).toBeNull();
  });

  it("asks for a target above the current best, as displayed", () => {
    const best = ladder([ride("a", "2026-09-01", 212.4)], MINUTE).best;
    expect(lowestTarget(best)).toBe(213);
    expect(lowestTarget(null)).toBe(1);
  });
});
