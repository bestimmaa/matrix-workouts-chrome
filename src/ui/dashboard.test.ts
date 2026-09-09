// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { toWorkout } from "../parse/workout.js";
import { flagHeartRateDropouts } from "../parse/heartRate.js";
import type { Workout } from "../parse/types.js";
import { renderDashboard } from "./dashboard.js";
import { clock, km, modeLabel } from "./format.js";

function fixture(id: string): Workout {
  // jsdom rebases import.meta.url onto the document URL, so resolve from cwd.
  const raw = JSON.parse(readFileSync(resolve(process.cwd(), `fixtures/raw-${id}.json`), "utf8"));
  return toWorkout(raw as Record<string, unknown>);
}

const ALL = [
  "6aa194a08d2b6d09c61e9500",
  "6aa045668d2b6d09c612785d",
  "6a95b033c23a154beb856bce",
  "6a9413328d2b6d09c6b512a9",
  "6a8336b68d2b6d09c634fc60",
  "6a7cab8cc23a154bebccef65",
  "6a6368cb18e8655524dbb05d",
  "6a5e4fe418e8655524aebab4",
];

function render(id: string): HTMLElement {
  return renderDashboard(fixture(id), { onShowStock: () => {} });
}

describe("format", () => {
  it("formats a clock past an hour", () => {
    expect(clock(3136)).toBe("52:16");
    expect(clock(3600)).toBe("1:00:00");
    expect(clock(0)).toBe("0:00");
  });

  it("converts stored meters to the km the site shows", () => {
    expect(km(24750)).toBe("24.75");
  });

  it("shows an unmapped program as its raw id rather than guessing", () => {
    expect(modeLabel("unknown", 47)).toBe("Program 47");
    expect(modeLabel("unknown", null)).toBe("Unidentified program");
    expect(modeLabel("target_watts", 20)).toBe("Target watts");
  });
});

describe("renderDashboard", () => {
  it("renders every fixture without throwing", () => {
    for (const id of ALL) expect(() => render(id)).not.toThrow();
  });

  it("gives each panel a caption, an accessible label and a series path", () => {
    const root = render("6aa045668d2b6d09c612785d");
    const figures = root.querySelectorAll("figure.panel");
    expect(figures.length).toBeGreaterThan(2);
    for (const figure of figures) {
      expect(figure.querySelector("figcaption h2")?.textContent).toBeTruthy();
      expect(figure.querySelector("svg")?.getAttribute("aria-label")).toBeTruthy();
      const d = figure.querySelector("path.series")?.getAttribute("d") ?? "";
      expect(d.length).toBeGreaterThan(10);
      expect(d).not.toMatch(/NaN/);
    }
  });

  it("is keyboard operable and scrubs with the arrow keys", () => {
    const root = render("6aa045668d2b6d09c612785d");
    const stack = root.querySelector<HTMLElement>(".stack")!;
    expect(stack.getAttribute("tabindex")).toBe("0");
    expect(stack.getAttribute("aria-label")).toMatch(/arrow keys/i);

    const clockValue = root.querySelector(".clock .v")!;
    // Idle, the clock reads the ride length; scrubbing swaps it for the cursor time.
    expect(clockValue.textContent).toBe("45:10");

    stack.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(stack.classList.contains("live")).toBe(true);
    expect(clockValue.textContent).toBe("0:10");

    stack.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(stack.classList.contains("live")).toBe(false);
    expect(clockValue.textContent).toBe("45:10");
  });

  it("reads a dropout as no value rather than as a zero", () => {
    const workout = fixture("6aa194a08d2b6d09c61e9500");
    const dropout = flagHeartRateDropouts(workout.samples).indexOf(false);
    expect(dropout).toBeGreaterThan(0);

    const root = renderDashboard(workout, { onShowStock: () => {} });
    const stack = root.querySelector<HTMLElement>(".stack")!;
    const readouts = root.querySelectorAll(".read .v");
    for (let i = 0; i < dropout; i += 1) {
      stack.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    }

    const texts = [...readouts].map((n) => n.firstChild?.textContent);
    expect(texts).toContain("—");
    // The dropout is blanked, not zeroed, and the other channels still read.
    expect(texts).not.toContain("0");
    expect(root.querySelectorAll("circle.cursor[opacity='0']")).toHaveLength(1);
  });

  it("shows the sprint bars only on a Sprint 8 ride", () => {
    expect(render("6a95b033c23a154beb856bce").querySelectorAll(".sprint")).toHaveLength(8);
    expect(render("6aa045668d2b6d09c612785d").querySelectorAll(".sprint")).toHaveLength(0);
  });

  it("always offers a table view with one row per sample", () => {
    const workout = fixture("6a8336b68d2b6d09c634fc60");
    const root = renderDashboard(workout, { onShowStock: () => {} });
    expect(root.querySelectorAll("tbody tr")).toHaveLength(workout.samples.length);
  });

  it("says the reported summary differs from the filtered series", () => {
    const text = render("6a6368cb18e8655524dbb05d").querySelector("footer")!.textContent ?? "";
    expect(text).toMatch(/filtered as strap dropouts/);
    expect(text).toMatch(/not derived from the samples/);
  });

  it("hands back a way to the stock page", () => {
    let asked = false;
    const root = renderDashboard(fixture("6aa045668d2b6d09c612785d"), {
      onShowStock: () => {
        asked = true;
      },
    });
    root.querySelector<HTMLButtonElement>("button")!.click();
    expect(asked).toBe(true);
  });
});
