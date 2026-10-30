import { exportFilename, workoutExportJson, workoutTitle, type Workout } from "matrix-workouts-core";
import { downloadBlob, downloadJson } from "./download.js";
import { icon } from "./icons.js";
import { shareCardPng, shareFilename } from "./share.js";
import { el } from "./svg.js";

/**
 * The top bar's actions: the three ways a ride leaves this view. Two are downloads
 * the browser makes — the share image and the JSON export — and one is the upload,
 * to Strava, on a press. Each is a `barAction`, which is what lets a control in the
 * bar say what it just did. The view that mounts them is `dashboard.ts`.
 */

/**
 * How an upload ended, in the terms the button speaks. `setup` means there is no
 * Strava app to sign in with yet, `cancelled` that the rider did not connect, and
 * `processing` that Strava took the file but had not finished with it in time.
 * `duplicate` is this ride, already uploaded; `conflict` is another app's copy of it
 * (an Apple Watch ride, say) that Strava refused this one for. Either way the
 * activity's address comes with it, so the view knows nothing about Strava's URLs.
 */
export type StravaOutcome =
  | { kind: "uploaded" | "duplicate" | "conflict"; activityUrl: string }
  | { kind: "setup" | "cancelled" | "processing" | "failed" };

/** What the button says, visibly and aloud, when an upload did not end on Strava. */
const STRAVA_TROUBLE: Record<Exclude<StravaOutcome, { activityUrl: string }>["kind"], readonly [string, string]> = {
  setup: ["Set up Strava first", "Strava is not set up. The extension's options page has opened."],
  cancelled: ["Not connected", "Strava was not connected"],
  processing: ["Still processing", "Strava is still processing the ride"],
  failed: ["Upload failed", "Upload failed"],
};

/**
 * Save the ride as a picture to post — the one thing this view makes that is meant to
 * leave the machine, and the rider is the one who takes it there.
 *
 * Two sizes, because the two places people post want different shapes: a 9:16 story
 * and a 4:5 feed post. Both come from the same card in core; this only rasterizes it
 * and hands the PNG to the browser's download, exactly like the JSON export. Nothing
 * is uploaded, and the card carries less than the export does — no 10-second series,
 * no account, no machine id.
 *
 * A menu rather than two buttons: the bar's right slot already holds the export and
 * the signature, and on a narrow viewport only the glyphs survive.
 */
const SHARE_FORMATS = [
  { format: "story", text: "Story, 9:16" },
  { format: "feed", text: "Feed post, 4:5" },
] as const;

export function shareMenu(workout: Workout): HTMLElement {
  const action = barAction(
    "image",
    ["Share image", "Save this ride as an image"],
    "Save this ride as a picture to post. Saved by your browser; nothing is uploaded.",
    { "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "sharemenu" },
  );
  const button = action.button;

  const items = SHARE_FORMATS.map(({ format, text }) => {
    const item = el("button", { type: "button", role: "menuitem", text });
    item.addEventListener("click", () => {
      close();
      button.focus();
      // One render at a time: each is a 1080-wide canvas and a download.
      void action.run(["Rendering…", "Rendering the image"], async () => {
        try {
          downloadBlob(shareFilename(workout, format), await shareCardPng(workout, format));
          action.flash("Saved", "Image saved");
        } catch {
          // Deliberately without the error, like the export: say enough, quote nothing.
          action.flash("Image failed", "Image failed");
        }
      });
    });
    return item;
  });
  const menu = el("div", { id: "sharemenu", class: "sharemenu", role: "menu", hidden: "" }, items);
  const wrap = el("div", { class: "share" }, [button, menu]);

  const open = () => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    items[0]!.focus();
  };
  const close = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  button.addEventListener("click", () => (menu.hidden ? open() : close()));
  wrap.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      close();
      button.focus();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const at = items.indexOf(event.target as HTMLButtonElement);
      if (at === -1) return;
      event.preventDefault();
      items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]!.focus();
    }
  });
  // Focus leaving the menu closes it — Tab out of it included; a click elsewhere
  // moves focus, so it closes too.
  wrap.addEventListener("focusout", (event) => {
    if (!wrap.contains(event.relatedTarget as Node | null)) close();
  });
  return wrap;
}

/**
 * Take the ride somewhere else.
 *
 * The platform offers no export of any kind, so this record is otherwise reachable
 * only by reading it out of `localStorage` by hand — which is exactly how this
 * project's own fixtures were captured, painfully, one field at a time.
 *
 * The download is the browser's, not ours: no upload, no service, nothing crosses
 * the network. That is the same promise the footer makes about the rest of this
 * view, and an export button is precisely where a user would reasonably start to
 * doubt it — so the button says where the file goes before they press it.
 */
