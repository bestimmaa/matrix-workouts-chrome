import {
  ceilingWatts,
  shownWatts,
  starChart,
  type PowerCurvePoint,
  type RiderSex,
  type StarGeometry,
  type StarSpokeInput,
  type WindowRecord,
} from "matrix-workouts-core";
import { windowLabel } from "./records.js";
import { el, svg } from "./svg.js";

/**
 * The power-skills star on the records page: one spoke per judged duration, the
 * last 8 weeks filled, in one of two modes.
 *
 * - **vs your best**: each spoke's 100 % is the all-time record, so the shape shows
 *   where recent form is near it. The centre is 50 %, not 0: recent bests sit close
 *   to their records, and from zero every spoke would look the same.
 * - **vs ceiling**: each spoke's 100 % is core's ceiling (90 % of the Allen and
 *   Coggan world-class W/kg, times the rider's weight), and the all-time best is the
 *   dashed outline. From 0 %, because the gap is the point.
 *
 * The ceiling is the one number on the page that is not the rider's own, so the
 * chart says so under it every time it is drawn. Geometry is core's `starChart`;
 * this file only lays it out and labels it.
 */

/** What the ceiling is drawn from, and where it came from. */
export interface RiderSetting {
  weightKg: number | null;
  sex: RiderSex | null;
  /** `settings`: typed by the rider and stored. `profile`: read from the site's session. */
  source: "settings" | "profile";
}

export type StarMode = "best" | "ceiling";

/** Sectors, by the same plain names as the record tables: durations, not physiology. */
const SECTORS = [
  { name: "Short", from: 0 },
  { name: "Medium", from: 2 },
  { name: "Long", from: 4 },
] as const;

const RADIUS = 120;
const VIEW = { x: -235, y: -195, width: 470, height: 390 };

const percentText = (percent: number) => `${Math.round(percent)}%`;

function spokesFor(records: readonly WindowRecord[], mode: StarMode, rider: RiderSetting): StarSpokeInput[] {
  return records.map((record) => {
    const recent = record.recent?.watts ?? null;
    if (mode === "best") {
      // The record set recently is the recent best: 100 %, as the table says.
      const sameRide = record.recent && record.allTime && record.recent.workoutId === record.allTime.workoutId;
      return {
        windowSeconds: record.windowSeconds,
        reference: record.allTime?.watts ?? null,
        recent: sameRide ? record.allTime!.watts : recent,
        allTime: null,
      };
    }
    return {
      windowSeconds: record.windowSeconds,
      reference: ceilingWatts(record.windowSeconds, { weightKg: rider.weightKg!, sex: rider.sex! }),
      recent,
      allTime: record.allTime?.watts ?? null,
    };
  });
}

function ringLabel(percent: number, mode: StarMode): string {
  if (percent === 100) return mode === "best" ? "all-time" : "ceiling";
  return `${percent}%`;
}

function vertex(point: { x: number; y: number; past: boolean }, effort: PowerCurvePoint | null, title: string): SVGElement {
  const dot = svg("circle", { cx: point.x.toFixed(1), cy: point.y.toFixed(1), r: "4.5", class: point.past ? "past" : "" }, [
    svg("title", { text: title }),
  ]);
  return effort ? svg("a", { href: `/workouts/${effort.routeId}` }, [dot]) : dot;
}

