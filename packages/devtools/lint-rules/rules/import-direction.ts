import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const CORE = "@better-answers/core";

type Zone = "kernel" | "access" | "door" | "layer" | "slice" | "catalogue" | "test";

const LAYERS = ["llm", "audit"] as const;

const TOP_SLICE = "erasure";

const CATALOGUE = "refusals";

const MAP_DOOR = "src/store/map";

const ZONES = {
  kernel: {
    reaches: new Set<Zone>(),
    clause: "kernel imports nothing else in core",
  },
  access: {
    reaches: new Set<Zone>(["kernel"]),
    clause: "access imports only kernel",
  },
  door: {
    reaches: new Set<Zone>(["kernel"]),
    clause: "a store door imports only kernel, and store/map alone also imports access",
  },
  layer: {
    reaches: new Set<Zone>(["kernel", "access", "door"]),
    clause: "llm and audit import kernel, access and the doors — never a slice, never each other",
  },
  slice: {
    reaches: new Set<Zone>(["kernel", "access", "door", "layer", "slice"]),
    clause: "a slice reaches another only through its face",
  },
  catalogue: {
    reaches: new Set<Zone>(["kernel", "slice"]),
    clause: "the refusal catalogue imports kernel and each slice's face, and nothing else",
  },
  test: {
    reaches: new Set<Zone>(["kernel", "access", "door", "layer", "slice", "catalogue"]),
    clause: "a test reaches a slice only through its face",
  },
} satisfies Record<Zone, { readonly reaches: ReadonlySet<Zone>; readonly clause: string }>;

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

type CorePackage = {
  readonly root: string;

  readonly entries: ReadonlyMap<string, string>;
  readonly faces: ReadonlySet<string>;
};

const packages = new Map<string, CorePackage | null>();

const entriesOf = (
  root: string,
  exported: readonly (readonly [string, unknown])[],
): ReadonlyMap<string, string> => {
  const entries = new Map<string, string>();
  for (const [entry, target] of exported) {
    if (typeof target === "string") entries.set(entry, path.resolve(root, target));
  }
  return entries;
};

const readManifest = (root: string): CorePackage | null => {
  const manifest: unknown = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

  // A manifest without the core's name is no core package, whatever else it holds.
  if (typeof manifest !== "object" || manifest === null) return null;
  if (!("name" in manifest) || manifest.name !== CORE) return null;
  const exported =
    "exports" in manifest && typeof manifest.exports === "object" && manifest.exports !== null
      ? Object.entries(manifest.exports)
      : [];
  const entries = entriesOf(root, exported);
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

type Place = {
  readonly zone: Zone;

  readonly dir: string;

  readonly top: string;
};

const srcPlaceOf = (first: string, second: string | undefined, depth: number): Place => {
  const dir = `src/${first}`;
  if (first === "kernel" || first === "access") return { zone: first, dir, top: first };
  if (first === CATALOGUE) return { zone: "catalogue", dir, top: first };
  if (first === "store") {
    const door = second !== undefined && depth > 3 ? `${dir}/${second}` : dir;
    return { zone: "door", dir: door, top: first };
  }
  const zone = LAYERS.some((layer) => layer === first) ? "layer" : "slice";
  return { zone, dir, top: first };
};

const placeOf = (pkg: CorePackage, absolute: string): Place | undefined => {
  const segments = path.relative(pkg.root, absolute).split(path.sep);
  const [area, first, second] = segments;
  if (area === "test" && segments.length >= 2) return { zone: "test", dir: "test", top: "test" };
  if (area !== "src" || first === undefined || segments.length < 3) return undefined;
  return srcPlaceOf(first, second, segments.length);
};

const faceOf = (pkg: CorePackage, place: Place): string =>
  path.join(pkg.root, ...place.dir.split("/"), "index.ts");

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

type Edge = { readonly importer: Place; readonly reached: Place; readonly target: string };

const edgeOf = (pkg: CorePackage, importerFile: string, specifier: string): Edge | undefined => {
  const importer = placeOf(pkg, importerFile);
  if (importer === undefined) return undefined;
  const target = targetOf(pkg, importerFile, specifier);
  if (target === undefined) return undefined;
  const reached = placeOf(pkg, target);
  if (reached === undefined || reached.dir === importer.dir) return undefined;
  return { importer, reached, target };
};

type Finding = {
  readonly messageId: "catalogue" | "direction" | "erasure" | "internal" | "unexported";
  readonly data?: Readonly<Record<string, string>>;
};

const directionFinding = ({ importer, reached }: Edge): Finding | undefined => {
  const { reaches, clause } = ZONES[importer.zone];
  if (reaches.has(reached.zone) || (importer.dir === MAP_DOOR && reached.zone === "access")) {
    return undefined;
  }
  return {
    messageId: "direction",
    data: {
      fromDir: importer.dir,
      from: importer.zone,
      toDir: reached.dir,
      to: reached.zone,
      clause,
    },
  };
};

const catalogueFinding = ({ importer, reached }: Edge): Finding | undefined =>
  reached.zone === "catalogue" && importer.zone !== "test" ? { messageId: "catalogue" } : undefined;

const ABOVE_ERASURE = new Set<Zone>(["catalogue", "test"]);

const erasureFinding = ({ importer, reached }: Edge): Finding | undefined =>
  reached.zone === "slice" && reached.top === TOP_SLICE && !ABOVE_ERASURE.has(importer.zone)
    ? { messageId: "erasure" }
    : undefined;

const faceFinding = (
  pkg: CorePackage,
  { importer, reached, target }: Edge,
): Finding | undefined => {
  const face = faceOf(pkg, reached);
  if (target !== face) {
    return {
      messageId: "internal",
      data: {
        fromDir: importer.dir,
        from: importer.zone,
        dir: reached.dir,
        inside: path.relative(path.dirname(face), target).split(path.sep).join("/"),
      },
    };
  }
  if (pkg.faces.has(target)) return undefined;
  return {
    messageId: "unexported",
    data: { dir: reached.dir, entry: reached.dir.slice("src/".length) },
  };
};

const findingOf = (pkg: CorePackage, edge: Edge): Finding | undefined =>
  catalogueFinding(edge) ??
  directionFinding(edge) ??
  erasureFinding(edge) ??
  faceFinding(pkg, edge);

export const importDirectionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "The import-direction rules over packages/core, by the position of both ends.",
    },
    messages: {
      transport:
        "packages/core is transport-agnostic: `{{specifier}}` is a transport or a transport's dependency. A status code, a Request or a Response belongs in apps/api; export a function and a typed error instead.",
      direction: "`{{fromDir}}` ({{from}}) may not import `{{toDir}}` ({{to}}): {{clause}}.",
      catalogue:
        "Nothing in core imports the refusal catalogue; it reads every slice's vocabulary, and only a test reaches it.",
      erasure:
        "Nothing in core imports `erasure` but the refusal catalogue; it sits at the top of the slice graph, and beyond the catalogue only a test reaches it.",
      internal:
        "`{{fromDir}}` ({{from}}) reaches `{{dir}}` only through its own index.ts, never `{{inside}}`. Export what you need from that face and import it from there.",
      unexported:
        "`{{dir}}/index.ts` is a face packages/core's exports map does not name. Add `./{{entry}}` to the map, so a sibling and a transport reach one face and a test reaches an entry point (the root `CODING_STANDARDS.md`).",
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
      const edge = edgeOf(pkg, context.filename, specifier);
      if (edge === undefined) return;
      const found = findingOf(pkg, edge);
      if (found !== undefined) context.report({ node, ...found });
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
