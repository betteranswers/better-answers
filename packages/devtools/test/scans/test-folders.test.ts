import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { afterAll, assert, describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";
import {
  GATES_FOLDER,
  HELPER_FOLDERS,
  PINS,
  reportFor,
  TREES,
  WHERE_THE_PINS_LIVE,
} from "@better-answers/devtools/test-folders";
import type { Pin, Tree } from "@better-answers/devtools/test-folders";
import {
  gitIn,
  sweptFolder,
  throwawayRepository,
  writeUnder,
} from "@better-answers/devtools/throwaway-tree";

const SCRIPT = path.join(repositoryRoot, "scripts/test-folders.mjs");

const PROBE: Tree = { tests: "packages/probe/test", source: "packages/probe/src" };

const WEB: Tree = { tests: "apps/probe/test", source: "apps/probe/src", strip: "features/" };

const sourceAndTest = ["packages/probe/src/a/b/work.ts", "packages/probe/test/a/b/work.test.ts"];

const findingsOf = (
  files: readonly string[],
  pins: readonly Pin[] = [],
  trees: readonly Tree[] = [PROBE],
): readonly string[] => reportFor(files, pins, trees).findings;

const strayLine = (folder: string): string =>
  `${folder}: mirrors no source folder and is not a kind folder. Move its files to the folder of the entry they drive, or add a row to PINS in ${WHERE_THE_PINS_LIVE} with the kind and the reason.`;

const staleLine = (folder: string): string =>
  `${folder}: its row in ${WHERE_THE_PINS_LIVE} is stale, since the folder holds no tracked file. Delete the row.`;

const goneLine = (folder: string, reason: string): string =>
  `${folder}: its row names ${reason}, which holds no tracked file. Point the row at the tree it mirrors, or move the tests into their mirror folder and delete the row.`;

describe("a folder that mirrors a source folder", () => {
  it("passes, however deep", () => {
    expect(reportFor(sourceAndTest, [], [PROBE])).toEqual({ read: 2, findings: [] });
  });

  it("passes with the tree's strip removed from the source side", () => {
    const files = [
      "apps/probe/src/features/people/page.tsx",
      "apps/probe/test/people/page.test.tsx",
    ];

    expect(findingsOf(files, [], [WEB])).toEqual([]);
  });

  it("fails a test in the strip's own folder", () => {
    const files = [
      "apps/probe/src/features/people/page.tsx",
      "apps/probe/test/people/page.test.tsx",
      "apps/probe/test/features/x.test.ts",
    ];

    expect(findingsOf(files, [], [WEB])).toEqual([strayLine("apps/probe/test/features")]);
  });

  it("reads a file at the test root as no folder", () => {
    expect(reportFor(["packages/probe/test/loose.test.ts"], [], [PROBE])).toEqual({
      read: 0,
      findings: [],
    });
  });

  it("reads only the files under the tree's own test folder", () => {
    expect(findingsOf(["packages/other/test/stray/x.test.ts", "docs/stray/x.md"])).toEqual([]);
  });
});

describe("a folder of one of the named kinds", () => {
  it.each([...HELPER_FOLDERS])("passes a %s folder", (name) => {
    expect(findingsOf([`packages/probe/test/${name}/x.ts`])).toEqual([]);
  });

  it("passes a helper folder below a mirror folder", () => {
    const files = [...sourceAndTest, "packages/probe/test/a/b/fixtures/deep/page.html"];

    expect(findingsOf(files)).toEqual([]);
  });

  it("passes a gates folder and the folders under it", () => {
    expect(findingsOf([`packages/probe/test/${GATES_FOLDER}/deep/x.test.ts`])).toEqual([]);
  });

  it("fails a gates folder that is not the first segment", () => {
    expect(findingsOf([...sourceAndTest, "packages/probe/test/a/gates/x.test.ts"])).toEqual([
      strayLine("packages/probe/test/a/gates"),
    ]);
  });

  it.each(["run", "mirror", "split"] as const)("passes a %s row's folder and below it", (kind) => {
    const pin: Pin = { folder: "packages/probe/test/pinned", kind, reason: "packages/probe/src" };
    const files = ["packages/probe/src/x.ts", "packages/probe/test/pinned/deep/x.test.ts"];

    expect(findingsOf(files, [pin])).toEqual([]);
  });

  it("fails a folder sharing only a row's name prefix", () => {
    const pin: Pin = { folder: "packages/probe/test/pinned", kind: "run", reason: "a job" };
    const files = [
      "packages/probe/test/pinned/x.test.ts",
      "packages/probe/test/pinned-too/x.test.ts",
    ];

    expect(findingsOf(files, [pin])).toEqual([strayLine("packages/probe/test/pinned-too")]);
  });
});

describe("a folder that mirrors nothing", () => {
  it("fails with the folder and the fix", () => {
    expect(findingsOf(["packages/probe/test/stray/x.test.ts"])).toEqual([
      strayLine("packages/probe/test/stray"),
    ]);
  });

  it("fails each stray folder of a nest, in order", () => {
    expect(
      findingsOf(["packages/probe/test/zed/x.test.ts", "packages/probe/test/a/b/x.test.ts"]),
    ).toEqual([
      strayLine("packages/probe/test/a"),
      strayLine("packages/probe/test/a/b"),
      strayLine("packages/probe/test/zed"),
    ]);
  });

  it("fails in each tree that holds one", () => {
    const files = ["packages/probe/test/stray/x.test.ts", "apps/probe/test/stray/x.test.ts"];

    expect(findingsOf(files, [], [PROBE, WEB])).toEqual([
      strayLine("apps/probe/test/stray"),
      strayLine("packages/probe/test/stray"),
    ]);
  });
});

describe("a row of the table", () => {
  const PINNED = ["packages/probe/test/pinned/x.test.ts", "packages/probe/src/pinned.ts"];

  const mirror = (reason: string): Pin => ({
    folder: "packages/probe/test/pinned",
    kind: "mirror",
    reason,
  });

  it("passes when its folder and its reason path hold files", () => {
    expect(findingsOf(PINNED, [mirror("packages/probe/src/pinned.ts")])).toEqual([]);
  });

  it("takes a reason that names a folder", () => {
    expect(findingsOf(PINNED, [mirror("packages/probe/src")])).toEqual([]);
  });

  it("fails as stale once its folder holds no file", () => {
    const row = mirror("packages/probe/src/pinned.ts");

    expect(findingsOf(["packages/probe/src/pinned.ts"], [row])).toEqual([staleLine(row.folder)]);
  });

  it("fails as stale when only another folder shares its prefix", () => {
    const row = mirror("packages/probe/src");
    const files = ["packages/probe/src/x.ts", "packages/probe/test/pinned-too/x.ts"];

    expect(findingsOf(files, [row])).toEqual([
      strayLine("packages/probe/test/pinned-too"),
      staleLine(row.folder),
    ]);
  });

  it("fails once the path its reason names holds no file", () => {
    const row = mirror("packages/probe/gone");

    expect(findingsOf(PINNED, [row])).toEqual([goneLine(row.folder, "packages/probe/gone")]);
  });

  it("fails a split row whose source file is gone", () => {
    const row: Pin = { ...mirror("packages/probe/src/gone.ts"), kind: "split" };

    expect(findingsOf(PINNED, [row])).toEqual([goneLine(row.folder, "packages/probe/src/gone.ts")]);
  });

  it("reads a run row's reason as prose", () => {
    const row: Pin = { ...mirror("a config selects it"), kind: "run" };

    expect(findingsOf(PINNED, [row])).toEqual([]);
  });

  it("names a stale row once, not also for its reason", () => {
    const row = mirror("packages/probe/gone");

    expect(findingsOf([], [row])).toEqual([staleLine(row.folder)]);
  });

  it("lists stale rows after strays, in order", () => {
    const rows = [mirror("x"), { ...mirror("x"), folder: "packages/probe/test/another" }];

    expect(findingsOf(["packages/probe/test/stray/x.test.ts"], rows)).toEqual([
      strayLine("packages/probe/test/stray"),
      staleLine("packages/probe/test/another"),
      staleLine("packages/probe/test/pinned"),
    ]);
  });
});

describe("the table of pins and trees", () => {
  const folders = PINS.map(({ folder }) => folder);

  it("lists each pinned folder once, in code-unit order", () => {
    expect(folders).toEqual([...new Set(folders)].toSorted());
  });

  it("pins only folders inside a tree", () => {
    const inside = (folder: string): boolean =>
      TREES.some(({ tests }) => folder.startsWith(`${tests}/`));

    expect(folders.filter((folder) => !inside(folder))).toEqual([]);
  });

  it("gives every pin a reason", () => {
    expect(PINS.filter(({ reason }) => reason.trim() === "")).toEqual([]);
  });

  it("reads each test tree once", () => {
    const tests = TREES.map((tree) => tree.tests);

    expect(tests.length).toBe(new Set(tests).size);
  });
});

const made: string[] = [];

afterAll(() => {
  for (const folder of made) rmSync(folder, { recursive: true, force: true });
});

const tracked = (...files: readonly string[]): string => {
  const parent = sweptFolder();
  made.push(parent);
  const root = throwawayRepository(path.join(parent, "repository"));
  for (const file of files) writeUnder(root, file, "export {};\n");
  gitIn(root, "add", "--", ...files);
  return root;
};

const everyPinHeld = (): readonly string[] =>
  PINS.flatMap(({ folder, kind, reason }) => {
    const held = [`${folder}/probe.test.ts`];
    if (kind === "run") return held;
    return [...held, /\.\w+$/u.test(reason) ? reason : `${reason}/probe.ts`];
  });

const gateIn = (cwd: string) => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });

