import { el } from "./svg.js";

/**
 * Hand a file to the browser.
 *
 * A blob URL on a detached `<a download>`, which is the one route that needs no new
 * permission: `chrome.downloads` would mean adding `"downloads"` to the manifest,
 * and this extension's permission list is deliberately the shortest it can be. The
 * anchor is never inserted — the site's DOM stays untouched, as it does everywhere
 * else here.
 *
 * The URL is revoked on the next task rather than immediately: Chrome reads it
 * during the click it has not finished dispatching yet.
 *
 * Note that Chrome may show its "allow multiple downloads" prompt for the origin.
 * That is the browser asking the user, which is the right place for the question.
 */
export function downloadJson(filename: string, json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = el("a", { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