export function exportButton(workout: Workout): HTMLButtonElement {
  const action = barAction(
    "download",
    ["Export JSON", "Export this workout as JSON"],
    `Download this workout's full record, telemetry included, as ` +
      `${exportFilename(workout)}. Saved by your browser; nothing is uploaded.`,
  );
  action.button.addEventListener("click", () => {
    try {
      downloadJson(exportFilename(workout), workoutExportJson(workout));
      // Chrome's own download bubble can be dismissed or off-screen, so the button
      // confirms for itself; a click that produced nothing visible reads as broken.
      action.flash("Saved", "Export saved");
    } catch {
      // Deliberately without the error: it can quote what was being written, and
      // that is the user's heart rate. The button says enough.
      action.flash("Export failed", "Export failed");
    }
  });
  return action.button;
}

/**
 * Send the ride to the rider's own Strava account, as an indoor ride with a name.
 *
 * The one action in this view that uploads, so the tooltip says what goes before it
 * is pressed: the FIT file, which carries the 10-second series and nothing that
 * identifies the account or the machine. Once Strava has the ride, the button opens
 * it there instead of sending it again. A ride Strava already has (the same file sent
 * twice) counts as sent: Strava names the activity, and that is where the button goes.
 *
 * A conflict is different: Strava refused the ride because another app's copy is
 * there. The button says so and its next click opens that copy, so the rider can
 * delete it. The click after that sends again.
 */
export function stravaButton(workout: Workout, send: () => Promise<StravaOutcome>): HTMLButtonElement {
  const idleTitle =
    `Upload this ride to your Strava account as an indoor ride named "${workoutTitle(workout)}". ` +
    "Strava receives power, cadence, speed, distance and heart rate every 10 seconds.";
  const action = barAction("upload", ["Send to Strava", "Send this ride to Strava"], idleTitle);
  action.button.classList.add("strava");
  let activityUrl: string | null = null;
  let conflictUrl: string | null = null;

  action.button.addEventListener("click", () => {
    if (activityUrl) {
      window.open(activityUrl, "_blank", "noopener");
      return;
    }
    if (conflictUrl) {
      window.open(conflictUrl, "_blank", "noopener");
      conflictUrl = null;
      action.button.title = idleTitle;
      action.say("Send to Strava", "Send this ride to Strava");
      return;
    }
    void action.run(["Sending…", "Sending to Strava"], async () => {
      try {
        const outcome = await send();
        if (outcome.kind === "uploaded" || outcome.kind === "duplicate") {
          activityUrl = outcome.activityUrl;
          action.button.title = "Open this ride on Strava.";
          action.say(outcome.kind === "uploaded" ? "On Strava" : "Already on Strava", "Open this ride on Strava");
        } else if (outcome.kind === "conflict") {
          conflictUrl = outcome.activityUrl;
          action.button.title =
            "Strava already has another copy of this ride, from another app or device, and refused this one. " +
            "Open it, delete it on Strava, then send again.";
          action.say("Another copy blocks it", "Strava refused this ride: another copy is there. Open it");
        } else {
          action.flash(...STRAVA_TROUBLE[outcome.kind]);
        }
      } catch {
        action.flash(...STRAVA_TROUBLE.failed);
      }
    });
  });
  return action.button;
}

/**
 * A text-and-glyph action in the black bar that can report what it just did.
 *
 * The visible label is hidden on a narrow viewport, where there is no room for it
 * beside the date — so the accessible name lives on the button rather than in the
 * text, and moves with it. The glyph is `aria-hidden` and cannot name anything.
 *
 * `flash` shows an outcome and returns to idle after a moment; any later `say` or
 * `flash` cancels that return, so a second click can never have its own message
 * overwritten by the first one's timer.
 *
 * `run` does slow work one at a time: a click while it is running does nothing, so
 * a double click cannot save a picture twice or upload a ride twice. The work says
 * its own outcome.
 */
interface BarAction {
  button: HTMLButtonElement;
  say(visible: string, spoken: string): void;
  flash(visible: string, spoken: string): void;
  run(busy: readonly [string, string], work: () => Promise<void>): Promise<void>;
}

function barAction(
  glyph: string,
  [idleText, idleName]: readonly [string, string],
  title: string,
  attrs: Record<string, string> = {},
): BarAction {
  const label = el("span", { class: "label" });
  const button = el("button", { type: "button", class: "baraction", title, ...attrs }, [icon(glyph), label]);
  let reset: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  const say = (visible: string, spoken: string) => {
    clearTimeout(reset);
    label.textContent = visible;
    button.setAttribute("aria-label", spoken);
  };
  say(idleText, idleName);
  return {
    button,
    say,
    flash(visible, spoken) {
      say(visible, spoken);
      reset = setTimeout(() => say(idleText, idleName), 2500);
    },
    async run(busy, work) {
      if (running) return;
      running = true;
      say(...busy);
      try {
        await work();
      } finally {
        running = false;
      }
    },
  };
}
