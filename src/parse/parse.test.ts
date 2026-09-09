import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DISTANCE_QUANTUM_METERS,
  PERSIST_KEY,
  WorkoutParseError,
  camelizeWorkout,
  extractRawWorkouts,
  findWorkout,
  flagHeartRateDropouts,
  heartRateStats,
  loadCachedWorkouts,
  programMode,
  toWorkout,
  type ReadableStorage,
} from "./index.js";

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), "utf8");

const PERSIST_BLOB = fixture("persist-root.json");
const TARGET_HR_DROPOUTS = "6aa194a08d2b6d09c61e9500"; // 09 Sep, strap glitching
const TARGET_HR_CLEAN = "6aa045668d2b6d09c612785d"; // 08 Sep, strap clean
const SPRINT_8 = "6a95b033c23a154beb856bce"; // 31 Aug, HIIT
const PROGRAM_0 = "6a9413328d2b6d09c6b512a9"; // 30 Aug, program 0
const PROGRAM_47 = "6a8336b68d2b6d09c634fc60"; // 17 Aug, program 47, only 19 samples
const PROGRAM_20 = "6a7cab8cc23a154bebccef65"; // 12 Aug, program 20
const PROGRAM_38 = "6a5e4fe418e8655524aebab4"; // 20 Jul, program 38, constant resistance
const RECUMBENT = "6a6368cb18e8655524dbb05d"; // 24 Jul, the only recumbent ride

const storage = (value: string | null): ReadableStorage => ({
  getItem: (key) => (key === PERSIST_KEY ? value : null),
});

describe("persisted blob", () => {
  it("parses the double-encoded store (values are JSON strings)", () => {
    expect(extractRawWorkouts(PERSIST_BLOB)).toHaveLength(8);
  });

  it("tolerates a slice that is already an object", () => {
    const blob = JSON.stringify({ userStore: { workouts: [] } });
    expect(extractRawWorkouts(blob)).toEqual([]);
  });

  it.each([
    ["missing", null, /localStorage "root" is empty/],
    ["empty", "", /localStorage "root" is empty/],
    ["malformed", "{not json", /not valid JSON/],
    ["not an object", '"a string"', /not an object/],
    ["missing userStore", "{}", /"userStore" is missing/],
    ["userStore not an object", '{"userStore":"[1,2]"}', /did not contain an object/],
  ])("fails clearly when the store is %s", (_label, value, message) => {
    expect(() => extractRawWorkouts(value)).toThrow(WorkoutParseError);
    expect(() => extractRawWorkouts(value)).toThrow(message);
  });

  it("returns an empty list when workouts is absent or not an array", () => {
    expect(extractRawWorkouts('{"userStore":"{}"}')).toEqual([]);
    expect(extractRawWorkouts('{"userStore":"{\\"workouts\\":42}"}')).toEqual([]);
  });

  it("loads and sorts cached workouts newest first", () => {
    const loaded = loadCachedWorkouts(storage(PERSIST_BLOB));
    expect(loaded.map((w) => w.id)).toEqual([
      TARGET_HR_DROPOUTS, TARGET_HR_CLEAN, SPRINT_8, PROGRAM_0,
      PROGRAM_47, PROGRAM_20, RECUMBENT, PROGRAM_38,
    ]);
  });
});

