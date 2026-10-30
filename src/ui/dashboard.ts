import {
  LAYOUT,
  PANEL_HEIGHT,
  PLOT_BOTTOM,
  buildPanel,
  elapsedScale,
  heartRateStats,
  nearestIndex,
  niceDomain,
  planWorkout,
  type ControlSignature,
  type HeartRateStats,
  type LinearScale,
  type PanelGeometry,
  type Workout,
} from "matrix-workouts-core";
import { exportButton, shareMenu, stravaButton, type StravaOutcome } from "./actions.js";
import { clock, hms, km, longDate, machineLabel, modeLabel } from "./format.js";
import { icon } from "./icons.js";
import { el, svg } from "./svg.js";

export interface DashboardOptions {
  /** Hide our sheet and hand the page back to the site. */
  onShowStock: () => void;
  /** Upload this ride to the rider's Strava. Without it there is no Strava button. */
  sendToStrava?: () => Promise<StravaOutcome>;
}

/** Build the whole replacement view for one workout. */
export function renderDashboard(workout: Workout, options: DashboardOptions): HTMLElement {
  const plan = planWorkout(workout);
  const x = elapsedScale(plan.elapsedSeconds);
  const panels = plan.panels.map((spec) => buildPanel(spec, x, plan.elapsedSeconds));
  const hr = heartRateStats(workout.samples);

  // Chrome first, then the page body — the same three bands the stock detail page
  // stacks: black header, cardio title, content plane.
  const page = el("div", { class: "page" }, [
    lede(plan.headlineReason),
    tiles(workout),
    ...(panels.length ? [] : [emptyState()]),
  ]);

  if (panels.length) {
    const consoleRow = readoutConsole(panels, workout.durationSeconds);
    const stack = panelStack(panels, x, plan.elapsedSeconds, consoleRow);
    page.append(el("section", { class: "telemetry" }, [consoleRow.root, stack]));
  }

  if (workout.sprint8) page.append(sprintSection(workout.sprint8));
  if (panels.length) page.append(tableSection(workout, panels));
  page.append(footer(workout, plan.control, hr));

  const actions = [
    ...(options.sendToStrava ? [stravaButton(workout, options.sendToStrava)] : []),
    shareMenu(workout),
    exportButton(workout),
  ];
  return el("div", { class: "wrap" }, [
    topBar(options.onShowStock, longDate(workout.startedAt), actions),
    band(workout),
    page,
  ]);
}

/* ---------------------------------------------------------------- top bar */

/**
 * The stock detail page's black header, slot for slot: a back control on the left,
 * the date (or what stands in for one) in the middle, and the spacer on the right —
 * which is where we sign the view, since the user needs to know whose page this is,
 * and where page-wide actions sit, because they act on the whole page rather than
 * on any one panel. Every view wears this one bar, with or without actions.
 *
 * The back button stays first in the DOM. It is the control a user reaches for to
 * get out, and tab order should hand it to them before four charts' worth of
 * scrubbing.
 */
export function topBar(onShowStock: () => void, title: string, actions: Node[] = []): HTMLElement {
  const stock = el("button", { type: "button", class: "back", text: "Show stock page" });
  stock.addEventListener("click", onShowStock);
  return el("div", { class: "topbar" }, [
    stock,
    el("div", { class: "date", text: title }),
    el("div", { class: "actions" }, [...actions, el("div", { class: "ident", text: "Full Matrix Workouts" })]),
  ]);
}

/**
 * The cardio band. The site colours this strip by workout type — `#ffa400` for
 * cardio, red for strength, teal for anything else — and puts the exercise title
 * in it; on a bike it reads `UPRIGHT_BIKE` and nothing more. Ours carries the mode
 * as well, because which program the console was running is the thing that decides
 * what the panels below say.
 */
function band(workout: Workout): HTMLElement {
  return el("h1", {
    class: "band",
    text: `${machineLabel(workout.machineType)} · ${modeLabel(workout.mode, workout.programType)}`,
  });
}

function lede(reason: string): HTMLElement {
  return el("p", {
    class: "lede",
    text:
      `Every channel the console recorded at 10-second resolution, on one shared clock. ` +
      `Panels are ordered by what the console was holding: ${reason}.`,
  });
}

/* ------------------------------------------------------------ stat tiles */

/**
 * The summary figures, in the site's own metric idiom: a small label in its
 * secondary face, then an icon, the value, and the unit shrunk beside it.
 */
