import { beats, bestEffort, type PowerCurvePoint, type Workout } from "matrix-workouts-core";

/**
 * Milestones and the rider's own targets, worked out from the history.
 *
 * **Milestones are fixed watt steps**, every `STEP_WATTS` at each duration: 175, 200,
 * 225 W. A step is earned by the first ride, in date order, whose best effort at that
 * duration reaches it. The rule is plain and the same for everyone, and it is not a
 * benchmark: a step says nothing about how good 225 W is, only that this rider held it.
 *
 * **Nothing about a milestone is stored.** Recomputed from the same rides, the same
 * milestones come out with the same dates, because a step's earner is the first ride
 * to reach it and later rides cannot change who was first. Only two things change a
 * milestone, and both are the rider's own doing:
 * - excluding the ride that earned it. The step moves to the next ride that
 *   genuinely reached it, or goes back to not earned, and `exclusionChanges` names it.
 * - history that is no longer returned. The page says so when the API reports
 *   truncation.
 *
 * **A target is the rider's own number** for one duration on one machine type, and it
 * is stored (see `src/content/targets.ts`). It is reached by the first ride after it
 * was set whose best effort holds it. Rides before it was set cannot reach it: the
 * page only lets a target be set above the current best.
 *
 * Every comparison is on rounded watts, as everywhere else in the records: a step is
 * reached when the effort *displays* at or above it.
 */

export const STEP_WATTS = 25;

/** The largest target accepted, watts. Far above anything a console has recorded. */
export const MAX_TARGET_WATTS = 2000;

const shown = (point: PowerCurvePoint): number => Math.round(point.watts);

/** One ride's best effort at one duration, for each ride that has one, oldest first. */
function effortsInOrder(rides: readonly Workout[], windowSeconds: number): PowerCurvePoint[] {
  return rides
    .map((ride) => bestEffort(ride, windowSeconds))
    .filter((effort): effort is PowerCurvePoint => effort !== null)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

export interface Milestone {
  windowSeconds: number;
  /** The step, watts: a multiple of `STEP_WATTS`. */
  watts: number;
  /** The effort that first reached it. */
  effort: PowerCurvePoint;
}

export interface Ladder {
  windowSeconds: number;
  /** Every step earned, lowest first. */
  earned: Milestone[];
  /** The best effort so far; `null` when no ride covers the duration. */
  best: PowerCurvePoint | null;
  /** The next step above the best, or the first step when nothing is recorded. */
  next: number;
}

/** The milestones of one duration over `rides`, which the caller has already filtered. */
export function ladder(rides: readonly Workout[], windowSeconds: number): Ladder {
  const earned: Milestone[] = [];
  let best: PowerCurvePoint | null = null;
  let top = 0;
  for (const effort of effortsInOrder(rides, windowSeconds)) {
    if (!best || beats(effort, best)) best = effort;
    const reached = Math.floor(shown(effort) / STEP_WATTS) * STEP_WATTS;
    for (let watts = top + STEP_WATTS; watts <= reached; watts += STEP_WATTS) {
      earned.push({ windowSeconds, watts, effort });
    }
    top = Math.max(top, reached);
  }
  return { windowSeconds, earned, best, next: top + STEP_WATTS };
}

/** The highest step one ride earned at each duration, for its post-ride line. */
export function milestonesEarnedBy(workout: Workout, rides: readonly Workout[], windowsSeconds: readonly number[]): Milestone[] {
  return windowsSeconds.flatMap((windowSeconds) => {
    const mine = ladder(rides, windowSeconds).earned.filter((m) => m.effort.workoutId === workout.id);
    return mine.length > 0 ? [mine[mine.length - 1]!] : [];
  });
}

/** A milestone an exclusion changed: moved to a later ride, or withdrawn (`now: null`). */
export interface MilestoneChange {
  windowSeconds: number;
  watts: number;
  /** The excluded ride that had earned it. */
  was: PowerCurvePoint;
  now: PowerCurvePoint | null;
}

/**
 * What excluding rides did to the milestones: each step that an excluded ride had
 * earned, and who holds it now. `allRides` includes the excluded ones, `counted` does
 * not; both are one machine type.
 */
export function exclusionChanges(
  allRides: readonly Workout[],
  counted: readonly Workout[],
  windowsSeconds: readonly number[],
): MilestoneChange[] {
  const countedIds = new Set(counted.map((ride) => ride.id));
  return windowsSeconds.flatMap((windowSeconds) => {
    const now = new Map(ladder(counted, windowSeconds).earned.map((m) => [m.watts, m.effort]));
    return ladder(allRides, windowSeconds)
      .earned.filter((m) => !countedIds.has(m.effort.workoutId))
      .map((m) => ({ windowSeconds, watts: m.watts, was: m.effort, now: now.get(m.watts) ?? null }));
  });
}

/** A target as the page sees it: the rider's number, and whether a ride has held it. */
export interface Target {
  machineType: string;
  windowSeconds: number;
  watts: number;
  setAt: Date;
}

export interface TargetState {
  target: Target;
  /** The first ride after the target was set that held it; `null` while open. */
  reachedBy: PowerCurvePoint | null;
}

/** Whether `target` has been reached, by rides of its own machine type. */
export function targetState(target: Target, rides: readonly Workout[]): TargetState {
  const since = target.setAt.getTime();
  const reachedBy =
    effortsInOrder(
      rides.filter((ride) => ride.machineType === target.machineType && ride.startedAt.getTime() >= since),
      target.windowSeconds,
    ).find((effort) => shown(effort) >= target.watts) ?? null;
  return { target, reachedBy };
}

/**
 * The lowest target the page accepts: one watt above the current best, as displayed.
 * A target at or below the best would be reached by a ride from before it was set,
 * which `targetState` does not count, and so would never read as reached.
 */
export function lowestTarget(best: PowerCurvePoint | null): number {
  return best ? shown(best) + 1 : 1;
}
