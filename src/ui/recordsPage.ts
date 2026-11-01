import { personalRecords, type PowerCurvePoint, type WindowRecord, type Workout } from "matrix-workouts-core";
import { topBar } from "./dashboard.js";
import { machineLabel } from "./format.js";
import { RECORD_WINDOWS_SECONDS, windowLabel } from "./records.js";
import { el } from "./svg.js";

/**
 * The records page: every duration's all-time best next to its best in the last
 * eight weeks, per machine type, and one next target.
 *
 * It keeps what a rider has earned (the all-time record never expires) apart from
 * what they hold now (the recent window does). A recent best below the record reads
 * as "this effort left the window", not as a loss. There is no score and no level:
 * see "Cross-ride analysis" in the core repo's AGENTS.md.
 */

/** Eight weeks, as Strava's Power Skills uses for current form. */
export const RECENT_DAYS = 56;

/**
 * Durations grouped by kind of effort, so the page reads as three short lists rather
 * than one long one. Plain names: these are durations, not physiological claims.
 */
export const EFFORT_GROUPS = [
  { name: "Short efforts", windows: [30, 60] },
  { name: "Medium efforts", windows: [300, 600] },
  { name: "Long efforts", windows: [1200, 3600] },
] as const satisfies readonly { name: string; windows: readonly (typeof RECORD_WINDOWS_SECONDS)[number][] }[];

/** What the page is built from: the fetched history, and the clock. */
export interface RecordsInput {
  workouts: readonly Workout[];
  /** The API reported more history than it sent. */
  truncated: boolean;
}

/** The records of one machine type, plus the rides they come from. */
export interface MachineRecords {
  machineType: string;
  rides: number;
  first: Date;
  last: Date;
  records: WindowRecord[];
}

/**
 * Records per machine type, most-ridden first. Console watts are not known to be
 * comparable across machine types, so each gets its own records.
 */
export function machineRecords(workouts: readonly Workout[], recentSince: Date): MachineRecords[] {
  const byType = new Map<string, Workout[]>();
  for (const workout of workouts) {
    const rides = byType.get(workout.machineType) ?? [];
    rides.push(workout);
    byType.set(workout.machineType, rides);
  }
  return [...byType.entries()]
    .map(([machineType, rides]) => {
      const times = rides.map((ride) => ride.startedAt.getTime());
      return {
        machineType,
        rides: rides.length,
        first: new Date(Math.min(...times)),
        last: new Date(Math.max(...times)),
        records: personalRecords(rides, { windowsSeconds: RECORD_WINDOWS_SECONDS, recentSince }),
      };
    })
    .sort((a, b) => b.rides - a.rides);
}

/** The single next thing to aim for, or `null` when there is nothing to suggest. */
export type NextTarget =
  /** The recent best closest to its record, and the gap. */
  | { kind: "beat"; record: WindowRecord & { allTime: PowerCurvePoint; recent: PowerCurvePoint }; gapWatts: number }
  /** A duration no ride has covered yet. */
  | { kind: "first"; windowSeconds: number }
  /** A record with no recent effort at that duration at all. */
  | { kind: "revisit"; record: WindowRecord & { allTime: PowerCurvePoint } };

/**
 * One target, not a list, in this order: among durations whose record was set before
 * the recent window, the one where recent form is closest to it; else the shortest
 * duration never ridden; else the shortest record with no recent effort at all.
 * `null` only when every record was set in the recent window.
 */
export function nextTarget(records: readonly WindowRecord[]): NextTarget | null {
  let best: NextTarget | null = null;
  let bestShare = 0;
  for (const record of records) {
    const { allTime, recent } = record;
    if (!allTime || !recent || recent.workoutId === allTime.workoutId) continue;
    const gapWatts = Math.round(allTime.watts) - Math.round(recent.watts);
    if (gapWatts <= 0) continue;
    const share = recent.watts / allTime.watts;
    if (share > bestShare) {
      bestShare = share;
      best = { kind: "beat", record: { ...record, allTime, recent }, gapWatts };
    }
  }
  if (best) return best;
  const missing = records.find((record) => !record.allTime);
  if (missing) return { kind: "first", windowSeconds: missing.windowSeconds };
  for (const record of records) {
    if (record.allTime && !record.recent) return { kind: "revisit", record: { ...record, allTime: record.allTime } };
  }
  return null;
}

const shortDate = (date: Date): string => date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
const fullDate = (date: Date): string =>
  date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function effortCell(point: PowerCurvePoint | null, empty: string): HTMLElement {
  if (!point) return el("td", { class: "empty", text: empty });
  return el("td", {}, [
    el("strong", { text: `${Math.round(point.watts)} W` }),
    " ",
    el("a", { href: `/workouts/${point.routeId}`, text: shortDate(point.startedAt) }),
  ]);
}

/** Recent as a share of all-time: a bar, and the number beside it. */
function formCell(record: WindowRecord): HTMLElement {
  if (!record.allTime || !record.recent) return el("td", { class: "empty", text: "" });
  if (record.recent.workoutId === record.allTime.workoutId) {
    return el("td", { class: "form current", text: "record is recent" });
  }
  const share = Math.min(100, Math.round((record.recent.watts / record.allTime.watts) * 100));
  return el("td", { class: "form" }, [
    el("span", { class: "meter", style: `--share: ${share}%`, "aria-hidden": "true" }),
    `${share}%`,
  ]);
}

