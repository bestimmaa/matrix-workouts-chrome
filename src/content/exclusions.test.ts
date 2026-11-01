import { describe, expect, it } from "vitest";
import { exclude, include, loadExcluded, type ExcludedRide, type ExclusionStorage } from "./exclusions.js";

/** `chrome.storage.local` for one key, in memory, counting writes. */
function memory(initial?: unknown): ExclusionStorage & { value: unknown; writes: number } {
  const state = {
    value: initial,
    writes: 0,
    load: async () => state.value,
    save: async (rides: ExcludedRide[]) => {
      state.value = JSON.parse(JSON.stringify(rides));
      state.writes += 1;
    },
    clear: async () => {
      state.value = undefined;
      state.writes += 1;
    },
  };
  return state;
}

const NOW = new Date("2026-11-01T12:00:00Z");
const ride = (id: string, day: string) => ({ id, startedAt: new Date(`${day}T07:00:00Z`) });

describe("excluded rides", () => {
  it("starts empty, and keeps id, start and exclusion time — nothing from the ride", async () => {
    const storage = memory();
    expect(await loadExcluded(storage)).toEqual([]);
    await exclude(storage, ride("a", "2026-09-01"), NOW);
    expect(storage.value).toEqual([
      { id: "a", startedAt: "2026-09-01T07:00:00.000Z", excludedAt: "2026-11-01T12:00:00.000Z" },
    ]);
  });

  it("lists rides oldest first, and excluding one twice changes nothing", async () => {
    const storage = memory();
    await exclude(storage, ride("late", "2026-09-10"), NOW);
    await exclude(storage, ride("early", "2026-08-01"), NOW);
    const writes = storage.writes;
    await exclude(storage, ride("late", "2026-09-10"), NOW);
    expect(storage.writes).toBe(writes);
    expect((await loadExcluded(storage)).map((r) => r.id)).toEqual(["early", "late"]);
  });

  it("removes the key when the last ride is counted again", async () => {
    const storage = memory();
    await exclude(storage, ride("a", "2026-09-01"), NOW);
    await exclude(storage, ride("b", "2026-09-02"), NOW);
    expect((await include(storage, "a")).map((r) => r.id)).toEqual(["b"]);
    await include(storage, "b");
    expect(storage.value).toBeUndefined();
  });

  it("keeps both of two exclusions made at once", async () => {
    const storage = memory();
    await Promise.all([exclude(storage, ride("a", "2026-09-01"), NOW), exclude(storage, ride("b", "2026-09-02"), NOW)]);
    expect((await loadExcluded(storage)).map((r) => r.id)).toEqual(["a", "b"]);
    await Promise.all([include(storage, "a"), exclude(storage, ride("c", "2026-09-03"), NOW)]);
    expect((await loadExcluded(storage)).map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("drops unreadable entries instead of failing the records", async () => {
    const storage = memory([{ id: "ok", startedAt: "2026-09-01T07:00:00Z", excludedAt: "x" }, { id: 4 }, null, "junk"]);
    expect((await loadExcluded(storage)).map((r) => r.id)).toEqual(["ok"]);
    expect(await loadExcluded(memory({ not: "a list" }))).toEqual([]);
  });
});
