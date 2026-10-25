import { defineConfig } from "vite";

/**
 * Two build targets, because they need different output formats and rollup takes
 * one format per build:
 *
 *   content    MV3 content scripts are not ES modules -> a single IIFE bundle,
 *              no code splitting, no dynamic import.
 *   background the service worker is declared "type": "module" -> ESM.
 *
 * `npm run build` runs both; the second passes `emptyOutDir: false` so it does not
 * delete the first. `public/` (the manifest) is copied on the content pass only.
 */
const TARGETS = {
  content: { entry: "src/content/main.ts", format: "iife" },
  background: { entry: "src/background/main.ts", format: "es" },
} as const;

export default defineConfig(({ mode }) => {
  const name = (mode in TARGETS ? mode : "content") as keyof typeof TARGETS;
  const target = TARGETS[name];
  const first = name === "content";

  return {
    publicDir: first ? "public" : false,
    build: {
      outDir: "dist",
      emptyOutDir: first,
      target: "es2022",
      modulePreload: false,
      cssCodeSplit: false,
      // The share card's two fonts are inlined into content.js, never emitted as
      // files. An emitted file would be fetched relative to the *site's* page —
      // a request this extension must not make, and a 404 there anyway. Vite's own
      // limit is 4 KB, which Instrument Sans (30 KB) is over, and an `?inline`
      // query did not override it on 5.4 — this line is the whole mechanism.
      assetsInlineLimit: (file: string) => (file.endsWith(".woff2") ? true : undefined),
      rollupOptions: {
        input: { [name]: target.entry },
        output: {
          format: target.format,
          entryFileNames: "[name].js",
          assetFileNames: "[name].[ext]",
          inlineDynamicImports: true,
        },
      },
    },
  };
});
