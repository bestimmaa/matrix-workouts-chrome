import styles from "../ui/styles.css?inline";

const HOST_ID = "full-matrix-workouts-root";

/**
 * Our UI lives in a shadow root on a fixed overlay, not in the site's DOM.
 *
 * The site is a React app that owns and re-renders its own tree. Rather than edit
 * or hide its nodes — which it would fight us over, and which would leave the user
 * staring at a blank page if our render ever failed — we cover the page and can be
 * removed without a trace. `hide()` hands the real dashboard straight back.
 */
export interface Surface {
  /** Replace the contents of the sheet. */
  render(content: Node): void;
  show(): void;
  hide(): void;
  readonly visible: boolean;
  destroy(): void;
}

export function createSurface(): Surface {
  const existing = document.getElementById(HOST_ID);
  existing?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  // The host itself carries no styles the page could inherit into; everything is
  // inside the shadow root.
  host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483000;";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styles;
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  shadow.append(style, sheet);

  let visible = false;
  let scrollLock: string | null = null;

  const attach = () => {
    if (!host.isConnected) document.documentElement.append(host);
  };

  return {
    render(content: Node) {
      sheet.replaceChildren(content);
      sheet.scrollTop = 0;
    },
    show() {
      attach();
      host.style.display = "block";
      if (!visible) {
        scrollLock = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      }
      visible = true;
    },
    hide() {
      host.style.display = "none";
      if (visible && scrollLock !== null) document.body.style.overflow = scrollLock;
      scrollLock = null;
      visible = false;
    },
    get visible() {
      return visible;
    },
    destroy() {
      this.hide();
      host.remove();
    },
  };
}
