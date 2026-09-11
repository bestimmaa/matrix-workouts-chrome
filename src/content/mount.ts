import styles from "../ui/styles.css?inline";

const HOST_ID = "full-matrix-workouts-root";

/**
 * Our UI lives in a shadow root on a fixed overlay, not in the site's DOM.
 *
 * The site is a React app that owns and re-renders its own tree. Rather than edit
 * or hide its nodes — which it would fight us over, and which would leave the user
 * staring at a blank page if our render ever failed — we cover the page and can be
 * removed without a trace.
 *
 * **Collapsed is the resting state.** The site's own dashboard is what loads; the
 * surface sits in the corner as a pill until the user asks for the extended view.
 * Expanding and collapsing are the two halves of one TOGGLE, never a dismissal:
 * the stock page shows its own "Oops!" error for any workout outside the week it
 * caches, so a one-way hide would strand the user there with no way back to the
 * view that was working.
 */
export interface Surface {
  /** Replace the contents of the sheet. */
  render(content: Node): void;
  /** Cover the page. */
  expand(): void;
  /** Hand the page back, leaving the pill to come back with. */
  collapse(): void;
  readonly visible: boolean;
  destroy(): void;
}

export interface SurfaceOptions {
  /**
   * What the pill does. The caller owns it because opening may mean rendering
   * first — the sheet is filled on demand, not on every route change.
   * Defaults to a bare `expand()`.
   */
  onOpen?(): void;
}

export function createSurface(options: SurfaceOptions = {}): Surface {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styles;

  const sheet = document.createElement("div");
  sheet.className = "sheet";

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "launcher";
  launcher.textContent = "Full telemetry";
  launcher.title = "Show the full telemetry view";

  shadow.append(style, sheet, launcher);

  let visible = false;
  /** The page's own overflow, restored exactly as found. */
  let pageOverflow: string | null = null;

  const surface: Surface = {
    render(content: Node) {
      sheet.replaceChildren(content);
      sheet.scrollTop = 0;
    },

    expand() {
      if (!host.isConnected) document.documentElement.append(host);
      // Covering the viewport, so the host must take the whole of it.
      host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483000;";
      sheet.hidden = false;
      launcher.hidden = true;
      if (!visible) {
        pageOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      }
      visible = true;
    },

    collapse() {
      if (!host.isConnected) document.documentElement.append(host);
      // Only the pill: anything larger would keep swallowing clicks meant for the
      // page we just handed back.
      host.style.cssText =
        "all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;";
      sheet.hidden = true;
      launcher.hidden = false;
      if (visible && pageOverflow !== null) document.body.style.overflow = pageOverflow;
      pageOverflow = null;
      visible = false;
    },

    get visible() {
      return visible;
    },

    destroy() {
      if (pageOverflow !== null) document.body.style.overflow = pageOverflow;
      host.remove();
      visible = false;
    },
  };

  launcher.addEventListener("click", () => {
    if (options.onOpen) options.onOpen();
    else surface.expand();
  });
  return surface;
}
