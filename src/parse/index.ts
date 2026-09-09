export * from "./types.js";
export * from "./program.js";
export * from "./persist.js";
export * from "./workout.js";
export * from "./heartRate.js";

import { extractRawWorkouts, PERSIST_KEY } from "./persist.js";
import { toWorkout } from "./workout.js";
import type { Workout } from "./types.js";

/** Minimal surface we need from localStorage — keeps this testable without a DOM. */
export interface ReadableStorage {
  getItem(key: string): string | null;
}

/**
 * Read every workout the site has cached in this browser, newest first.
 *
 * Note this is only what the app happens to hold — typically the current week.
 * Deeper history lives behind the HTTP API (see AGENTS.md).
 */
export function loadCachedWorkouts(storage: ReadableStorage): Workout[] {
  return extractRawWorkouts(storage.getItem(PERSIST_KEY))
    .map((raw) => toWorkout(raw as Record<string, unknown>))
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

export function findWorkout(workouts: readonly Workout[], id: string): Workout | null {
  return workouts.find((w) => w.id === id) ?? null;
}
