// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportFilename,
  flagHeartRateDropouts,
  toWorkout,
  type Workout,
} from "matrix-workouts-core";
import { renderDashboard, type StravaOutcome } from "./dashboard.js";
import { shareCardPng, shareCardSvg, shareFilename } from "./share.js";

/*
 * jsdom has no image decoder and no canvas, so the rasterizer is the one thing the
 * view tests replace: the menu, the label, the filename and the download around it
 * are all the real thing.
 */
vi.mock("./share.js", async (original) => ({
  ...(await original<typeof import("./share.js")>()),
  shareCardPng: vi.fn(),
}));
import { clock, hms, km, modeLabel } from "./format.js";

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
  "6aa2d8a88d2b6d09c62953f0",
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
    // 0 is the last id still unmapped; 47 was named Virtual Active on 13 Sep 2026.
    expect(modeLabel("unknown", 0)).toBe("Program 0");
    expect(modeLabel("unknown", null)).toBe("Unidentified program");
    expect(modeLabel("target_watts", 20)).toBe("Target watts");
    expect(modeLabel("virtual_active", 47)).toBe("Virtual Active");
  });

  it("splits a duration into the value/unit pairs the site's tiles use", () => {
    expect(hms(2710)).toEqual([["45", "m"], ["10", "s"]]);
    expect(hms(3725)).toEqual([["1", "h"], ["2", "m"], ["5", "s"]]);
  });
});

