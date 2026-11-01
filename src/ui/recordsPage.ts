import { personalRecords, type PowerCurvePoint, type WindowRecord, type Workout } from "matrix-workouts-core";
import { topBar } from "./dashboard.js";
import { machineLabel } from "./format.js";
import {
  MAX_TARGET_WATTS,
  STEP_WATTS,
  exclusionChanges,
  ladder,
  lowestTarget,
  targetState,
  type Ladder,
  type MilestoneChange,
  type Target,
} from "./milestones.js";
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

/** What the page is built from: the fetched history, and what the rider excluded. */
export interface RecordsInput {
  workouts: readonly Workout[];
  /** The API reported more history than it sent. */
  truncated: boolean;
  /** Rides the rider excluded from records, by `Workout.id`, with when each started. */
  excluded: readonly { id: string; startedAt: Date }[];
  /** The rider's own targets, one per duration and machine type at most. */
  targets: readonly Target[];
}

/** The records of one machine type, plus the rides they come from. */
export interface MachineRecords {
  machineType: string;
  rides: number;
  first: Date;
  last: Date;
  records: WindowRecord[];
  /** The rides themselves, for the milestones. */
  workouts: Workout[];
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
        workouts: rides,
      };
    })
    .sort((a, b) => b.rides - a.rides);
}

/**
 * The one thing the page suggests aiming for next, or `null` when there is nothing to
 * suggest. Not the rider's own target, which they set themselves (see `milestones.ts`).
 */