function groupTable(name: string, records: readonly WindowRecord[]): HTMLElement {
  const body = el(
    "tbody",
    {},
    records.map((record) =>
      el("tr", {}, [
        el("th", { scope: "row", text: windowLabel(record.windowSeconds) }),
        effortCell(record.allTime, "not recorded yet"),
        effortCell(record.recent, record.allTime ? "none recently" : ""),
        formCell(record),
      ]),
    ),
  );
  return el("div", { class: "group" }, [
    el("h3", { text: name }),
    el("table", { class: "recordtable" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: "" }),
          el("th", { text: "Best ever" }),
          el("th", { text: "Last 8 weeks" }),
          el("th", { text: "Of best" }),
        ]),
      ]),
      body,
    ]),
  ]);
}

function targetLine(target: NextTarget | null, idleSince: Date | null): HTMLElement {
  if (idleSince) {
    return el("p", { class: "target" }, [
      el("strong", { text: "No rides on this machine in the last 8 weeks." }),
      ` The records below are from before ${fullDate(idleSince)}.`,
    ]);
  }
  if (!target) {
    return el("p", { class: "target" }, [
      el("strong", { text: "Every record is recent." }),
      " Each one was set in the last 8 weeks.",
    ]);
  }
  if (target.kind === "first") {
    return el("p", { class: "target" }, [
      el("strong", { text: `Next: a first ${windowLabel(target.windowSeconds)} effort.` }),
      " No ride has held power that long yet.",
    ]);
  }
  if (target.kind === "revisit") {
    const { allTime } = target.record;
    return el("p", { class: "target" }, [
      el("strong", { text: `Next target: ${windowLabel(target.record.windowSeconds)} at ${Math.round(allTime.watts) + 1} W.` }),
      ` No ride in the last 8 weeks held power that long. Your record is ${Math.round(allTime.watts)} W, from `,
      el("a", { href: `/workouts/${allTime.routeId}`, text: fullDate(allTime.startedAt) }),
      ".",
    ]);
  }
  const { record, gapWatts } = target;
  return el("p", { class: "target" }, [
    el("strong", { text: `Next target: ${windowLabel(record.windowSeconds)} at ${Math.round(record.allTime.watts) + 1} W.` }),
    ` Your best in the last 8 weeks is ${Math.round(record.recent.watts)} W, ${gapWatts} W short of the ` +
      `${Math.round(record.allTime.watts)} W you held on `,
    el("a", { href: `/workouts/${record.allTime.routeId}`, text: fullDate(record.allTime.startedAt) }),
    ".",
  ]);
}

function machineSection(machine: MachineRecords, recentSince: Date): HTMLElement {
  const byWindow = new Map(machine.records.map((record) => [record.windowSeconds, record]));
  return el("section", { class: "card recordspage" }, [
    el("figcaption", {}, [
      el("h2", { text: machineLabel(machine.machineType) }),
      el("span", {
        class: "unit",
        text: `${machine.rides} ride${machine.rides === 1 ? "" : "s"}, ${fullDate(machine.first)} to ${fullDate(machine.last)}`,
      }),
    ]),
    targetLine(nextTarget(machine.records), machine.last < recentSince ? recentSince : null),
    el(
      "div",
      { class: "groups" },
      EFFORT_GROUPS.map((group) =>
        groupTable(
          group.name,
          group.windows.map((seconds) => byWindow.get(seconds)).filter((r): r is WindowRecord => r !== undefined),
        ),
      ),
    ),
  ]);
}

export interface RecordsPageOptions {
  onShowStock: () => void;
  /** Present when the page was opened from a ride: a way back to it. */
  onBackToRide?: () => void;
  /** Today. Passed in so the page is a function of its arguments. */
  now: Date;
}

/**
 * The page, in its loading state; it fills in when `input` resolves. Rides on
 * machines this extension does not handle are left out before it is called.
 */
export function renderRecordsPage(input: Promise<RecordsInput>, options: RecordsPageOptions): HTMLElement {
  const recentSince = new Date(options.now.getTime() - RECENT_DAYS * 86_400_000);
  const body = el("div", { class: "page", "aria-live": "polite" }, [
    el("p", { class: "lede", text: "Loading your history…" }),
  ]);

  const back = options.onBackToRide
    ? (() => {
        const button = el("button", { type: "button", class: "backtoride", text: "Back to ride" });
        button.addEventListener("click", options.onBackToRide);
        return [button];
      })()
    : [];

  input.then(
    ({ workouts, truncated }) => {
      const machines = machineRecords(workouts, recentSince);
      const lede =
        "Your best mean power per duration, from every ride in your history, next to your best since " +
        `${fullDate(recentSince)}. Durations are whole 10-second samples, so 30 s is three readings. ` +
        "Each machine type has its own records, because their watts are not known to be comparable.";
      body.replaceChildren(
        el("p", { class: "lede", text: lede }),
        ...(truncated
          ? [el("p", { class: "lede", text: "The API reported more history than it sent, so an older record may be missing." })]
          : []),
        ...(machines.length > 0
          ? machines.map((machine) => machineSection(machine, recentSince))
          : [el("p", { class: "lede", text: "No rides in your history yet." })]),
      );
    },
    () => {
      body.replaceChildren(
        el("p", { class: "lede", text: "Could not load your history, so there are no records to show. Try again later." }),
      );
    },
  );

  return el("div", { class: "wrap" }, [
    topBar(options.onShowStock, "Records", back),
    el("h1", { class: "band", text: "Personal records" }),
    body,
  ]);
}
