import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  corePackageOf,
  importFinding,
  messageOf,
  type Finding,
} from "@better-answers/devtools/import-direction";
import {
  oxlintOverrideFor,
  pluginConfigFor,
  readOxlintConfig,
} from "@better-answers/devtools/oxlint-config";
import { repositoryRoot } from "@better-answers/devtools/paths";
import { GATES_FOLDER, HELPER_FOLDERS, PINS } from "@better-answers/devtools/test-folders";
import {
  oxlintBatchOver,
  type PlannedLint,
  type Tree,
} from "@better-answers/devtools/throwaway-tree";

const RULE = "better-answers/import-direction";
const CORE = "packages/core";

const config = readOxlintConfig();

const severity = config.rules[RULE];
if (severity === undefined) {
  throw new Error(`.oxlintrc.json's base rules block no longer switches ${RULE} on.`);
}

const MANIFEST_VALUE = {
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
    "./refusals": "./src/refusals/index.ts",
  },
};

const MANIFEST = JSON.stringify(MANIFEST_VALUE);

const globsOf = (override: { readonly files?: readonly string[] | undefined }): readonly string[] =>
  override.files ?? [];

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
const CATALOGUE = `${CORE}/src/refusals/index.ts`;
const TEST = `${CORE}/test/concepts.test.ts`;
const MIRRORED = `${CORE}/test/concepts/grammar.test.ts`;
const MIRRORED_NESTED = `${CORE}/test/concepts/writes/key.test.ts`;
const MIRRORED_DOOR = `${CORE}/test/store/map/walk.test.ts`;
const MIRRORED_UNMAPPED = `${CORE}/test/sources/ingest.test.ts`;
const ELSEWHERE = `${CORE}/test/answering/draft.test.ts`;
const OTHER_DOOR = `${CORE}/test/store/postgres/handle.test.ts`;
const SUPPORT = `${CORE}/test/support/probe.ts`;
const GATE = `${CORE}/test/gates/probe.test.ts`;
const NESTED_HELPER = `${CORE}/test/concepts/support/probe.ts`;
const ROOT_FILE = `${CORE}/probe.ts`;

const KIND_FOLDERS: readonly string[] = [
  ...HELPER_FOLDERS,
  GATES_FOLDER,
  ...PINS.filter((pin) => pin.folder.startsWith(`${CORE}/test/`)).map((pin) =>
    path.posix.basename(pin.folder),
  ),
];

const KIND_REFUSALS: readonly (readonly [string, string, string])[] = KIND_FOLDERS.map((kind) => [
  `a ${kind} file reaching src/${kind}`,
  `${CORE}/test/${kind}/probe.ts`,
  `../../src/${kind}/probe.ts`,
]);

const VIRTUAL_ROOT = path.resolve(path.sep, "virtual");

const corePackage = corePackageOf(path.join(VIRTUAL_ROOT, CORE), MANIFEST_VALUE);
if (corePackage === null) {
  throw new Error("MANIFEST names @better-answers/core, so it reads as the core package.");
}

const findingFor = (file: string, specifier: string): Finding | undefined =>
  importFinding(corePackage, path.join(VIRTUAL_ROOT, file), specifier);

const statedBy = (file: string, specifier: string): string => {
  const finding = findingFor(file, specifier);
  if (finding === undefined)
    throw new Error(`the rule is silent on ${file} importing ${specifier}`);
  return messageOf(finding);
};

const spawn = oxlintBatchOver();

const spawned = (tree: Tree, caseConfig: string): PlannedLint => spawn.plan(tree, caseConfig);

const RULE_CONFIG = pluginConfigFor({ [RULE]: severity });

const spawnedRule = (tree: Tree): PlannedLint => spawned(tree, RULE_CONFIG);

spawn.control(importing(SLICE, "../guides/renderer.ts"), RULE_CONFIG, [SLICE]);

beforeAll(spawn.run);