describe("renderDashboard", () => {
  it("renders every fixture without throwing", () => {
    for (const id of ALL) expect(() => render(id)).not.toThrow();
  });

  it("wears the site's chrome: black bar, cardio band, content plane", () => {
    const root = render("6a95b033c23a154beb856bce");
    // The date sits in the bar's middle slot, as it does on the stock detail page.
    expect(root.querySelector(".topbar .date")?.textContent).toMatch(/2026/);
    // The band is the view's only h1, and names the machine and the program.
    const bands = root.querySelectorAll("h1");
    expect(bands).toHaveLength(1);
    expect(bands[0]!.className).toBe("band");
    expect(bands[0]!.textContent).toBe("Upright bike · Sprint 8");
    expect(root.querySelector(".page")).toBeTruthy();
  });

  /*
   * Restyling is not allowed to quietly drop a figure. Every fact the view carried
   * before it was dressed as the platform's own page has to still be on it — this
   * caught the workout id going missing when the top bar was rebuilt.
   */
  it("still carries every summary figure it had before", () => {
    const workout = fixture("6aa045668d2b6d09c612785d");
    const root = renderDashboard(workout, { onShowStock: () => {} });

    const labels = [...root.querySelectorAll(".tile .k")].map((t) => t.textContent);
    expect(labels).toEqual(["Duration", "Distance", "Calories", "Samples", "Interval"]);

    const values = [...root.querySelectorAll(".tile .v")].map((t) => t.textContent ?? "");
    expect(values[0]).toBe("45m10s");
    expect(values[1]).toBe("21.69km");
    expect(values[2]).toBe(`${workout.calories}kcal`);
    expect(values[3]).toBe(`${workout.samples.length}recorded`);

    // The id used to sit in the top bar; it now lives in the provenance line.
    expect(root.querySelector("footer")?.textContent).toContain(workout.id);
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

  /*
   * The platform offers no export, so this button is the only route the record has
   * out of the browser. It lives in the header's right slot beside the ident, and
   * it must survive the narrow-viewport rule that hides that ident — a control is
   * not a label.
   */
  describe("export", () => {
    interface Saved {
      filename: string;
      json: string;
    }

    const saved: Saved[] = [];
    const BLOB_URL = "blob:stub";
    let restore: () => void;

    /*
     * Stand in for the browser's download machinery, which jsdom does not have:
     * a Blob that remembers its text, an object URL that is just a token, and an
     * anchor whose click records instead of navigating. This exercises the real
     * `downloadJson` rather than mocking it out, so the filename and the bytes that
     * would actually reach disk are what these tests assert on.
     */
    beforeEach(() => {
      saved.length = 0;
      const url = window.URL as unknown as Record<string, unknown>;
      const win = window as unknown as Record<string, unknown>;
      const originals = { create: url["createObjectURL"], revoke: url["revokeObjectURL"], blob: win["Blob"] };
      const originalClick = window.HTMLAnchorElement.prototype.click;

      let pending = "";
      class StubBlob {
        constructor(readonly parts: BlobPart[]) {}
      }
      win["Blob"] = StubBlob;
      url["createObjectURL"] = (blob: StubBlob) => {
        pending = blob.parts.map(String).join("");
        return BLOB_URL;
      };
      url["revokeObjectURL"] = () => {};
      window.HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
        if (this.getAttribute("href") !== BLOB_URL) return originalClick.call(this);
        saved.push({ filename: this.getAttribute("download") ?? "", json: pending });
      };

      restore = () => {
        url["createObjectURL"] = originals.create;
        url["revokeObjectURL"] = originals.revoke;
        win["Blob"] = originals.blob;
        window.HTMLAnchorElement.prototype.click = originalClick;
      };
    });

    // `downloadJson` revokes on the next task, so the stubs have to outlive this
    // tick — restoring under them leaves the timer calling into a jsdom method that
    // does not exist.
    afterEach(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      restore();
    });

    function exportControl(root: HTMLElement): HTMLButtonElement {
      // A direct child: the share menu's button sits inside its own wrapper.
      return root.querySelector<HTMLButtonElement>(".topbar .actions > button")!;
    }

    it("offers the export from the header, and says where the file goes", () => {
      const root = render("6aa045668d2b6d09c612785d");
      const button = exportControl(root);
      expect(button.textContent).toContain("Export JSON");
      // An export button is where a user starts to wonder about uploads. Answer first.
      expect(button.getAttribute("title")).toMatch(/nothing is uploaded/i);
      // The back button keeps the first tab stop; leaving is the control people hunt for.
      expect(root.querySelector("button")).not.toBe(button);
    });

    it("writes the whole record, telemetry included, under a dated filename", () => {
      const workout = fixture("6a95b033c23a154beb856bce");
      const root = renderDashboard(workout, { onShowStock: () => {} });

      exportControl(root).click();
      expect(saved).toHaveLength(1);
      expect(saved[0]!.filename).toBe(exportFilename(workout));

      const doc = JSON.parse(saved[0]!.json);
      expect(doc.workout.id).toBe(workout.id);
      expect(doc.workout.samples).toHaveLength(workout.samples.length);
      expect(doc.workout.samples[0]).toHaveProperty("powerWatts");
      expect(doc.source.record).toBeTruthy();
    });

    it("confirms for itself, because the browser's own bubble may not be visible", () => {
      const button = exportControl(render("6aa045668d2b6d09c612785d"));
      button.click();
      expect(button.textContent).toContain("Saved");
    });
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

  describe("send to strava", () => {
    const RIDE = "6aa045668d2b6d09c612785d";
    const ACTIVITY = "https://www.strava.com/activities/42";
    const withStrava = (send: () => Promise<StravaOutcome>) =>
      renderDashboard(fixture(RIDE), { onShowStock: () => {}, sendToStrava: send });
    const stravaControl = (root: HTMLElement) => root.querySelector<HTMLButtonElement>(".topbar .strava");
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("is offered only where something can make the upload", () => {
      expect(stravaControl(render(RIDE))).toBeNull();
      const button = stravaControl(withStrava(async () => ({ kind: "failed" })))!;
      expect(button.textContent).toContain("Send to Strava");
      // The one action that uploads says so, and says what goes, before it is pressed.
      expect(button.title).toMatch(/upload/i);
      expect(button.title).toMatch(/heart rate/);
      expect(button.title).toContain("Target heart rate · 45 min @ 142 bpm");
    });

    it.each([
      ["uploaded", "On Strava"],
      ["duplicate", "Already on Strava"],
    ] as const)("on %s says %s, then opens the ride instead of sending again", async (kind, label) => {
      const send = vi.fn(async (): Promise<StravaOutcome> => ({ kind, activityUrl: ACTIVITY }));
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const button = stravaControl(withStrava(send))!;
      button.click();
      expect(button.textContent).toContain("Sending");
      await settle();
      expect(button.textContent).toContain(label);

      button.click();
      expect(send).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith(ACTIVITY, "_blank", "noopener");
      open.mockRestore();
    });

    it("says what went wrong in its own words, and stays ready to try again", async () => {
      let outcome: "cancelled" | "failed" = "cancelled";
      const button = stravaControl(withStrava(async () => ({ kind: outcome })))!;
      button.click();
      await settle();
      expect(button.textContent).toContain("Not connected");
      outcome = "failed";
      button.click();
      await settle();
      expect(button.textContent).toContain("Upload failed");
    });
  });

  describe("share image", () => {
    const parts = (root: HTMLElement) => {
      const button = root.querySelector<HTMLButtonElement>(".topbar .share > button")!;
      const menu = root.querySelector<HTMLElement>(".topbar .sharemenu")!;
      return { button, menu, items: [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")] };
    };

    it("sits in the header beside the export, and says nothing is uploaded", () => {
      const { button, menu, items } = parts(render("6aa045668d2b6d09c612785d"));
      expect(button.getAttribute("aria-haspopup")).toBe("menu");
      expect(button.getAttribute("aria-controls")).toBe(menu.id);
      expect(button.title).toMatch(/nothing is uploaded/);
      expect(menu.hidden).toBe(true);
      expect(items.map((i) => i.textContent)).toEqual(["Story, 9:16", "Feed post, 4:5"]);
    });

    it("opens on click, moves with the arrow keys, and closes on Escape", () => {
      const root = render("6aa045668d2b6d09c612785d");
      document.body.append(root);
      const { button, menu, items } = parts(root);
      button.click();
      expect(menu.hidden).toBe(false);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement).toBe(items[0]);
      items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      expect(document.activeElement).toBe(items[1]);
      items[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(menu.hidden).toBe(true);
      expect(document.activeElement).toBe(button);
      root.remove();
    });

    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("downloads the PNG under its own name and says so", async () => {
      const saved: string[] = [];
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        saved.push(this.download);
      });
      const url = window.URL as unknown as Record<string, unknown>;
      const originals = { create: url["createObjectURL"], revoke: url["revokeObjectURL"] };
      url["createObjectURL"] = () => "blob:stub";
      url["revokeObjectURL"] = () => {};
      vi.mocked(shareCardPng).mockResolvedValueOnce(new Blob(["png"], { type: "image/png" }));

      const root = render("6aa045668d2b6d09c612785d");
      const { button, items } = parts(root);
      button.click();
      items[1]!.click();
      expect(button.textContent).toBe("Rendering…");
      await settle();
      expect(saved).toEqual([shareFilename(fixture("6aa045668d2b6d09c612785d"), "feed")]);
      expect(button.textContent).toBe("Saved");

      await settle();
      click.mockRestore();
      url["createObjectURL"] = originals.create;
      url["revokeObjectURL"] = originals.revoke;
    });

    it("fails quietly when the image cannot be drawn, quoting nothing", async () => {
      vi.mocked(shareCardPng).mockRejectedValueOnce(new Error("the rider's heart rate"));
      const root = render("6aa045668d2b6d09c612785d");
      const { button, items } = parts(root);
      button.click();
      items[0]!.click();
      await settle();
      expect(button.textContent).toBe("Image failed");
      expect(button.getAttribute("aria-label")).toBe("Image failed");
    });

    it("renders once however often it is asked while busy", async () => {
      vi.mocked(shareCardPng).mockClear();
      vi.mocked(shareCardPng).mockReturnValueOnce(new Promise(() => {}));
      const { button, items } = parts(render("6aa045668d2b6d09c612785d"));
      button.click();
      items[0]!.click();
      button.click();
      items[0]!.click();
      expect(vi.mocked(shareCardPng)).toHaveBeenCalledTimes(1);
    });

    it("names the PNG beside the JSON export, by format", () => {
      const w = fixture("6aa045668d2b6d09c612785d");
      expect(shareFilename(w, "story")).toBe(exportFilename(w).replace(".json", "-story.png"));
      expect(shareFilename(w, "feed")).toMatch(/-feed\.png$/);
    });

    it("carries both fonts inside the SVG and names no web address", () => {
      // Under vitest the font import is a module path; the build inlines it as a
      // data: URL (see vite.config.ts), which is checked against dist/ in AGENTS.md.
      const svg = shareCardSvg(fixture("6aa045668d2b6d09c612785d"), "story");
      expect(svg).toContain("font-family:Doto");
      expect(svg).toContain('font-family:"Instrument Sans"');
      expect(svg.match(/src:url\(/g)).toHaveLength(2);
      expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:/);
    });
  });
});
