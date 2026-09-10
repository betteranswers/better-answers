import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  oxlintOverrideFor,
  readOxlintConfig,
  repositoryRoot,
} from "@better-answers/devtools/oxlint-config";
import { oxlintOver, type Tree } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

/**
 * ADR 0029's five import-direction rules are one rule in the repository's own oxlint
 * plugin, `better-answers/import-direction`: it places the importer and the target in a
 * zone by their position under `packages/core` and refuses what the ADR's matrix refuses,
 * with the rule number in the message. A rule nobody has run is a convention, so this test
 * runs it where each refusal fires and where its counterpart stays silent (`[CHECK1]`,
 * `[TEST7]`), and then over the real tree twice: once to show every directory under
 * `packages/core/src` classifies to the zone the ADR gives it, and once to show the tree
 * as committed lints clean under the rule.
 *
 * The rule's severity is read out of the real `.oxlintrc.json` and the plugin is resolved
 * from the repository rather than copied, so the suite cannot pass while the config that
 * switches the rule on is broken. The tree and the oxlint run are the devtools runner's,
 * which is what stops this suite reading a linter that could not run as a rule that stayed
 * quiet: an empty output satisfies every silent assertion below, so an empty output has to
 * be impossible unless the rule was silent.
 */

const RULE = "better-answers/import-direction";
const CORE = "packages/core";

const config = readOxlintConfig();

/**
 * The severity the base `rules` block runs the rule at. A restatement would pass while the
 * real config carried the rule as a warning, or not at all.
 */
const severity = config.rules[RULE];
if (severity === undefined) {
  throw new Error(`.oxlintrc.json's base rules block no longer switches ${RULE} on.`);
}

/**
 * The manifest a throwaway core carries: the name the rule keys on, and an `exports` map
 * naming the faces the cases below reach. Written here rather than copied from the real
 * manifest, so the case for a face the map does not name stays a case on the day the real
 * map gains that face.
 */
const MANIFEST = JSON.stringify({
  name: "@better-answers/core",
  exports: {
    "./kernel": "./src/kernel/index.ts",
    "./access": "./src/access/index.ts",
    "./store": "./src/store/index.ts",
    "./store/postgres": "./src/store/postgres/index.ts",
    "./store/graph": "./src/store/graph/index.ts",
    "./llm": "./src/llm/index.ts",
    "./audit": "./src/audit/index.ts",
    "./concepts": "./src/concepts/index.ts",
    "./guides": "./src/guides/index.ts",
    "./answering": "./src/answering/index.ts",
    "./erasure": "./src/erasure/index.ts",
  },
});

/** `files` under a throwaway core that carries the manifest above. */
const coreTree = (files: Tree): Tree => ({ [`${CORE}/package.json`]: MANIFEST, ...files });

const importOf = (specifier: string): string =>
  `import * as reached from "${specifier}";\nexport const probe = reached;\n`;

/** One file at `file` importing `specifier`, in a throwaway core. */
const importing = (file: string, specifier: string): Tree =>
  coreTree({ [file]: importOf(specifier) });

const SLICE = `${CORE}/src/concepts/landing.ts`;
const NESTED = `${CORE}/src/answering/plan/step.ts`;
const KERNEL = `${CORE}/src/kernel/actor.ts`;
const ACCESS = `${CORE}/src/access/predicate.ts`;
const GRAPH_DOOR = `${CORE}/src/store/graph/index.ts`;
const POSTGRES_DOOR = `${CORE}/src/store/postgres/handle.ts`;
const STORE_BARREL = `${CORE}/src/store/index.ts`;
const LLM = `${CORE}/src/llm/routes.ts`;
const AUDIT = `${CORE}/src/audit/index.ts`;
const TEST = `${CORE}/test/concepts.test.ts`;
const ROOT_FILE = `${CORE}/probe.ts`;

// The smoke case: the rule's own subject, with the one path that must come back. Until
// oxlint answers this the way the config says it will, no silence below means anything —
// and the plugin specifier is proved to load by the same case.
const lint = oxlintOver(
  JSON.stringify({
    jsPlugins: config.jsPlugins.map((plugin) => ({
      ...plugin,
      specifier: path.join(repositoryRoot, plugin.specifier),
    })),
    rules: { [RULE]: severity },
  }),
  { tree: importing(SLICE, "../guides/renderer.ts"), flagged: [SLICE] },
);

