import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { testsReachingNoSource } from "@better-answers/devtools/mutation-suite";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Which test files the mutation run leaves out: the ones that reach the workspace's `src`
 * through no import, and so can kill no mutant (T-107).
 *
 * The cases are the ways a test reaches `src` that a naive reading would miss — through a
 * helper beside it, through the workspace's own package name, through a directory import
 * that resolves to an index file, through a dynamic import whose target is not a literal —
 * and the one way it does not: a file that reads the repository and imports nothing under
 * `src`. A test wrongly left out is a kill lost silently, so every reaching shape is a
 * case here and the reading is conservative where it cannot tell.
 */

const scratch = mkdtempSync(path.join(tmpdir(), "mutation-suite-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const write = (root: string, relative: string, content: string): void => {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};

describe("the test files the mutation run leaves out (T-107)", () => {
  it("leaves out the tests that reach src by no import, and keeps every other", () => {
    const root = path.join(scratch, "workspace");
    write(root, "src/answer.ts", "export const answer = 1;\n");
    write(root, "src/store/index.ts", "export const store = 1;\n");
    write(root, "tests/direct.test.ts", 'import { answer } from "../src/answer.ts";\n');
    write(
      root,
      "tests/helper.ts",
      'import { answer } from "../src/answer.ts";\nexport { answer };\n',
    );
    write(root, "tests/through-helper.test.ts", 'import { answer } from "./helper.ts";\n');
    write(root, "tests/by-name.test.ts", 'import { store } from "@example/workspace/store";\n');
    write(root, "tests/by-directory.test.ts", 'import { store } from "../src/store";\n');
    write(
      root,
      "tests/dynamic.test.ts",
      'const file = "../src/answer.ts";\nawait import(/* @vite-ignore */ file);\n',
    );
    write(root, "tests/deep/nested.test.ts", 'import { answer } from "../../src/answer.ts";\n');
    write(root, "tests/reads-the-tree.test.ts", 'import { readFileSync } from "node:fs";\n');
    write(root, "tests/sibling-only.test.ts", 'import { other } from "./other.ts";\n');
    write(
      root,
      "tests/other.ts",
      'import { readFileSync } from "node:fs";\nexport const other = 1;\n',
    );
    write(root, "tests/cycle-a.test.ts", 'import "./cycle-b.ts";\n');
    write(root, "tests/cycle-b.ts", 'import "./cycle-a.test.ts";\n');
    write(root, "tests/not-a-test.ts", "export const nothing = 1;\n");

    expect(testsReachingNoSource(root, "tests", "@example/workspace")).toEqual([
      "tests/cycle-a.test.ts",
      "tests/reads-the-tree.test.ts",
      "tests/sibling-only.test.ts",
    ]);
  });

  it("leaves nothing out of a workspace whose every test reaches src", () => {
    const root = path.join(scratch, "all-reach");
    write(root, "src/answer.ts", "export const answer = 1;\n");
    write(root, "test/one.test.ts", 'import { answer } from "../src/answer.ts";\n');

    expect(testsReachingNoSource(root, "test", "@example/all-reach")).toEqual([]);
  });
});
