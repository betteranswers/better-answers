import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { knipOver } from "@better-answers/devtools/throwaway-tree";
import type { KnipFinding, Tree } from "@better-answers/devtools/throwaway-tree";

const MANIFEST = JSON.stringify({
  name: "throwaway",
  version: "0.0.0",
  private: true,
  type: "module",
});

const KNIP_CONFIG = JSON.stringify({
  entry: ["src/main.ts", "src/registry/**"],
  project: ["**/*.ts"],
});

const scaffold: Tree = { "package.json": MANIFEST, "knip.json": KNIP_CONFIG };

const MAIN =
  'import { reached } from "./reached.ts";\n\nexport const run = (): number => reached;\n';
const REACHED = "export const reached = 1;\n";

const smokeTree: Tree = {
  "src/main.ts": MAIN,
  "src/reached.ts": `${REACHED}export const spare = 2;\n`,
};

const knip = knipOver(scaffold, {
  tree: smokeTree,
  findings: [{ kind: "exports", file: "src/reached.ts", name: "spare" }],
});

const namesOf = (findings: readonly KnipFinding[]): readonly string[] =>
  findings.map((finding) => `${finding.kind}:${finding.file}:${finding.name}`);

describe("knip over a throwaway tree (T-066)", () => {
  it("names an export nothing imports", () => {
    const findings = knip.findings({
      "src/main.ts": MAIN,
      "src/reached.ts": `${REACHED}export const spare = 2;\n`,
    });

    expect(namesOf(findings)).toEqual(["exports:src/reached.ts:spare"]);
  });

  it("names a dependency the tree declares and no file imports", () => {
    const findings = knip.findings({
      "package.json": JSON.stringify({
        name: "throwaway",
        version: "0.0.0",
        private: true,
        type: "module",
        dependencies: { "a-package-nothing-imports": "1.0.0" },
      }),
      "src/main.ts": MAIN,
      "src/reached.ts": REACHED,
    });

    expect(namesOf(findings)).toEqual(["dependencies:package.json:a-package-nothing-imports"]);
  });

  it("names a file no entry reaches", () => {
    const findings = knip.findings({
      "src/main.ts": MAIN,
      "src/reached.ts": REACHED,
      "src/orphan.ts": "export const alone = 1;\n",
    });

    expect(namesOf(findings)).toEqual(["files:src/orphan.ts:src/orphan.ts"]);
  });

  it("stays silent over a tree whose every file and export is reached", () => {
    const findings = knip.findings({ "src/main.ts": MAIN, "src/reached.ts": REACHED });

    expect(findings).toEqual([]);
  });

  it("stays silent about an unreached file that sits under a configured entry directory", () => {
    const findings = knip.findings({
      "src/main.ts": MAIN,
      "src/reached.ts": REACHED,
      "src/registry/dialog.ts": "export const dialog = 1;\n",
    });

    expect(findings).toEqual([]);
  });
});

describe("the knip gate is a step of the root check (T-066)", () => {
  it("is named in the root check, so CI runs it with no workflow change", () => {
    const root = z
      .object({ scripts: z.record(z.string(), z.string()).optional() })
      .parse(
        JSON.parse(
          readFileSync(path.resolve(import.meta.dirname, "../../../package.json"), "utf8"),
        ),
      );
    const scripts = root.scripts ?? {};

    expect(scripts["knip"], "the root declares no knip script").toBeDefined();
    // The gates a branch never narrows are one list under one name, so the reach is two hops.
    expect(
      scripts["check:gates"] ?? "",
      "knip is not one of the gates that walk the whole tree",
    ).toContain(" knip");
    expect(scripts["check"] ?? "", "the root check no longer runs those gates").toContain(
      "check:gates",
    );
  });
});

describe("a directory `.git/info/exclude` names is invisible to knip, so the config names none", () => {
  const TREE = {
    "src/main.ts": MAIN,
    "src/reached.ts": REACHED,
    ".gitnexus/probe.ts": "export const alone = 1;\n",
  };

  it("stays silent about an unreached file under a directory the exclude file names", () => {
    const findings = knip.findings({ ...TREE, ".git/info/exclude": ".gitnexus/\n" });

    expect(findings).toEqual([]);
  });

  it("names the same file when the exclude file does not name its directory", () => {
    const findings = knip.findings({ ...TREE, ".git/info/exclude": ".elsewhere/\n" });

    expect(namesOf(findings)).toEqual(["files:.gitnexus/probe.ts:.gitnexus/probe.ts"]);
  });
});
