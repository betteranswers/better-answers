import { existsSync } from "node:fs";
import path from "node:path";

import { assert, describe, expect, it } from "vitest";

import {
  findingsFor,
  mentionsIn,
  pathsNamedIn,
  rootsOf,
  tierContractIn,
} from "@better-answers/devtools/contract-paths";
import type { ContractFiles } from "@better-answers/devtools/contract-paths";
import { repositoryRoot } from "@better-answers/devtools/paths";

const ROOTS = ["apps", "docs", "packages", ".github"];

const withOnePathMoved = (
  files: ContractFiles,
  roots: readonly string[],
): { readonly seeded: ContractFiles; readonly file: string; readonly moved: string } => {
  const found = mentionsIn(files, roots).find(
    ({ file, path: named }) => file.endsWith(".json") && named.endsWith(".ts"),
  );
  assert(found !== undefined, "a JSON fixture names a TypeScript file");
  const moved = found.path.replace("/", "/moved-away/");
  const seeded = Object.fromEntries(
    Object.entries(files).map(([file, text]) => [
      file,
      file === found.file ? text.replaceAll(found.path, moved) : text,
    ]),
  );
  return { seeded, file: found.file, moved };
};

const heldAt =
  (...held: readonly string[]) =>
  (repositoryPath: string): boolean =>
    held.includes(repositoryPath);

describe("the paths a string names", () => {
  it.each([
    ["(packages/core/src/x.ts, `X`)", ["packages/core/src/x.ts"]],
    ["held in `apps/api` and `apps/worker`", ["apps/api", "apps/worker"]],
    ["`packages/schema`'s migrations", ["packages/schema"]],
    ["see docs/plans/008-folder-restructure.md.", ["docs/plans/008-folder-restructure.md"]],
    ["read .github/workflows/build.yml first", [".github/workflows/build.yml"]],
    ["runs apps/worker/tests/*_contract.py", ["apps/worker/tests"]],
    ["both docs/a.md and docs/b.md", ["docs/a.md", "docs/b.md"]],
  ])("reads %s", (text, expected) => {
    expect(pathsNamedIn(text, ROOTS)).toEqual(expected);
  });

  it.each([
    "knowledge/docs/expenses.md",
    "../packages/finance/rates.md",
    "/knowledge/policies/../rules.md",
    "text/markdown",
    "21/09/2026",
    "better-answers-extraction/1.2",
    "01M2Q3R4S5T6V7W8X9YZAB0001/chars",
    "the docs say so",
    "xapps/api",
  ])("leaves %s alone", (text) => {
    expect(pathsNamedIn(text, ROOTS)).toEqual([]);
  });
});

describe("the top-level folders", () => {
  it("are the first segment of each foldered tracked file", () => {
    expect(rootsOf(["package.json", "apps/api/a.ts", "apps/web/b.ts", ".github/c.yml"])).toEqual([
      "apps",
      ".github",
    ]);
  });
});

describe("the strings a contract file holds", () => {
  const roots = ["packages", "docs"];

  it("reads every JSON key and value, however deep", () => {
    const files = {
      "contracts/a/cases.json": JSON.stringify({
        description: "see docs/one.md",
        cases: [{ why: "and packages/two.ts", nested: { "docs/three.md": 4, count: 5 } }],
      }),
    };

    expect(mentionsIn(files, roots).map(({ path: named }) => named)).toEqual([
      "docs/one.md",
      "docs/three.md",
      "packages/two.ts",
    ]);
  });

  it("reads a file that is not JSON as one text", () => {
    const files = { "contracts/README.md": "# The contract\n\nSee `docs/one.md`.\n" };

    expect(mentionsIn(files, roots)).toEqual([
      { file: "contracts/README.md", path: "docs/one.md" },
    ]);
  });

  it("names a path once per file however often it appears", () => {
    const files = { "contracts/a.json": JSON.stringify(["docs/one.md", "docs/one.md"]) };

    expect(mentionsIn(files, roots)).toHaveLength(1);
  });

  it("refuses a JSON file it cannot parse, naming the file", () => {
    expect(() => mentionsIn({ "contracts/bad.json": "{" }, roots)).toThrow(
      "contracts/bad.json is not valid JSON",
    );
  });
});

describe("a mention of a path", () => {
  const mentions = [
    { file: "contracts/a/cases.json", path: "docs/one.md" },
    { file: "contracts/README.md", path: "docs/gone.md" },
  ];

  it("passes when the repository holds the path", () => {
    expect(findingsFor(mentions.slice(0, 1), heldAt("docs/one.md"))).toEqual([]);
  });

  it("fails naming the file, the missing path and the fix", () => {
    const [report, ...rest] = findingsFor(mentions, heldAt("docs/one.md"));

    expect(rest).toEqual([]);
    expect(report).toContain("contracts/README.md names docs/gone.md");
    expect(report).toContain("Point it at the file's new path");
    expect(report).toContain("git log -1 --format=%h -- docs/gone.md");
  });
});

describe("this repository's tier contract", () => {
  const { files, roots } = tierContractIn(repositoryRoot);
  const mentions = mentionsIn(files, roots);
  const existsHere = (repositoryPath: string): boolean =>
    existsSync(path.join(repositoryRoot, repositoryPath));

  it("is read in full, README and fixtures", () => {
    expect(Object.keys(files)).toContain("contracts/README.md");
    expect(Object.keys(files)).toContain("contracts/manifest.json");
    expect(mentions.length).toBeGreaterThan(20);
  });

  it("names only paths the repository holds", () => {
    expect(
      findingsFor(mentions, existsHere),
      "each line names a path in contracts/ that no longer exists. Point the mention at the file's new path, then regenerate both contract stamps (`pnpm --filter @better-answers/schema run generate:contract-stamp` and, in apps/worker, `uv run --frozen generate-contract-stamp`), because a fixture edit moves the digest.",
    ).toEqual([]);
  });

  it("fails once one fixture names a path that was moved", () => {
    const { seeded, file, moved } = withOnePathMoved(files, roots);

    const reports = findingsFor(mentionsIn(seeded, roots), existsHere).filter((report) =>
      report.includes(moved),
    );

    expect(reports).toEqual([
      expect.stringContaining(`${file} names ${moved}, which the repository does not hold`),
    ]);
  });
});