describe("the rule fires, naming the ADR 0029 rule it holds", () => {
  it.each([
    // Rule 5 — nothing in core imports a transport or a transport's dependency, from a slice,
    // a test, or a file at the package root that sits in no zone.
    ["5", "a slice importing hono", SLICE, "hono"],
    ["5", "a slice importing a hono subpath", SLICE, "hono/streaming"],
    ["5", "a slice importing the node adapter", SLICE, "@hono/node-server"],
    ["5", "a slice importing trpc", SLICE, "@trpc/server"],
    ["5", "a slice importing the MCP v2 server", SLICE, "@modelcontextprotocol/server"],
    ["5", "a slice importing the MCP v1 sdk", SLICE, "@modelcontextprotocol/sdk"],
    ["5", "a slice importing better-auth", SLICE, "better-auth"],
    ["5", "a slice importing a better-auth plugin", SLICE, "@better-auth/oauth-provider"],
    ["5", "a slice importing node:http", SLICE, "node:http"],
    ["5", "a slice importing node:http2", SLICE, "node:http2"],
    ["5", "a slice importing node:https", SLICE, "node:https"],
    ["5", "a test importing hono", TEST, "hono"],
    ["5", "a file at the package root importing hono", ROOT_FILE, "hono"],
    // Rule 4 — a cross-directory import lands on the target's own index.ts.
    ["4", "a slice reaching a sibling's internal file", SLICE, "../guides/renderer.ts"],
    [
      "4",
      "a slice reaching a sibling's internal without an extension",
      SLICE,
      "../guides/renderer",
    ],
    ["4", "a slice reaching a door's internal file", SLICE, "../store/postgres/handle.ts"],
    [
      "4",
      "a slice reaching a sibling's internal through a detour",
      SLICE,
      "../concepts/../guides/renderer.ts",
    ],
    [
      "4",
      "a slice subdirectory reaching a sibling's internal two up",
      NESTED,
      "../../concepts/inbox.ts",
    ],
    ["4", "a door reaching kernel's internal", GRAPH_DOOR, "../../kernel/actor.ts"],
    ["4", "the graph door reaching access's internal", GRAPH_DOOR, "../../access/predicate.ts"],
    ["4", "a test reaching a slice's internal", TEST, "../src/concepts/file.ts"],
    [
      "4",
      "a self-reference to a sibling's internal file",
      SLICE,
      "@better-answers/core/guides/renderer.ts",
    ],
    // Rule 4 — the face is an entry of the exports map.
    ["4", "a slice reaching a face the map does not name", SLICE, "../store/objects/index.ts"],
    ["4", "a slice reaching a sibling the map does not name", SLICE, "../sources/index.ts"],
    [
      "4",
      "a slice reaching a directory the map does not name, by its directory",
      SLICE,
      "../sources",
    ],
    ["4", "a slice reaching a nested face inside a sibling", SLICE, "../guides/internal/index.ts"],
    ["4", "a test reaching a face the map does not name", TEST, "../src/store/objects/index.ts"],
    [
      "4",
      "a self-reference to an entry the map does not name",
      SLICE,
      "@better-answers/core/sources",
    ],
    // Rule 4 — nothing imports erasure.
    ["4", "a slice importing erasure's face", SLICE, "../erasure/index.ts"],
    ["4", "a slice importing erasure by its directory", SLICE, "../erasure"],
    ["4", "a slice importing erasure's internal", SLICE, "../erasure/replay.ts"],
    ["4", "a slice importing erasure by self-reference", SLICE, "@better-answers/core/erasure"],
    // Rule 1 — kernel imports nothing else in core, and an internal is no exception.
    ["1", "kernel importing a slice's face", KERNEL, "../concepts/index.ts"],
    ["1", "kernel importing a slice's internal", KERNEL, "../concepts/inbox.ts"],
    ["1", "kernel importing access's face", KERNEL, "../access/index.ts"],
    ["1", "kernel importing a door's face", KERNEL, "../store/postgres/index.ts"],
    ["1", "kernel importing a layer's face", KERNEL, "../audit/index.ts"],
    // Rule 2 — access and the doors import only kernel; store/graph alone also imports access.
    ["2", "access importing a door's face", ACCESS, "../store/postgres/index.ts"],
    ["2", "access importing a slice's face", ACCESS, "../concepts/index.ts"],
    ["2", "the postgres door importing access", POSTGRES_DOOR, "../../access/index.ts"],
    ["2", "the graph door importing a slice's face", GRAPH_DOOR, "../../concepts/index.ts"],
    ["2", "the graph door importing a layer's face", GRAPH_DOOR, "../../audit/index.ts"],
    ["2", "a door importing another door", GRAPH_DOOR, "../postgres/index.ts"],
    ["2", "a door importing the store barrel", POSTGRES_DOOR, "../index.ts"],
    ["2", "the store barrel importing a door", STORE_BARREL, "./postgres/index.ts"],
    // Rule 3 — llm and audit import kernel, access and the doors; never a slice, never each other.
    ["3", "audit importing llm", AUDIT, "../llm/index.ts"],
    ["3", "llm importing audit", LLM, "../audit/index.ts"],
    ["3", "llm importing a slice's face", LLM, "../concepts/index.ts"],
    ["3", "audit importing a slice by self-reference", AUDIT, "@better-answers/core/concepts"],
    ["3", "a layer importing erasure", LLM, "../erasure/index.ts"],
  ])("rule %s — %s", (rule, _title, file, specifier) => {
    const output = lint.output(importing(file, specifier));

    expect(output).toContain(file);
    expect(output).toContain("import-direction");
    expect(output).toContain(`ADR 0029 rule ${rule}`);
  });

  it("says which entry to export when the face is one the map does not name", () => {
    const output = lint.output(importing(SLICE, "../store/objects/index.ts"));

    expect(output).toContain("`./store/objects`");
  });

  it("reads a nested index.ts inside a sibling as one of its internals, not as a face to export", () => {
    const output = lint.output(importing(SLICE, "../guides/internal/index.ts"));

    expect(output).toContain("never `internal/index.ts`");
    expect(output).not.toContain("Add `./guides`");
  });

  it.each([
    ["export-all", `export * from "../guides/renderer.ts";\n`],
    ["export-named", `export { render } from "../guides/renderer.ts";\n`],
    [
      "type-only",
      `import type { Rendered } from "../guides/renderer.ts";\nexport type Kept = Rendered;\n`,
    ],
  ])("reads a %s declaration as it reads an import", (_form, source) => {
    const output = lint.output(coreTree({ [SLICE]: source }));

    expect(output).toContain(SLICE);
    expect(output).toContain("ADR 0029 rule 4");
  });
});

