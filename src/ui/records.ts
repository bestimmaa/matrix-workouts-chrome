import { rideRecords, type PowerCurvePoint, type RideRecord, type Workout } from "matrix-workouts-core";
import { clock, shortDate, wattsText } from "./format.js";
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
}

/**
 * Judge `workout` against `history`, counting only rides on the same machine type.
 * Upright and recumbent console watts are not known to be comparable, and a record
 * set on one should not be counted as beaten on the other.
 */
export function compareRide(workout: Workout, history: readonly Workout[], truncated = false): RideComparison {
  const comparable = history.filter((ride) => ride.machineType === workout.machineType);
  const start = workout.startedAt.getTime();
  return {
    records: rideRecords(workout, comparable, RECORD_WINDOWS_SECONDS),
    compared: comparable.filter((ride) => ride.id !== workout.id && ride.startedAt.getTime() < start).length,
    truncated,
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

function body(comparison: RideComparison): Node[] {
  const lines = comparison.records.map(achievement).filter((line): line is HTMLElement => line !== null);
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

/** The section, in its loading state. The dashboard renders before the history arrives. */
export function recordsSection(): RecordsSection {
  const root = el("section", { class: "card records-card", "aria-live": "polite" }, [
    caption(METHOD),
    el("p", { class: "pending", text: "Loading your history to compare…" }),
  ]);

  return {
    root,
    show(comparison) {
      const range =
        `against ${comparison.compared} earlier ride${comparison.compared === 1 ? "" : "s"}` +
        (comparison.truncated ? ", history incomplete" : "");
      const note = comparison.truncated
        ? `${METHOD}. The API reported more history than it sent, so an older best may be missing.`
        : METHOD;
      root.replaceChildren(caption(note, range), ...body(comparison));
    },
    fail() {
      root.replaceChildren(
        caption(METHOD),
        el("p", { class: "pending", text: "Could not load your history, so this ride is not compared." }),
      );
    },
  };
}