describe("normalization", () => {
  const workouts = loadCachedWorkouts(storage(PERSIST_BLOB));
  const dropouts = findWorkout(workouts, TARGET_HR_DROPOUTS)!;
  const clean = findWorkout(workouts, TARGET_HR_CLEAN)!;
  const sprint8 = findWorkout(workouts, SPRINT_8)!;

  it("maps units into the field names", () => {
    expect(dropouts.durationSeconds).toBe(3136);
    expect(dropouts.distanceMeters).toBeCloseTo(24751.65);
    expect(dropouts.samples).toHaveLength(314);
    expect(clean.samples).toHaveLength(272);
    expect(sprint8.samples).toHaveLength(121);
  });

  it("accumulates elapsed time from each sample's own duration", () => {
    expect(dropouts.samples[0]!.elapsedSeconds).toBe(0);
    expect(dropouts.samples[1]!.elapsedSeconds).toBe(10);
    expect(dropouts.samples.at(-1)!.elapsedSeconds).toBe(3130);
  });

  it("does not assume a 10-second final sample", () => {
    // Observed final-sample durations across the fixtures: 0, 1 and 8.
    const all = loadCachedWorkouts(storage(PERSIST_BLOB));
    const finals = all.map((w) => {
      const raw = JSON.parse(JSON.parse(PERSIST_BLOB).userStore).workouts.find(
        (x: { workoutId: string }) => x.workoutId === w.id,
      );
      return raw.intervals.at(-1).duration as number;
    });
    expect(new Set(finals).size).toBeGreaterThan(1);
    expect(finals).toContain(8); // the recumbent ride ends mid-sample
  });

  it("places a short final sample on the real clock, not on a 10s grid", () => {
    const rec = findWorkout(loadCachedWorkouts(storage(PERSIST_BLOB)), RECUMBENT)!;
    const n = rec.samples.length;
    // Every sample before the last is 10s, so the last starts at (n-1)*10 ...
    expect(rec.samples.at(-1)!.elapsedSeconds).toBe((n - 1) * 10);
    // ... and its own 8s duration is what the ride actually ended on.
    const p38 = findWorkout(loadCachedWorkouts(storage(PERSIST_BLOB)), PROGRAM_38)!;
    expect(p38.samples.at(-1)!.elapsedSeconds).toBe((p38.samples.length - 1) * 10);
  });

  it("keeps averageDistance as the cumulative distance it actually is", () => {
    const last = dropouts.samples.at(-1)!;
    expect(last.cumulativeDistanceMeters).toBeCloseTo(24735.56);
    // ...and it is NOT the running mean of distanceMeters
    expect(last.cumulativeDistanceMeters).not.toBeCloseTo(last.distanceMeters);
  });

  it("quantizes per-sample distance to hundredths of a mile", () => {
    for (const s of clean.samples) {
      const steps = s.distanceMeters / DISTANCE_QUANTUM_METERS;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(0.01);
    }
  });

  it("accepts the snake_case shape the HTTP API returns", () => {
    const api = {
      workout_id: "abc",
      workout_time: "2026-08-31T16:27:43.000Z",
      machine_type: "upright_bike",
      program_type: 18,
      duration: 20,
      distance: 100,
      average_heart_rate: 157,
      intervals: [
        { duration: 10, distance: 0, average_distance: 32.19, speed: 23.66, rpm: 92,
          power: 73, resistance: 3, heart_rate: 120, incline: 0, total_steps: 1 },
      ],
    };
    const w = toWorkout(api);
    expect(w.id).toBe("abc");
    expect(w.mode).toBe("sprint_8");
    expect(w.reported.averageHeartRateBpm).toBe(157);
    expect(w.samples[0]!.cumulativeDistanceMeters).toBeCloseTo(32.19);
    expect(w.samples[0]!.cadenceRpm).toBe(92);
  });

  it("camelizes nested interval keys", () => {
    const out = camelizeWorkout({ total_sweat_score: 1, intervals: [{ heart_rate: 2 }] });
    expect(out.totalSweatScore).toBe(1);
    expect(out.intervals![0]!.heartRate).toBe(2);
  });

  it("keeps an unknown machine type instead of rejecting it", () => {
    const w = toWorkout({
      workoutId: "x", workoutTime: "2026-01-01T00:00:00.000Z",
      machineType: "ski_erg", duration: 1, distance: 1,
    });
    expect(w.machineType).toBe("ski_erg");
    expect(w.samples).toEqual([]);
  });

  it.each([
    ["no workoutId", { workoutTime: "2026-01-01T00:00:00.000Z" }, /no workoutId/],
    ["bad workoutTime", { workoutId: "x", workoutTime: "nonsense" }, /unreadable workoutTime/],
  ])("rejects a record with %s", (_label, input, message) => {
    expect(() => toWorkout(input)).toThrow(WorkoutParseError);
    expect(() => toWorkout(input)).toThrow(message);
  });
});

