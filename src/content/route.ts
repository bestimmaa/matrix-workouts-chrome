/**
 * Route detection for a React SPA that navigates without a page load.
 *
 * IMPORTANT: patching `history.pushState` from a content script does NOT work here.
 * Content scripts run in an isolated world with their own wrappers, so a patch
 * applied there never sees the page's own calls. The reliable options from inside
 * the isolated world are the Navigation API (when the browser has it) and polling
 * `location.href`. We use the first opportunistically and the second as the backstop,
 * because a missed navigation means our view goes stale over the user's dashboard.
 */

/** `/workouts/:id` -> the id. Anything else -> null. */
export function workoutIdFromPath(pathname: string): string | null {
  const match = /^\/workouts\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
  return match ? match[1]! : null;
}

export interface LocationWatcher {
  stop(): void;
}

/** Call `onChange` whenever the URL changes, including same-document navigation. */
export function observeLocation(
  onChange: (location: { pathname: string; href: string }) => void,
  intervalMs = 300,
): LocationWatcher {
  let last = location.href;

  const check = () => {
    if (location.href === last) return;
    last = location.href;
    onChange({ pathname: location.pathname, href: location.href });
  };

  const timer = setInterval(check, intervalMs);
  window.addEventListener("popstate", check);
  window.addEventListener("hashchange", check);

  // Navigation API, where available: reacts on the same frame instead of waiting
  // out the poll interval. The poll stays regardless — this is an optimisation.
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  const onNavigate = () => queueMicrotask(check);
  nav?.addEventListener("navigate", onNavigate);
  nav?.addEventListener("navigatesuccess", onNavigate);

  return {
    stop() {
      clearInterval(timer);
      window.removeEventListener("popstate", check);
      window.removeEventListener("hashchange", check);
      nav?.removeEventListener("navigate", onNavigate);
      nav?.removeEventListener("navigatesuccess", onNavigate);
    },
  };
}
