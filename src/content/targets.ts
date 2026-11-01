/**
 * The rider's own targets: one watt figure per duration per machine type.
 *
 * Stored in `chrome.storage.local`, and like everything there shown and clearable on
 * the options page. What is stored is the rider's own number, the duration and
 * machine type it is for, and when it was set: nothing from any ride. Whether a
 * target has been reached is worked out from the history every time
 * (`targetState` in `src/ui/milestones.ts`), never stored, so excluding the ride
 * that reached it re-opens it.
 *
 * One target per duration and machine type. Setting another replaces it, and its
 * `setAt` starts again: only rides after that can reach the new number.
 */

import { MAX_TARGET_WATTS } from "../ui/milestones.js";
import { chromeList, readList, serially, writeList, type ListStorage } from "./storedList.js";

export const TARGETS_KEY = "recordTargets";

export interface StoredTarget {
  machineType: string;
  windowSeconds: number;
  /** Whole watts. */
  watts: number;
  /** When it was set, ISO 8601. */
  setAt: string;
}

export type TargetStorage = ListStorage<StoredTarget>;

export const chromeTargets: TargetStorage = chromeList(TARGETS_KEY);

const isStoredTarget = (value: unknown): value is StoredTarget => {
  const v = value as Partial<StoredTarget> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.machineType === "string" &&
    typeof v.windowSeconds === "number" &&
    Number.isInteger(v.watts) &&
    (v.watts ?? 0) > 0 &&
    (v.watts ?? 0) <= MAX_TARGET_WATTS &&
    typeof v.setAt === "string"
  );
};

const sameSlot = (a: Pick<StoredTarget, "machineType" | "windowSeconds">, b: typeof a): boolean =>
  a.machineType === b.machineType && a.windowSeconds === b.windowSeconds;

const bySlot = (a: StoredTarget, b: StoredTarget): number =>
  a.machineType.localeCompare(b.machineType) || a.windowSeconds - b.windowSeconds;

/** What is stored, by machine type and then duration. */
export function loadTargets(storage: TargetStorage): Promise<StoredTarget[]> {
  return readList(storage, isStoredTarget, bySlot);
}

const inOrder = serially();

/** Set the target for one duration on one machine type, replacing any there was. */
export function setTarget(
  storage: TargetStorage,
  target: Omit<StoredTarget, "setAt">,
  now: Date,
): Promise<StoredTarget[]> {
  const next = { ...target, setAt: now.toISOString() };
  if (!isStoredTarget(next)) {
    return Promise.reject(new RangeError(`A target must be a whole number of watts, 1 to ${MAX_TARGET_WATTS}.`));
  }
  return inOrder(async () => {
    const kept = (await loadTargets(storage)).filter((t) => !sameSlot(t, target));
    const targets = [...kept, next].sort(bySlot);
    await writeList(storage, targets);
    return targets;
  });
}

/** Remove one target. The last one gone removes the key entirely. */
export function clearTarget(
  storage: TargetStorage,
  slot: Pick<StoredTarget, "machineType" | "windowSeconds">,
): Promise<StoredTarget[]> {
  return inOrder(async () => {
    const kept = (await loadTargets(storage)).filter((t) => !sameSlot(t, slot));
    await writeList(storage, kept);
    return kept;
  });
}
