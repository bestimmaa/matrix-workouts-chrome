import { rideRecords, type PowerCurvePoint, type RideRecord, type Workout } from "matrix-workouts-core";
import { clock, shortDate, wattsText } from "./format.js";
import { milestonesEarnedBy, targetState, type Milestone, type Target, type TargetState } from "./milestones.js";
import { el } from "./svg.js";

/**
 * The post-ride records line: what this ride did against every earlier ride.
 *
 * It says only what the rider's own history supports. There is no score, level or
 * population benchmark, and "first" stays apart from "record": the first ride long
 * enough to hold 20 minutes has done something new without beating anything. See
 * "Cross-ride analysis" in the core repo's AGENTS.md for the rules the numbers follow.
 */

/**
 * The durations judged. Core's defaults minus 10 s: a 10 s "best" is a single
 * sample's reading, and showing it next to the others would suggest a sprint peak
 * this data cannot measure. 30 s is three samples and is labelled as coarse.
 */
export const RECORD_WINDOWS_SECONDS = [30, 60, 300, 600, 1200, 3600] as const;

/** What the content script hands the view once the history is in. */
export interface RideComparison {
  records: RideRecord[];
  /** Earlier rides of the same machine type the verdicts were judged against. */
  compared: number;
  /** The API said it holds more history than it returned. */
  truncated: boolean;
  /** The rider excluded this ride from records: it is not judged. */
  excluded: boolean;
  /** Earlier rides of the same machine type left out because the rider excluded them. */
  excludedEarlier: number;
  /** The highest milestone this ride earned at each duration where it earned one. */
  milestones: Milestone[];
  /** The rider's own targets this ride was the first to reach. */
  targetsReached: TargetState[];
}

export interface CompareOptions {
  /** The API reported more history than it sent. */
  truncated?: boolean;
  /** Rides the rider excluded from records, by `Workout.id`. */
  excludedIds?: ReadonlySet<string>;
  /** The rider's own targets, any machine type. */
  targets?: readonly Target[];
}

/**
 * Judge `workout` against `history`, counting only rides on the same machine type.
 * Upright and recumbent console watts are not known to be comparable, and a record
 * set on one should not be counted as beaten on the other. Rides in `excludedIds`
 * are left out, so the next best effort stands in for an excluded one.
 */
export function compareRide(
  workout: Workout,
  history: readonly Workout[],
  { truncated = false, excludedIds = new Set(), targets = [] }: CompareOptions = {},
): RideComparison {
  const start = workout.startedAt.getTime();
  const earlier = history.filter(
    (ride) => ride.machineType === workout.machineType && ride.id !== workout.id && ride.startedAt.getTime() < start,
  );
  const counted = earlier.filter((ride) => !excludedIds.has(ride.id));
  const excluded = excludedIds.has(workout.id);
  // Who earned a milestone or reached a target first depends only on rides up to
  // this one, so the verdict does not change as the history grows past it.
  const upToHere = excluded ? counted : [...counted, workout];
  return {
    records: rideRecords(workout, counted, RECORD_WINDOWS_SECONDS),
    compared: counted.length,
    truncated,
    excluded,
    excludedEarlier: earlier.length - counted.length,
    milestones: excluded ? [] : milestonesEarnedBy(workout, upToHere, RECORD_WINDOWS_SECONDS),
    targetsReached: excluded
      ? []
      : targets
          .filter((target) => target.machineType === workout.machineType)
          .map((target) => targetState(target, upToHere))
          .filter((state) => state.reachedBy?.workoutId === workout.id),
  };
}

