const SVG_NS = "http://www.w3.org/2000/svg";

/** Terse element builders. The whole UI is built from these — no framework. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  return fill(document.createElement(tag), attrs, children);
}

export function svg(
  tag: string,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): SVGElement {
  return fill(document.createElementNS(SVG_NS, tag), attrs, children);
}

/** `text` sets the text content; every other key is an attribute. */
function fill<T extends Element>(node: T, attrs: Record<string, string>, children: (Node | string)[]): T {
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}
