import { svg } from "./svg.js";

/**
 * The glyphs beside the summary figures.
 *
 * The stock page puts a 21px icon in front of every metric value, and the tiles
 * read as somebody else's without one. These are hand-authored for the same reason
 * the charts are: the extension ships no assets and makes no request, so an icon
 * font or a sprite sheet is not available to us.
 *
 * Drawn on a 24-unit grid, stroked in `currentColor` so a tile decides its own
 * colour, and marked `aria-hidden` — every one of them sits next to a text label
 * that already says the same thing.
 */
const PATHS: Record<string, string[]> = {
  // Clock: ride length.
  duration: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18", "M12 7v5l3.5 2"],
  // Horizontal arrows: distance covered, as the site draws it.
  distance: ["M3 12h18", "M6 9l-3 3 3 3", "M18 9l3 3-3 3"],
  // Flame: calories.
  calories: ["M12 21c3.9 0 6-2.4 6-5.6 0-3.7-3-5.2-3.6-9.4-1.7 1.3-2.4 3-2.4 4.6-1-.6-1.6-1.7-1.6-3C8.6 9 6 11 6 15.4 6 18.6 8.1 21 12 21Z"],
  // Pulse trace: how many samples the console recorded.
  samples: ["M3 12h3l2.5-6 4 12 2.5-6h6"],
  // Stopwatch: the sampling interval.
  interval: ["M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16", "M12 10v4", "M9 2h6", "M12 2v4"],
  // Tray with an arrow into it: take this record away with you.
  download: ["M12 3v11", "M8 10.5l4 4 4-4", "M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"],
  // Droplet: Sprint 8 sweat score.
  sweat: ["M12 3c3.5 4.2 5.5 6.9 5.5 9.4a5.5 5.5 0 1 1-11 0C6.5 9.9 8.5 7.2 12 3Z"],
};

export function icon(name: keyof typeof PATHS | string): SVGElement {
  const d = PATHS[name] ?? PATHS["samples"]!;
  return svg(
    "svg",
    {
      class: "icon",
      viewBox: "0 0 24 24",
      "stroke-width": "1.8",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    d.map((path) => svg("path", { d: path })),
  );
}
