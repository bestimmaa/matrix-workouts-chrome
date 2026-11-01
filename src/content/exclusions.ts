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

export const EXCLUDED_KEY = "excludedRides";

export interface ExcludedRide {
  /** The ride's `workoutId` — `Workout.id`. */
  id: string;
  /** When the ride started, ISO 8601: how the options page names it. */
  startedAt: string;
  /** When it was excluded, ISO 8601. */
  excludedAt: string;
}

/** Storage, injected so the rules here are tested without `chrome`. */
export interface ExclusionStorage {
  load(): Promise<unknown>;
  save(rides: ExcludedRide[]): Promise<void>;
  clear(): Promise<void>;
}

export const chromeExclusions: ExclusionStorage = {
  load: async () => (await chrome.storage.local.get(EXCLUDED_KEY))[EXCLUDED_KEY],
  save: (rides) => chrome.storage.local.set({ [EXCLUDED_KEY]: rides }),
  clear: () => chrome.storage.local.remove(EXCLUDED_KEY),
};

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

/**
 * What is stored, oldest ride first. Anything unreadable is dropped rather than
 * thrown: a broken entry must not stop the records from drawing.
 */
export async function loadExcluded(storage: ExclusionStorage): Promise<ExcludedRide[]> {
  const stored = await storage.load();
  if (!Array.isArray(stored)) return [];
  return stored.filter(isExcludedRide).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/**
 * Run read-modify-write changes one after another. Two quick clicks (× on two
 * records) would otherwise both read the list before either saved, and the second
 * save would silently undo the first. This orders the writes made from one page;
 * a tab and the options page are separate pages and can still interleave, which
 * needs two people's worth of clicking at once.
 */
export function serially(): <T>(change: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return (change) => {
    const run = last.then(change, change);
    last = run.catch(() => undefined);
    return run;
  };
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
    await storage.save(next);
    return loadExcluded(storage);
  });
}

/** Count a ride in records again. The last one gone removes the key entirely. */
export function include(storage: ExclusionStorage, id: string): Promise<ExcludedRide[]> {
  return inOrder(async () => {
    const next = (await loadExcluded(storage)).filter((r) => r.id !== id);
    if (next.length === 0) await storage.clear();
    else await storage.save(next);
    return next;
  });
}