function tiles(workout: Workout): HTMLElement {
  return el("div", { class: "tiles" }, [
    tile("duration", "Duration", hms(workout.durationSeconds)),
    tile("distance", "Distance", [[km(workout.distanceMeters), "km"]]),
    ...(workout.calories !== null
      ? [tile("calories", "Calories", [[String(workout.calories), "kcal"]])]
      : []),
    tile("samples", "Samples", [[String(workout.samples.length), "recorded"]]),
    tile("interval", "Interval", [["10", "s"]]),
  ]);
}

/** One tile. `parts` is value/unit pairs, so `45 m 10 s` is one figure, not two. */
function tile(
  glyph: string,
  label: string,
  parts: readonly (readonly [string, string])[],
): HTMLElement {
  const value = el("span", { class: "v" }, [icon(glyph)]);
  for (const [amount, unit] of parts) {
    value.append(amount, el("small", { text: unit }));
  }
  return el("div", { class: "tile" }, [el("span", { class: "k", text: label }), value]);
}

function emptyState(): HTMLElement {
  // h2, not h1: the cardio band above is this page's heading.
  return el("div", { class: "problem" }, [
    el("h2", { text: "No interval data" }),
    el("p", {
      text:
        "This workout record carries no 10-second samples, so there is nothing to plot. " +
        "The summary above is everything the platform stored for it.",
    }),
  ]);
}

/* --------------------------------------------------------- console readout */

/** A panel's value as the readouts and the table print it; a dropout is a dash. */
function reading(panel: PanelGeometry, value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(panel.spec.precision ?? 0);
}

interface ConsoleRow {
  root: HTMLElement;
  clockKey: HTMLElement;
  clockValue: HTMLElement;
  /** What the clock reads when nothing is under the cursor: the ride length. */
  idleClock: string;
  /** One value cell per panel, in panel order. The crosshair fills them in. */
  readouts: HTMLElement[];
}

function readoutConsole(panels: PanelGeometry[], totalSeconds: number): ConsoleRow {
  const clockKey = el("span", { class: "k" });
  const clockValue = el("span", { class: "v" });
  // `auto repeat(auto-fit, ...)` collapses to a single column, so the count has to
  // be explicit — it varies by machine and program. It is passed as a custom
  // property rather than as the grid declaration itself, because an inline
  // `grid-template-columns` would outrank the narrow-viewport rule that has to
  // break this row onto two lines.
  const root = el("div", {
    class: "console",
    style: `--channels: ${panels.length}`,
  }, [el("div", { class: "clock" }, [clockKey, clockValue])]);

  const readouts = panels.map((panel) => {
    const value = el("span");
    // The channel's colour is the cell's top rule — the site marks its own blocks
    // with a coloured edge rather than a dot, and this row is the closest thing we
    // have to its row of coloured channel buttons.
    root.append(
      el("div", { class: "read", style: `--accent: var(${panel.spec.colorVar})` }, [
        el("span", { class: "k", text: panel.spec.label }),
        el("span", { class: "v" }, [value, el("small", { text: panel.spec.shortUnit })]),
      ]),
    );
    return value;
  });
  return { root, clockKey, clockValue, idleClock: clock(totalSeconds), readouts };
}

/* ----------------------------------------------------------------- panels */

function panelStack(
  panels: PanelGeometry[],
  x: LinearScale,
  elapsedSeconds: number[],
  consoleRow: ConsoleRow,
): HTMLElement {
  const stack = el("div", {
    class: "stack",
    tabindex: "0",
    role: "group",
    "aria-label":
      `${panels.map((p) => p.spec.label).join(", ")} over time on a shared clock. ` +
      "Use left and right arrow keys to scrub, shift for a larger step, escape to clear.",
  });

  const crosshairs: Crosshair[] = [];

  panels.forEach((panel, index) => {
    const last = index === panels.length - 1;
    const height = last ? PANEL_HEIGHT + LAYOUT.axisHeight : PANEL_HEIGHT;
    const figure = el("figure", {
      class: "panel",
      style: `--accent: var(${panel.spec.colorVar})`,
    });

    const caption = el("figcaption", {}, [
      el("span", { class: "swatch", "aria-hidden": "true" }),
      el("h2", { text: panel.spec.label }),
      el("span", { class: "unit", text: panel.spec.unit }),
      el("span", { class: "range", text: panel.summary }),
    ]);
    if (panel.spec.note) caption.append(el("p", { class: "note", text: panel.spec.note }));

    const plot = svg("svg", {
      viewBox: `0 0 ${LAYOUT.viewWidth} ${height}`,
      preserveAspectRatio: "none",
      role: "img",
      "aria-label": panel.ariaLabel,
    });

    for (const tick of panel.yTicks) {
      plot.append(
        svg("line", {
          class: "grid",
          x1: String(LAYOUT.plotLeft),
          y1: tick.y.toFixed(1),
          x2: String(LAYOUT.plotRight),
          y2: tick.y.toFixed(1),
        }),
        svg("text", {
          class: "ytick",
          x: String(LAYOUT.plotLeft - 10),
          y: (tick.y + 3.5).toFixed(1),
          text: tick.label,
        }),
      );
    }

    if (panel.areaPath) {
      plot.append(
        svg("path", { class: "area", d: panel.areaPath, fill: `var(${panel.spec.colorVar})` }),
      );
    }
    plot.append(
      svg("path", { class: "series", d: panel.seriesPath, stroke: `var(${panel.spec.colorVar})` }),
    );

    const line = svg("line", {
      class: "cross",
      x1: "0",
      y1: String(LAYOUT.plotTop - 4),
      x2: "0",
      y2: String(PLOT_BOTTOM),
    });
    const dot = svg("circle", {
      class: "cursor",
      r: "4.5",
      cx: "0",
      cy: "0",
      fill: `var(${panel.spec.colorVar})`,
    });
    plot.append(line, dot);
    crosshairs.push({ line, dot, panel, readout: consoleRow.readouts[index]! });

    if (last) plot.append(...xAxis(x, elapsedSeconds, height));

    figure.append(caption, plot);
    stack.append(figure);
  });

  wireCrosshair(stack, crosshairs, x, elapsedSeconds, consoleRow);
  return stack;
}