export type Suggestion =
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
export function suggestNext(records: readonly WindowRecord[]): Suggestion | null {
  let best: Suggestion | null = null;
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

/** Exclude the ride an effort came from. Absent, the page offers no exclusion. */
type OnExclude = ((point: PowerCurvePoint) => void) | undefined;

function effortCell(point: PowerCurvePoint | null, empty: string, onExclude: OnExclude): HTMLElement {
  if (!point) return el("td", { class: "empty", text: empty });
  const cell = el("td", {}, [
    el("strong", { text: `${Math.round(point.watts)} W` }),
    " ",
    el("a", { href: `/workouts/${point.routeId}`, text: shortDate(point.startedAt) }),
  ]);
  if (onExclude) {
    const label = `Exclude the ride of ${fullDate(point.startedAt)} from records`;
    const button = el("button", {
      type: "button",
      class: "excludeeffort",
      text: "×",
      title: `${label}. The next best effort takes its place.`,
      "aria-label": label,
    });
    button.addEventListener("click", () => {
      button.disabled = true;
      onExclude(point);
    });
    cell.append(button);
  }
  return cell;
}

/** Recent as a share of all-time: a bar, and the number beside it. */
function formCell(record: WindowRecord): HTMLElement {
  if (!record.allTime || !record.recent) return el("td", { class: "empty", text: "" });
  // The record itself is recent: 100%, which the target line above spells out.
  const share =
    record.recent.workoutId === record.allTime.workoutId
      ? 100
      : Math.min(100, Math.round((record.recent.watts / record.allTime.watts) * 100));
  return el("td", { class: "form" }, [
    el("span", { class: "meter", style: `--share: ${share}%`, "aria-hidden": "true" }),
    `${share}%`,
  ]);
}

function groupTable(name: string, records: readonly WindowRecord[], onExclude: OnExclude): HTMLElement {
  const body = el(
    "tbody",
    {},
    records.map((record) =>
      el("tr", {}, [
        el("th", { scope: "row", text: windowLabel(record.windowSeconds) }),
        effortCell(record.allTime, "not recorded yet", onExclude),
        // One exclude control per ride and row: none here when it is the record's ride.
        effortCell(
          record.recent,
          record.allTime ? "none recently" : "",
          record.recent?.workoutId === record.allTime?.workoutId ? undefined : onExclude,
        ),
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

function targetLine(target: Suggestion | null, idleSince: Date | null): HTMLElement {
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
      el("strong", { text: `Suggested next: a first ${windowLabel(target.windowSeconds)} effort.` }),
      " No ride has held power that long yet.",
    ]);
  }
  if (target.kind === "revisit") {
    const { allTime } = target.record;
    return el("p", { class: "target" }, [
      el("strong", { text: `Suggested next: ${windowLabel(target.record.windowSeconds)} at ${Math.round(allTime.watts) + 1} W.` }),
      ` No ride in the last 8 weeks held power that long. Your record is ${Math.round(allTime.watts)} W, from `,
      el("a", { href: `/workouts/${allTime.routeId}`, text: fullDate(allTime.startedAt) }),
      ".",
    ]);
  }
  const { record, gapWatts } = target;
  return el("p", { class: "target" }, [
    el("strong", { text: `Suggested next: ${windowLabel(record.windowSeconds)} at ${Math.round(record.allTime.watts) + 1} W.` }),
    ` Your best in the last 8 weeks is ${Math.round(record.recent.watts)} W, ${gapWatts} W short of the ` +
      `${Math.round(record.allTime.watts)} W you held on `,
    el("a", { href: `/workouts/${record.allTime.routeId}`, text: fullDate(record.allTime.startedAt) }),
    ".",
  ]);
}

/* ------------------------------------------------------------- milestones */

/** What the milestones block may do: set or clear the rider's own targets. */
interface TargetActions {
  onSet: ((target: Omit<Target, "setAt">) => void) | undefined;
  onClear: ((slot: { machineType: string; windowSeconds: number }) => void) | undefined;
}

/** How many earned steps a row shows before folding the rest into a count. */
const SHOWN_STEPS = 3;

function stepsCell(steps: Ladder): HTMLElement {
  if (steps.earned.length === 0) return el("td", { class: "empty", text: "none yet" });
  const shown = steps.earned.slice(-SHOWN_STEPS);
  const earlier = steps.earned.length - shown.length;
  // The wrapping row is a div inside the cell: a flex `td` stops being a table cell.
  const cell = el("div", { class: "steps" });
  for (const milestone of shown) {
    cell.append(
      el("span", { class: "step" }, [
        `✓ ${milestone.watts} W `,
        el("a", { href: `/workouts/${milestone.effort.routeId}`, text: shortDate(milestone.effort.startedAt) }),
      ]),
    );
  }
  if (earlier > 0) cell.append(el("span", { class: "earlier", text: `+${earlier} earlier` }));
  return el("td", {}, [cell]);
}

function nextCell(steps: Ladder): HTMLElement {
  if (!steps.best) return el("td", { class: "empty", text: "not recorded yet" });
  const gap = steps.next - Math.round(steps.best.watts);
  return el("td", { class: "next", text: `next ${steps.next} W, ${gap} W to go` });
}

/**
 * The rider's own target for one duration: reached, open, or a button to set one.
 * Setting opens a small form in the cell, which only accepts a number above the
 * current best (see `lowestTarget`).
 */
function targetCell(
  machineType: string,
  steps: Ladder,
  target: Target | undefined,
  workouts: readonly Workout[],
  actions: TargetActions,
): HTMLElement {
  const cell = el("td", { class: "owntarget" });
  const slot = { machineType, windowSeconds: steps.windowSeconds };
  const clear = (): HTMLElement[] => {
    if (!actions.onClear) return [];
    const button = el("button", { type: "button", class: "linkbutton", text: "Clear" });
    button.addEventListener("click", () => {
      button.disabled = true;
      actions.onClear!(slot);
    });
    return [button];
  };

  if (target) {
    const state = targetState(target, workouts);
    if (state.reachedBy) {
      cell.append(
        el("strong", { text: `✓ Your ${target.watts} W` }),
        " reached ",
        el("a", { href: `/workouts/${state.reachedBy.routeId}`, text: shortDate(state.reachedBy.startedAt) }),
        " ",
        ...clear(),
      );
    } else {
      const gap = steps.best ? Math.max(1, target.watts - Math.round(steps.best.watts)) : null;
      cell.append(
        el("strong", { text: `Your target ${target.watts} W` }),
        `${gap !== null ? `, ${gap} W to go` : ""} (set ${shortDate(target.setAt)}) `,
        ...clear(),
      );
    }
    return cell;
  }

  if (!actions.onSet) return cell;
  const open = el("button", { type: "button", class: "linkbutton", text: "Set target" });
  open.addEventListener("click", () => {
    const lowest = lowestTarget(steps.best);
    const input = el("input", {
      type: "number",
      min: String(lowest),
      max: String(MAX_TARGET_WATTS),
      step: "1",
      value: String(Math.max(lowest, steps.next)),
      "aria-label": `Target for ${windowLabel(steps.windowSeconds)}, watts`,
    });
    const save = el("button", { type: "submit", class: "linkbutton", text: "Save" });
    const cancel = el("button", { type: "button", class: "linkbutton", text: "Cancel" });
    const error = el("span", { class: "formerror", role: "status" });
    const form = el("form", { class: "targetform" }, [input, " W ", save, cancel, error]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const watts = Number(input.value);
      if (!Number.isInteger(watts) || watts < lowest || watts > MAX_TARGET_WATTS) {
        error.textContent =
          watts < lowest && steps.best
            ? ` Above your best of ${Math.round(steps.best.watts)} W, please.`
            : ` A whole number of watts, ${lowest} to ${MAX_TARGET_WATTS}.`;
        return;
      }
      save.disabled = true;
      actions.onSet!({ ...slot, watts });
    });
    cancel.addEventListener("click", () => cell.replaceChildren(open));
    cell.replaceChildren(form);
    input.focus();
  });
  cell.append(open);
  return cell;
}

/**
 * What excluding rides did to this machine's milestones, one clause per duration.
 * Withdrawn steps are named, because they are what the rider lost. Steps that only
 * moved to a later ride are counted: excluding an early ride re-dates every low step
 * it had earned, and listing 25 W, 50 W, 75 W … would bury the one that matters.
 */
function changesNote(changes: readonly MilestoneChange[]): HTMLElement | null {
  if (changes.length === 0) return null;
  const clauses = RECORD_WINDOWS_SECONDS.flatMap((windowSeconds) => {
    const here = changes.filter((change) => change.windowSeconds === windowSeconds);
    if (here.length === 0) return [];
    const withdrawn = here.filter((change) => !change.now).map((change) => `${change.watts} W`);
    const moved = here.length - withdrawn.length;
    const parts = [
      ...(withdrawn.length ? [`${withdrawn.join(", ")} withdrawn`] : []),
      ...(moved ? [`${moved} now dated to a later ride`] : []),
    ];
    return [`${windowLabel(windowSeconds)}: ${parts.join(", ")}`];
  });
  return el("p", {
    class: "changes",
    text:
      `Changed because you excluded rides. ${clauses.join("; ")}. ` +
      "Each milestone belongs to the first remaining ride that held it.",
  });
}

function milestonesBlock(
  machine: MachineRecords,
  allRides: readonly Workout[],
  targets: readonly Target[],
  actions: TargetActions,
): HTMLElement {
  const own = new Map(
    targets.filter((t) => t.machineType === machine.machineType).map((t) => [t.windowSeconds, t]),
  );
  const rows = RECORD_WINDOWS_SECONDS.map((windowSeconds) => {
    const steps = ladder(machine.workouts, windowSeconds);
    return el("tr", {}, [
      el("th", { scope: "row", text: windowLabel(windowSeconds) }),
      stepsCell(steps),
      nextCell(steps),
      targetCell(machine.machineType, steps, own.get(windowSeconds), machine.workouts, actions),
    ]);
  });
  const note = changesNote(exclusionChanges(allRides, machine.workouts, RECORD_WINDOWS_SECONDS));
  return el("div", { class: "milestones" }, [
    el("h3", { text: "Milestones and your targets" }),
    el("p", {
      class: "explain",
      text:
        `A milestone every ${STEP_WATTS} W at each duration, dated to the first ride that held it. ` +
        "Your own target is reached by the first ride after you set it.",
    }),
    ...(note ? [note] : []),
    el("table", { class: "recordtable milestonetable" }, [el("tbody", {}, rows)]),
  ]);
}

function machineSection(
  machine: MachineRecords,
  recentSince: Date,
  onExclude: OnExclude,
  allRides: readonly Workout[],
  targets: readonly Target[],
  actions: TargetActions,
): HTMLElement {
  const byWindow = new Map(machine.records.map((record) => [record.windowSeconds, record]));
  return el("section", { class: "card recordspage" }, [
    el("figcaption", {}, [
      el("h2", { text: machineLabel(machine.machineType) }),
      el("span", {
        class: "unit",
        text: `${machine.rides} ride${machine.rides === 1 ? "" : "s"}, ${fullDate(machine.first)} to ${fullDate(machine.last)}`,
      }),
    ]),
    targetLine(suggestNext(machine.records), machine.last < recentSince ? recentSince : null),
    el(
      "div",
      { class: "groups" },
      EFFORT_GROUPS.map((group) =>
        groupTable(
          group.name,
          group.windows.map((seconds) => byWindow.get(seconds)).filter((r): r is WindowRecord => r !== undefined),
          onExclude,
        ),
      ),
    ),
    milestonesBlock(machine, allRides, targets, actions),
  ]);
}

/**
 * The rides the rider excluded, each with a way to count it again. A ride the
 * history does not hold (it may be past a truncation) is still listed, by its date.
 */
function excludedSection(
  excluded: RecordsInput["excluded"],
  workouts: readonly Workout[],
  onInclude: ((id: string) => void) | undefined,
): HTMLElement {
  const byId = new Map(workouts.map((workout) => [workout.id, workout]));
  const rows = excluded.map((ride) => {
    const workout = byId.get(ride.id);
    const name = workout
      ? [el("a", { href: `/workouts/${workout.routeId}`, text: fullDate(ride.startedAt) }), ` · ${machineLabel(workout.machineType)}`]
      : [fullDate(ride.startedAt)];
    const item = el("li", {}, [el("span", {}, name)]);
    if (onInclude) {
      const button = el("button", { type: "button", class: "secondary", text: "Count again" });
      button.addEventListener("click", () => {
        button.disabled = true;
        onInclude(ride.id);
      });
      item.append(button);
    }
    return item;
  });
  return el("section", { class: "card excludedrides" }, [
    el("figcaption", {}, [
      el("h2", { text: "Excluded rides" }),
      el("span", { class: "unit", text: `${excluded.length} left out of every record` }),
      el("p", {
        class: "note",
        text: "Excluded because their power looked wrong. Each record above is the best effort without them. Also listed, and clearable, on the extension's options page.",
      }),
    ]),
    el("ul", {}, rows),
  ]);
}

export interface RecordsPageOptions {
  onShowStock: () => void;
  /** Exclude a ride from records. Without it, the page offers no exclusion. */
  onExclude?: (ride: { id: string; startedAt: Date }) => void;
  /** Count an excluded ride again. */
  onInclude?: (id: string) => void;
  /** Set the rider's own target for one duration. Without it, no way to set one. */
  onSetTarget?: (target: Omit<Target, "setAt">) => void;
  /** Clear the rider's own target for one duration. */
  onClearTarget?: (slot: { machineType: string; windowSeconds: number }) => void;
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
    ({ workouts, truncated, excluded, targets }) => {
      const excludedIds = new Set(excluded.map((ride) => ride.id));
      const counted = workouts.filter((workout) => !excludedIds.has(workout.id));
      const machines = machineRecords(counted, recentSince);
      const onExclude: OnExclude = options.onExclude
        ? (point) => options.onExclude!({ id: point.workoutId, startedAt: point.startedAt })
        : undefined;
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
          ? machines.map((machine) =>
              machineSection(
                machine,
                recentSince,
                onExclude,
                workouts.filter((workout) => workout.machineType === machine.machineType),
                targets,
                { onSet: options.onSetTarget, onClear: options.onClearTarget },
              ),
            )
          : [el("p", { class: "lede", text: "No rides in your history yet." })]),
        ...(excluded.length > 0 ? [excludedSection(excluded, workouts, options.onInclude)] : []),
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
