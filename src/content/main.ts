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
 * Contract with the user: the site's own dashboard is what they get by default —
 * we never take the page without being asked. On the workout detail route we put a
 * pill in the corner, and that pill toggles the extended view. We only ever cover
 * that one route, we always offer a way back to the stock page, and a failure
 * renders a readable explanation rather than a blank sheet over their real
 * dashboard.
 */

let surface: Surface | null = null;
/**
 * The workout the sheet currently holds, so reopening the pill and a poll tick on
 * the same route do not re-render needlessly. Null while the sheet holds something
 * that is not a workout — a problem view, or the history offer.
 */
let renderedId: string | null = null;
/**
 * History fetched from the API this session. In memory only, never persisted — it
 * is the user's health data and it is one request away whenever it is wanted again.
 */
let history: Workout[] | null = null;

function ensureSurface(): Surface {
  if (!surface) surface = createSurface({ onOpen: openView });
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

/**
 * Everything that is not a rendered workout still wears the same chrome — black
 * bar, title band, content plane — so a failure or an offer reads as this view
 * having something to say, not as the page having broken. The band goes brand red
 * rather than cardio amber: there is no workout behind it to colour it by.
 */
function shell(title: string, children: (Node | string)[]): HTMLElement {
  const back = el("button", { type: "button", class: "back", text: "Show stock page" });
  back.addEventListener("click", showStock);
  return el("div", { class: "wrap" }, [
    el("div", { class: "topbar" }, [
      back,
      el("div", { class: "date", text: "Full telemetry" }),
      el("div", { class: "ident", text: "Full Matrix Workouts" }),
    ]),
    el("h1", { class: "band alert", text: title }),
    el("div", { class: "page" }, children),
  ]);
}

function problem(title: string, message: string, action?: HTMLElement): HTMLElement {
  return shell(title, [
    el("div", { class: "problem" }, [
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

/** Fill the sheet with one workout's dashboard. Does not change visibility. */
function renderWorkout(view: Surface, id: string): void {
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
}

/**
 * Show the extended view. Both entry points — the pill and the toolbar icon — land
 * here, and it is the only place that covers the page.
 *
 * The sheet is filled here rather than on navigation, so a user who never opens it
 * pays nothing for parsing and charting a ride they are not looking at.
 */
function openView(): void {
  const view = ensureSurface();
  const id = workoutIdFromPath(location.pathname);

  if (id === null) {
    view.render(
      problem(
        "Open a workout first",
        "This view replaces the workout detail page. Open any workout from the list, " +
          "then use this button again there.",
      ),
    );
    renderedId = null;
  } else if (id !== renderedId) {
    renderWorkout(view, id);
  }

  view.expand();
}

/**
 * React to navigation. Note what this does *not* do: expand. The site's own
 * dashboard is the default, and an open view is a thing the user asked for — so a
 * route change only keeps an already-open view in sync, and otherwise leaves the
 * pill sitting over the stock page.
 */
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

  const view = ensureSurface();
  if (id === renderedId) return;

  // The sheet now holds the wrong workout, so it must not be shown as-is.
  renderedId = null;
  if (view.visible) renderWorkout(view, id);
  else view.collapse();
}

/**
 * Toolbar-icon toggle. Does the same job as the pill, but from anywhere on the
 * site and from where a user looks for an extension's UI — the pill only exists on
 * the detail route.
 */
function toggle(): void {
  if (surface?.visible) {
    surface.collapse();
    return;
  }
  openView();
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
