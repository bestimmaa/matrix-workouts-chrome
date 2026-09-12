import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ApiError, fetchWorkoutHistory, workoutsUrl, type FetchLike } from "./client.js";
import { readCredentials, redact } from "./credentials.js";
import { WorkoutParseError } from "../parse/types.js";
import { findWorkout } from "../parse/index.js";

const TOKEN = "test-token-do-not-use-a-real-one";
const CREDENTIALS = { exerciserId: "ex-1", token: TOKEN };

/**
 * A real API response record — captured from `apollo.jfit.co`, not converted from a
 * cached one. The API speaks snake_case where the localStorage blob speaks camelCase,
 * and this is the only fixture in the repo that carries the API's own shape, so it is
 * what the client should be tested against.
 *
 * NOTE: no fixture in this repo carries a real bearer token, and none should.
 */
const RECORD = JSON.parse(
  readFileSync("fixtures/raw-6a998daf8d2b6d09c6e334d2.json", "utf8"),
) as Record<string, unknown>;

function respond(body: unknown, status = 200): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function storage(root: unknown): { getItem(key: string): string | null } {
  return { getItem: () => (root === null ? null : JSON.stringify(root)) };
}

function persisted(userStore: Record<string, unknown>) {
  // The blob is double-encoded: an object whose values are JSON strings.
  return { userStore: JSON.stringify(userStore) };
}

describe("readCredentials", () => {
  it("reads the token and id from the persisted profile", () => {
    const store = storage(
      persisted({ exerciserProfile: { token: TOKEN, id: "ex-1" }, workouts: [] }),
    );
    expect(readCredentials(store)).toEqual({ exerciserId: "ex-1", token: TOKEN });
  });

  it("falls back to the ids mirrored elsewhere in the store", () => {
    const store = storage(persisted({ exerciserProfile: { token: TOKEN }, userId: "ex-2" }));
    expect(readCredentials(store).exerciserId).toBe("ex-2");
  });

  it("explains a missing sign-in instead of throwing something opaque", () => {
    const store = storage(persisted({ workouts: [] }));
    expect(() => readCredentials(store)).toThrow(WorkoutParseError);
    expect(() => readCredentials(store)).toThrow(/sign in/i);
  });

  it("explains a signed-in session with no exerciser id", () => {
    const store = storage(persisted({ exerciserProfile: { token: TOKEN } }));
    expect(() => readCredentials(store)).toThrow(/exerciser id/i);
  });

  it("reports an empty browser rather than crashing", () => {
    expect(() => readCredentials(storage(null))).toThrow(WorkoutParseError);
  });
});

describe("redact", () => {
  it("removes the token from anything on its way out", () => {
    expect(redact(`GET ...?auth=${TOKEN} failed`, TOKEN)).toBe("GET ...?auth=[token] failed");
    expect(redact("nothing to hide", TOKEN)).toBe("nothing to hide");
  });
});

describe("workoutsUrl", () => {
  it("targets apollo, not orion, and escapes the id", () => {
    expect(workoutsUrl("ex-1")).toBe("https://apollo.jfit.co/exerciser/ex-1/workouts");
    expect(workoutsUrl("a/b")).toBe("https://apollo.jfit.co/exerciser/a%2Fb/workouts");
  });
});

