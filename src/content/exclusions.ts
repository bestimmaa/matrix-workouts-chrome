/**
 * Rides the rider has excluded from records.
 *
 * One bad power reading can put a record permanently out of reach, so a rider can
 * take a ride out of every records calculation. The next best effort then takes its
 * place. A whole ride rather than one effort: the console gives no reason to trust
 * the rest of a ride whose power went wrong somewhere, and it is the unit the rider
 * can recognise on the options page.
 *
 * This is the one thing the records keep in `chrome.storage.local`, and like
 * everything there it is shown and clearable on the options page. What is stored is
 * the ride's id and its start time, so the options page can name the ride without
 * the history: no power, no heart rate, nothing from the ride itself.
 */

import { chromeList, readList, serially, writeList, type ListStorage } from "./storedList.js";

export const EXCLUDED_KEY = "excludedRides";

export interface ExcludedRide {
  /** The ride's `workoutId` — `Workout.id`. */
  id: string;
  /** When the ride started, ISO 8601: how the options page names it. */
  startedAt: string;
  /** When it was excluded, ISO 8601. */
  excludedAt: string;
}

export type ExclusionStorage = ListStorage<ExcludedRide>;

export const chromeExclusions: ExclusionStorage = chromeList(EXCLUDED_KEY);

const isExcludedRide = (value: unknown): value is ExcludedRide => {
  const v = value as Partial<ExcludedRide> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.id === "string" &&
    typeof v.startedAt === "string" &&
    typeof v.excludedAt === "string"
  );
};

const oldestFirst = (a: ExcludedRide, b: ExcludedRide): number => a.startedAt.localeCompare(b.startedAt);

/** What is stored, oldest ride first. */
export function loadExcluded(storage: ExclusionStorage): Promise<ExcludedRide[]> {
  return readList(storage, isExcludedRide, oldestFirst);
}

const inOrder = serially();

/** Exclude one ride. Excluding it again changes nothing. */
export function exclude(
  storage: ExclusionStorage,
  ride: { id: string; startedAt: Date },
  now: Date,
): Promise<ExcludedRide[]> {
  return inOrder(async () => {
    const rides = await loadExcluded(storage);
    if (rides.some((r) => r.id === ride.id)) return rides;
    const next = [...rides, { id: ride.id, startedAt: ride.startedAt.toISOString(), excludedAt: now.toISOString() }];
    await writeList(storage, next);
    return next.sort(oldestFirst);
  });
}

/** Count a ride in records again. The last one gone removes the key entirely. */
export function include(storage: ExclusionStorage, id: string): Promise<ExcludedRide[]> {
  return inOrder(async () => {
    const next = (await loadExcluded(storage)).filter((r) => r.id !== id);
    await writeList(storage, next);
    return next;
  });
}
