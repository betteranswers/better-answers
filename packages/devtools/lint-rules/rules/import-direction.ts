import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * ADR 0029's five import-direction rules over `packages/core`, held as one rule.
 *
 * `no-restricted-imports` sees the specifier's text and nothing else: it cannot learn what
 * directory `../../x/index.ts` lands in from the importer's position, and it knows the
 * importer only by an override's glob. So it held rule 4's face clause and rule 5 by
 * enumerating specifier shapes, and rules 1, 2, 3 and "nothing imports erasure" were
 * conventions the tree obeyed by hand (T-114; the probe of 10/09/2026 behind T-117).
 *
 * This rule resolves both ends. The importer and the target are each placed in a *zone*
 * by their position under the package: `kernel` and `access` are themselves, `store/<x>`
 * is a door, `llm` and `audit` are the rule-3 layers, `erasure` is the slice on top, every
 * other directory under `src/` is a slice and `test/` is a test. The package is found from
 * the nearest `package.json` naming `@better-answers/core` — never a path segment — so a
 * throwaway tree in a suite and the real tree classify the same way, and a new slice or
 * door lands with no line here. Only a new layer is a line, and rule 3 names the layers, so
 * it is an ADR 0029 amendment before it is a line. (*Zone*, not *kind*: the glossary's
 * kind is a concept's type.)
 *
 * A face is the target directory's own `index.ts` *and* an entry of the package's
 * `exports` map: the face a sibling imports and the face a transport imports are one file,
 * and the constitution's interface rule already asks a test to reach an entry the map names
 * (`[TEST1]`). Both import forms resolve — `../<dir>/index.ts` at any depth and
 * `@better-answers/core/<entry>` — and a same-directory import is never judged.
 *
 * Rule 4's other clause, that the slice graph is acyclic, stays `import/no-cycle`'s, which
 * follows both forms.
 */

/** The package this rule judges: the one whose nearest manifest carries this name. */
const CORE = "@better-answers/core";

/** What a position under the package resolves to. */
type Zone = "kernel" | "access" | "door" | "layer" | "slice" | "test";

/** The rule-3 layers, by directory name under `src/`. */
const LAYERS = ["llm", "audit"] as const;

/** The slice nothing but a test imports (rule 4). */
const TOP_SLICE = "erasure";

/** The one door that also imports `access` (rule 2, amended 2026-09-07). */
const GRAPH_DOOR = "src/store/graph";

/**
 * What each zone may reach in core, and the ADR 0029 rule with its clause a refusal cites.
 * Rules 1–3 are these rows; a slice's and a test's own limits are rule 4's, checked apart.
 */
const ZONES = {
  kernel: {
    reaches: new Set<Zone>(),
    rule: "1",
    clause: "kernel imports nothing else in core",
  },
  access: {
    reaches: new Set<Zone>(["kernel"]),
    rule: "2",
    clause: "access imports only kernel",
  },
  door: {
    reaches: new Set<Zone>(["kernel"]),
    rule: "2",
    clause: "a store door imports only kernel, and store/graph alone also imports access",
  },
  layer: {
    reaches: new Set<Zone>(["kernel", "access", "door"]),
    rule: "3",
    clause: "llm and audit import kernel, access and the doors — never a slice, never each other",
  },
  slice: {
    reaches: new Set<Zone>(["kernel", "access", "door", "layer", "slice"]),
    rule: "4",
    clause: "a slice reaches another only through its face",
  },
  test: {
    reaches: new Set<Zone>(["kernel", "access", "door", "layer", "slice"]),
    rule: "4",
    clause: "a test reaches a slice only through its face",
  },
} satisfies Record<
  Zone,
  { readonly reaches: ReadonlySet<Zone>; readonly rule: string; readonly clause: string }
>;

/**
 * Rule 5's list — a transport, or a transport's dependency — refused as the package itself
 * or any subpath of it. `core` is a library with five callers, four of which have no notion
 * of an HTTP status code; a transport import here is how that boundary erodes, and a package
 * boundary cannot refuse it on its own.
 */
const TRANSPORTS = [
  "hono",
  "@hono",
  "@trpc",
  "@modelcontextprotocol",
  "better-auth",
  "@better-auth",
  "node:http",
  "node:http2",
  "node:https",
] as const;

const isTransport = (specifier: string): boolean =>
  TRANSPORTS.some((name) => specifier === name || specifier.startsWith(`${name}/`));

/** A core package: where it is, and the faces its `exports` map names, as absolute paths. */
type CorePackage = {
  readonly root: string;
  /** An entry subpath as the map writes it — `./kernel`, `./store/graph` — to the file it names. */
  readonly entries: ReadonlyMap<string, string>;
  readonly faces: ReadonlySet<string>;
};

/**
 * The core package a directory sits in, memoised per directory for the life of the plugin
 * process; `null` when the nearest manifest is another package's or there is none. A tree
 * is written once and linted once, so a directory's answer never changes underneath this.
 */
const packages = new Map<string, CorePackage | null>();

const readManifest = (root: string): CorePackage | null => {
  const parsed: unknown = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  // SAFETY: only the two manifest fields the rule reads are asserted, each checked below
  // before use — a manifest without a name is no core package, and an `exports` value that
  // is not a string (a conditions object) names no face.
  const manifest = parsed as { readonly name?: unknown; readonly exports?: unknown };
  if (manifest.name !== CORE) return null;
  const entries = new Map<string, string>();
  if (typeof manifest.exports === "object" && manifest.exports !== null) {
    for (const [entry, target] of Object.entries(manifest.exports)) {
      if (typeof target === "string") entries.set(entry, path.resolve(root, target));
    }
  }
  return { root, entries, faces: new Set(entries.values()) };
};

const packageOf = (directory: string): CorePackage | null => {
  const known = packages.get(directory);
  if (known !== undefined) return known;
  const parent = path.dirname(directory);
  const found = existsSync(path.join(directory, "package.json"))
    ? readManifest(directory)
    : parent === directory
      ? null
      : packageOf(parent);
  packages.set(directory, found);
  return found;
};

/** Where a file sits in the package. */
type Place = {
  readonly zone: Zone;
  /** The directory that owns the file, relative to the package root with `/`: `src/store/graph`. */
  readonly dir: string;
  /** The directory's name under `src/` — `concepts`, `store` — or `test`. */
  readonly top: string;
};

/** `absolute`'s place in `pkg`, or undefined when it sits nowhere the rule classifies. */
const placeOf = (pkg: CorePackage, absolute: string): Place | undefined => {
  const segments = path.relative(pkg.root, absolute).split(path.sep);
  const [area, first, second] = segments;
  if (area === "test" && segments.length >= 2) return { zone: "test", dir: "test", top: "test" };
  if (area !== "src" || first === undefined || segments.length < 3) return undefined;
  const dir = `src/${first}`;
  if (first === "kernel" || first === "access") return { zone: first, dir, top: first };
  if (first === "store") {
    const door = second !== undefined && segments.length > 3 ? `${dir}/${second}` : dir;
    return { zone: "door", dir: door, top: first };
  }
  const zone = LAYERS.some((layer) => layer === first) ? "layer" : "slice";
  return { zone, dir, top: first };
};

/** The face of a place: its directory's own `index.ts`, as an absolute path. */
const faceOf = (pkg: CorePackage, place: Place): string =>
  path.join(pkg.root, ...place.dir.split("/"), "index.ts");

/**
 * The file a specifier names, as an absolute path; undefined for a bare package. A relative
 * specifier without an extension names a directory, and is read as that directory's face,
 * so the direction is judged whatever the compiler makes of the form. A self-reference the
 * map does not name resolves to where it would land under `src/`, so the refusal can say
 * which face to export rather than staying silent on a subpath the compiler will refuse.
 */
const targetOf = (pkg: CorePackage, importer: string, specifier: string): string | undefined => {
  if (specifier.startsWith(".")) {
    const resolved = path.resolve(path.dirname(importer), specifier);
    return path.extname(resolved) === "" ? path.join(resolved, "index.ts") : resolved;
  }
  if (specifier !== CORE && !specifier.startsWith(`${CORE}/`)) return undefined;
  const entry = `.${specifier.slice(CORE.length)}`;
  const named = pkg.entries.get(entry);
  if (named !== undefined) return named;
  if (entry === ".") return undefined;
  const under = entry.slice("./".length);
  return path.join(pkg.root, "src", under.endsWith(".ts") ? under : path.join(under, "index.ts"));
};

export const importDirectionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "ADR 0029's five import-direction rules over packages/core, by the position of both ends.",
    },
    messages: {
      transport:
        "packages/core is transport-agnostic: `{{specifier}}` is a transport or a transport's dependency (ADR 0029 rule 5). A status code, a Request or a Response belongs in apps/api; export a function and a typed error instead.",
      direction:
        "`{{fromDir}}` ({{from}}) may not import `{{toDir}}` ({{to}}) — ADR 0029 rule {{rule}}: {{clause}}.",
      erasure:
        "Nothing in core imports `erasure`; it sits at the top of the slice graph, and only a test reaches it (ADR 0029 rule 4).",
      internal:
        "`{{fromDir}}` ({{from}}) reaches `{{dir}}` only through its own index.ts, never `{{inside}}` (ADR 0029 rule 4). Export what you need from that face and import it from there.",
      unexported:
        "`{{dir}}/index.ts` is a face packages/core's exports map does not name (ADR 0029 rule 4). Add `./{{entry}}` to the map, so a sibling and a transport reach one face and a test reaches an entry point ([TEST1]).",
    },
  },
  createOnce(context) {
    const check = (node: ESTree.Node, specifier: string): void => {
      const pkg = packageOf(path.dirname(context.filename));
      if (pkg === null) return;
      if (isTransport(specifier)) {
        context.report({ node, messageId: "transport", data: { specifier } });
        return;
      }
      const importer = placeOf(pkg, context.filename);
      if (importer === undefined) return;
      const target = targetOf(pkg, context.filename, specifier);
      if (target === undefined) return;
      const reached = placeOf(pkg, target);
      if (reached === undefined || reached.dir === importer.dir) return;
      // Direction first: a kernel file reaching a slice's internal has broken rule 1, and
      // reaching for the face instead would not mend it.
      const { reaches, rule, clause } = ZONES[importer.zone];
      const allowed =
        reaches.has(reached.zone) || (importer.dir === GRAPH_DOOR && reached.zone === "access");
      if (!allowed) {
        context.report({
          node,
          messageId: "direction",
          data: {
            fromDir: importer.dir,
            from: importer.zone,
            toDir: reached.dir,
            to: reached.zone,
            rule,
            clause,
          },
        });
        return;
      }
      if (reached.zone === "slice" && reached.top === TOP_SLICE && importer.zone !== "test") {
        context.report({ node, messageId: "erasure" });
        return;
      }
      // The face is the directory's own index.ts: a nested index.ts inside a sibling is one
      // of its internals, reached only through the sibling's.
      const face = faceOf(pkg, reached);
      if (target !== face) {
        context.report({
          node,
          messageId: "internal",
          data: {
            fromDir: importer.dir,
            from: importer.zone,
            dir: reached.dir,
            inside: path.relative(path.dirname(face), target).split(path.sep).join("/"),
          },
        });
        return;
      }
      if (!pkg.faces.has(target)) {
        context.report({
          node,
          messageId: "unexported",
          data: { dir: reached.dir, entry: reached.dir.slice("src/".length) },
        });
      }
    };
    const source = (node: {
      readonly source: { readonly value: unknown } | null;
    }): string | undefined =>
      node.source !== null && typeof node.source.value === "string" ? node.source.value : undefined;
    return {
      ImportDeclaration(node) {
        const specifier = source(node);
        if (specifier !== undefined) check(node, specifier);
      },
      ExportAllDeclaration(node) {
        const specifier = source(node);
        if (specifier !== undefined) check(node, specifier);
      },
      ExportNamedDeclaration(node) {
        const specifier = source(node);
        if (specifier !== undefined) check(node, specifier);
      },
    };
  },
});
