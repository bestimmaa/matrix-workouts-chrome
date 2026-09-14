/**
 * Render a fixture to a standalone HTML file, so the design can be iterated on
 * without loading the extension into Chrome.
 *
 *   npm run preview -- 6aa045668d2b6d09c612785d
 *
 * Output goes to `preview/<id>.html`. The page is the same DOM the content script
 * mounts, with the shadow-root stylesheet inlined and the crosshair script omitted
 * (it needs the live listeners the extension wires up).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const g = globalThis as unknown as { document: Document; window: unknown };
g.document = dom.window.document;
g.window = dom.window;

const { toWorkout } = await import("matrix-workouts-core");
const { renderDashboard } = await import("../src/ui/dashboard.js");

const styles = readFileSync(resolve(process.cwd(), "src/ui/styles.css"), "utf8");

const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(resolve(process.cwd(), "fixtures"))
      .filter((f) => f.startsWith("raw-") && f.endsWith(".json"))
      .map((f) => f.slice(4, -5));

mkdirSync(resolve(process.cwd(), "preview"), { recursive: true });

for (const id of ids) {
  const raw = JSON.parse(readFileSync(resolve(process.cwd(), `fixtures/raw-${id}.json`), "utf8"));
  const workout = toWorkout(raw as Record<string, unknown>);
  const view = renderDashboard(workout, { onShowStock: () => {} });

  // `:host` only resolves inside a shadow root; the preview is a plain document.
  // The three theme guards must keep their structure, or the preview cannot show
  // the light theme at all on a dark-mode machine.
  const pageStyles = styles
    .replace(/:host\(:not\(\[data-theme="light"\]\)\)/g, ':root:not([data-theme="light"])')
    .replace(/:host\(\[data-theme="dark"\]\)/g, ':root[data-theme="dark"]')
    .replace(/:host/g, ":root");

  const html = `<!doctype html>
<html lang="en" data-theme="${process.env["THEME"] ?? ""}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${workout.mode} · ${id}</title>
<style>${pageStyles}
  .sheet { position: static; min-height: 100vh; }
  body { margin: 0; }
</style>
<div class="sheet">${view.outerHTML}</div>
</html>`;

  const out = resolve(process.cwd(), `preview/${id}.html`);
  writeFileSync(out, html);
  console.log(`${out}  (${workout.mode}, ${workout.samples.length} samples)`);
}
