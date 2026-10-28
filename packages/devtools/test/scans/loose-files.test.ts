import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  CAPS,
  countsIn,
  findingsFor,
  isCounted,
  LOOSE_FILE_LIMIT,
  WHERE_THE_CAPS_LIVE,
} from "@better-answers/devtools/loose-files";
import type { Cap } from "@better-answers/devtools/loose-files";
import { repositoryRoot } from "@better-answers/devtools/paths";
import {
  gitIn,
  sweptFolder,
  throwawayRepository,
  writeUnder,
} from "@better-answers/devtools/throwaway-tree";

const SCRIPT = path.join(repositoryRoot, "scripts/loose-files.mjs");

const PROBE = "packages/probe/src";

const scratch = sweptFolder();

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const filesIn = (folder: string, count: number): readonly string[] =>
  Array.from({ length: count }, (_, index) => `${folder}/file-${String(index)}.ts`);

const probeCap = (cap: number): readonly Cap[] => [
  { folder: PROBE, cap, kind: "awaiting", reason: "a probe awaits" },
];

const pinnedProbeCap = (cap: number): readonly Cap[] => [
  { folder: PROBE, cap, kind: "pinned", reason: "a tool writes there" },
];

const findings = (files: readonly string[], caps: readonly Cap[] = []): readonly string[] =>
  findingsFor(countsIn(files), caps);

describe("the files the gate counts", () => {
  it.each([
    ["apps/api/src/server.ts", true],
    ["apps/web/e2e/page.spec.ts", true],
    ["apps/worker/tests/test_work_loop.py", true],
    ["apps/worker/src/better_answers_worker/redaction/pins.py", true],
    ["packages/core/test/workspaces/workspaces.test.ts", true],
    ["packages/core/src/members/index.ts", true],
    ["packages/core/tests/workspaces.test.ts", false],
    ["packages/core/e2e/page.spec.ts", false],
    ["apps/web/test/fixtures/page.html", false],
    ["apps/web/test/fixtures/deep/page.html", false],
    ["apps/web/src/app/__snapshots__/page.snap", false],
    ["apps/api/package.json", false],
    ["apps/api/lifts/better-auth/index.ts", false],
    ["docs/plans/001-one.md", false],
    ["scripts/check.mjs", false],
  ])("reads %s as counted: %s", (file, expected) => {
    expect(isCounted(file)).toBe(expected);
  });

  it("counts a file in the folder holding it, never above", () => {
    const counts = countsIn([...filesIn(PROBE, 3), ...filesIn(`${PROBE}/sub`, 2)]);

    expect(Object.fromEntries(counts)).toEqual({ [PROBE]: 3, [`${PROBE}/sub`]: 2 });
  });
});

describe("a folder with no cap", () => {
  it("passes at the limit", () => {
    expect(findings(filesIn(PROBE, LOOSE_FILE_LIMIT))).toEqual([]);
  });

  it("fails one file over, naming folder, count, limit and fix", () => {
    const [report, ...rest] = findings(filesIn(PROBE, LOOSE_FILE_LIMIT + 1));

    expect(rest).toEqual([]);
    expect(report).toContain(`${PROBE}: 16 files`);
    expect(report).toContain("limit of 15");
    expect(report).toContain("Move files into a subfolder by capability");
  });

  it("fails each folder over the limit, in order", () => {
    const files = [...filesIn("packages/probe/test", 16), ...filesIn(PROBE, 17)];

    expect(findings(files)).toEqual([
      expect.stringContaining("packages/probe/src: 17 files"),
      expect.stringContaining("packages/probe/test: 16 files"),
    ]);
  });

  it.each(["fixtures", "__snapshots__"])("walks past a %s folder", (name) => {
    expect(findings(filesIn(`packages/probe/test/${name}`, 40))).toEqual([]);
  });

  it("walks past a folder outside the source and test trees", () => {
    expect(findings(filesIn("docs/plans", 40))).toEqual([]);
  });
});

