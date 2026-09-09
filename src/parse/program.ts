/**
 * Console program ("mode") identification.
 *
 * `programType` is the numeric console program id and is the mode marker. Values
 * observed across one account's 43 workouts: 46 (27x), 18 (7x), 20 (4x), 0 (2x),
 * 47 (2x), 38 (1x). Only the two confirmed ones are named here — the rest are
 * deliberately left unmapped rather than guessed at.
 */
export type ProgramMode = "sprint_8" | "target_heart_rate" | "unknown";

export const PROGRAM_MODES: Readonly<Record<number, ProgramMode>> = Object.freeze({
  18: "sprint_8",
  46: "target_heart_rate",
});

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
