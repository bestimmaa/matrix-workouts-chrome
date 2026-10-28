/**
 * The view's stylesheet for a plain document rather than a shadow root.
 *
 * `:host` only resolves inside a shadow root, so a page outside one (the fixture
 * preview, the options page) gets the same tokens on `:root`. The three theme guards
 * must keep their structure, or a dark-mode machine could not show the light theme.
 */
export function documentStyles(css: string): string {
  return css
    .replace(/:host\(:not\(\[data-theme="light"\]\)\)/g, ':root:not([data-theme="light"])')
    .replace(/:host\(\[data-theme="dark"\]\)/g, ':root[data-theme="dark"]')
    .replace(/:host/g, ":root");
}
