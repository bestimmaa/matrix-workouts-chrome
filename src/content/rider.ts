/**
 * The rider's weight and sex, for the power ceiling on the records page.
 *
 * Two sources, and only one of them is stored. The site's own profile
 * (`readRider` in core) is read on demand from the session it left in this browser,
 * like the token, and never copied into `chrome.storage`. What the rider types on
 * the records page or the options page is stored, under one key, shown and
 * clearable on the options page, and wins over the profile while it is there.
 */

import type { RiderProfile, RiderSex } from "matrix-workouts-core";
import type { RiderSetting } from "../ui/star.js";

export const RIDER_KEY = "ceilingRider";

/** Bounds on a typed weight: wide, but enough to catch a pound figure typed as kg. */
export const MIN_WEIGHT_KG = 30;
export const MAX_WEIGHT_KG = 200;

export interface StoredRider {
  weightKg: number;
  sex: RiderSex;
  /** When it was set, ISO 8601. */
  setAt: string;
}

export interface RiderStorage {
  load(): Promise<unknown>;
  save(rider: StoredRider): Promise<void>;
  clear(): Promise<void>;
}

export const chromeRider: RiderStorage = {
  load: async () => (await chrome.storage.local.get(RIDER_KEY))[RIDER_KEY],
  save: (rider) => chrome.storage.local.set({ [RIDER_KEY]: rider }),
  clear: () => chrome.storage.local.remove(RIDER_KEY),
};

const isWeight = (value: unknown): value is number =>
  typeof value === "number" && value >= MIN_WEIGHT_KG && value <= MAX_WEIGHT_KG;

const isStoredRider = (value: unknown): value is StoredRider => {
  const v = value as Partial<StoredRider> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    isWeight(v.weightKg) &&
    (v.sex === "male" || v.sex === "female") &&
    typeof v.setAt === "string"
  );
};

/** What is stored, or `null` when nothing (readable) is. */
export async function loadStoredRider(storage: RiderStorage): Promise<StoredRider | null> {
  const stored = await storage.load();
  return isStoredRider(stored) ? stored : null;
}

/** Store what the rider typed. Weight is kept to one decimal. */
export async function saveRider(
  storage: RiderStorage,
  rider: { weightKg: number; sex: RiderSex },
  now: Date,
): Promise<StoredRider> {
  const next = { weightKg: Math.round(rider.weightKg * 10) / 10, sex: rider.sex, setAt: now.toISOString() };
  if (!isStoredRider(next)) {
    throw new RangeError(`A weight must be ${MIN_WEIGHT_KG} to ${MAX_WEIGHT_KG} kg.`);
  }
  await storage.save(next);
  return next;
}

/** The stored setting when there is one, otherwise whatever the profile says. */
export function riderSetting(stored: StoredRider | null, profile: RiderProfile): RiderSetting {
  if (stored) return { weightKg: stored.weightKg, sex: stored.sex, source: "settings" };
  return { weightKg: isWeight(profile.weightKg) ? profile.weightKg : null, sex: profile.sex, source: "profile" };
}
