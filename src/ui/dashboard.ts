import { buildPanel, elapsedScale, type PanelGeometry } from "../charts/panel.js";
import { LAYOUT, PANEL_HEIGHT, PLOT_BOTTOM } from "../charts/layout.js";
import { nearestIndex } from "../charts/series.js";
import { niceDomain, type LinearScale } from "../charts/scale.js";
import { planWorkout } from "../charts/plan.js";
import { heartRateStats } from "../parse/heartRate.js";
import type { Workout } from "../parse/types.js";
import { clock, km, longDate, machineLabel, modeLabel } from "./format.js";
import { el, svg } from "./svg.js";

export interface DashboardOptions {
  /** Hide our sheet and hand the page back to the site. */
  onShowStock: () => void;
}

/** Build the whole replacement view for one workout. */
export function renderDashboard(workout: Workout, options: DashboardOptions): HTMLElement {
  const plan = planWorkout(workout);
  const x = elapsedScale(plan.elapsedSeconds);
  const panels = plan.panels.map((spec) => buildPanel(spec, x, plan.elapsedSeconds));
  const hr = heartRateStats(workout.samples);

  const wrap = el("div", { class: "wrap" });

  wrap.append(
    topBar(workout, options),
    header(workout, plan.headlineReason),
    ...(panels.length ? [] : [emptyState()]),
  );

  if (panels.length) {
    const readouts = new Map<string, HTMLElement>();
    const consoleRow = readoutConsole(panels, readouts, workout.durationSeconds);
    const stack = panelStack(panels, x, plan.elapsedSeconds, readouts, consoleRow);
    wrap.append(consoleRow.root, stack);
  }

  if (workout.sprint8) wrap.append(sprintSection(workout.sprint8));
  if (panels.length) wrap.append(tableSection(workout, panels));
  wrap.append(footer(workout, plan.control, hr));

  return wrap;
}

/* ---------------------------------------------------------------- top bar */

function topBar(workout: Workout, options: DashboardOptions): HTMLElement {
  const stock = el("button", { type: "button", text: "Show stock page" });
  stock.addEventListener("click", options.onShowStock);
  return el("div", { class: "bar" }, [
    el("span", { class: "eyebrow", text: "Full Matrix Workouts" }),
    el("span", { class: "spacer" }),
    el("span", { class: "eyebrow", text: workout.id }),
    stock,
  ]);
}

/* ----------------------------------------------------------------- header */

function header(workout: Workout, reason: string): HTMLElement {
  const samples = workout.samples.length;
  return el("header", {}, [
    el("div", {
      class: "eyebrow",
      text: `${machineLabel(workout.machineType)} · ${longDate(workout.startedAt)}`,
    }),
    el("h1", { text: `${modeLabel(workout.mode, workout.programType)} telemetry` }),
    el("p", {
      class: "lede",
      text:
        `Every channel the console recorded at 10-second resolution, on one shared clock. ` +
        `Panels are ordered by what the console was holding: ${reason}.`,
    }),
    el("div", { class: "meta" }, [
      metaItem("Duration", clock(workout.durationSeconds)),
      metaItem("Distance", `${km(workout.distanceMeters)} km`),
      ...(workout.calories !== null ? [metaItem("Calories", `${workout.calories} kcal`)] : []),
      metaItem("Samples", String(samples)),
      metaItem("Interval", "10 s"),
    ]),
  ]);
}

function metaItem(key: string, value: string): HTMLElement {
  return el("span", {}, [`${key} `, el("b", { text: value })]);
}

function emptyState(): HTMLElement {
  return el("div", { class: "problem" }, [
    el("h1", { text: "No interval data" }),
    el("p", {
      text:
        "This workout record carries no 10-second samples, so there is nothing to plot. " +
        "The summary above is everything the platform stored for it.",
    }),
  ]);
}

/* --------------------------------------------------------- console readout */

interface ConsoleRow {
  root: HTMLElement;
  clockKey: HTMLElement;
  clockValue: HTMLElement;
  /** What the clock reads when nothing is under the cursor: the ride length. */
  idleClock: string;
}

function readoutConsole(
  panels: PanelGeometry[],
  readouts: Map<string, HTMLElement>,
  totalSeconds: number,
): ConsoleRow {
  const clockKey = el("span", { class: "k", text: "Session average" });
  const clockValue = el("span", { class: "v", text: clock(totalSeconds) });
  // `auto repeat(auto-fit, ...)` collapses to a single column; the count has to be
  // explicit because the number of channels varies by machine and program.
  const root = el("div", {
    class: "console",
    style: `grid-template-columns: auto repeat(${panels.length}, minmax(0, 1fr))`,
  }, [el("div", { class: "clock" }, [clockKey, clockValue])]);

  for (const panel of panels) {
    const value = el("span", {
      text: panel.stats.mean.toFixed(panel.spec.precision ?? 0),
    });
    readouts.set(panel.spec.key, value);
    root.append(
      el("div", { class: "read" }, [
        el("span", { class: "k" }, [
          el("i", { class: "dot", style: `background: var(${panel.spec.colorVar})` }),
          panel.spec.label,
        ]),
        el("span", { class: "v" }, [value, el("small", { text: panel.spec.shortUnit })]),
      ]),
    );
  }
  return { root, clockKey, clockValue, idleClock: clock(totalSeconds) };
}

