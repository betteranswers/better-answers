import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const CORE = "@better-answers/core";

type Zone = "kernel" | "access" | "door" | "layer" | "slice" | "test";

const LAYERS = ["llm", "audit"] as const;

const TOP_SLICE = "erasure";

const GRAPH_DOOR = "src/store/graph";

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

const readManifest = (root: string): CorePackage | null => {
  const parsed: unknown = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

  // SAFETY: both asserted fields are checked below before use, and a manifest without a name
  // is no core package.
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

// Found by the nearest manifest's name, never a path segment, so a throwaway tree and the
// real tree classify alike.
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

      // Direction before face: a kernel file reaching a slice's internal has broken
      // direction, and importing the face instead would not mend it.
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
