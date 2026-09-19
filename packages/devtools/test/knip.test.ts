import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { knipOver } from "@better-answers/devtools/throwaway-tree";
import type { KnipFinding, Tree } from "@better-answers/devtools/throwaway-tree";

import knipConfig, { topLevelIgnore } from "../../../knip.config.ts";

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
 *
 * The last five cases hold `.gitnexus/`, a per-checkout GitNexus index: it is excluded from
 * git through `.git/info/exclude` rather than `.gitignore`, which is the only file knip
 * reads, so an analysed checkout named `.gitnexus/run.cjs` an unused file for a reason that
 * was never the tree's (T-180). Two read the function `knip.config.ts` computes its
 * top-level `ignore` through, both ways as literals, because a directory that is absent is
 * a pattern matching nothing, which knip prints as a configuration hint on every run from a
 * checkout that was never analysed (T-192); a third reads the configuration's own value, so
 * the call that joins the two cannot be dropped or handed the presence inverted while the
 * suite stays green. The other two run the mechanism itself over a throwaway tree, both
 * ways, so the silence is proved and not assumed from the tool's own docs.
 *
 * The hint itself is out of this runner's reach and is not asserted anywhere: knip prints
 * configuration hints from its default reporter only, and the runner reads the JSON one,
 * which answers `{"issues":[]}` and no hints for the same tree. It was proved by hand
 * instead, and the run is in T-192's commit message.
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

describe("the repository's own top-level `ignore` follows the index's presence (T-192)", () => {
  it("ignores `.gitnexus/**` for a checkout that carries an index", () => {
    expect(topLevelIgnore(true)).toEqual([".gitnexus/**"]);
  });

  it("ignores nothing for a checkout that carries none", () => {
    // A worktree carries no index of its own — GitNexus analyses the main checkout only —
    // and knip prints a pattern that matches nothing as a hint to remove it, on every run,
    // while the exit stays 0. The pattern is dropped rather than the hint silenced: the
    // only silence knip offers is `--no-config-hints`, which would also hide the
    // redundant-entry hints `knip.config.ts`'s docblock is written to keep.
    expect(topLevelIgnore(false)).toEqual([]);
  });

  it("ignores what this checkout's own directory asks for", () => {
    // The two cases above hold the function; this one holds the line that calls it, which
    // nothing else reads: dropped, or handed the presence inverted, the configuration would
    // be silent here and knip would name `.gitnexus/run.cjs` unused on an analysed checkout
    // again — the red gate T-180 landed to stop. The expectation is a literal on each side
    // of a branch taken from the filesystem, so the case holds wherever it runs: `[]` from a
    // worktree, the glob from a main checkout that has been analysed.
    // SAFETY: `knip.config.ts`'s declared type admits the function form knip supports for a
    // CLI-argument-aware config; this repository's own config is always a plain object, so
    // the cast reads a value nobody is asking knip to compute.
    const { ignore } = knipConfig as { readonly ignore?: readonly string[] };
    const root = path.resolve(import.meta.dirname, "../../..");

    expect(ignore).toEqual(existsSync(path.join(root, ".gitnexus")) ? [".gitnexus/**"] : []);
  });
});

describe("the top-level `ignore` glob, proved both ways (T-180)", () => {
  // A knip config shaped like this repository's own fix: the same entry and project globs
  // as the scaffold above, plus the one line under test. A separate runner from `knip`
  // above, because that scaffold's config carries no `ignore` at all.
  const IGNORES_GITNEXUS = JSON.stringify({
    entry: ["src/main.ts", "src/registry/**"],
    project: ["**/*.ts"],
    ignore: [".gitnexus/**"],
  });

  const gitnexusIgnore = knipOver(
    { "package.json": MANIFEST, "knip.json": IGNORES_GITNEXUS },
    {
      tree: {
        "src/main.ts": MAIN,
        "src/reached.ts": REACHED,
        "other/probe.ts": "export const alone = 1;\n",
      },
      findings: [{ kind: "files", file: "other/probe.ts", name: "other/probe.ts" }],
    },
  );

  it("stays silent about an unreached file under the ignored directory", () => {
    const findings = gitnexusIgnore.findings({
      "src/main.ts": MAIN,
      "src/reached.ts": REACHED,
      ".gitnexus/probe.ts": "export const alone = 1;\n",
    });

    expect(findings).toEqual([]);
  });

  it("still names the same shape of unreached file under a directory the config does not name", () => {
    const findings = gitnexusIgnore.findings({
      "src/main.ts": MAIN,
      "src/reached.ts": REACHED,
      "other/probe.ts": "export const alone = 1;\n",
    });

    expect(namesOf(findings)).toEqual(["files:other/probe.ts:other/probe.ts"]);
  });
});
