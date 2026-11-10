import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { pluginConfigFor, readOxlintConfig } from "@better-answers/devtools/oxlint-config";
import { repositoryRoot } from "@better-answers/devtools/paths";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

import { ROOTS_HELPER } from "../../lint-rules/shared/path-climb.ts";

const RULE = "better-answers/no-path-climb";

const REPOSITORY: Tree = {
  "package.json": "{}\n",
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
  "apps/api/package.json": "{}\n",
  "packages/widgets/package.json": "{}\n",
};

const SEEDED = "apps/api/tests/deploy/probe.test.ts";

const reading = (file: string, code: string): Tree => ({ ...REPOSITORY, [file]: `${code}\n` });

const TEMPLATE_CLIMB = "`" + "${import.meta.dirname}" + "/../../..`";

const CLIMB = 'export const script = path.resolve(import.meta.dirname, "../../../../deploy/x.sh");';

const lint = oxlintOver(pluginConfigFor({ [RULE]: "error" }), {
  tree: reading(SEEDED, CLIMB),
  flagged: [SEEDED],
});

const lifting = readOxlintConfig().overrides.filter((one) => one.rules?.[RULE] !== undefined);

const inTheRealConfig = oxlintOver(
  JSON.stringify({ ...JSON.parse(pluginConfigFor({ [RULE]: "error" })), overrides: lifting }),
  { tree: reading(SEEDED, CLIMB), flagged: [SEEDED] },
);

describe("the no-path-climb rule", () => {
  it("refuses a seeded climb and names the helper", () => {
    const output = lint.output(reading(SEEDED, CLIMB));

    expect(output).toContain("better-answers(no-path-climb)");
    expect(output).toContain(
      '`path.resolve(import.meta.dirname, "../../../../deploy/x.sh")` climbs to the root of `apps/api` or above it, so the path breaks when the file moves. Import `rootsOf` from `@better-answers/schema/testing/roots`, take `repositoryRoot` or `workspaceRoot` from `rootsOf(import.meta.url)`, and join the path from there.',
    );
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
    ["a template literal around the folder", TEMPLATE_CLIMB],
    [
      "an anchor read from the file URL",
      'path.join(path.dirname(new URL(import.meta.url).pathname), "../../../..")',
    ],
    [
      "an anchor made by fileURLToPath",
      'path.join(path.dirname(fileURLToPath(import.meta.url)), "../..")',
    ],
    ["a join from the parent of the folder", 'path.join(path.dirname(import.meta.dirname), "..")'],
    ["a parent of a parent of the folder", "path.dirname(path.dirname(import.meta.dirname))"],
    ["a file read from the working directory", 'readFileSync("../../AGENTS.md", "utf8")'],
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

  it.each([
    ["apps/api/tests/deploy/probe.test.ts", "apps/api"],
    ["packages/devtools/test/probe.test.ts", "packages/devtools"],
    ["packages/widgets/test/probe.test.ts", "packages/widgets"],
  ])("names the same helper in %s", (file, workspace) => {
    const code = 'export const at = path.join(import.meta.dirname, "../../..");';
    const tree = { ...reading(file, code), [`${workspace}/package.json`]: "{}\n" };

    expect(lint.output(tree)).toContain(
      `climbs to the root of \`${workspace}\` or above it, so the path breaks when the file moves. Import \`rootsOf\` from \`@better-answers/schema/testing/roots\``,
    );
  });
});

describe("the no-path-climb rule accepts", () => {
  it.each([
    ["a fixture beside its test", 'new URL("../fixtures/bundle", import.meta.url)'],
    [
      "a sibling folder inside the workspace",
      'path.resolve(import.meta.dirname, "../support/seed.ts")',
    ],
    ["the folder itself", "path.resolve(import.meta.dirname)"],
    ["the parent of the folder inside the workspace", "path.dirname(import.meta.dirname)"],
    [
      "the folder of a file URL",
      'path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures")',
    ],
    [
      "a template literal inside the workspace",
      "`" + "${import.meta.dirname}" + "/../support/x.ts`",
    ],
    ["a read below the working directory", 'readFileSync("fixtures/x.json", "utf8")'],
    ["a path from a root helper", 'path.join(workspaceRoot, "..", "..", "deploy")'],
    ["a path under a root helper", 'path.join(repositoryRoot, "deploy/x.sh")'],
    ["a string that only reads like a climb", '"../sources/bid-library.md"'],
    ["a Playwright locator", 'row.locator("..")'],
  ])("%s", (_what, expression) => {
    const file = "apps/api/tests/ops/probe.test.ts";

    expect(lint.flagged(reading(file, `export const at = ${expression};`))).toEqual([]);
  });

  it("a relative import, which the import rules check", () => {
    const file = "apps/api/tests/ops/probe.test.ts";
    const code = 'import { seed } from "../../../src/seed.ts";\nexport const again = seed;';

    expect(lint.flagged(reading(file, code))).toEqual([]);
  });

  it("a repositoryRoot import from the toolchain", () => {
    const file = "apps/api/tests/ops/probe.test.ts";
    const code =
      'import { repositoryRoot } from "@better-answers/devtools/paths";\nexport const at = repositoryRoot;';

    expect(lint.flagged(reading(file, code))).toEqual([]);
  });

  it("a file in the repository's own root workspace", () => {
    const file = "scripts/probe.mjs";
    const code = 'export const at = path.resolve(import.meta.dirname, "..");';

    expect(lint.flagged(reading(file, code))).toEqual([]);
  });
});

describe("the no-path-climb rule in the real config", () => {
  it("is on for every file", () => {
    expect(readOxlintConfig().rules[RULE]).toBe("error");
  });

  it("refuses a climb in a test", () => {
    expect(inTheRealConfig.flagged(reading(SEEDED, CLIMB))).toEqual([SEEDED]);
  });

  it.each(["apps/api/src/probe.ts", "packages/schema/src/probe.ts"])(
    "accepts production source in %s",
    (file) => {
      expect(inTheRealConfig.flagged(reading(file, CLIMB))).toEqual([]);
    },
  );

  it("is turned off by one override", () => {
    expect(lifting).toHaveLength(1);
  });

  it("names only helper files the tree holds", () => {
    const manifest = z
      .object({ exports: z.record(z.string(), z.string()) })
      .parse(
        JSON.parse(readFileSync(path.join(repositoryRoot, "packages/schema/package.json"), "utf8")),
      );
    const subpath = ROOTS_HELPER.specifier.replace("@better-answers/schema", ".");
    const source = readFileSync(path.join(repositoryRoot, ROOTS_HELPER.file), "utf8");

    expect(manifest.exports[subpath]).toBe(
      `./${path.posix.relative("packages/schema", ROOTS_HELPER.file)}`,
    );
    expect(source).toContain(`export const ${ROOTS_HELPER.name} =`);
  });
});