/* ----------------------------------------------------------------- panels */

function panelStack(
  panels: PanelGeometry[],
  x: LinearScale,
  elapsedSeconds: number[],
  readouts: Map<string, HTMLElement>,
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

  const crosshairs: { line: SVGElement; dot: SVGElement; panel: PanelGeometry }[] = [];

  panels.forEach((panel, index) => {
    const last = index === panels.length - 1;
    const height = last ? PANEL_HEIGHT + LAYOUT.axisHeight : PANEL_HEIGHT;
    const figure = el("figure", {
      class: "panel",
      style: `--accent: var(${panel.spec.colorVar})`,
    });

    const caption = el("figcaption", {}, [
      svgSwatch(),
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
    crosshairs.push({ line, dot, panel });

    if (last) plot.append(...xAxis(x, elapsedSeconds, height));

    figure.append(caption, plot);
    stack.append(figure);
  });

  wireCrosshair(stack, crosshairs, x, elapsedSeconds, readouts, consoleRow, panels);
  return stack;
}

function svgSwatch(): HTMLElement {
  return el("span", { class: "swatch", "aria-hidden": "true" });
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
      text: "minutes elapsed",
    }),
  );
  return out;
}

/* -------------------------------------------------------------- crosshair */

function wireCrosshair(
  stack: HTMLElement,
  crosshairs: { line: SVGElement; dot: SVGElement; panel: PanelGeometry }[],
  x: LinearScale,
  elapsedSeconds: number[],
  readouts: Map<string, HTMLElement>,
  consoleRow: ConsoleRow,
  panels: PanelGeometry[],
): void {
  let current = -1;

  const idle = () => {
    stack.classList.remove("live");
    consoleRow.clockKey.textContent = "Session average";
    consoleRow.clockValue.textContent = consoleRow.idleClock;
    for (const panel of panels) {
      const out = readouts.get(panel.spec.key);
      if (out) out.textContent = panel.stats.mean.toFixed(panel.spec.precision ?? 0);
    }
  };
  idle();

  const show = (index: number) => {
    if (index === current) return;
    current = index;
    if (index < 0) return idle();

    stack.classList.add("live");
    const px = x(elapsedSeconds[index] ?? 0);
    for (const { line, dot, panel } of crosshairs) {
      const value = panel.spec.values[index];
      line.setAttribute("x1", px.toFixed(1));
      line.setAttribute("x2", px.toFixed(1));
      const out = readouts.get(panel.spec.key);
      if (value === null || value === undefined) {
        // A dropout has no position to point at; say so rather than parking the
        // marker on the last good reading.
        dot.setAttribute("opacity", "0");
        if (out) out.textContent = "—";
        continue;
      }
      dot.removeAttribute("opacity");
      dot.setAttribute("cx", px.toFixed(1));
      dot.setAttribute("cy", panel.y(value).toFixed(1));
      if (out) out.textContent = value.toFixed(panel.spec.precision ?? 0);
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

  // Sprint scores cluster tightly (1060-1180 on the reference ride), so bars from
  // zero would all be the same height and hide the only thing worth seeing: whether
  // the rider faded. The baseline is therefore non-zero — and, per the project's own
  // rule, said out loud on the panel rather than left for the reader to infer.
  const [floor, ceiling] = niceDomain(low, high, 3);
  const height = (score: number) => Math.round(((score - floor) / (ceiling - floor)) * 96) + 2;

  const bars = el("div", { class: "sprints" });
  scores.forEach((score, index) => {
    bars.append(
      el("div", { class: "sprint" }, [
        el("span", { class: "v", text: String(score) }),
        el("div", { class: "bar", style: `height: ${height(score)}px` }),
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

  return el("section", { class: "stack" }, [caption, bars]);
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
    for (const panel of panels) {
      const value = panel.spec.values[index];
      row.append(
        el("td", {
          text: value === null || value === undefined ? "—" : value.toFixed(panel.spec.precision ?? 0),
        }),
      );
    }
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
  control: { mode: string; minLevel: number; maxLevel: number; changes: number; meanStep: number },
  hr: ReturnType<typeof heartRateStats>,
): HTMLElement {
  const parts: string[] = [];
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