describe("program mode", () => {
  const workouts = loadCachedWorkouts(storage(PERSIST_BLOB));
  const sprint8 = findWorkout(workouts, SPRINT_8)!;
  const targetHr = findWorkout(workouts, TARGET_HR_CLEAN)!;

  it("names the two confirmed program ids", () => {
    expect(programMode(18)).toBe("sprint_8");
    expect(programMode(46)).toBe("target_heart_rate");
  });

  it("does not guess at unmapped ids", () => {
    for (const id of [0, 20, 38, 47]) expect(programMode(id)).toBe("unknown");
    expect(programMode(null)).toBe("unknown");
  });

  it("parses every program in the account without special-casing", () => {
    const all = loadCachedWorkouts(storage(PERSIST_BLOB));
    const seen = new Map(all.map((w) => [w.programType, w]));
    expect([...seen.keys()].sort((a, b) => a! - b!)).toEqual([0, 18, 20, 38, 46, 47]);
    for (const w of all) {
      expect(w.samples.length).toBeGreaterThan(0);
      expect(w.durationSeconds).toBeGreaterThan(0);
      // Only Sprint 8 carries the sprint block; every other program is structurally identical.
      expect(w.sprint8 === null).toBe(w.programType !== 18);
    }
  });

  it("handles both machine types", () => {
    const all = loadCachedWorkouts(storage(PERSIST_BLOB));
    expect(new Set(all.map((w) => w.machineType))).toEqual(
      new Set(["upright_bike", "recumbent_bike"]),
    );
    const rec = findWorkout(all, RECUMBENT)!;
    // A recumbent is pedalled slower than an upright at the same output.
    const cadence = rec.samples.map((s) => s.cadenceRpm).filter((r) => r > 0);
    expect(Math.max(...cadence)).toBeLessThan(100);
  });

  it("program 38 drives output by power, not resistance", () => {
    // The assumption that power tracks resistance holds for 46 but NOT for 38,
    // which holds resistance at 1 while stepping wattage up.
    const p38 = findWorkout(loadCachedWorkouts(storage(PERSIST_BLOB)), PROGRAM_38)!;
    expect(new Set(p38.samples.map((s) => s.resistanceLevel))).toEqual(new Set([1]));
    const power = p38.samples.map((s) => s.powerWatts);
    expect(Math.min(...power)).toBe(35);
    expect(Math.max(...power)).toBe(280);
  });

  it("copes with a 19-sample ride", () => {
    const short = findWorkout(loadCachedWorkouts(storage(PERSIST_BLOB)), PROGRAM_47)!;
    expect(short.samples).toHaveLength(19);
    expect(short.durationSeconds).toBe(181);
  });

  it("identifies the mode of each fixture", () => {
    expect(sprint8.programType).toBe(18);
    expect(sprint8.mode).toBe("sprint_8");
    expect(targetHr.programType).toBe(46);
    expect(targetHr.mode).toBe("target_heart_rate");
  });

  it("extracts the eight sprint scores in order", () => {
    expect(sprint8.sprint8?.scores).toEqual([1060, 1070, 1110, 1120, 1180, 1180, 1170, 1150]);
    expect(sprint8.sprint8?.programLevel).toBe(1);
  });

  it("sweat score equals the sum of the sprint scores", () => {
    const s8 = sprint8.sprint8!;
    expect(s8.sweatScore).toBe(9040);
    expect(s8.scores.reduce((a, b) => a + b, 0)).toBe(s8.sweatScore);
  });

  it("leaves sprint8 null on non-Sprint 8 rides", () => {
    expect(targetHr.sprint8).toBeNull();
  });

  it("refuses a partial sprint score set", () => {
    const w = toWorkout({
      workoutId: "x", workoutTime: "2026-01-01T00:00:00.000Z",
      sprintScores: { 1: 100, 2: 200 },
    });
    expect(w.sprint8).toBeNull();
  });

  it("falls back to the summed scores when sweatScore is absent", () => {
    const scores = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [i, 10 * i]));
    const w = toWorkout({
      workoutId: "x", workoutTime: "2026-01-01T00:00:00.000Z", sprintScores: scores,
    });
    expect(w.sprint8?.sweatScore).toBe(360);
  });

  it("sees the Sprint 8 structure in the samples: eight power spikes", () => {
    const spikes = sprint8.samples.filter((s) => s.powerWatts > 300);
    expect(spikes.length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...sprint8.samples.map((s) => s.powerWatts))).toBe(400);
    expect(Math.max(...sprint8.samples.map((s) => s.resistanceLevel))).toBe(23);
  });
});