const INTERNAL = "only through its own index.ts";

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
    ["a slice subdirectory reaching a sibling's internal", NESTED, "../../concepts/suggestions.ts"],
    ["a door reaching kernel's internal", MAP_DOOR, "../../kernel/actor.ts"],
    ["the map door reaching access's internal", MAP_DOOR, "../../access/predicate.ts"],
    ["a test reaching a slice's internal", TEST, "../src/concepts/file.ts"],
    ["a test reaching another slice's internal", ELSEWHERE, "../../src/concepts/file.ts"],
    ["a test helper reaching a slice's internal", SUPPORT, "../../src/concepts/file.ts"],
    ["a gate reaching a slice's internal", GATE, "../../src/concepts/file.ts"],
    [
      "a nested helper reaching its slice's internal",
      NESTED_HELPER,
      "../../../src/concepts/file.ts",
    ],
    ...KIND_REFUSALS,
    [
      "a test reaching a door's internal outside the door",
      MIRRORED,
      "../../src/store/postgres/handle.ts",
    ],
    ["a test reaching another door's internal", OTHER_DOOR, "../../../src/store/map/walk.ts"],
    [
      "a test reaching another slice's nested face",
      ELSEWHERE,
      "../../src/concepts/writes/index.ts",
    ],
    [
      "a test reaching another slice's internal by self-reference",
      MIRRORED,
      "@better-answers/core/guides/renderer.ts",
    ],
    [
      "a self-reference to a sibling's internal file",
      SLICE,
      "@better-answers/core/guides/renderer.ts",
    ],
    ["a slice reaching a sibling's nested face", SLICE, "../guides/internal/index.ts"],
    ["the catalogue reaching a slice's internal file", CATALOGUE, "../concepts/vocabulary.ts"],
  ],
  "is a face packages/core's exports map does not name": [
    ["a slice reaching an unmapped face", SLICE, "../store/objects/index.ts"],
    ["a slice reaching an unmapped sibling", SLICE, "../sources/index.ts"],
    ["a slice reaching an unmapped directory", SLICE, "../sources"],
    ["a test reaching an unmapped face", TEST, "../src/store/objects/index.ts"],
    ["a test reaching another slice's unmapped face", MIRRORED, "../../src/sources/index.ts"],
    ["a self-reference to an unmapped entry", SLICE, "@better-answers/core/sources"],
  ],
  "only a test reaches it": [
    ["a slice importing erasure's face", SLICE, "../erasure/index.ts"],
    ["a slice importing erasure by its directory", SLICE, "../erasure"],
    ["a slice importing erasure's internal", SLICE, "../erasure/replay.ts"],
    ["a slice importing erasure by self-reference", SLICE, "@better-answers/core/erasure"],
  ],
  "Nothing in core imports the refusal catalogue": [
    ["a slice importing the catalogue", SLICE, "../refusals/index.ts"],
    ["a slice importing the catalogue by its directory", SLICE, "../refusals"],
    ["a slice importing the catalogue by self-reference", SLICE, "@better-answers/core/refusals"],
    ["kernel importing the catalogue", KERNEL, "../refusals/index.ts"],
    ["a layer importing the catalogue", AUDIT, "../refusals/index.ts"],
    ["a door importing the catalogue", POSTGRES_DOOR, "../../refusals/index.ts"],
  ],
  "the refusal catalogue imports kernel and each slice's face, and nothing else": [
    ["the catalogue importing a door's face", CATALOGUE, "../store/postgres/index.ts"],
    ["the catalogue importing a layer's face", CATALOGUE, "../audit/index.ts"],
    ["the catalogue importing access's face", CATALOGUE, "../access/index.ts"],
  ],
  "kernel imports nothing else in core": [
    ["kernel importing a slice's face", KERNEL, "../concepts/index.ts"],
    ["kernel importing a slice's internal", KERNEL, "../concepts/suggestions.ts"],
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

const BRIDGED: readonly (readonly [string, string, string])[] = [
  ["a transport finding", SLICE, "hono"],
  ["a direction finding", KERNEL, "../concepts/index.ts"],
  ["a catalogue finding", SLICE, "../refusals/index.ts"],
  ["an erasure finding", SLICE, "../erasure/index.ts"],
  ["an internal finding", SLICE, "../guides/renderer.ts"],
  ["a test-internal finding", ELSEWHERE, "../../src/concepts/file.ts"],
  ["an unexported finding", SLICE, "../store/objects/index.ts"],
];

describe("the rule fires, stating the clause it holds", () => {
  it.each(REFUSALS)("refuses %s", (_title, clause, file, specifier) => {
    expect(statedBy(file, specifier)).toContain(clause);
  });

  it("says which entry to export for an unmapped face", () => {
    expect(statedBy(SLICE, "../store/objects/index.ts")).toContain("`./store/objects`");
  });

  it("names the fix for a test outside its mirror", () => {
    const message = statedBy(ELSEWHERE, "../../src/concepts/file.ts");

    expect(message).toContain("never `file.ts`");
    expect(message).toContain("Import the face, or move the test to `test/concepts/`");
    expect(message).toContain("mirrors `src/concepts`");
  });

  it("names the mirror folder of a door", () => {
    expect(statedBy(MIRRORED, "../../src/store/postgres/handle.ts")).toContain(
      "move the test to `test/store/postgres/`",
    );
  });

  it("says a test outside its mirror reaches an entry point", () => {
    expect(statedBy(MIRRORED, "../../src/sources/index.ts")).toContain(
      "a test outside its mirror folder reaches an entry point",
    );
  });

  it("reads a sibling's nested index.ts as internal, not a face", () => {
    const message = statedBy(SLICE, "../guides/internal/index.ts");

    expect(message).toContain("never `internal/index.ts`");
    expect(message).not.toContain("Add `./guides`");
  });

  const bridged = BRIDGED.map(
    ([finding, file, specifier]) =>
      [finding, file, specifier, spawnedRule(importing(file, specifier))] as const,
  );

  it("words each finding as the spawned rule does", () => {
    const read = bridged.map(([finding, file, specifier, found]) => {
      const output = found.output();
      return {
        finding,
        names: [output.includes(file), output.includes("import-direction")],
        states: output.includes(statedBy(file, specifier)),
      };
    });

    expect(read).toEqual(
      bridged.map(([finding]) => ({ finding, names: [true, true], states: true })),
    );
  });

  it.each(
    (
      [
        ["export-all", `export * from "../guides/renderer.ts";\n`],
        ["export-named", `export { render } from "../guides/renderer.ts";\n`],
        [
          "type-only",
          `import type { Rendered } from "../guides/renderer.ts";\nexport type Kept = Rendered;\n`,
        ],
      ] as const
    ).map(([form, source]) => [form, spawnedRule(coreTree({ [SLICE]: source }))] as const),
  )("reads a %s declaration as it reads an import", (_form, found) => {
    const output = found.output();

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
    ["a slice importing its own internal", SLICE, "./suggestions.ts"],
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
    ["a test importing erasure", TEST, "../src/erasure/index.ts"],
    ["a test importing the catalogue", TEST, "../src/refusals/index.ts"],
    ["the catalogue importing kernel's face", CATALOGUE, "../kernel/index.ts"],
    ["the catalogue importing a slice's face", CATALOGUE, "../concepts/index.ts"],
    ["the catalogue importing erasure's face", CATALOGUE, "../erasure/index.ts"],
    ["a test importing the module its folder mirrors", MIRRORED, "../../src/concepts/file.ts"],
    ["a test importing that module without its extension", MIRRORED, "../../src/concepts/file"],
    [
      "a nested test importing a nested module of its slice",
      MIRRORED_NESTED,
      "../../../src/concepts/writes/write.ts",
    ],
    [
      "a nested test importing its slice's root module",
      MIRRORED_NESTED,
      "../../../src/concepts/file.ts",
    ],
    [
      "a door's test importing the door's internal",
      MIRRORED_DOOR,
      "../../../src/store/map/walk.ts",
    ],
    [
      "a test importing its own directory's unmapped face",
      MIRRORED_UNMAPPED,
      "../../src/sources/index.ts",
    ],
    ["a test importing its own directory by its path", MIRRORED_UNMAPPED, "../../src/sources"],
    ["a test importing another slice's face", MIRRORED, "../../src/guides/index.ts"],
    ["a test importing a door's face", MIRRORED, "../../src/store/postgres/index.ts"],
    ["a test importing its own sibling", TEST, "./suite-postgres.ts"],
    ["a test importing a helper from the support folder", MIRRORED, "../support/seed.ts"],
    ["a test importing the devtools runner", TEST, "@better-answers/devtools/throwaway-tree"],
    ["a slice importing a third-party package", SLICE, "zod"],
    ["a slice importing the schema package", SLICE, "@better-answers/schema"],
    ["a slice importing a node builtin outside the list", SLICE, "node:crypto"],
  ])("%s", (_title, file, specifier) => {
    expect(findingFor(file, specifier)).toBeUndefined();
  });

  it.each(
    (
      [
        ["an upward relative import", "apps/api/src/routers/probe.ts", "../auth/claims.ts"],
        ["a transport import", "apps/api/src/probe.ts", "hono"],
      ] as const
    ).map(([title, file, specifier]) => [title, spawnedRule(importing(file, specifier))] as const),
  )("stays silent outside packages/core for %s", (_title, found) => {
    expect(found.flagged()).toEqual([]);
  });

  const elsewhere = "libs/knowledge/src/kernel/actor.ts";
  const otherName = spawnedRule({
    [`${CORE}/package.json`]: JSON.stringify({ name: "@better-answers/other" }),
    [KERNEL]: importOf("../concepts/index.ts"),
  });
  const movedCore = spawnedRule({
    "libs/knowledge/package.json": MANIFEST,
    [elsewhere]: importOf("../concepts/index.ts"),
  });

  it("keys on the manifest's name, not on a path segment", () => {
    expect(otherName.flagged()).toEqual([]);
    expect(movedCore.flagged()).toEqual([elsewhere]);
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
  if (first === "refusals") return "catalogue";
  if (first === "store") return "door";
  if (first === "llm" || first === "audit") return "layer";
  return "slice";
};

const crossZoneSpecifierFrom = (dir: string): string => {
  const target = dir.startsWith("kernel") ? "src/access/predicate.ts" : "src/kernel/actor.ts";
  const specifier = path.posix.relative(`src/${dir}`, target);
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
};

describe("the zones and the real tree", () => {
  const directories = sourceDirectories();

  it("walks a tree with directories in it", () => {
    expect(directories.length).toBeGreaterThan(0);
  });

  it.each(directories)("places src/%s in its zone", (dir) => {
    const file = `${CORE}/src/${dir}/probe.ts`;

    expect(statedBy(file, crossZoneSpecifierFrom(dir))).toContain(`(${zoneOf(dir)})`);
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

  const committed = spawnedRule(committedCore());

  it("lints every committed import in packages/core clean", () => {
    expect(committed.flagged()).toEqual([]);
  });
});

describe("the base import bans reach packages/core unrestated", () => {
  it("has no override in .oxlintrc.json setting no-restricted-imports over packages/core", () => {
    const over = config.overrides
      .filter((override) => override.rules?.["no-restricted-imports"] !== undefined)
      .flatMap(globsOf)
      .filter((glob) => glob.startsWith("packages/core"));

    expect(over).toEqual([]);
  });

  const probe = `${CORE}/src/concepts/probe.ts`;
  const baseOverride = JSON.stringify({ overrides: [oxlintOverrideFor("**/*.ts")] });

  it.each(
    ["drizzle-zod", "better-auth", "@better-auth/oauth-provider"].map(
      (specifier) => [specifier, spawned({ [probe]: importOf(specifier) }, baseOverride)] as const,
    ),
  )("refuses %s in core through the base override alone", (_specifier, found) => {
    expect(found.flagged()).toEqual([probe]);
  });
});