describe("fetchWorkoutHistory", () => {
  it("is a genuinely snake_case record, not a camelCase one in disguise", () => {
    // If someone "normalizes" this fixture, the client loses its only real test.
    expect(RECORD["workout_id"]).toBe("6a998daf8d2b6d09c6e334d2");
    expect(RECORD["workoutId"]).toBeUndefined();
    const first = (RECORD["intervals"] as Record<string, unknown>[])[0]!;
    expect(first["heart_rate"]).toBeDefined();
    expect(first["average_distance"]).toBeDefined();
    expect(first["averageDistance"]).toBeUndefined();
  });

  it("sends the bearer token and parses the snake_case response", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const fetchImpl: FetchLike = async (url, init) => {
      seen = { url, headers: init.headers };
      return { ok: true, status: 200, json: async () => ({ workouts: [RECORD], paging: {} }) };
    };

    const result = await fetchWorkoutHistory(CREDENTIALS, fetchImpl);

    expect(seen!.url).toBe("https://apollo.jfit.co/exerciser/ex-1/workouts");
    expect(seen!.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(result.workouts).toHaveLength(1);
    expect(result.workouts[0]!.id).toBe("6a998daf8d2b6d09c6e334d2");
    // Intervals survive the round trip: this endpoint is the only source of them.
    expect(result.workouts[0]!.samples).toHaveLength(362);
    expect(result.workouts[0]!.samples[0]!.powerWatts).toBeGreaterThan(0);
  });

  it("returns newest first", async () => {
    const older = { ...RECORD, workout_id: "older", workout_time: "2026-01-01T10:00:00Z" };
    const result = await fetchWorkoutHistory(CREDENTIALS, respond({ workouts: [older, RECORD] }));
    expect(result.workouts.map((w) => w.id)).toEqual(["6a998daf8d2b6d09c6e334d2", "older"]);
  });

  it("accepts a bare array, in case the envelope changes", async () => {
    const result = await fetchWorkoutHistory(CREDENTIALS, respond([RECORD]));
    expect(result.workouts).toHaveLength(1);
  });

  it("skips an unreadable record rather than losing the whole history", async () => {
    const result = await fetchWorkoutHistory(
      CREDENTIALS,
      respond({ workouts: [{ nonsense: true }, RECORD] }),
    );
    expect(result.workouts).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it("reports truncation instead of silently dropping history", async () => {
    const full = await fetchWorkoutHistory(CREDENTIALS, respond({ workouts: [RECORD], paging: { total: 1 } }));
    expect(full.truncated).toBe(false);
    const partial = await fetchWorkoutHistory(CREDENTIALS, respond({ workouts: [RECORD], paging: { total: 43 } }));
    expect(partial.truncated).toBe(true);
  });

  /*
   * The bug this guards: the history came back complete and the view still told the
   * user their workout was not in it. Every ride recorded before 13 Aug 2026 carries
   * a `workout_id` that differs from the `id` in its own /workouts/:id link — 25 of
   * one account's 45 records — so a lookup that knew only `workout_id` missed all of
   * them. The pair below was read live from the API on 12 Sep 2026.
   */
  it("returns history that can be found by the id the site's links carry", async () => {
    const older = {
      ...RECORD,
      workout_id: "6a7cab8cc23a154bebccef65",
      id: "6a7cabca18b66a215bd6d6ad",
      workout_time: "2026-08-12T16:35:08.000Z",
    };
    const result = await fetchWorkoutHistory(CREDENTIALS, respond({ workouts: [older, RECORD] }));

    expect(result.skipped).toBe(0);
    expect(findWorkout(result.workouts, "6a7cabca18b66a215bd6d6ad")!.id).toBe(
      "6a7cab8cc23a154bebccef65",
    );
    // The record's own name still resolves, and the two are not conflated.
    expect(findWorkout(result.workouts, "6a7cab8cc23a154bebccef65")!.routeId).toBe(
      "6a7cabca18b66a215bd6d6ad",
    );
  });

  it("handles an empty history", async () => {
    const result = await fetchWorkoutHistory(CREDENTIALS, respond({ workouts: [], paging: {} }));
    expect(result.workouts).toEqual([]);
  });

  it("tells the user to refresh their sign-in on 401 and 403", async () => {
    for (const status of [401, 403]) {
      await expect(fetchWorkoutHistory(CREDENTIALS, respond({}, status))).rejects.toThrow(/sign-in/i);
    }
  });

  it("carries the status on every failure", async () => {
    const error = await fetchWorkoutHistory(CREDENTIALS, respond({}, 500)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect((error as ApiError).message).toMatch(/try again later/i);
  });

  it("reports a non-JSON body", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });
    await expect(fetchWorkoutHistory(CREDENTIALS, fetchImpl)).rejects.toThrow(/not JSON/i);
  });

  it("never lets the token escape in a transport error", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error(`fetch failed for https://apollo.jfit.co/x?access_token=${TOKEN}`);
    };
    const error = await fetchWorkoutHistory(CREDENTIALS, fetchImpl).catch((e: unknown) => e);
    expect((error as ApiError).message).not.toContain(TOKEN);
    expect((error as ApiError).message).toContain("[token]");
    expect((error as ApiError).status).toBe(0);
  });
});
