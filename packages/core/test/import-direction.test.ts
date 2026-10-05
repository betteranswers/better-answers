import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  oxlintOverrideFor,
  pluginConfigFor,
  readOxlintConfig,
} from "@better-answers/devtools/oxlint-config";
import { repositoryRoot } from "@better-answers/devtools/paths";
import { oxlintOver, type Tree } from "@better-answers/devtools/throwaway-tree";

const RULE = "better-answers/import-direction";
const CORE = "packages/core";

const config = readOxlintConfig();

const severity = config.rules[RULE];
if (severity === undefined) {
  throw new Error(`.oxlintrc.json's base rules block no longer switches ${RULE} on.`);
}

const MANIFEST = JSON.stringify({
  name: "@better-answers/core",
  exports: {
    "./kernel": "./src/kernel/index.ts",
    "./access": "./src/access/index.ts",
    "./store": "./src/store/index.ts",
    "./store/postgres": "./src/store/postgres/index.ts",
    "./store/map": "./src/store/map/index.ts",
    "./llm": "./src/llm/index.ts",
    "./audit": "./src/audit/index.ts",
    "./concepts": "./src/concepts/index.ts",
    "./guides": "./src/guides/index.ts",
    "./answering": "./src/answering/index.ts",
    "./erasure": "./src/erasure/index.ts",
  },
});

const coreTree = (files: Tree): Tree => ({ [`${CORE}/package.json`]: MANIFEST, ...files });

const importOf = (specifier: string): string =>
  `import * as reached from "${specifier}";\nexport const probe = reached;\n`;

const importing = (file: string, specifier: string): Tree =>
  coreTree({ [file]: importOf(specifier) });

const SLICE = `${CORE}/src/concepts/landing.ts`;
const NESTED = `${CORE}/src/answering/plan/step.ts`;
const KERNEL = `${CORE}/src/kernel/actor.ts`;
const ACCESS = `${CORE}/src/access/predicate.ts`;
const MAP_DOOR = `${CORE}/src/store/map/index.ts`;
const POSTGRES_DOOR = `${CORE}/src/store/postgres/handle.ts`;
const STORE_BARREL = `${CORE}/src/store/index.ts`;
const LLM = `${CORE}/src/llm/model-choices.ts`;
const AUDIT = `${CORE}/src/audit/index.ts`;
const TEST = `${CORE}/test/concepts.test.ts`;
const ROOT_FILE = `${CORE}/probe.ts`;

const lint = oxlintOver(pluginConfigFor({ [RULE]: severity }), {
  tree: importing(SLICE, "../guides/renderer.ts"),
  flagged: [SLICE],
});

const INTERNAL = "only through its own index.ts";

/** Each clause as the rule prints it, with the imports that break it. */
const REFUSED: Readonly<Record<string, readonly (readonly [string, string, string])[]>> = {
  "packages/core is transport-agnostic": [
    ["a slice importing hono", SLICE, "hono"],
    ["a slice importing a hono subpath", SLICE, "hono/streaming"],
    ["a slice importing the node adapter", SLICE, "@hono/node-server"],
    ["a slice importing trpc", SLICE, "@trpc/server"],
    ["a slice importing the MCP v2 server", SLICE, "@modelcontextprotocol/server"],
    ["a slice importing the MCP v1 sdk", SLICE, "@modelcontextprotocol/sdk"],
    ["a slice importing better-auth", SLICE, "better-auth"],
    ["a slice importing a better-auth plugin", SLICE, "@better-auth/oauth-provider"],
    ["a slice importing node:http", SLICE, "node:http"],
    ["a slice importing node:http2", SLICE, "node:http2"],
    ["a slice importing node:https", SLICE, "node:https"],
    ["a test importing hono", TEST, "hono"],
    ["a package-root file importing hono", ROOT_FILE, "hono"],
  ],
  [INTERNAL]: [
    ["a slice reaching a sibling's internal file", SLICE, "../guides/renderer.ts"],
    ["a slice reaching a sibling's extensionless internal", SLICE, "../guides/renderer"],
    ["a slice reaching a door's internal file", SLICE, "../store/postgres/handle.ts"],
    ["a slice detouring to a sibling's internal", SLICE, "../concepts/../guides/renderer.ts"],
    ["a slice subdirectory reaching a sibling's internal", NESTED, "../../concepts/inbox.ts"],
    ["a door reaching kernel's internal", MAP_DOOR, "../../kernel/actor.ts"],
    ["the map door reaching access's internal", MAP_DOOR, "../../access/predicate.ts"],
    ["a test reaching a slice's internal", TEST, "../src/concepts/file.ts"],
    [
      "a self-reference to a sibling's internal file",
      SLICE,
      "@better-answers/core/guides/renderer.ts",
    ],
    ["a slice reaching a sibling's nested face", SLICE, "../guides/internal/index.ts"],
  ],
  "is a face packages/core's exports map does not name": [
    ["a slice reaching an unmapped face", SLICE, "../store/objects/index.ts"],
    ["a slice reaching an unmapped sibling", SLICE, "../sources/index.ts"],
    ["a slice reaching an unmapped directory", SLICE, "../sources"],
    ["a test reaching an unmapped face", TEST, "../src/store/objects/index.ts"],
    ["a self-reference to an unmapped entry", SLICE, "@better-answers/core/sources"],
  ],
  "only a test reaches it": [
    ["a slice importing erasure's face", SLICE, "../erasure/index.ts"],
    ["a slice importing erasure by its directory", SLICE, "../erasure"],
    ["a slice importing erasure's internal", SLICE, "../erasure/replay.ts"],
    ["a slice importing erasure by self-reference", SLICE, "@better-answers/core/erasure"],
  ],
  "kernel imports nothing else in core": [
    ["kernel importing a slice's face", KERNEL, "../concepts/index.ts"],
    ["kernel importing a slice's internal", KERNEL, "../concepts/inbox.ts"],
    ["kernel importing access's face", KERNEL, "../access/index.ts"],
    ["kernel importing a door's face", KERNEL, "../store/postgres/index.ts"],
    ["kernel importing a layer's face", KERNEL, "../audit/index.ts"],
  ],
  "access imports only kernel": [
    ["access importing a door's face", ACCESS, "../store/postgres/index.ts"],
    ["access importing a slice's face", ACCESS, "../concepts/index.ts"],
  ],
  "a store door imports only kernel, and store/map alone also imports access": [
    ["the postgres door importing access", POSTGRES_DOOR, "../../access/index.ts"],
    ["the map door importing a slice's face", MAP_DOOR, "../../concepts/index.ts"],
    ["the map door importing a layer's face", MAP_DOOR, "../../audit/index.ts"],
    ["a door importing another door", MAP_DOOR, "../postgres/index.ts"],
    ["a door importing the store barrel", POSTGRES_DOOR, "../index.ts"],
    ["the store barrel importing a door", STORE_BARREL, "./postgres/index.ts"],
  ],
  "llm and audit import kernel, access and the doors": [
    ["audit importing llm", AUDIT, "../llm/index.ts"],
    ["llm importing audit", LLM, "../audit/index.ts"],
    ["llm importing a slice's face", LLM, "../concepts/index.ts"],
    ["audit importing a slice by self-reference", AUDIT, "@better-answers/core/concepts"],
    ["a layer importing erasure", LLM, "../erasure/index.ts"],
  ],
};

