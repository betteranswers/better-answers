import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { knipOver } from "@better-answers/devtools/throwaway-tree";
import type { KnipFinding, KnipRunner, Tree } from "@better-answers/devtools/throwaway-tree";

import knipConfig from "../../../knip.config.ts";

const PACKAGE = { name: "throwaway", version: "0.0.0", private: true, type: "module" };

const MANIFEST = JSON.stringify(PACKAGE);

const KNIP_CONFIG = JSON.stringify({
  entry: ["src/main.ts", "src/registry/**"],
  project: ["**/*.ts"],
});

const scaffold: Tree = { "package.json": MANIFEST, "knip.json": KNIP_CONFIG };

const MAIN =
  'import { reached } from "./reached.ts";\n\nexport const run = (): number => reached;\n';
const REACHED = "export const reached = 1;\n";
const REACHED_AND_SPARE = `${REACHED}export const spare = 2;\n`;
const ALONE = "export const alone = 1;\n";

const smokeTree: Tree = {
  "src/main.ts": MAIN,
  "src/reached.ts": REACHED_AND_SPARE,
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
      "src/reached.ts": REACHED_AND_SPARE,
    });

    expect(namesOf(findings)).toEqual(["exports:src/reached.ts:spare"]);
  });

  it("names a dependency the tree declares and no file imports", () => {
    const findings = knip.findings({
      "package.json": JSON.stringify({
        ...PACKAGE,
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
      "src/orphan.ts": ALONE,
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

describe("knip never reads a directory `.git/info/exclude` names", () => {
  const TREE = { "src/main.ts": MAIN, "src/reached.ts": REACHED, ".gitnexus/probe.ts": ALONE };

  it("stays silent about an unreached file under a directory the exclude file names", () => {
    const findings = knip.findings({ ...TREE, ".git/info/exclude": ".gitnexus/\n" });

    expect(findings).toEqual([]);
  });

  it("names the same file when the exclude file does not name its directory", () => {
    const findings = knip.findings({ ...TREE, ".git/info/exclude": ".elsewhere/\n" });

    expect(namesOf(findings)).toEqual(["files:.gitnexus/probe.ts:.gitnexus/probe.ts"]);
  });
});

describe("a slice's barrel export nothing imports is named where the config gates entry exports", () => {
  const SLICE_MANIFEST = JSON.stringify({
    ...PACKAGE,
    exports: { "./slice": "./src/slice/index.ts" },
  });
  const CONSUMER = 'import { reached } from "./slice/index.ts";\n\nconsole.log(reached);\n';
  const ONE_NAME = 'export { reached } from "./reached.ts";\n';
  const BOTH_NAMES = 'export { reached, spare } from "./reached.ts";\n';

  const sliceTree = (barrel: string, source: string): Tree => ({
    "src/consumer.ts": CONSUMER,
    "src/slice/reached.ts": source,
    "src/slice/index.ts": barrel,
  });

  // A workspace's own value wins over the top-level one, the order knip reads them in.
  const entryExportsIn = (workspace: string): boolean => {
    if (typeof knipConfig === "function") {
      throw new Error("the repository's knip config is a plain object, never the function form");
    }
    return (
      knipConfig.workspaces?.[workspace]?.includeEntryExports ??
      knipConfig.includeEntryExports ??
      false
    );
  };

  const knipConfiguredAs = (workspace: string): KnipRunner =>
    knipOver(
      {
        "package.json": SLICE_MANIFEST,
        "knip.json": JSON.stringify({
          entry: ["src/consumer.ts"],
          project: ["**/*.ts"],
          includeEntryExports: entryExportsIn(workspace),
        }),
      },
      {
        tree: { ...sliceTree(ONE_NAME, REACHED), "src/orphan.ts": ALONE },
        findings: [{ kind: "files", file: "src/orphan.ts", name: "src/orphan.ts" }],
      },
    );

  it.each([
    ".",
    "apps/api",
    "packages/core",
    "packages/design-system",
    "packages/devtools",
    "packages/schema",
  ])("names it, and the source export it passes on, in %s", (workspace) => {
    const findings = knipConfiguredAs(workspace).findings(sliceTree(BOTH_NAMES, REACHED_AND_SPARE));

    expect(namesOf(findings)).toEqual([
      "exports:src/slice/index.ts:spare",
      "exports:src/slice/reached.ts:spare",
    ]);
  });

  it("stays silent about it in apps/web, whose registry is installed ahead of its callers", () => {
    const findings = knipConfiguredAs("apps/web").findings(
      sliceTree(BOTH_NAMES, REACHED_AND_SPARE),
    );

    expect(findings).toEqual([]);
  });

  it("stays silent about one tagged `@public` for the block that will wire it", () => {
    const tagged = `${ONE_NAME}/** @public S3 */\nexport { spare } from "./reached.ts";\n`;

    const findings = knipConfiguredAs("packages/core").findings(
      sliceTree(tagged, REACHED_AND_SPARE),
    );

    expect(findings).toEqual([]);
  });
});