describe("a folder with a cap", () => {
  it("passes at its cap", () => {
    expect(findings(filesIn(PROBE, 20), probeCap(20))).toEqual([]);
  });

  it("fails one file over, naming folder, count, cap and fix", () => {
    const [report, ...rest] = findings(filesIn(PROBE, 21), probeCap(20));

    expect(rest).toEqual([]);
    expect(report).toContain(`${PROBE}: 21 files`);
    expect(report).toContain("cap of 20");
    expect(report).toContain(WHERE_THE_CAPS_LIVE);
    expect(report).toContain("Move files into a subfolder by capability; never raise the cap");
    expect(report).not.toContain("pinned");
  });

  it("fails as stale once the folder holds fewer", () => {
    const [report, ...rest] = findings(filesIn(PROBE, 19), probeCap(20));

    expect(rest).toEqual([]);
    expect(report).toContain(`${PROBE}: its cap of 20`);
    expect(report).toContain("holds 19");
    expect(report).toContain("Lower the cap to 19");
  });

  it("fails as stale at the limit, asking to delete", () => {
    const [report, ...rest] = findings(filesIn(PROBE, LOOSE_FILE_LIMIT), probeCap(20));

    expect(rest).toEqual([]);
    expect(report).toContain("holds 15, within the limit of 15");
    expect(report).toContain("Delete the entry");
  });

  it("fails as stale under the limit", () => {
    expect(findings(filesIn(PROBE, 10), probeCap(20))).toEqual([
      expect.stringContaining("holds 10, within the limit of 15"),
    ]);
  });

  it("fails as stale once the folder is gone", () => {
    const [report, ...rest] = findings(filesIn("packages/probe/test", 3), probeCap(20));

    expect(rest).toEqual([]);
    expect(report).toContain("holds no tracked file");
    expect(report).toContain("Delete the entry");
  });

  it("fails as stale when only a fixtures folder holds files", () => {
    expect(findings(filesIn(`${PROBE}/fixtures`, 25), probeCap(20))).toEqual([
      expect.stringContaining("holds no tracked file"),
    ]);
  });
});

describe("a folder with a pinned cap", () => {
  it("passes at its cap", () => {
    expect(findings(filesIn(PROBE, 20), pinnedProbeCap(20))).toEqual([]);
  });

  it("fails one file over, saying to raise the cap", () => {
    const [report, ...rest] = findings(filesIn(PROBE, 21), pinnedProbeCap(20));

    expect(rest).toEqual([]);
    expect(report).toContain(`${PROBE}: 21 files`);
    expect(report).toContain("cap of 20");
    expect(report).toContain("pinned (a tool writes there)");
    expect(report).toContain("Raise the cap to 21 in the same change");
    expect(report).not.toContain("never raise the cap");
    expect(report).not.toContain("Move files into a subfolder");
  });

  it("fails as stale once the folder holds fewer", () => {
    expect(findings(filesIn(PROBE, 19), pinnedProbeCap(20))).toEqual([
      expect.stringContaining("Lower the cap to 19"),
    ]);
  });

  it("fails as stale within the limit, asking to delete", () => {
    expect(findings(filesIn(PROBE, 10), pinnedProbeCap(20))).toEqual([
      expect.stringContaining("Delete the entry"),
    ]);
  });
});

describe("the table of caps", () => {
  const folders = CAPS.map(({ folder }) => folder);

  it("lists each folder once, in code-unit order", () => {
    expect(folders).toEqual([...new Set(folders)].toSorted());
  });

  it("caps every folder above the limit", () => {
    expect(CAPS.filter(({ cap }) => cap <= LOOSE_FILE_LIMIT)).toEqual([]);
  });

  it("names only folders the gate reads", () => {
    expect(folders.filter((folder) => !isCounted(`${folder}/file.ts`))).toEqual([]);
  });

  it("gives every entry a reason", () => {
    expect(CAPS.filter(({ reason }) => reason.trim() === "")).toEqual([]);
  });

  it("pins the two folders a tool fixes in place", () => {
    expect(CAPS.filter(({ kind }) => kind === "pinned").map(({ folder }) => folder)).toEqual([
      "apps/web/src/shared/ui",
      "apps/worker/src/better_answers_worker/redaction",
    ]);
  });
});