function draw(geometry: StarGeometry, records: readonly WindowRecord[], spokes: StarSpokeInput[], mode: StarMode): SVGElement {
  const marks: SVGElement[] = [];
  for (const ring of geometry.rings) {
    const outer = ring.percent === 100;
    marks.push(svg("path", { d: ring.path, class: outer ? "ring outer" : "ring" }));
    marks.push(svg("text", { x: "4", y: (-ring.radius - 3).toFixed(1), class: "ringlabel", text: ringLabel(ring.percent, mode) }));
  }
  for (const spoke of geometry.spokes) {
    marks.push(svg("line", { x1: "0", y1: "0", x2: spoke.end.x.toFixed(1), y2: spoke.end.y.toFixed(1), class: "spoke" }));
  }
  for (const sector of SECTORS) {
    // Halfway between the sector's two spokes, outside the labels' reach.
    const a = geometry.spokes[sector.from];
    const b = geometry.spokes[sector.from + 1];
    if (!a || !b) continue;
    const dx = (a.dx + b.dx) / 2;
    const dy = (a.dy + b.dy) / 2;
    const length = Math.hypot(dx, dy) || 1;
    const r = RADIUS * 1.32;
    marks.push(
      svg("text", { x: ((dx / length) * r).toFixed(1), y: ((dy / length) * r + 4).toFixed(1), class: "sector", text: sector.name }),
    );
  }
  if (geometry.allTimePath) marks.push(svg("path", { d: geometry.allTimePath, class: "alltime" }));
  if (geometry.recentPath) marks.push(svg("path", { d: geometry.recentPath, class: "recent" }));

  geometry.spokes.forEach((spoke, i) => {
    const record = records[i]!;
    const input = spokes[i]!;
    if (spoke.recent && record.recent) {
      const of = input.reference ? ` of ${Math.round(input.reference)} W` : "";
      marks.push(vertex(spoke.recent, record.recent, `${windowLabel(spoke.windowSeconds)}: ${shownWatts(record.recent)} W${of}, last 8 weeks. Opens the ride.`));
    }
    // Labels beyond the end of the spoke, anchored away from the centre.
    const end = Math.hypot(spoke.end.x, spoke.end.y) + 16;
    const x = spoke.dx * end;
    const y = spoke.dy * end + (spoke.dy < -0.9 ? -12 : spoke.dy > 0.9 ? 12 : 0);
    const anchor = Math.abs(spoke.dx) < 0.1 ? "middle" : spoke.dx > 0 ? "start" : "end";
    const percent = spoke.recent?.percent ?? null;
    const reached = percent !== null && (mode === "best" ? Math.round(percent) >= 100 : percent > 100);
    marks.push(
      svg("text", { x: x.toFixed(1), y: y.toFixed(1), "text-anchor": anchor, class: "spokelabel" }, [
        `${windowLabel(spoke.windowSeconds)} `,
        svg("tspan", { class: reached ? "pct reached" : "pct", text: percent === null ? "–" : percentText(percent) }),
      ]),
    );
    const detail =
      record.recent && input.reference
        ? `${shownWatts(record.recent)} / ${Math.round(input.reference)} W`
        : record.allTime
          ? "none recently"
          : "not recorded";
    marks.push(svg("text", { x: x.toFixed(1), y: (y + 14).toFixed(1), "text-anchor": anchor, class: "spokedetail", text: detail }));
  });

  return svg(
    "svg",
    {
      viewBox: `${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`,
      class: "starchart",
      role: "img",
      "aria-label":
        (mode === "best"
          ? "Best effort in the last 8 weeks as a share of the all-time best, per duration: "
          : "Best effort in the last 8 weeks as a share of the ceiling, per duration: ") +
        geometry.spokes
          .map((s) => `${windowLabel(s.windowSeconds)} ${s.recent ? percentText(s.recent.percent) : "none"}`)
          .join(", ") +
        ".",
    },
    marks,
  );
}

function legend(mode: StarMode): HTMLElement {
  const item = (cls: string, text: string) => el("span", {}, [el("span", { class: `swatch ${cls}`, "aria-hidden": "true" }), text]);
  return el("div", { class: "starlegend" }, [
    item("recent", "Last 8 weeks"),
    item("alltime", mode === "best" ? "All-time best = 100%" : "All-time best"),
    ...(mode === "ceiling" ? [item("past", "Past the ceiling")] : []),
  ]);
}

const SEX_LABEL: Record<RiderSex, string> = { male: "men's table", female: "women's table" };

