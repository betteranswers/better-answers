import { beforeAll, describe, expect, it } from "vitest";

import { knipBatchOver, knipOver } from "@better-answers/devtools/throwaway-tree";
import type {
  KnipCaseConfig,
  KnipFinding,
  PlannedKnip,
  Tree,
} from "@better-answers/devtools/throwaway-tree";

import knipConfig from "../../../../knip.config.ts";

const PACKAGE = { name: "throwaway", version: "0.0.0", private: true, type: "module" };

const MANIFEST = JSON.stringify(PACKAGE);

const KNIP_CONFIG = {
  entry: ["src/main.ts", "src/registry/**"],
  project: ["**/*.ts"],
};

const scaffold: Tree = { "package.json": MANIFEST, "knip.json": JSON.stringify(KNIP_CONFIG) };

const MAIN =
  'import { reached } from "./reached.ts";\n\nexport const run = (): number => reached;\n';
const REACHED = "export const reached = 1;\n";
const REACHED_AND_SPARE = `${REACHED}export const spare = 2;\n`;
const ALONE = "export const alone = 1;\n";

const smokeTree: Tree = {
  "src/main.ts": MAIN,
  "src/reached.ts": REACHED_AND_SPARE,
};

const SPARE: KnipFinding = { kind: "exports", file: "src/reached.ts", name: "spare" };

const batch = knipBatchOver({ "package.json": MANIFEST });

batch.control(smokeTree, KNIP_CONFIG, [SPARE]);

const found = (tree: Tree, config: KnipCaseConfig = KNIP_CONFIG): PlannedKnip =>
  batch.plan(tree, config);

beforeAll(batch.run);

const knip = knipOver(scaffold, { tree: smokeTree, findings: [SPARE] });

const namesOf = (findings: readonly KnipFinding[]): readonly string[] =>
  findings.map((finding) => `${finding.kind}:${finding.file}:${finding.name}`);

describe("knip over a throwaway tree", () => {
  const spare = found(smokeTree);

  it("names an export nothing imports", () => {
    expect(namesOf(spare.findings())).toEqual(["exports:src/reached.ts:spare"]);
  });

  const undeclared = found({
    "package.json": JSON.stringify({
      ...PACKAGE,
      dependencies: { "a-package-nothing-imports": "1.0.0" },
    }),
    "src/main.ts": MAIN,
    "src/reached.ts": REACHED,
  });

  it("names a dependency the tree declares and no file imports", () => {
    expect(namesOf(undeclared.findings())).toEqual([
      "dependencies:package.json:a-package-nothing-imports",
    ]);
  });

  const orphaned = found({
    "src/main.ts": MAIN,
    "src/reached.ts": REACHED,
    "src/orphan.ts": ALONE,
  });

  it("names a file no entry reaches", () => {
    expect(namesOf(orphaned.findings())).toEqual(["files:src/orphan.ts:src/orphan.ts"]);
  });

  const reachedAll = found({ "src/main.ts": MAIN, "src/reached.ts": REACHED });

  it("stays silent when every file and export is reached", () => {
    expect(reachedAll.findings()).toEqual([]);
  });

  const registry = found({
    "src/main.ts": MAIN,
    "src/reached.ts": REACHED,
    "src/registry/dialog.ts": "export const dialog = 1;\n",
  });

  it("stays silent about an unreached file under an entry directory", () => {
    expect(registry.findings()).toEqual([]);
  });
});

describe("knipOver's smoke case", () => {
  const CASED_TREE: Tree = {
    "src/main.ts": MAIN,
    "src/reached.ts": `${REACHED}export const Upper = 2;\nexport const lower = 3;\n`,
  };
  const UPPER: KnipFinding = { kind: "exports", file: "src/reached.ts", name: "Upper" };
  const LOWER: KnipFinding = { kind: "exports", file: "src/reached.ts", name: "lower" };

  it.each([
    ["code-unit order", [UPPER, LOWER]],
    ["a locale's order", [LOWER, UPPER]],
  ])("accepts findings differing in case, named in %s", (_order, findings) => {
    expect(() => knipOver(scaffold, { tree: CASED_TREE, findings })).not.toThrow();
  });

  it("refuses a smoke case the report does not match", () => {
    expect(() => knipOver(scaffold, { tree: CASED_TREE, findings: [UPPER] })).toThrow(/smoke/);
  });
});

describe("knip never reads a directory `.git/info/exclude` names", () => {
  const TREE = { "src/main.ts": MAIN, "src/reached.ts": REACHED, ".gitnexus/probe.ts": ALONE };

  it("stays silent about an unreached file in an excluded directory", () => {
    const findings = knip.findings({ ...TREE, ".git/info/exclude": ".gitnexus/\n" });

    expect(findings).toEqual([]);
  });

  it("names the same file when its directory is not excluded", () => {
    const findings = knip.findings({ ...TREE, ".git/info/exclude": ".elsewhere/\n" });

    expect(namesOf(findings)).toEqual(["files:.gitnexus/probe.ts:.gitnexus/probe.ts"]);
  });
});

describe("a slice's unused barrel export where entry exports are gated", () => {
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

  /** A workspace's own value wins over the top-level one, the order knip reads them in. */
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

  const configuredAs = (workspace: string): KnipCaseConfig => ({
    entry: ["src/consumer.ts"],
    project: ["**/*.ts"],
    includeEntryExports: entryExportsIn(workspace),
  });

  const manifested = (tree: Tree): Tree => ({ "package.json": SLICE_MANIFEST, ...tree });

  batch.control(
    manifested({ ...sliceTree(ONE_NAME, REACHED), "src/orphan.ts": ALONE }),
    configuredAs("."),
    [{ kind: "files", file: "src/orphan.ts", name: "src/orphan.ts" }],
  );

  it.each(
    [
      ".",
      "apps/api",
      "packages/core",
      "packages/design-system",
      "packages/devtools",
      "packages/schema",
    ].map(
      (workspace) =>
        [
          workspace,
          found(manifested(sliceTree(BOTH_NAMES, REACHED_AND_SPARE)), configuredAs(workspace)),
        ] as const,
    ),
  )("names it and the source export it re-exports in %s", (_workspace, planned) => {
    expect(namesOf(planned.findings())).toEqual([
      "exports:src/slice/index.ts:spare",
      "exports:src/slice/reached.ts:spare",
    ]);
  });

  const web = found(manifested(sliceTree(BOTH_NAMES, REACHED_AND_SPARE)), configuredAs("apps/web"));

  it("stays silent in apps/web, whose registry lands before its callers", () => {
    expect(web.findings()).toEqual([]);
  });

  const tagged = found(
    manifested(
      sliceTree(
        `${ONE_NAME}/** @public S3 */\nexport { spare } from "./reached.ts";\n`,
        REACHED_AND_SPARE,
      ),
    ),
    configuredAs("packages/core"),
  );

  it("stays silent about one tagged `@public` for a later block", () => {
    expect(tagged.findings()).toEqual([]);
  });
});
