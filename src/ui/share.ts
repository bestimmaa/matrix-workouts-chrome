import { exportFilename, renderShareCardSvg, shareCard, type ShareFormat, type Workout } from "matrix-workouts-core";
import doto from "./fonts/Doto-Black-latin.woff2";
import instrumentSans from "./fonts/InstrumentSans-latin.woff2";

/**
 * The shareable workout image: core decides what the card says and lays it out as
 * SVG; this turns that SVG into a PNG the rider can post.
 *
 * **The fonts travel inside the SVG, as `data:` URLs.** A canvas draws an SVG through
 * an `<img>`, and an SVG image cannot reach any font the page has loaded — so the two
 * faces the card is designed in are embedded in the document itself. They are the
 * extension's only fonts, they exist only inside this offscreen image, and nothing is
 * fetched: see "No webfonts of our own" in AGENTS.md.
 */
const FONT_FACES =
  `@font-face{font-family:Doto;font-weight:900;src:url(${doto}) format("woff2")}` +
  `@font-face{font-family:"Instrument Sans";font-weight:400 700;src:url(${instrumentSans}) format("woff2")}`;

export function shareCardSvg(workout: Workout, format: ShareFormat): string {
  // The rider's calendar day, which only the browser knows: the record is in UTC.
  const card = shareCard(workout, { utcOffsetMinutes: -workout.startedAt.getTimezoneOffset() });
  return renderShareCardSvg(card, { format, fontFaceCss: FONT_FACES });
}

/** `matrix-workout-2026-10-24-<id>-story.png`, beside the JSON export's own name. */
export function shareFilename(workout: Workout, format: ShareFormat): string {
  return exportFilename(workout).replace(/\.json$/, `-${format}.png`);
}

/**
 * Rasterize the card at its native size (1080 wide). Everything happens on detached
 * elements — an `<img>` and a `<canvas>` that are never inserted — so the site's DOM
 * is untouched, as it is everywhere else here.
 */
export async function shareCardPng(workout: Workout, format: ShareFormat): Promise<Blob> {
  const svg = shareCardSvg(workout, format);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob gave nothing"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