/** Weight and table, typed on the page. Says why when it refuses. */
function riderForm(rider: RiderSetting, onSave: (rider: { weightKg: number; sex: RiderSex }) => void, onCancel?: () => void): HTMLElement {
  const weight = el("input", {
    type: "number",
    min: "30",
    max: "200",
    step: "0.1",
    value: rider.weightKg === null ? "" : String(rider.weightKg),
    "aria-label": "Your weight, kg",
  });
  const sex = el("select", { "aria-label": "Which table" }, [
    el("option", { value: "male", text: "Men's table" }),
    el("option", { value: "female", text: "Women's table" }),
  ]);
  sex.value = rider.sex ?? "male";
  const save = el("button", { type: "submit", class: "secondary linkbutton", text: "Save" });
  const error = el("span", { class: "formerror", role: "status" });
  const form = el("form", { class: "targetform riderform", novalidate: "" }, [weight, " kg ", sex, save]);
  if (onCancel) {
    const cancel = el("button", { type: "button", class: "secondary linkbutton", text: "Cancel" });
    cancel.addEventListener("click", onCancel);
    form.append(cancel);
  }
  form.append(error);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const weightKg = Number(weight.value);
    if (!(weightKg >= 30 && weightKg <= 200)) {
      error.textContent = " A weight in kg, 30 to 200.";
      return;
    }
    save.disabled = true;
    onSave({ weightKg, sex: sex.value as RiderSex });
  });
  return form;
}

/**
 * The block: a heading with the mode toggle, the chart, its legend, and in ceiling
 * mode what the ceiling was drawn from, with a way to change it. Without a weight and
 * a table, ceiling mode asks for them instead of drawing.
 */
export function starBlock(
  records: readonly WindowRecord[],
  rider: RiderSetting,
  onSetRider: ((rider: { weightKg: number; sex: RiderSex }) => void) | undefined,
): HTMLElement {
  const ready = rider.weightKg !== null && rider.sex !== null;
  let mode: StarMode = ready ? "ceiling" : "best";
  const body = el("div", { class: "starbody" });
  const buttons = (["best", "ceiling"] as const).map((m) => {
    const button = el("button", { type: "button", class: "secondary linkbutton", text: m === "best" ? "vs your best" : "vs ceiling" });
    button.addEventListener("click", () => {
      mode = m;
      render();
    });
    return button;
  });

  const riderLine = (): HTMLElement => {
    const line = el("p", { class: "ridernote" });
    if (!ready) {
      line.append("The ceiling needs your weight and which table to use. Your Matrix profile did not say. ");
      if (onSetRider) line.append(riderForm(rider, onSetRider));
      return line;
    }
    const from = rider.source === "settings" ? "as you set it" : "from your Matrix profile";
    line.append(`For ${rider.weightKg} kg, ${SEX_LABEL[rider.sex!]}, ${from}. `);
    if (onSetRider) {
      const change = el("button", { type: "button", class: "secondary linkbutton", text: "Change" });
      change.addEventListener("click", () => line.replaceChildren(riderForm(rider, onSetRider, () => line.replaceChildren(...riderLine().childNodes))));
      line.append(change);
    }
    return line;
  };

  const render = (): void => {
    buttons.forEach((button, i) => button.setAttribute("aria-pressed", String((i === 0 ? "best" : "ceiling") === mode)));
    if (mode === "ceiling" && !ready) {
      body.replaceChildren(riderLine());
      return;
    }
    const spokes = spokesFor(records, mode, rider);
    const geometry = starChart(
      spokes,
      mode === "best"
        ? { radius: RADIUS, floorPercent: 50, rings: [50, 75, 100] }
        : { radius: RADIUS, floorPercent: 0, maxPercent: 115, rings: [25, 50, 75, 100] },
    );
    body.replaceChildren(
      el("div", { class: "starground" }, [draw(geometry, records, spokes, mode)]),
      legend(mode),
      ...(mode === "ceiling"
        ? [
            riderLine(),
            el("p", {
              class: "explain",
              text:
                "A ceiling, not a measurement: 90% of the Allen and Coggan world-class watts per kilo, times your weight. " +
                "The table has no 30 s, 10 min or 20 min value, so those are interpolated, and console watts are not calibrated against a power meter.",
            }),
          ]
        : [el("p", { class: "explain", text: "Each spoke is your best in the last 8 weeks as a share of your all-time best. The centre is 50%." })]),
    );
  };
  render();

  return el("div", { class: "powerskills" }, [
    el("div", { class: "starhead" }, [el("h3", { text: "Power skills" }), el("div", { class: "startoggle" }, buttons)]),
    body,
  ]);
}