/** `30 s`, `1 min`, `20 min`, `60 min`. Short, because it sits beside a number. */
export function windowLabel(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${seconds / 60} min`;
}

const watts = (point: PowerCurvePoint): string => wattsText(point.watts);

/** A link to the ride a record came from, so every number can be checked. */
function rideLink(point: PowerCurvePoint): HTMLElement {
  return el("a", { href: `/workouts/${point.routeId}`, text: shortDate(point.startedAt) });
}

/** One line per first effort or new record, in window order. */
function achievement(record: RideRecord): HTMLElement | null {
  const effort = record.effort;
  if (!effort) return null;
  const at = `at ${clock(effort.atSeconds)}`;

  if (record.outcome === "first") {
    return el("li", { class: "first" }, [
      el("strong", { text: `First ${windowLabel(record.windowSeconds)} effort` }),
      ` ${watts(effort)}, ${at}`,
    ]);
  }
  if (record.outcome === "record" && record.previous) {
    const gain = Math.round(effort.watts) - Math.round(record.previous.watts);
    return el("li", { class: "record" }, [
      el("strong", { text: `New ${windowLabel(record.windowSeconds)} best` }),
      ` ${watts(effort)}, ${at}: up ${gain} W on ${watts(record.previous)} from `,
      rideLink(record.previous),
    ]);
  }
  return null;
}

/**
 * When nothing was won: the one target this ride came closest to, by share of the
 * record, so a rider sees how near the next best effort is.
 */
function nearest(records: readonly RideRecord[]): HTMLElement | null {
  let best: RideRecord | null = null;
  let bestShare = 0;
  for (const record of records) {
    if (record.outcome !== "below-record" || !record.effort || !record.previous) continue;
    const share = record.effort.watts / record.previous.watts;
    if (share > bestShare) {
      best = record;
      bestShare = share;
    }
  }
  if (!best?.effort || !best.previous) return null;
  // Below the record means at most level with it, on the rounded figures shown.
  const short = Math.round(best.previous.watts) - Math.round(best.effort.watts);
  return el("p", { class: "nearest" }, [
    `Closest to a record: ${windowLabel(best.windowSeconds)} at ${watts(best.effort)}, ` +
      (short > 0 ? `${short} W short of` : "level with") +
      ` your ${watts(best.previous)} from `,
    rideLink(best.previous),
    ".",
  ]);
}

/** A target the rider set, reached by this ride. Their own number, so it leads. */
function targetLine(state: TargetState): HTMLElement {
  const { target } = state;
  return el("li", { class: "target" }, [
    el("strong", { text: `Your ${windowLabel(target.windowSeconds)} target reached` }),
    ` ${target.watts} W, set ${shortDate(target.setAt)}`,
  ]);
}

/** The highest watt step this ride earned at one duration. */
function milestoneLine(milestone: Milestone): HTMLElement {
  return el("li", { class: "milestone" }, [
    el("strong", { text: `${windowLabel(milestone.windowSeconds)} milestone` }),
    ` ${milestone.watts} W, at ${clock(milestone.effort.atSeconds)}`,
  ]);
}

function body(comparison: RideComparison): Node[] {
  const lines = [
    ...comparison.targetsReached.map(targetLine),
    ...comparison.records.map(achievement).filter((line): line is HTMLElement => line !== null),
    ...comparison.milestones.map(milestoneLine),
  ];
  const nodes: Node[] = [];
  if (lines.length > 0) nodes.push(el("ul", { class: "records" }, lines));
  else nodes.push(el("p", { text: "No new records on this ride." }));

  const target = lines.length > 0 ? null : nearest(comparison.records);
  if (target) nodes.push(target);
  return nodes;
}

function caption(note: string, range = ""): HTMLElement {
  return el("figcaption", {}, [
    el("h2", { text: "Records" }),
    el("span", { class: "unit", text: "best mean power" }),
    ...(range ? [el("span", { class: "range", text: range })] : []),
    el("p", { class: "note", text: note }),
  ]);
}

const METHOD =
  "over whole 10-second samples, so a 30 s best is three readings; compared only with earlier rides on this machine type";

export interface RecordsSection {
  root: HTMLElement;
  /** Fill in once the history has loaded. */
  show(comparison: RideComparison): void;
  /** The history could not be loaded; say so without taking the page down. */
  fail(): void;
}

export interface RecordsSectionOptions {
  /** Open the records page. Without it, no button to it. */
  onShowAll?: () => void;
  /** Exclude this ride from records, or count it again. Without it, no button. */
  onToggleExcluded?: () => void;
}

/**
 * The section, in its loading state. The dashboard renders before the history
 * arrives. A filled section ends with its buttons: to the records page, and to
 * exclude the ride (or include it again).
 */
export function recordsSection({ onShowAll, onToggleExcluded }: RecordsSectionOptions = {}): RecordsSection {
  const buttons = (excluded: boolean): Node[] => {
    const row: HTMLElement[] = [];
    if (onShowAll) {
      const button = el("button", { type: "button", class: "allrecords", text: "All records" });
      button.addEventListener("click", onShowAll);
      row.push(button);
    }
    if (onToggleExcluded) {
      const button = el("button", {
        type: "button",
        class: "exclude secondary",
        text: excluded ? "Count in records again" : "Exclude from records",
        title: excluded
          ? "Count this ride in records again. Its efforts can be records once more."
          : "If this ride's power looks wrong, exclude it: none of its efforts count as a record, " +
            "and the next best takes their place. Undo any time, here or on the options page.",
      });
      button.addEventListener("click", () => {
        button.disabled = true;
        onToggleExcluded();
      });
      row.push(button);
    }
    return row.length ? [el("div", { class: "recordbuttons" }, row)] : [];
  };

  const root = el("section", { class: "card records-card", "aria-live": "polite" }, [
    caption(METHOD),
    el("p", { class: "pending", text: "Loading your history to compare…" }),
  ]);

  return {
    root,
    show(comparison) {
      if (comparison.excluded) {
        root.replaceChildren(
          caption(METHOD, "excluded"),
          el("p", {
            text:
              "You excluded this ride from records, so it is not compared, and none of its " +
              "efforts count as a record anywhere.",
          }),
          ...buttons(true),
        );
        return;
      }
      const range =
        `against ${comparison.compared} earlier ride${comparison.compared === 1 ? "" : "s"}` +
        (comparison.excludedEarlier > 0 ? ` (${comparison.excludedEarlier} excluded)` : "") +
        (comparison.truncated ? ", history incomplete" : "");
      const note = comparison.truncated
        ? `${METHOD}. The API reported more history than it sent, so an older best may be missing.`
        : METHOD;
      root.replaceChildren(caption(note, range), ...body(comparison), ...buttons(false));
    },
    fail() {
      root.replaceChildren(
        caption(METHOD),
        el("p", { class: "pending", text: "Could not load your history, so this ride is not compared." }),
      );
    },
  };
}
