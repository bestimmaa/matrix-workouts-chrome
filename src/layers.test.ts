import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * The layering, enforced rather than merely intended.
 *
 * The parser, API client and export format used to live here as a `core` layer with
 * no platform under it. They are now `matrix-workouts-core`, an npm package shared
 * with the MCP server, and the boundary that used to be internal is a dependency.
 * What survives the move is the property that made the extraction possible in the
 * first place, and it still has to be defended here:
 *
 * - **`charts/` stands on nothing.** It emits geometry — path `d` strings, ticks,
 *   scales — and a chart that reached for `document` would stop being testable
 *   against fixtures without a browser, which is the only reason the chart tests are
 *   fast enough to run on every change.
 * - **Nothing sprouts a dependency tree.** `mayDependOn` is an allowlist, not a
 *   boolean: a layer may import the one package this extension deliberately depends
 *   on, and nothing else. The bundle is one IIFE that makes no network request of any
 *   kind; that is a promise in README, and it survives exactly as long as the list
 *   below stays short.
 *
 * **Why the TypeScript AST and not a grep.** Every mention of `localStorage`,
 * `chrome` or `fetch` in a layer that may not use it is inside a comment or a string.
 * A textual scan flags all of them, is turned off within the week, and protects
 * nothing. Identifiers are the only honest unit here, so the file gets parsed.
 *
 * Adding a layer means adding it to LAYERS. That is deliberate: the last assertion
 * fails on any directory under `src/` no layer claims, so a new consumer cannot
 * quietly arrive without someone writing down what it is allowed to touch.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

/**
 * Globals that mean "a platform is underneath this". Grouped, because the
 * interesting question is never one identifier, it is which world a file lives in.
 *
 * `Node` and `Element` are deliberately absent: they are also ordinary TypeScript
 * type names, and a rule that cries wolf gets deleted.
 */
const PLATFORM = {
  dom: [
    "document",
    "window",
    "localStorage",
    "sessionStorage",
    "navigator",
    "getComputedStyle",
    "requestAnimationFrame",
    "HTMLElement",
    "SVGElement",
    "DOMParser",
    "MutationObserver",
    "CustomEvent",
    "ShadowRoot",
    "Blob",
  ],
  extension: ["chrome", "browser"],
  node: ["process", "require", "__dirname", "__filename", "Buffer"],
  net: ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"],
} as const;

type Platform = keyof typeof PLATFORM;

interface Layer {
  name: string;
  /** Directories directly under `src/`. */
  dirs: string[];
  /** Platforms this layer is allowed to stand on. Everything else is a failure. */
  mayUse: Platform[];
  /** Layers it may import from. Its own name has to be listed to import a sibling. */
  mayImport: string[];
  /**
   * Packages this layer may import by bare specifier. Empty means zero runtime
   * dependencies. An allowlist rather than a boolean because the interesting
   * question after the core moved to npm is not *whether* a layer has dependencies
   * but *which* — one known package is a boundary, anything else is a bundle nobody
   * audited.
   */
  mayDependOn: string[];
}

const CORE = "matrix-workouts-core";

const LAYERS: Layer[] = [
  {
    /*
     * Geometry, not pixels: data + scale -> path strings and tick positions. It sits
     * below the view rather than inside it so the chart tests can run the real
     * layout against every fixture with no DOM at all.
     */
    name: "charts",
    dirs: ["charts"],
    mayUse: [],
    mayImport: ["charts"],
    mayDependOn: [CORE],
  },
  {
    name: "view",
    dirs: ["ui"],
    mayUse: ["dom"],
    mayImport: ["charts", "view"],
    mayDependOn: [CORE],
  },
  {
    name: "extension",
    dirs: ["content", "background"],
    mayUse: ["dom", "extension", "net"],
    mayImport: ["charts", "view", "extension"],
    mayDependOn: [CORE],
  },
];

const layerOfDir = new Map(LAYERS.flatMap((layer) => layer.dirs.map((dir) => [dir, layer])));

/** Every `.ts` file in a layer, tests excluded — a test may reach for anything. */
function sourceFilesIn(dir: string): string[] {
  const root = join(SRC, dir);
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
        out.push(path);
      }
    }
  };
  walk(root);
  return out;
}

