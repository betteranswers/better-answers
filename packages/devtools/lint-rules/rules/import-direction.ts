import path from "node:path";

import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * PROBE — throwaway, never merged (branch probe/import-direction, 10/09/2026).
 *
 * ADR 0029's five import-direction rules as one rule that resolves the importer and the
 * target to a *kind* by their position under `packages/core/src`, rather than by the
 * shape of the specifier. The "map" the ADR asked for turns out to be three names and a
 * shape: `kernel` and `access` are themselves, `store/<x>` is a door, `llm` and `audit`
 * are the rule-3 layers, `erasure` is the slice nothing imports, and every other directory
 * under `src/` is a slice. A new slice or a new door needs no line here.
 */

type Kind = "kernel" | "access" | "door" | "layer" | "slice" | "test";

type Place = {
  readonly kind: Kind;
  /** The directory that owns the file, relative to the package root: `src/store/graph`. */
  readonly dir: string;
  /** The file's name inside that directory. */
  readonly base: string;
};

const LAYERS: ReadonlySet<string> = new Set(["llm", "audit"]);
const TOP_SLICE = "erasure";
const PACKAGE = "core";
const SELF = "@better-answers/core/";

/** What each kind may reach in core (rules 1–4); the graph door's `access` is special-cased. */
const MAY_REACH: Readonly<Record<Kind, ReadonlySet<Kind>>> = {
  kernel: new Set(),
  access: new Set(["kernel"]),
  door: new Set(["kernel"]),
  layer: new Set(["kernel", "access", "door"]),
  slice: new Set(["kernel", "access", "door", "layer", "slice"]),
  test: new Set(["kernel", "access", "door", "layer", "slice"]),
};

/** Where `absolute` sits in the package, or undefined when it is not a core file. */
const placeOf = (absolute: string): Place | undefined => {
  const segments = absolute.split(path.sep);
  const root = segments.lastIndexOf(PACKAGE);
  if (root < 0) return undefined;
  const area = segments[root + 1];
  const rest = segments.slice(root + 2);
  const base = rest.at(-1);
  if (base === undefined) return undefined;
  if (area === "test") return { kind: "test", dir: "test", base };
  if (area !== "src") return undefined;
  const [first, second] = rest;
  if (first === undefined || rest.length < 2) return undefined;
  const dirOf = (depth: number): string => path.posix.join("src", ...rest.slice(0, depth));
  if (first === "kernel") return { kind: "kernel", dir: dirOf(1), base };
  if (first === "access") return { kind: "access", dir: dirOf(1), base };
  if (first === "store") {
    if (second === undefined || rest.length < 3) return { kind: "door", dir: dirOf(1), base };
    return { kind: "door", dir: dirOf(2), base };
  }
  if (LAYERS.has(first)) return { kind: "layer", dir: dirOf(1), base };
  return { kind: "slice", dir: dirOf(1), base };
};

/** The module a specifier names, as an absolute path; undefined for a bare package. */
const targetOf = (importer: string, specifier: string): string | undefined => {
  if (specifier.startsWith(".")) return path.resolve(path.dirname(importer), specifier);
  if (specifier.startsWith(SELF)) {
    const segments = importer.split(path.sep);
    const root = segments.slice(0, segments.lastIndexOf(PACKAGE) + 1).join(path.sep);
    const entry = specifier.slice(SELF.length);
    // The exports map names `./<entry>` → `./src/<entry>/index.ts`; a deeper path is no entry.
    return entry.endsWith(".ts")
      ? path.join(root, "src", entry)
      : path.join(root, "src", entry, "index.ts");
  }
  return undefined;
};

const sliceName = (place: Place): string => place.dir.split("/")[1] ?? place.dir;

export const importDirectionRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "ADR 0029's import direction inside packages/core, by kind." },
    messages: {
      internal:
        "A {{from}} reaches `{{dir}}` only through its index.ts, never `{{base}}` (ADR 0029 rule 4).",
      direction:
        "`{{fromDir}}` ({{from}}) may not import `{{toDir}}` ({{to}}) — ADR 0029 rule {{rule}}.",
      erasure: "Nothing in core imports `erasure`; it sits at the top (ADR 0029 rule 4).",
    },
  },
  createOnce(context) {
    const check = (node: ESTree.Node, specifier: string): void => {
      const importer = placeOf(context.filename);
      if (importer === undefined) return;
      const target = targetOf(context.filename, specifier);
      if (target === undefined) return;
      const reached = placeOf(target);
      if (reached === undefined) return;
      if (reached.dir === importer.dir) return;
      if (reached.base !== "index.ts") {
        context.report({
          node,
          messageId: "internal",
          data: { from: importer.kind, dir: reached.dir, base: reached.base },
        });
        return;
      }
      if (reached.kind === "slice" && sliceName(reached) === TOP_SLICE) {
        context.report({ node, messageId: "erasure" });
        return;
      }
      const allowed =
        MAY_REACH[importer.kind].has(reached.kind) ||
        (importer.dir === "src/store/graph" && reached.kind === "access");
      if (!allowed) {
        const rule = importer.kind === "kernel" ? "1" : importer.kind === "layer" ? "3" : "2";
        context.report({
          node,
          messageId: "direction",
          data: {
            fromDir: importer.dir,
            from: importer.kind,
            toDir: reached.dir,
            to: reached.kind,
            rule,
          },
        });
      }
    };
    return {
      ImportDeclaration(node) {
        if (typeof node.source.value === "string") check(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        if (typeof node.source.value === "string") check(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null && typeof node.source.value === "string")
          check(node, node.source.value);
      },
    };
  },
});
