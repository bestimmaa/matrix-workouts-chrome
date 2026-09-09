import { findWorkout, loadCachedWorkouts } from "../parse/index.js";
import { WorkoutParseError } from "../parse/types.js";
import { renderDashboard } from "../ui/dashboard.js";
import { el } from "../ui/svg.js";
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

function ensureSurface(): Surface {
  if (!surface) surface = createSurface();
  return surface;
}

function showStock(): void {
  surface?.hide();
  // Leaving the route and coming back should bring our view back.
  renderedId = null;
}

function problem(title: string, message: string): HTMLElement {
  const back = el("button", { type: "button", text: "Show stock page" });
  back.addEventListener("click", showStock);
  return el("div", { class: "wrap" }, [
    el("div", { class: "bar" }, [
      el("span", { class: "eyebrow", text: "Full Matrix Workouts" }),
      el("span", { class: "spacer" }),
      back,
    ]),
    el("div", { class: "problem" }, [el("h1", { text: title }), el("p", { text: message })]),
  ]);
}

function renderRoute(pathname: string): void {
  const id = workoutIdFromPath(pathname);

  if (id === null) {
    surface?.hide();
    renderedId = null;
    return;
  }
  if (id === renderedId && surface?.visible) return;

  const view = ensureSurface();

  try {
    const workout = findWorkout(loadCachedWorkouts(localStorage), id);
    if (!workout) {
      // The app caches roughly the current week. Older workouts are only in the
      // HTTP API, which this version does not talk to yet.
      view.render(
        problem(
          "That workout is not cached in this browser",
          "The site keeps only about the current week in local storage, and it does not " +
            "fetch older workouts on demand — which is why its own page shows an error " +
            "for them too. Open a workout from the current week, or wait for the history " +
            "backfill that reads the full record from the API.",
        ),
      );
    } else {
      view.render(renderDashboard(workout, { onShowStock: showStock }));
    }
  } catch (error) {
    const message =
      error instanceof WorkoutParseError
        ? error.message
        : "The stored workout data was not in a shape this extension understands. " +
          "The site may have changed its format.";
    view.render(problem("Could not read this workout", message));
  }

  renderedId = id;
  view.show();
}

function start(): void {
  renderRoute(location.pathname);
  observeLocation(({ pathname }) => renderRoute(pathname));
}

start();
