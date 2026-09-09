/**
 * Console program ("mode") identification.
 *
 * `programType` is the numeric console program id and is the mode marker. Values
 * observed across one account's 43 workouts: 46 (27x), 18 (7x), 20 (4x), 0 (2x),
 * 47 (2x), 38 (1x). Only the two confirmed ones are named here — the rest are
 * deliberately left unmapped rather than guessed at.
 */
export type ProgramMode =
  | "sprint_8"
  | "target_heart_rate"
  | "target_watts"
  | "fitness_test"
  | "unknown";

export const PROGRAM_MODES: Readonly<Record<number, ProgramMode>> = Object.freeze({
  18: "sprint_8",          // carries sprintScores; confirmed by rider
  46: "target_heart_rate", // confirmed by rider and by their training log
  20: "target_watts",      // all 4 rides are watt-target sessions in the log
  38: "fitness_test",      // console VO2 / Cooper test; exact match in the log
});

/**
 * How these were established, and why 0 and 47 are still unknown.
 *
 * The rider keeps a Notion training log with a dated row per session. Matching ride
 * dates and durations against it identifies the modes directly, rather than by
 * inference from the telemetry:
 *
 *  - **20 = target watts.** All four program-20 rides are explicitly watt-target
 *    sessions in the log ("2x18 min at 145-150 W", "4x4 @ 200 W", "2x18 min @
 *    155 W", "2x20 min @ 155 W"). The 2026-08-12 ride matches its log row exactly:
 *    46.07 min, 22.29 km, 129 W average.
 *  - **38 = fitness test.** The single program-38 ride matches the log's
 *    "Fitness test / indoor bike" row exactly: 2026-07-20, 902 s, 7419 m, 148 W
 *    average against a logged 149 W. The console reported a VO2 estimate and
 *    "final stage completed: 7", which is why the series shows eight power stages
 *    at a fixed resistance.
 *  - **46 = target heart rate**, independently corroborated by log entries that
 *    name the mode ("Relaxed Zone 2 ride in Target HR mode", "Target HR was 139").
 *
 * Programs 0 and 47 remain "unknown": their rides are in the log but no entry names
 * a console mode, and the telemetry does not separate them. Program 0 is plausibly
 * manual / quick-start (that is the usual console convention for id 0, and both
 * rides are short unstructured efforts) but that is a convention, not evidence.
 *
 * A power-plateau heuristic was tried as a way to detect watt-target rides from the
 * data alone and REJECTED: across all 43 rides, program 20 scores 0.50-0.76 but
 * three program-46 rides score 0.51-0.72, so any threshold misclassifies them.
 * Use programType for this, not a derived signal.
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
