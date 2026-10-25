declare module "*.css?inline" {
  const css: string;
  export default css;
}

/**
 * Minimal ambient declaration for the two chrome APIs this extension uses.
 * Preferred over `@types/chrome`: the surface is tiny and the dependency is not.
 */
declare namespace chrome.runtime {
  function sendMessage(message: unknown): Promise<unknown>;
  const onMessage: {
    addListener(
      listener: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void,
      ) => boolean | undefined,
    ): void;
  };
}

declare namespace chrome.action {
  const onClicked: {
    addListener(listener: (tab: { id?: number; url?: string }) => void): void;
  };
}

declare namespace chrome.tabs {
  function sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

/**
 * A font, inlined at build time as a `data:` URL by `assetsInlineLimit` in
 * vite.config.ts — not by an `?inline` query, which Vite 5.4 ignored for a file over
 * its 4 KB limit. See `src/ui/fonts/README.md`.
 */
declare module "*.woff2" {
  const dataUrl: string;
  export default dataUrl;
}
