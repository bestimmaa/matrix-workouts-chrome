// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createSurface } from "./mount.js";

const HOST = "#full-matrix-workouts-root";

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  document.body.style.overflow = "";
});

function parts() {
  const host = document.querySelector<HTMLElement>(HOST)!;
  const shadow = host.shadowRoot!;
  return {
    host,
    sheet: shadow.querySelector<HTMLElement>(".sheet")!,
    launcher: shadow.querySelector<HTMLButtonElement>(".launcher")!,
  };
}

describe("createSurface", () => {
  it("renders into a shadow root, not the page", () => {
    const surface = createSurface();
    surface.render(document.createElement("h1"));
    surface.expand();

    const { host, sheet } = parts();
    expect(host.shadowRoot).not.toBeNull();
    // The site's DOM is untouched: our content is not reachable from the document.
    expect(document.querySelector("h1")).toBeNull();
    expect(sheet.querySelector("h1")).not.toBeNull();
  });

  it("collapses to a pill that opens it again", () => {
    const surface = createSurface();
    surface.render(document.createElement("p"));
    surface.expand();
    expect(surface.visible).toBe(true);

    surface.collapse();
    const { host, sheet, launcher } = parts();
    expect(surface.visible).toBe(false);
    expect(sheet.hidden).toBe(true);
    expect(launcher.hidden).toBe(false);
    // Collapsed it must not cover the page, or it swallows clicks meant for it.
    expect(host.style.inset).not.toBe("0px");

    launcher.click();
    expect(surface.visible).toBe(true);
    expect(parts().sheet.hidden).toBe(false);
    expect(parts().launcher.hidden).toBe(true);
  });

  it("routes the pill through onOpen, so the sheet can be filled on demand", () => {
    // Collapsed is the resting state and the sheet starts empty, so the pill has to
    // reach the caller rather than expand over the page with nothing in it.
    const opens: number[] = [];
    const surface = createSurface({ onOpen: () => opens.push(1) });
    surface.collapse();

    parts().launcher.click();
    expect(opens).toHaveLength(1);
    expect(surface.visible).toBe(false);
  });

  it("keeps the rendered view across a collapse, with no re-render", () => {
    const surface = createSurface();
    const content = document.createElement("p");
    content.textContent = "telemetry";
    surface.render(content);
    surface.expand();
    surface.collapse();
    parts().launcher.click();
    expect(parts().sheet.textContent).toBe("telemetry");
  });

  it("restores the page's own scroll setting exactly", () => {
    document.body.style.overflow = "scroll";
    const surface = createSurface();
    surface.expand();
    expect(document.body.style.overflow).toBe("hidden");
    surface.collapse();
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("leaves nothing behind when destroyed", () => {
    document.body.style.overflow = "auto";
    const surface = createSurface();
    surface.expand();
    surface.destroy();
    expect(document.querySelector(HOST)).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("replaces an earlier host rather than stacking overlays", () => {
    createSurface().expand();
    createSurface().expand();
    expect(document.querySelectorAll(HOST)).toHaveLength(1);
  });
});
