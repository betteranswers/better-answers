import { describe, expect, it } from "vitest";

import { pluginConfigFor } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

const RULE = "better-answers/no-path-climb";

const REPOSITORY: Tree = {
  "package.json": "{}\n",
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
  "apps/api/package.json": "{}\n",
  "packages/design-system/package.json": "{}\n",
};

const SEEDED = "apps/api/tests/deploy/probe.test.ts";

const reading = (file: string, code: string): Tree => ({ ...REPOSITORY, [file]: `${code}\n` });

const CLIMB = 'export const script = path.resolve(import.meta.dirname, "../../../../deploy/x.sh");';

const lint = oxlintOver(pluginConfigFor({ [RULE]: "error" }), {
  tree: reading(SEEDED, CLIMB),
  flagged: [SEEDED],
});

describe("the no-path-climb rule", () => {
  it("refuses a seeded climb and names the helper", () => {
    const output = lint.output(reading(SEEDED, CLIMB));

    expect(output).toContain("better-answers(no-path-climb)");
    expect(output).toContain("`../../../../deploy/x.sh` climbs to the root of `apps/api`");
    expect(output).toContain("`apps/api/tests/support/roots/roots.ts`");
  });

  it.each([
    [
      "a join with the climb split into segments",
      'path.join(import.meta.dirname, "..", "..", "..")',
    ],
    ["a resolve from __dirname", 'path.resolve(__dirname, "../../..")'],
    ["a bare resolve", 'resolve(import.meta.dirname, "../../..")'],
    ["a URL against import.meta.url", 'new URL("../../..", import.meta.url)'],
    ["a climb hidden in a template literal", "path.join(import.meta.dirname, `../../..`)"],
    ["a climb followed by a name", 'path.join(import.meta.dirname, "../../..", name)'],
  ])("refuses %s", (_what, expression) => {
    const file = "apps/api/tests/deploy/probe.test.ts";

    expect(lint.flagged(reading(file, `export const at = ${expression};`))).toEqual([file]);
  });

  it("refuses a climb that lands on the workspace root", () => {
    const file = "apps/api/tests/probe.test.ts";

    expect(
      lint.flagged(reading(file, 'export const at = path.resolve(import.meta.dirname, "..");')),
    ).toEqual([file]);
  });

  it("refuses a climb that passes through the root", () => {
    const file = "apps/api/tests/trpc/probe.test.ts";
    const code = 'export const at = new URL("../../src/", import.meta.url);';

    expect(lint.flagged(reading(file, code))).toEqual([file]);
  });

  it("names the toolchain helper for devtools", () => {
    const file = "packages/devtools/test/probe.test.ts";
    const tree = {
      ...REPOSITORY,
      "packages/devtools/package.json": "{}\n",
      [file]: 'export const at = path.join(import.meta.dirname, "../../..");\n',
    };

    expect(lint.output(tree)).toContain("`@better-answers/devtools/paths`");
  });

  it("says a workspace without a helper needs one", () => {
    const file = "packages/design-system/test/probe.test.ts";
    const code = 'export const at = path.join(import.meta.dirname, "../..");';

    expect(lint.output(reading(file, code))).toContain("which it does not have yet");
  });
});

describe("the no-path-climb rule stays silent", () => {
  it.each([
    ["a fixture beside its test", 'new URL("../fixtures/bundle", import.meta.url)'],
    [
      "a sibling folder inside the workspace",
      'path.resolve(import.meta.dirname, "../support/seed.ts")',
    ],
    ["the folder itself", "path.resolve(import.meta.dirname)"],
    ["a path from a root helper", 'path.join(workspaceRoot, "..", "..", "deploy")'],
    ["a path under a root helper", 'path.join(repositoryRoot, "deploy/x.sh")'],
    ["a string that only reads like a climb", '"../sources/bid-library.md"'],
    ["a Playwright locator", 'row.locator("..")'],
  ])("over %s", (_what, expression) => {
    const file = "apps/api/tests/ops/probe.test.ts";

    expect(lint.flagged(reading(file, `export const at = ${expression};`))).toEqual([]);
  });

  it("over a relative import, which the import rules read", () => {
    const file = "apps/api/tests/ops/probe.test.ts";
    const code = 'import { seed } from "../../../src/seed.ts";\nexport const again = seed;';

    expect(lint.flagged(reading(file, code))).toEqual([]);
  });

  it("over a file in the repository's own root workspace", () => {
    const file = "scripts/probe.mjs";
    const code = 'export const at = path.resolve(import.meta.dirname, "..");';

    expect(lint.flagged(reading(file, code))).toEqual([]);
  });
});