describe("heart rate quality", () => {
  const workouts = loadCachedWorkouts(storage(PERSIST_BLOB));
  const dropouts = findWorkout(workouts, TARGET_HR_DROPOUTS)!;
  const clean = findWorkout(workouts, TARGET_HR_CLEAN)!;
  const sprint8 = findWorkout(workouts, SPRINT_8)!;

  it("flags nothing on a session where the strap held", () => {
    const stats = heartRateStats(clean.samples);
    expect(stats.dropoutCount).toBe(0);
    expect(stats.validCount).toBe(272);
    expect(stats.minBpm).toBe(86);
    expect(stats.maxBpm).toBe(168);
  });

  it("flags the glitches on the session where it did not", () => {
    const stats = heartRateStats(dropouts.samples);
    expect(stats.dropoutCount).toBeGreaterThan(30);
    expect(stats.minBpm).toBeGreaterThan(60);
  });

  it("never lets a zero through", () => {
    const zeros = dropouts.samples
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.heartRateBpm === 0);
    expect(zeros.length).toBeGreaterThan(0);
    const valid = flagHeartRateDropouts(dropouts.samples);
    for (const { i } of zeros) expect(valid[i]).toBe(false);
  });

  it("catches the cold-strap first sample of the Sprint 8 ride", () => {
    expect(sprint8.samples[0]!.heartRateBpm).toBe(45);
    expect(flagHeartRateDropouts(sprint8.samples)[0]).toBe(false);
  });

  it("honours a custom floor", () => {
    const samples = [90, 50, 95].map((bpm, i) => ({ ...clean.samples[i]!, heartRateBpm: bpm }));
    expect(flagHeartRateDropouts(samples, { floorBpm: 40, maxDeltaBpm: 100 })).toEqual([
      true, true, true,
    ]);
    expect(flagHeartRateDropouts(samples, { floorBpm: 60, maxDeltaBpm: 100 })).toEqual([
      true, false, true,
    ]);
  });

  it("does not let a run of bad samples drag the reference down", () => {
    const bpms = [140, 70, 68, 66, 142];
    const samples = bpms.map((bpm, i) => ({ ...clean.samples[i]!, heartRateBpm: bpm }));
    expect(flagHeartRateDropouts(samples)).toEqual([true, false, false, false, true]);
  });

  it("survives a strap that died mid-ride", () => {
    const rec = findWorkout(loadCachedWorkouts(storage(PERSIST_BLOB)), RECUMBENT)!;
    const stats = heartRateStats(rec.samples);
    // 215 of 376 samples are literal zeros — the majority of the ride.
    expect(stats.dropoutCount).toBeGreaterThan(rec.samples.length / 2);
    expect(stats.validCount).toBeGreaterThan(0);
    expect(stats.minBpm).toBeGreaterThan(60);
  });

  it("returns nulls rather than NaN when everything is a dropout", () => {
    const samples = [0, 0].map((bpm, i) => ({ ...clean.samples[i]!, heartRateBpm: bpm }));
    expect(heartRateStats(samples)).toMatchObject({
      minBpm: null, maxBpm: null, meanBpm: null, validCount: 0, dropoutCount: 2,
    });
  });

  it("shows the platform's own average disagreeing with the series", () => {
    // Documented gotcha: reported summaries are not derived from the intervals.
    const stats = heartRateStats(dropouts.samples);
    expect(dropouts.reported.averageHeartRateBpm).toBe(142);
    expect(Math.round(stats.meanBpm!)).not.toBe(142);
    expect(dropouts.reported.minHeartRateBpm).toBe(87);
    expect(stats.minBpm).not.toBe(87);
  });
});