const spawned = (cwd: string) => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });

let repositories = 0;

const repositoryOf = (tracked: readonly string[], untracked: readonly string[] = []): string => {
  repositories += 1;
  const root = throwawayRepository(path.join(scratch, `repository-${String(repositories)}`));
  for (const file of [...tracked, ...untracked]) writeUnder(root, file, "export {};\n");
  gitIn(root, "add", "--", ...tracked);
  return root;
};

const linesOf = (stdout: string): readonly string[] => stdout.split("\n");

describe("the gate over a throwaway repository", () => {
  it("fails a folder over the limit, naming it", () => {
    const ran = spawned(repositoryOf(filesIn(PROBE, 16)));

    expect(ran.status).toBe(1);
    expect(
      linesOf(ran.stdout).filter((line) => line.startsWith(`${PROBE}: 16 files`)),
    ).toHaveLength(1);
  });

  it("fails a folder over its cap", () => {
    const ran = spawned(repositoryOf(filesIn("apps/web/test", 112)));

    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain("apps/web/test: 112 files directly inside, over its cap of 111");
  });

  it("tells a pinned folder over its cap to raise it", () => {
    const ran = spawned(repositoryOf(filesIn("apps/web/src/shared/ui", 30)));

    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain("apps/web/src/shared/ui: 30 files directly inside, over its cap");
    expect(ran.stdout).toContain("shadcn CLI's target");
    expect(ran.stdout).toContain("Raise the cap to 30 in the same change");
  });

  it("fails a cap its folder has fallen below", () => {
    const ran = spawned(repositoryOf(filesIn("apps/web/src/shared/ui", 20)));

    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain("apps/web/src/shared/ui: its cap of 29");
    expect(ran.stdout).toContain("Lower the cap to 20");
  });

  it("fails a cap whose folder is within the limit", () => {
    const ran = spawned(repositoryOf(filesIn("apps/api/tests", 14)));

    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain("apps/api/tests: its cap of 115");
    expect(ran.stdout).toContain("Delete the entry");
  });

  it("reads tracked files only", () => {
    const ran = spawned(repositoryOf(filesIn(PROBE, 15), filesIn(PROBE, 20).slice(15)));

    expect(ran.stdout).not.toContain(PROBE);
  });

  it("walks past tracked files that are fixtures", () => {
    const ran = spawned(repositoryOf(filesIn("packages/probe/test/fixtures", 40)));

    expect(ran.stdout).not.toContain("packages/probe");
  });

  it("does not count a tracked file deleted from disk", () => {
    const root = repositoryOf(filesIn(PROBE, 16));
    rmSync(path.join(root, PROBE, "file-0.ts"));

    expect(spawned(root).stdout).not.toContain(PROBE);
  });

  it("refuses a repository with no file in a counted tree", () => {
    const ran = spawned(repositoryOf(["docs/plans/001-one.md"]));

    expect(ran.status).toBe(2);
    expect(ran.stderr).toContain("no tracked file under a source or test tree");
  });

  it("refuses a directory that is no repository", () => {
    const bare = path.join(scratch, "no-repository");
    mkdirSync(bare);
    const ran = spawned(bare);

    expect(ran.status).toBe(2);
    expect(ran.stderr).toContain("the listing did not finish");
  });
});

describe("the gate over this repository", () => {
  it("passes, so no folder grew and no cap went stale", () => {
    const ran = spawned(repositoryRoot);

    expect(ran.stdout).toMatch(/^each of the \d+ folders read holds 15 tracked files or fewer/u);
    expect(ran.status).toBe(0);
  });
});
