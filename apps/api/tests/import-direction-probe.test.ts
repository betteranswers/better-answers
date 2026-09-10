import path from "node:path";

import { readOxlintConfig, repositoryRoot } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

/**
 * PROBE — throwaway, never merged (branch probe/import-direction, 10/09/2026).
 *
 * The minimal `better-answers/import-direction` rule over a throwaway tree, through the
 * devtools runner: enough to prove the plugin API hands the rule the importer's path and
 * the specifier, that it can resolve both semantically, and that the runner can test it
 * both ways.
 */

const RULE = "better-answers/import-direction";

const config = readOxlintConfig();

const at = (file: string, specifier: string): Readonly<Record<string, string>> => ({
  [file]: `import * as reached from "${specifier}";\nexport const probe = reached;\n`,
});

const SLICE = "packages/core/src/concepts/landing.ts";
const NESTED = "packages/core/src/answering/plan/step.ts";
const GRAPH_DOOR = "packages/core/src/store/graph/index.ts";
const POSTGRES_DOOR = "packages/core/src/store/postgres/index.ts";
const KERNEL = "packages/core/src/kernel/actor.ts";
const ACCESS = "packages/core/src/access/predicate.ts";
const AUDIT = "packages/core/src/audit/index.ts";
const LLM = "packages/core/src/llm/index.ts";
const TEST = "packages/core/test/concepts.test.ts";

const lint = oxlintOver(
  JSON.stringify({
    jsPlugins: config.jsPlugins.map((plugin) => ({
      ...plugin,
      specifier: path.join(repositoryRoot, plugin.specifier),
    })),
    rules: { [RULE]: "error" },
  }),
  { tree: at(SLICE, "../guides/renderer.ts"), flagged: [SLICE] },
);

describe("probe: import direction by kind", () => {
  it.each([
    ["rule 4: a slice reaching a sibling's internal file", SLICE, "../guides/renderer.ts"],
    ["rule 4: from a slice subdirectory, two levels up", NESTED, "../../concepts/inbox.ts"],
    ["rule 4: a slice importing erasure's face", SLICE, "../erasure/index.ts"],
    [
      "rule 4: a self-reference to a sibling's internal file",
      SLICE,
      "@better-answers/core/guides/renderer.ts",
    ],
    ["rule 4: a test reaching a slice internal", TEST, "../src/concepts/file.ts"],
    ["rule 1: kernel importing a slice's face", KERNEL, "../concepts/index.ts"],
    ["rule 1: kernel importing access's face", KERNEL, "../access/index.ts"],
    ["rule 2: access importing a door's face", ACCESS, "../store/postgres/index.ts"],
    ["rule 2: the postgres door importing access", POSTGRES_DOOR, "../../access/index.ts"],
    ["rule 2: the graph door importing a slice's face", GRAPH_DOOR, "../../concepts/index.ts"],
    ["rule 2: a door importing another door", GRAPH_DOOR, "../postgres/index.ts"],
    ["rule 3: audit importing llm", AUDIT, "../llm/index.ts"],
    ["rule 3: llm importing a slice's face", LLM, "../concepts/index.ts"],
    ["rule 3: audit importing a slice by self-reference", AUDIT, "@better-answers/core/concepts"],
  ])("fires — %s", (_title, file, specifier) => {
    const output = lint.output(at(file, specifier));
    expect(output).toContain(file);
    expect(output).toContain("import-direction");
    expect(output).toContain("ADR 0029");
  });

  it.each([
    ["a slice importing a sibling's face", SLICE, "../guides/index.ts"],
    ["a slice importing a door's face", SLICE, "../store/postgres/index.ts"],
    ["a slice importing a layer's face", SLICE, "../audit/index.ts"],
    ["a slice importing its own internal", SLICE, "./inbox.ts"],
    ["a slice subdirectory reaching a sibling's face two up", NESTED, "../../concepts/index.ts"],
    ["a slice importing a sibling's face by self-reference", SLICE, "@better-answers/core/guides"],
    ["the graph door importing access", GRAPH_DOOR, "../../access/index.ts"],
    ["the graph door importing kernel", GRAPH_DOOR, "../../kernel/index.ts"],
    ["access importing kernel", ACCESS, "../kernel/index.ts"],
    ["audit importing a door", AUDIT, "../store/postgres/index.ts"],
    ["a test importing a slice's face", TEST, "../src/concepts/index.ts"],
    ["a test importing a door's face by self-reference", TEST, "@better-answers/core/store/git"],
    ["a bare third-party package", SLICE, "zod"],
    ["the same import outside core", "apps/api/src/routers/probe.ts", "../auth/claims.ts"],
  ])("stays silent — %s", (_title, file, specifier) => {
    expect(lint.flagged(at(file, specifier))).toEqual([]);
  });

  it("fires on a re-export of a sibling's internal file", () => {
    const output = lint.output({ [SLICE]: `export * from "../guides/renderer.ts";\n` });
    expect(output).toContain(SLICE);
    expect(output).toContain("import-direction");
  });
});
