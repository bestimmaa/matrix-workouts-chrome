import { findWorkout, loadCachedWorkouts } from "../parse/index.js";
import { WorkoutParseError, type Workout } from "../parse/types.js";
import { ApiError } from "../api/client.js";
import { renderDashboard } from "../ui/dashboard.js";
import { el } from "../ui/svg.js";
import { loadHistory } from "./history.js";
import { createSurface, type Surface } from "./mount.js";
import { observeLocation, workoutIdFromPath } from "./route.js";

/**
 * Content script entry point.
 *
 * Contract with the user: we only ever cover the workout detail route, we always
 * offer a way back to the stock page, and a failure renders a readable explanation
 * rather than a blank sheet over their real dashboard.
 */

let surface: Surface | null = null;
/** The workout currently on screen, so a poll tick does not re-render needlessly. */
let renderedId: string | null = null;
/**
 * History fetched from the API this session. In memory only, never persisted — it
 * is the user's health data and it is one request away whenever it is wanted again.
 */
let history: Workout[] | null = null;

function ensureSurface(): Surface {
  if (!surface) surface = createSurface();
  return surface;
}

/**
 * Hand the page back to the site. Reversible: the surface leaves a pill behind,
 * because the stock page shows its own error for anything outside the cached week
 * and a one-way hide would strand the user on it.
 */
function showStock(): void {
  surface?.collapse();
}

function shell(children: (Node | string)[]): HTMLElement {
  const back = el("button", { type: "button", text: "Show stock page" });
  back.addEventListener("click", showStock);
  return el("div", { class: "wrap" }, [
    el("div", { class: "bar" }, [
      el("span", { class: "eyebrow", text: "Full Matrix Workouts" }),
      el("span", { class: "spacer" }),
      back,
    ]),
    ...children,
  ]);
}

function problem(title: string, message: string, action?: HTMLElement): HTMLElement {
  return shell([
    el("div", { class: "problem" }, [
      el("h1", { text: title }),
      el("p", { text: message }),
      ...(action ? [action] : []),
    ]),
  ]);
}

/** The workout is not in this browser's cache; offer to go and get it. */
function offerHistory(view: Surface, id: string): void {
  const button = el("button", { type: "button", text: "Load full history" });

  button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = "Loading…";

    loadHistory(localStorage)
      .then((result) => {
        history = result.workouts;
        const workout = findWorkout(history, id);
        if (workout) {
          view.render(renderDashboard(workout, { onShowStock: showStock }));
          renderedId = id;
          return;
        }
        view.render(
          problem(
            "That workout is not in your history either",
            `The API returned ${result.workouts.length} workouts and none of them has this id. ` +
              (result.skipped > 0 ? `${result.skipped} record(s) could not be read. ` : "") +
              (result.truncated ? "The response also reported more history than it sent. " : "") +
              "The link may be for a different account.",
          ),
        );
      })
      .catch((error: unknown) => {
        const message =
          error instanceof ApiError || error instanceof WorkoutParseError
            ? error.message
            : "Something went wrong fetching your history.";
        const retry = el("button", { type: "button", text: "Try again" });
        retry.addEventListener("click", () => offerHistory(view, id));
        view.render(problem("Could not load your history", message, retry));
      });
  });

  view.render(
    problem(
      "That workout is not cached in this browser",
      "The site keeps only about the current week in local storage and does not fetch " +
        "older workouts on demand — which is why its own page shows an error for them. " +
        "It can be fetched from the workout API instead, using the sign-in this browser " +
        "already holds. Nothing is stored: the history stays in memory for this tab only.",
      button,
    ),
  );
}

function renderRoute(pathname: string): void {
  const id = workoutIdFromPath(pathname);

  if (id === null) {
    // Off the workout route entirely: remove ourselves completely rather than
    // leaving a pill floating over a page this extension does not handle.
    surface?.destroy();
    surface = null;
    renderedId = null;
    return;
  }
  if (id === renderedId && surface?.visible) return;

  const view = ensureSurface();

  try {
    const workout =
      findWorkout(loadCachedWorkouts(localStorage), id) ?? (history ? findWorkout(history, id) : null);

    if (workout) {
      view.render(renderDashboard(workout, { onShowStock: showStock }));
      renderedId = id;
    } else {
      offerHistory(view, id);
      // Not marked as rendered: the view is an offer, not the workout.
      renderedId = null;
    }
  } catch (error) {
    const message =
      error instanceof WorkoutParseError
        ? error.message
        : "The stored workout data was not in a shape this extension understands. " +
          "The site may have changed its format.";
    view.render(problem("Could not read this workout", message));
    renderedId = null;
  }

  view.expand();
}

/**
 * Toolbar-icon toggle. The pill only exists once the view has been collapsed, and
 * only on the detail route; this works from anywhere on the site and is where a
 * user looks for an extension's UI.
 */
function toggle(): void {
  if (surface?.visible) {
    surface.collapse();
    return;
  }
  if (surface) {
    surface.expand();
    return;
  }
  // Nothing mounted yet — off the detail route, or the surface was destroyed.
  const id = workoutIdFromPath(location.pathname);
  if (id === null) {
    const view = ensureSurface();
    view.render(
      problem(
        "Open a workout first",
        "This view replaces the workout detail page. Open any workout from the list, " +
          "and it will take over automatically — or use this button again there.",
      ),
    );
    view.expand();
    return;
  }
  renderRoute(location.pathname);
}

function start(): void {
  renderRoute(location.pathname);
  observeLocation(({ pathname }) => renderRoute(pathname));

  chrome.runtime.onMessage.addListener((message) => {
    if (typeof message === "object" && message !== null && (message as { type?: string }).type === "toggleSurface") {
      toggle();
    }
    return false;
  });
}

start();