describe("the gate over a throwaway repository", () => {
  const MIRRORED = ["packages/core/src/a/x.ts", "packages/core/test/a/x.test.ts"];

  it("passes a tree whose folders all mirror or are pinned", () => {
    const ran = gateIn(tracked(...MIRRORED, ...everyPinHeld()));

    expect(ran.stdout).toMatch(
      /^each of the \d+ test folders read mirrors a source folder or is a named kind\n$/u,
    );
    expect(ran.status).toBe(0);
  });

  it("fails a stray folder, naming it and the fix", () => {
    const ran = gateIn(
      tracked(...MIRRORED, ...everyPinHeld(), "packages/core/test/stray/stray.test.ts"),
    );

    expect(ran.status).toBe(1);
    expect(ran.stdout).toBe(`${strayLine("packages/core/test/stray")}\n`);
  });

  it("fails a row whose folder holds no tracked file", () => {
    const row = PINS.find(({ kind }) => kind === "run");
    assert.ok(row !== undefined, "the table holds a run row");
    const held = everyPinHeld().filter((file) => !file.startsWith(`${row.folder}/`));
    const ran = gateIn(tracked(...MIRRORED, ...held));

    expect(ran.status).toBe(1);
    expect(ran.stdout).toBe(`${staleLine(row.folder)}\n`);
  });

  it("fails a row whose reason path holds no tracked file", () => {
    const held = everyPinHeld().filter((file) => file !== "deploy/probe.ts");
    const ran = gateIn(tracked(...MIRRORED, ...held));

    expect(ran.status).toBe(1);
    expect(ran.stdout).toBe(`${goneLine("apps/api/tests/deploy", "deploy")}\n`);
  });

  it("reads tracked files only", () => {
    const root = tracked(...MIRRORED, ...everyPinHeld());
    writeUnder(root, "packages/core/test/untracked/x.test.ts", "export {};\n");

    expect(gateIn(root).status).toBe(0);
  });

  it("refuses a repository with no file in a test tree", () => {
    const ran = gateIn(tracked("docs/plans/001-one.md"));

    expect(ran.status).toBe(2);
    expect(ran.stderr).toContain("no tracked file under a test tree");
  });

  it("refuses a directory that is no repository", () => {
    const bare = path.join(sweptFolder(), "no-repository");
    made.push(path.dirname(bare));
    mkdirSync(bare);
    const ran = gateIn(bare);

    expect(ran.status).toBe(2);
    expect(ran.stderr).toContain("the listing did not finish");
  });
});

describe("the gate over this repository", () => {
  it("passes, so no folder strays and no row went stale", () => {
    const ran = gateIn(repositoryRoot);

    expect(ran.stdout).toMatch(
      /^each of the \d+ test folders read mirrors a source folder or is a named kind\n$/u,
    );
    expect(ran.status).toBe(0);
  });
});
