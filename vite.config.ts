import { defineConfig } from "vite";

/**
 * MV3 content scripts are not ES modules, so everything ships as one IIFE bundle
 * with no code splitting and no dynamic import. `public/` (the manifest) is copied
 * verbatim. CSS is imported with `?inline` and injected into our shadow root, so
 * no stylesheet is emitted or exposed to the host page.
 */
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: { content: "src/content/main.ts" },
      output: {
        format: "iife",
        entryFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
        inlineDynamicImports: true,
      },
    },
  },
});