describe("the rule stays silent where the ADR allows the import", () => {
  it.each([
    ["a slice importing a sibling's face", SLICE, "../guides/index.ts"],
    // The compiler refuses the extensionless form; the rule judges the direction, not the form.
    ["a slice importing a sibling by its directory", SLICE, "../guides"],
    ["a slice importing a door's face", SLICE, "../store/postgres/index.ts"],
    ["a slice importing a layer's face", SLICE, "../audit/index.ts"],
    ["a slice importing kernel's face", SLICE, "../kernel/index.ts"],
    ["a slice importing its own internal", SLICE, "./inbox.ts"],
    ["a slice subdirectory reaching its own slice's internal", NESTED, "../draft.ts"],
    ["a slice subdirectory reaching a sibling's face two up", NESTED, "../../concepts/index.ts"],
    ["a slice importing a sibling's face by self-reference", SLICE, "@better-answers/core/guides"],
    [
      "a slice importing a door's face by self-reference",
      SLICE,
      "@better-answers/core/store/postgres",
    ],
    ["the graph door importing access", GRAPH_DOOR, "../../access/index.ts"],
    ["the graph door importing kernel", GRAPH_DOOR, "../../kernel/index.ts"],
    ["the postgres door importing kernel", POSTGRES_DOOR, "../../kernel/index.ts"],
    ["a door importing its own internal", GRAPH_DOOR, "./walk.ts"],
    ["access importing kernel", ACCESS, "../kernel/index.ts"],
    ["audit importing a door", AUDIT, "../store/postgres/index.ts"],
    ["audit importing kernel", AUDIT, "../kernel/index.ts"],
    ["audit importing access", AUDIT, "../access/index.ts"],
    ["llm importing a door by self-reference", LLM, "@better-answers/core/store/postgres"],
    ["a test importing a slice's face", TEST, "../src/concepts/index.ts"],
    ["a test importing kernel's face", TEST, "../src/kernel/index.ts"],
    ["a test importing a door's face by self-reference", TEST, "@better-answers/core/store/graph"],
    ["a test importing erasure — the one importer allowed to", TEST, "../src/erasure/index.ts"],
    ["a test importing its own sibling", TEST, "./suite-postgres.ts"],
    ["a test importing the devtools runner", TEST, "@better-answers/devtools/throwaway-tree"],
    ["a slice importing a third-party package", SLICE, "zod"],
    ["a slice importing the schema package", SLICE, "@better-answers/schema"],
    ["a slice importing a node builtin outside the list", SLICE, "node:crypto"],
  ])("%s", (_title, file, specifier) => {
    expect(lint.flagged(importing(file, specifier))).toEqual([]);
  });

  it.each([
    [
      "a relative import that leaves its directory",
      "apps/api/src/routers/probe.ts",
      "../auth/claims.ts",
    ],
    ["a transport import", "apps/api/src/probe.ts", "hono"],
  ])("stays silent outside packages/core for %s", (_title, file, specifier) => {
    expect(lint.flagged(importing(file, specifier))).toEqual([]);
  });

  it("keys on the manifest's name, not on a path segment: another package under packages/core is silent, core under any path fires", () => {
    const elsewhere = "libs/knowledge/src/kernel/actor.ts";

    expect(
      lint.flagged({
        [`${CORE}/package.json`]: JSON.stringify({ name: "@better-answers/other" }),
        [KERNEL]: importOf("../concepts/index.ts"),
      }),
    ).toEqual([]);
    expect(
      lint.flagged({
        "libs/knowledge/package.json": MANIFEST,
        [elsewhere]: importOf("../concepts/index.ts"),
      }),
    ).toEqual([elsewhere]);
  });
});

