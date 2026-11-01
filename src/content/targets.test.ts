import { describe, expect, it } from "vitest";
import { clearTarget, loadTargets, setTarget, type StoredTarget, type TargetStorage } from "./targets.js";

function memory(initial?: unknown): TargetStorage & { value: unknown } {
  const state = {
    value: initial,
    load: async () => state.value,
    save: async (targets: StoredTarget[]) => {
      state.value = JSON.parse(JSON.stringify(targets));
    },
    clear: async () => {
      state.value = undefined;
    },
  };
  return state;
}

const NOW = new Date("2026-11-01T12:00:00Z");
const fiveMin = { machineType: "upright_bike", windowSeconds: 300 };

describe("targets", () => {
  it("stores the rider's number, its slot and when it was set — nothing else", async () => {
    const storage = memory();
    await setTarget(storage, { ...fiveMin, watts: 240 }, NOW);
    expect(storage.value).toEqual([{ ...fiveMin, watts: 240, setAt: "2026-11-01T12:00:00.000Z" }]);
  });

  it("keeps one target per duration and machine type: a new one replaces it and restarts its clock", async () => {
    const storage = memory();
    await setTarget(storage, { ...fiveMin, watts: 240 }, NOW);
    await setTarget(storage, { machineType: "recumbent_bike", windowSeconds: 300, watts: 200 }, NOW);
    const later = new Date("2026-11-05T12:00:00Z");
    const targets = await setTarget(storage, { ...fiveMin, watts: 250 }, later);
    expect(targets).toHaveLength(2);
    expect(targets.find((t) => t.machineType === "upright_bike")).toEqual({ ...fiveMin, watts: 250, setAt: later.toISOString() });
  });

  it("keeps both of two targets set at once", async () => {
    const storage = memory();
    await Promise.all([
      setTarget(storage, { ...fiveMin, watts: 240 }, NOW),
      setTarget(storage, { machineType: "upright_bike", windowSeconds: 1200, watts: 170 }, NOW),
    ]);
    expect((await loadTargets(storage)).map((t) => t.windowSeconds)).toEqual([300, 1200]);
  });

  it("refuses a number that is not a sensible whole number of watts", async () => {
    const storage = memory();
    for (const watts of [0, -5, 12.5, 2001, Number.NaN]) {
      await expect(setTarget(storage, { ...fiveMin, watts }, NOW)).rejects.toThrow(RangeError);
    }
    expect(storage.value).toBeUndefined();
  });

  it("removes the key when the last target is cleared, and drops unreadable entries", async () => {
    const storage = memory();
    await setTarget(storage, { ...fiveMin, watts: 240 }, NOW);
    await clearTarget(storage, fiveMin);
    expect(storage.value).toBeUndefined();
    const junk = memory([{ ...fiveMin, watts: "lots", setAt: "x" }, null, { ...fiveMin, watts: 230, setAt: "2026-11-01T00:00:00Z" }]);
    expect((await loadTargets(junk)).map((t) => t.watts)).toEqual([230]);
  });
});