interface Usage {
  globals: { name: string; platform: Platform; line: number }[];
  imports: { specifier: string; line: number }[];
}

/**
 * The identifiers a file actually references, and what it imports. Property names
 * (`init.fetch`), declaration names and import bindings are skipped — only a free
 * reference to the global counts.
 */
function read(path: string): Usage {
  const text = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true);
  const usage: Usage = { globals: [], imports: [] };
  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const isName = (node: ts.Identifier): boolean => {
    const parent = node.parent as ts.Node & { name?: ts.Node; right?: ts.Node };
    return parent.name === node || parent.right === node;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isName(node)) {
      for (const [platform, names] of Object.entries(PLATFORM) as [Platform, readonly string[]][]) {
        if (names.includes(node.text)) {
          usage.globals.push({ name: node.text, platform, line: lineOf(node) });
        }
      }
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      usage.imports.push({ specifier: node.moduleSpecifier.text, line: lineOf(node) });
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const literal = node.argument.literal;
      if (ts.isStringLiteral(literal)) usage.imports.push({ specifier: literal.text, line: lineOf(node) });
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      usage.imports.push({ specifier: node.arguments[0].text, line: lineOf(node) });
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return usage;
}

/** `../charts/plan.js` from a file in `ui/` -> the layer owning `charts/`. */
function layerOfImport(from: string, specifier: string): Layer | undefined {
  const target = resolve(from, "..", specifier.split("?")[0] ?? specifier);
  const rel = relative(SRC, target);
  if (rel.startsWith("..")) return undefined; // fixtures and the like: data, not a layer
  return layerOfDir.get(rel.split("/")[0] ?? "");
}

const label = (path: string): string => relative(SRC, path);

describe("layer boundaries", () => {
  for (const layer of LAYERS) {
    const banned = (Object.keys(PLATFORM) as Platform[]).filter((p) => !layer.mayUse.includes(p));

    it(`${layer.name} stands on ${layer.mayUse.join(" + ") || "no platform at all"}`, () => {
      const offences: string[] = [];
      for (const dir of layer.dirs) {
        for (const path of sourceFilesIn(dir)) {
          for (const use of read(path).globals) {
            if (banned.includes(use.platform)) {
              offences.push(`${label(path)}:${use.line} uses ${use.name} (${use.platform})`);
            }
          }
        }
      }
      expect(offences).toEqual([]);
    });

    const allowed = [...layer.mayImport, ...layer.mayDependOn].join(", ");
    it(`${layer.name} imports only from ${allowed}`, () => {
      const offences: string[] = [];
      for (const dir of layer.dirs) {
        for (const path of sourceFilesIn(dir)) {
          for (const { specifier, line } of read(path).imports) {
            const at = `${label(path)}:${line}`;

            if (specifier.startsWith("node:")) {
              if (!layer.mayUse.includes("node")) offences.push(`${at} imports ${specifier}`);
              continue;
            }

            if (!specifier.startsWith(".")) {
              const root = specifier.startsWith("@")
                ? specifier.split("/").slice(0, 2).join("/")
                : (specifier.split("/")[0] ?? specifier);
              if (!layer.mayDependOn.includes(root)) {
                offences.push(`${at} depends on the package ${specifier}`);
              }
              continue;
            }

            const target = layerOfImport(path, specifier);
            if (target && !layer.mayImport.includes(target.name)) {
              offences.push(`${at} imports ${specifier}, which is ${target.name}`);
            }
          }
        }
      }
      expect(offences).toEqual([]);
    });
  }

  /*
   * The rule that keeps the rest of this file honest. A new directory under `src/`
   * — a second extension surface, a worker, a shared client for something outside
   * this repo — is a new layer, and it arrives with no constraints at all until it
   * is written down here. Failing loudly at that moment is the whole point.
   */
  it("claims every directory under src/, so a new consumer has to declare itself", () => {
    const dirs = readdirSync(SRC)
      .filter((entry) => statSync(join(SRC, entry)).isDirectory())
      .sort();
    const unclaimed = dirs.filter((dir) => !layerOfDir.has(dir));
    expect(unclaimed).toEqual([]);
  });
});