const coreRoot = path.join(repositoryRoot, CORE);

/** Every directory under `packages/core/src`, relative to it with `/`, deepest last. */
const sourceDirectories = (under = ""): readonly string[] =>
  readdirSync(path.join(coreRoot, "src", under), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = under === "" ? entry.name : `${under}/${entry.name}`;
      return [dir, ...sourceDirectories(dir)];
    });

/**
 * The zone ADR 0029 gives a directory: three names fixed, two layers, everything else a
 * slice, and everything under `store/` a door. This is the test's half of the pair: the
 * rule's table is proved against the tree, and the tree against the table.
 */
const zoneOf = (dir: string): string => {
  const [first] = dir.split("/");
  if (first === "kernel" || first === "access") return first;
  if (first === "store") return "door";
  if (first === "llm" || first === "audit") return "layer";
  return "slice";
};

describe("the zones and the real tree", () => {
  const directories = sourceDirectories();

  it("walks a tree with directories in it", () => {
    expect(directories.length).toBeGreaterThan(0);
  });

  // An internal file of another directory fires from every zone — as a direction refusal
  // from kernel, as an internal from the rest — and either message names the importer's
  // zone, which is how a directory's classification is read off a run. So every directory
  // the tree has classifies, and to the zone the ADR gives it: a new slice or door needs no
  // line anywhere.
  it.each(directories)("places src/%s in its zone", (dir) => {
    const target = dir.startsWith("kernel") ? "src/access/predicate.ts" : "src/kernel/actor.ts";
    const specifier = path.posix.relative(`src/${dir}`, target);
    const file = `${CORE}/src/${dir}/probe.ts`;
    const output = lint.output(
      importing(file, specifier.startsWith(".") ? specifier : `./${specifier}`),
    );

    expect(output).toContain(file);
    expect(output).toContain(`(${zoneOf(dir)})`);
  });

  it.each(["llm", "audit", "erasure"])("names a layer or top slice the tree has: %s", (named) => {
    expect(existsSync(path.join(coreRoot, "src", named, "index.ts"))).toBe(true);
  });

  /** The committed `packages/core` — its manifest, `src/` and `test/` — as a throwaway tree. */
  const committedCore = (): Tree => {
    const files = (under: string): readonly string[] =>
      readdirSync(path.join(coreRoot, under), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(`${under}/${entry.name}`)
          : entry.name.endsWith(".ts")
            ? [`${under}/${entry.name}`]
            : [],
      );
    return Object.fromEntries(
      ["package.json", ...files("src"), ...files("test")].map((file) => [
        `${CORE}/${file}`,
        readFileSync(path.join(coreRoot, file), "utf8"),
      ]),
    );
  };

  it("lints the tree as committed clean — every import in packages/core obeys all five rules", () => {
    expect(lint.flagged(committedCore())).toEqual([]);
  });
});

/**
 * The override this rule replaced. With it gone, the base `**\/*.ts` override's bans reach
 * core with no restatement — which is the point of deleting it, and is proved here rather
 * than remembered: an override that set `no-restricted-imports` over core again would
 * replace the base override's patterns for those files, and the drizzle-zod ban would go
 * quiet there without any test noticing.
 */
describe("the base import bans reach packages/core unrestated", () => {
  it("has no override in .oxlintrc.json setting no-restricted-imports over packages/core", () => {
    const over = config.overrides
      .filter((override) => override.rules?.["no-restricted-imports"] !== undefined)
      .flatMap((override) => override.files ?? [])
      .filter((glob) => glob.startsWith("packages/core"));

    expect(over).toEqual([]);
  });

  const probe = `${CORE}/src/concepts/probe.ts`;
  const lintBase = oxlintOver(JSON.stringify({ overrides: [oxlintOverrideFor("**/*.ts")] }), {
    tree: { [probe]: importOf("drizzle-zod") },
    flagged: [probe],
  });

  it.each(["drizzle-zod", "better-auth", "@better-auth/oauth-provider"])(
    "refuses %s in a core file through the base override alone",
    (specifier) => {
      expect(lintBase.flagged({ [probe]: importOf(specifier) })).toEqual([probe]);
    },
  );
});