const REFUSALS = Object.entries(REFUSED).flatMap(([clause, cases]) =>
  cases.map(([title, file, specifier]) => [title, clause, file, specifier] as const),
);

describe("the rule fires, stating the clause it holds", () => {
  it.each(REFUSALS)("refuses %s", (_title, clause, file, specifier) => {
    const output = lint.output(importing(file, specifier));

    expect(output).toContain(file);
    expect(output).toContain("import-direction");
    expect(output).toContain(clause);
  });

  it("says which entry to export for an unmapped face", () => {
    const output = lint.output(importing(SLICE, "../store/objects/index.ts"));

    expect(output).toContain("`./store/objects`");
  });

  it("reads a sibling's nested index.ts as internal, not a face", () => {
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
    expect(output).toContain(INTERNAL);
  });
});

describe("the rule stays silent where the ADR allows the import", () => {
  it.each([
    ["a slice importing a sibling's face", SLICE, "../guides/index.ts"],

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
    ["the map door importing access", MAP_DOOR, "../../access/index.ts"],
    ["the map door importing kernel", MAP_DOOR, "../../kernel/index.ts"],
    ["the postgres door importing kernel", POSTGRES_DOOR, "../../kernel/index.ts"],
    ["a door importing its own internal", MAP_DOOR, "./walk.ts"],
    ["access importing kernel", ACCESS, "../kernel/index.ts"],
    ["audit importing a door", AUDIT, "../store/postgres/index.ts"],
    ["audit importing kernel", AUDIT, "../kernel/index.ts"],
    ["audit importing access", AUDIT, "../access/index.ts"],
    ["llm importing a door by self-reference", LLM, "@better-answers/core/store/postgres"],
    ["a test importing a slice's face", TEST, "../src/concepts/index.ts"],
    ["a test importing kernel's face", TEST, "../src/kernel/index.ts"],
    ["a test importing a door's face by self-reference", TEST, "@better-answers/core/store/map"],
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
    ["an upward relative import", "apps/api/src/routers/probe.ts", "../auth/claims.ts"],
    ["a transport import", "apps/api/src/probe.ts", "hono"],
  ])("stays silent outside packages/core for %s", (_title, file, specifier) => {
    expect(lint.flagged(importing(file, specifier))).toEqual([]);
  });

  it("keys on the manifest's name, not on a path segment", () => {
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

const sourceDirectories = (under = ""): readonly string[] =>
  readdirSync(path.join(coreRoot, "src", under), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = under === "" ? entry.name : `${under}/${entry.name}`;
      return [dir, ...sourceDirectories(dir)];
    });

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

  it("lints every committed import in packages/core clean", () => {
    expect(lint.flagged(committedCore())).toEqual([]);
  });
});

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
    "refuses %s in core through the base override alone",
    (specifier) => {
      expect(lintBase.flagged({ [probe]: importOf(specifier) })).toEqual([probe]);
    },
  );
});
