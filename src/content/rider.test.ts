import { describe, expect, it } from "vitest";
import { loadStoredRider, riderSetting, saveRider, type RiderStorage, type StoredRider } from "./rider.js";

function memory(initial?: unknown): RiderStorage & { value: unknown } {
  const state = {
    value: initial,
    load: async () => state.value,
    save: async (rider: StoredRider) => {
      state.value = JSON.parse(JSON.stringify(rider));
    },
    clear: async () => {
      state.value = undefined;
    },
  };
  return state;
}

const NOW = new Date("2026-11-01T12:00:00Z");

describe("rider", () => {
  it("stores the weight, the sex and when they were set — nothing else", async () => {
    const storage = memory();
    await saveRider(storage, { weightKg: 79.96, sex: "male" }, NOW);
    expect(storage.value).toEqual({ weightKg: 80, sex: "male", setAt: "2026-11-01T12:00:00.000Z" });
    expect(await loadStoredRider(storage)).toEqual(storage.value);
  });

  it("refuses a weight out of bounds, and stores nothing", async () => {
    const storage = memory();
    await expect(saveRider(storage, { weightKg: 176 * 2, sex: "female" }, NOW)).rejects.toThrow(RangeError);
    await expect(saveRider(storage, { weightKg: Number.NaN, sex: "female" }, NOW)).rejects.toThrow(RangeError);
    expect(storage.value).toBeUndefined();
  });

  it("reads an unreadable entry as nothing stored", async () => {
    expect(await loadStoredRider(memory({ weightKg: "80", sex: "male", setAt: "x" }))).toBeNull();
    expect(await loadStoredRider(memory({ weightKg: 80, sex: "other", setAt: "x" }))).toBeNull();
  });

  it("prefers what the rider set over the profile", () => {
    const stored = { weightKg: 75, sex: "female" as const, setAt: NOW.toISOString() };
    expect(riderSetting(stored, { weightKg: 80, sex: "male" })).toEqual({ weightKg: 75, sex: "female", source: "settings" });
  });

  it("falls back to the profile, dropping an implausible weight", () => {
    expect(riderSetting(null, { weightKg: 80, sex: "male" })).toEqual({ weightKg: 80, sex: "male", source: "profile" });
    expect(riderSetting(null, { weightKg: 400, sex: null })).toEqual({ weightKg: null, sex: null, source: "profile" });
  });
});
