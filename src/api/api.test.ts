import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ApiError, fetchWorkoutHistory, workoutsUrl, type FetchLike } from "./client.js";
import { readCredentials, redact } from "./credentials.js";
import { WorkoutParseError } from "../parse/types.js";

const TOKEN = "test-token-do-not-use-a-real-one";
const CREDENTIALS = { exerciserId: "ex-1", token: TOKEN };

/**
 * The API speaks snake_case where the cached blob speaks camelCase, so the test
 * data is a real fixture with its keys converted — the shape the client actually
 * meets, rather than the one the parser tests already cover.
 *
 * NOTE: no fixture in this repo carries a real bearer token, and none should.
 */
function snakeCase(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeCase);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, v]) => [
      key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
      snakeCase(v),
    ]),
  );
}

const RECORD = snakeCase(
  JSON.parse(readFileSync("fixtures/raw-6aa045668d2b6d09c612785d.json", "utf8")),
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
    expect(result.workouts[0]!.id).toBe("6aa045668d2b6d09c612785d");
    // Intervals survive the round trip: this endpoint is the only source of them.
    expect(result.workouts[0]!.samples).toHaveLength(272);
    expect(result.workouts[0]!.samples[0]!.powerWatts).toBeGreaterThan(0);
  });

  it("returns newest first", async () => {
    const older = { ...RECORD, workout_id: "older", workout_time: "2026-01-01T10:00:00Z" };
    const result = await fetchWorkoutHistory(CREDENTIALS, respond({ workouts: [older, RECORD] }));
    expect(result.workouts.map((w) => w.id)).toEqual(["6aa045668d2b6d09c612785d", "older"]);
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
