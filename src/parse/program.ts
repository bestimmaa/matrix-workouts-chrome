/**
 * Console program ("mode") identification.
 *
 * `programType` is the numeric console program id and is the mode marker. Values
 * observed across one account's 43 workouts: 46 (27x), 18 (7x), 20 (4x), 0 (2x),
 * 47 (2x), 38 (1x). Only the two confirmed ones are named here — the rest are
 * deliberately left unmapped rather than guessed at.
 */
export type ProgramMode = "sprint_8" | "target_heart_rate" | "ramp_test" | "unknown";

export const PROGRAM_MODES: Readonly<Record<number, ProgramMode>> = Object.freeze({
  18: "sprint_8",        // confirmed: carries sprintScores
  46: "target_heart_rate", // confirmed by the rider
  38: "ramp_test",       // see evidence note below
});

/**
 * Why 38 is named and 0/20/47 are not.
 *
 * Program 38 occurs exactly once in the account and its shape is unambiguous:
 * resistance pinned at level 1 for the entire ride while power climbs a clean
 * staircase, 35 W to 280 W in eight ~2-minute stages at a held cadence. That is a
 * graded exercise test driven in constant-power (ERG) mode, and the rider confirms
 * doing "at least one ramp test". One ride, one signature, one recollection.
 *
 * Programs 0, 20 and 47 stay "unknown". The rider's remaining activities are free
 * rides alongside Apple Fitness+ and a terrain video mapping elevation to
 * resistance, but the telemetry does not separate those three ids: their change
 * rates and step sizes overlap each other AND overlap program 46. Naming them would
 * be a guess dressed as a fact. See AGENTS.md for the evidence table.
 */

export function programMode(programType: number | null | undefined): ProgramMode {
  if (programType == null) return "unknown";
  return PROGRAM_MODES[programType] ?? "unknown";
}

/** The eight per-sprint scores from a Sprint 8 (HIIT) ride, in order 1..8. */
export interface Sprint8Result {
  /** Sum of `scores` — the console's "sweat score". */
  sweatScore: number;
  /** Exactly eight scores, sprint 1 through 8. */
  scores: number[];
  programLevel: number | null;
}