/** X ticks live below the plot band, in the last panel's extra height. */
function xAxis(
  x: LinearScale,
  elapsedSeconds: number[],
  height: number,
): SVGElement[] {
  const total = elapsedSeconds[elapsedSeconds.length - 1] ?? 0;
  const minutes = total / 60;
  const stepMinutes = minutes <= 6 ? 1 : minutes <= 15 ? 2 : minutes <= 40 ? 5 : 10;
  const out: SVGElement[] = [];
  for (let m = 0; m * 60 <= total; m += stepMinutes) {
    out.push(
      svg("text", {
        class: "xtick",
        x: x(m * 60).toFixed(1),
        y: (height - 22).toFixed(1),
        text: String(m),
      }),
    );
  }
  out.push(
    svg("text", {
      class: "xlabel",
      x: ((LAYOUT.plotLeft + LAYOUT.plotRight) / 2).toFixed(1),
      y: (height - 6).toFixed(1),
      text: "time (minutes)",
    }),
  );
  return out;
}

/* -------------------------------------------------------------- crosshair */

/** One panel's share of the crosshair: its rule, its marker, and its console cell. */
interface Crosshair {
  line: SVGElement;
  dot: SVGElement;
  panel: PanelGeometry;
  readout: HTMLElement;
}

function wireCrosshair(
  stack: HTMLElement,
  crosshairs: Crosshair[],
  x: LinearScale,
  elapsedSeconds: number[],
  consoleRow: ConsoleRow,
): void {
  let current = -1;

  const idle = () => {
    stack.classList.remove("live");
    consoleRow.clockKey.textContent = "Session average";
    consoleRow.clockValue.textContent = consoleRow.idleClock;
    for (const { panel, readout } of crosshairs) readout.textContent = reading(panel, panel.stats.mean);
  };
  idle();

  const show = (index: number) => {
    if (index === current) return;
    current = index;
    if (index < 0) return idle();

    stack.classList.add("live");
    const px = x(elapsedSeconds[index] ?? 0).toFixed(1);
    for (const { line, dot, panel, readout } of crosshairs) {
      const value = panel.spec.values[index];
      line.setAttribute("x1", px);
      line.setAttribute("x2", px);
      readout.textContent = reading(panel, value);
      if (value === null || value === undefined) {
        // A dropout has no position to point at; say so rather than parking the
        // marker on the last good reading.
        dot.setAttribute("opacity", "0");
        continue;
      }
      dot.removeAttribute("opacity");
      dot.setAttribute("cx", px);
      dot.setAttribute("cy", panel.y(value).toFixed(1));
    }
    consoleRow.clockKey.textContent = "At";
    consoleRow.clockValue.textContent = clock(elapsedSeconds[index] ?? 0);
  };

  const fromPointer = (event: PointerEvent) => {
    const plot = stack.querySelector("svg");
    if (!plot) return;
    const box = plot.getBoundingClientRect();
    if (box.width === 0) return;
    const viewX = ((event.clientX - box.left) / box.width) * LAYOUT.viewWidth;
    const elapsed = x.invert(viewX);
    show(nearestIndex(elapsedSeconds, elapsed));
  };

  stack.addEventListener("pointermove", fromPointer);
  stack.addEventListener("pointerdown", fromPointer);
  stack.addEventListener("pointerleave", () => show(-1));
  stack.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 30 : 1;
    const from = current < 0 ? 0 : current;
    const last = elapsedSeconds.length - 1;
    if (event.key === "ArrowRight") {
      show(Math.min(last, from + step));
      event.preventDefault();
    } else if (event.key === "ArrowLeft") {
      show(Math.max(0, from - step));
      event.preventDefault();
    } else if (event.key === "Escape") {
      show(-1);
    }
  });
}

