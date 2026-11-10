import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { corePackageOf } from "@better-answers/devtools/import-direction";
import { repositoryRoot } from "@better-answers/devtools/paths";
import { respelledSource } from "@better-answers/devtools/respell-core-imports";
import {
  gitIn,
  sweptFolder,
  throwawayRepository,
  writeUnder,
} from "@better-answers/devtools/throwaway-tree";

const SCRIPT = path.join(repositoryRoot, "scripts/respell-core-imports.mjs");

const CORE = "packages/core";

const MANIFEST = {
  name: "@better-answers/core",
  exports: {
    "./concepts": "./src/concepts/index.ts",
    "./guides": "./src/guides/index.ts",
    "./store/postgres": "./src/store/postgres/index.ts",
  },
};

const virtualRoot = path.join(path.sep, "virtual", CORE);

const pkg = corePackageOf(virtualRoot, MANIFEST);
if (pkg === null) throw new Error("corePackageOf did not read MANIFEST as @better-answers/core.");

const MIRRORED = `${CORE}/test/guides/render.test.ts`;
const NESTED = `${CORE}/test/guides/render/step.test.ts`;
const ROOT_TEST = `${CORE}/test/render.test.ts`;

const respelled = (file: string, source: string): string =>
  respelledSource(pkg, path.join(path.sep, "virtual", file), source);

describe("respelling the core imports of a test", () => {
  it.each([
    [
      "an import of a face",
      `import { a } from "../../src/concepts/index.ts";\n`,
      `import { a } from "@better-answers/core/concepts";\n`,
    ],
    [
      "a type import of a face",
      `import type { A } from "../../src/concepts/index.ts";\n`,
      `import type { A } from "@better-answers/core/concepts";\n`,
    ],
    [
      "a re-export from a face",
      `export { a } from "../../src/concepts/index.ts";\n`,
      `export { a } from "@better-answers/core/concepts";\n`,
    ],
    [
      "an export-all from a face",
      `export * from "../../src/concepts/index.ts";\n`,
      `export * from "@better-answers/core/concepts";\n`,
    ],
    [
      "a face named by its directory",
      `import { a } from "../../src/concepts";\n`,
      `import { a } from "@better-answers/core/concepts";\n`,
    ],
    [
      "a door's face",
      `import { a } from "../../src/store/postgres/index.ts";\n`,
      `import { a } from "@better-answers/core/store/postgres";\n`,
    ],
  ])("rewrites %s", (_what, before, after) => {
    expect(respelled(MIRRORED, before)).toBe(after);
  });

  it("rewrites a face from nested and root tests", () => {
    expect(respelled(NESTED, `import { a } from "../../../src/concepts/index.ts";\n`)).toBe(
      `import { a } from "@better-answers/core/concepts";\n`,
    );
    expect(respelled(ROOT_TEST, `import { a } from "../src/concepts/index.ts";\n`)).toBe(
      `import { a } from "@better-answers/core/concepts";\n`,
    );
  });

  it.each([
    ["the face of the mirror folder", `import { a } from "../../src/guides/index.ts";\n`],
    ["a module of the mirror folder", `import { a } from "../../src/guides/render.ts";\n`],
    [
      "a face already spelled by its package name",
      `import { a } from "@better-answers/core/concepts";\n`,
    ],
    [
      "a face with no entry in the exports map",
      `import { a } from "../../src/sources/index.ts";\n`,
    ],
    [
      "a module of another folder, which the lint reports",
      `import { a } from "../../src/concepts/file.ts";\n`,
    ],
    ["a helper beside the tests", `import { a } from "../support/seed.ts";\n`],
    ["a package", `import { z } from "zod";\n`],
  ])("keeps %s", (_what, source) => {
    expect(respelled(MIRRORED, source)).toBe(source);
  });

  it("changes only the specifiers", () => {
    const before = [
      `import { b } from "../support/seed.ts";`,
      `import { a } from "../../src/concepts/index.ts"; // the face`,
      `import {`,
      `  c,`,
      `} from '../../src/store/postgres/index.ts';`,
      ``,
      `export const text = "../../src/concepts/index.ts";`,
      ``,
    ].join("\n");

    expect(respelled(MIRRORED, before)).toBe(
      [
        `import { b } from "../support/seed.ts";`,
        `import { a } from "@better-answers/core/concepts"; // the face`,
        `import {`,
        `  c,`,
        `} from '@better-answers/core/store/postgres';`,
        ``,
        `export const text = "../../src/concepts/index.ts";`,
        ``,
      ].join("\n"),
    );
  });

  it("makes no further change on a second pass", () => {
    const once = respelled(MIRRORED, `import { a } from "../../src/concepts/index.ts";\n`);

    expect(respelled(MIRRORED, once)).toBe(once);
  });
});

const scratch = sweptFolder();

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const FACE_TEST = `${CORE}/test/guides/render.test.ts`;

const repositoryWith = (tree: Readonly<Record<string, string>>): string => {
  const root = throwawayRepository(path.join(scratch, "repository"));
  for (const [file, text] of Object.entries(tree)) writeUnder(root, file, text);
  gitIn(root, "add", "--", ...Object.keys(tree));
  return root;
};

const spawned = (cwd: string) => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });

describe("the respell-core-imports script", () => {
  it("rewrites tracked tests, then finds nothing to do", () => {
    const root = repositoryWith({
      [`${CORE}/package.json`]: `${JSON.stringify(MANIFEST)}\n`,
      [`${CORE}/src/concepts/index.ts`]: "export const a = 1;\n",
      [`${CORE}/src/guides/index.ts`]: "export const g = 1;\n",
      [FACE_TEST]: `import { a } from "../../src/concepts/index.ts";\nimport { g } from "../../src/guides/index.ts";\nexport const sum = a + g;\n`,
    });
    const first = spawned(root);

    expect(first.status).toBe(0);
    expect(first.stdout).toBe(`${FACE_TEST}\nrespell-core-imports: rewrote 1 files\n`);
    expect(readFileSync(path.join(root, FACE_TEST), "utf8")).toBe(
      `import { a } from "@better-answers/core/concepts";\nimport { g } from "../../src/guides/index.ts";\nexport const sum = a + g;\n`,
    );

    const second = spawned(root);

    expect(second.status).toBe(0);
    expect(second.stdout).toBe("respell-core-imports: rewrote 0 files\n");
  });

  it("refuses a repository with no core package", () => {
    const ran = spawned(throwawayRepository(path.join(scratch, "empty")));

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("respell-core-imports:");
  });
});
