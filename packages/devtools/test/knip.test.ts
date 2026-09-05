import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { knipOver } from "@better-answers/devtools/throwaway-tree";
import type { KnipFinding, Tree } from "@better-answers/devtools/throwaway-tree";

/**
 * knip as a gate, run over a throwaway tree (`[CHECK1]`).
 *
 * The gate's claim is that a file no code reaches, an export nothing imports and a
 * dependency no workspace uses each fail `check`. Reading the root manifest says the step
 * is wired; only running the tool says the step has teeth, and the silent half matters as
 * much as the loud one — a configuration knip refused reports nothing, and a suite that
 * reads nothing as "the tree is clean" would pass while the repository rotted.
 *
 * The fourth case is this repository's one calibrated exception: registry source under the
 * SPA's shared UI directory is an entry point, so a component installed for a surface that
 * does not exist yet is never a finding (ADR 0033). The rule is a directory in the
 * configuration, so the test that proves it is a tree with an unreached file in one.
 */

const MANIFEST = JSON.stringify({
  name: "throwaway",
  version: "0.0.0",
  private: true,
  type: "module",
});

/** The shape of the repository's own configuration: named entries, and an entry directory. */
const KNIP_CONFIG = JSON.stringify({
  entry: ["src/main.ts", "src/registry/**"],
  project: ["**/*.ts"],
});

const scaffold: Tree = { "package.json": MANIFEST, "knip.json": KNIP_CONFIG };

const MAIN =
  'import { reached } from "./reached.ts";\n\nexport const run = (): number => reached;\n';
const REACHED = "export const reached = 1;\n";

/** The tree the runner proves itself on: one unused export, and nothing else. */
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

    // The file itself, once: knip names the unreached file and says nothing more about
    // the exports inside it, which would be the same finding counted twice.
    expect(namesOf(findings)).toEqual(["files:src/orphan.ts:src/orphan.ts"]);
  });

  it("stays silent over a tree whose every file and export is reached", () => {
    const findings = knip.findings({ "src/main.ts": MAIN, "src/reached.ts": REACHED });

    expect(findings).toEqual([]);
  });

  it("stays silent about an unreached file that sits under a configured entry directory", () => {
    // The registry-source calibration (ADR 0033): a component installed for the answer
    // surface is reached by nothing until that surface exists, and is not a finding.
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
    const root: unknown = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, "../../../package.json"), "utf8"),
    );
    // SAFETY: the manifest is read only for its scripts, and each field is checked before
    // it is used, so a manifest without them fails the assertions rather than this cast.
    const scripts = (root as { readonly scripts?: Readonly<Record<string, string>> }).scripts ?? {};

    expect(scripts["knip"], "the root declares no knip script").toBeDefined();
    expect(scripts["check"] ?? "").toContain(" knip");
  });
});