/* --------------------------------------------------------------- sprint 8 */

function sprintSection(sprint8: NonNullable<Workout["sprint8"]>): HTMLElement {
  const scores = sprint8.scores;
  const low = Math.min(...scores);
  const high = Math.max(...scores);

  // The site draws this bar as a fixed track filled from the bottom, and so do we —
  // but it fills from zero, and we do not. Sprint scores cluster tightly (1060-1180
  // on the reference ride), so from zero every bar is the same height and the only
  // thing worth seeing, whether the rider faded, disappears. The baseline is
  // therefore non-zero — and, per the project's own rule, said out loud on the panel
  // rather than left for the reader to infer.
  const [floor, ceiling] = niceDomain(low, high, 3);
  const fill = (score: number) => Math.round(((score - floor) / (ceiling - floor)) * 98) + 2;

  const bars = el("div", { class: "sprints" });
  scores.forEach((score, index) => {
    bars.append(
      el("div", { class: "sprint" }, [
        el("span", { class: "v", text: String(score) }),
        el("div", { class: "bar", style: `--fill: ${fill(score)}%` }),
        el("span", { class: "n", text: String(index + 1) }),
      ]),
    );
  });

  const caption = el("figcaption", {}, [
    el("h2", { text: "Sprint scores" }),
    el("span", { class: "unit", text: "per sprint" }),
    el("span", {
      class: "range",
      text: `sweat score ${sprint8.sweatScore}${sprint8.programLevel !== null ? ` · level ${sprint8.programLevel}` : ""}`,
    }),
    el("p", {
      class: "note",
      text: `bars start at ${floor}, not zero — the spread across the eight sprints is ${high - low} points`,
    }),
  ]);

  return el("section", { class: "card" }, [caption, bars]);
}

/* ------------------------------------------------------------ table view */

function tableSection(workout: Workout, panels: PanelGeometry[]): HTMLElement {
  const head = el("tr", {}, [el("th", { text: "Time" }), el("th", { text: "km" })]);
  for (const panel of panels) {
    head.append(el("th", { text: `${panel.spec.label} (${panel.spec.shortUnit})` }));
  }

  const body = el("tbody");
  workout.samples.forEach((sample, index) => {
    const row = el("tr", {}, [
      el("td", { text: clock(sample.elapsedSeconds) }),
      el("td", { text: km(sample.cumulativeDistanceMeters) }),
    ]);
    for (const panel of panels) row.append(el("td", { text: reading(panel, panel.spec.values[index]) }));
    body.append(row);
  });

  return el("details", {}, [
    el("summary", { text: `Table view — ${workout.samples.length} samples` }),
    el("div", { class: "tablebox" }, [
      el("table", {}, [el("thead", {}, [head]), body]),
    ]),
  ]);
}

/* ---------------------------------------------------------------- footer */

function footer(
  workout: Workout,
  control: ControlSignature,
  hr: HeartRateStats,
): HTMLElement {
  // The workout id belongs here rather than in the top bar: the bar's third slot
  // collapses on a narrow viewport, and an id that disappears with the layout is
  // not much use when someone is trying to quote which ride they are looking at.
  const parts: string[] = [`Workout ${workout.id}.`];
  if (workout.machineId) parts.push(`Recorded by machine ${workout.machineId.slice(0, 8)}.`);
  parts.push(
    `Resistance moved ${control.changes} times, mean step ${control.meanStep.toFixed(2)} ` +
      `(levels ${control.minLevel}–${control.maxLevel}); control signature "${control.mode}".`,
  );
  if (hr.dropoutCount > 0) {
    parts.push(
      `Heart rate: ${hr.dropoutCount} of ${workout.samples.length} samples filtered as strap dropouts, ` +
        `so the series min/max/avg here differ from the platform's reported ` +
        `${workout.reported.minHeartRateBpm ?? "—"}/${workout.reported.maxHeartRateBpm ?? "—"}/` +
        `${workout.reported.averageHeartRateBpm ?? "—"} bpm, which are not derived from the samples.`,
    );
  }
  parts.push("Read from this browser's cached workout record. Nothing leaves your machine.");
  return el("footer", { text: parts.join(" ") });
}
