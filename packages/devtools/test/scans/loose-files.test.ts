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

const CAP = LOOSE_FILE_LIMIT + 5;

const probeCap = (cap: number): readonly Cap[] => [
  { folder: PROBE, cap, reason: "a tool writes there" },
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
    ["apps/web/test/support/stub-server.ts", false],
    ["apps/web/test/support/jsdom/layout.ts", false],
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
    expect(report).toContain(`${PROBE} has ${String(LOOSE_FILE_LIMIT + 1)} files`);
    expect(report).toContain(`limit is ${String(LOOSE_FILE_LIMIT)}`);
    expect(report).toContain("Move files into subfolders by capability");
  });

  it("fails each folder over the limit, in order", () => {
    const files = [
      ...filesIn("packages/probe/test", LOOSE_FILE_LIMIT + 1),
      ...filesIn(PROBE, LOOSE_FILE_LIMIT + 2),
    ];

    expect(findings(files)).toEqual([
      expect.stringContaining(`packages/probe/src has ${String(LOOSE_FILE_LIMIT + 2)} files`),
      expect.stringContaining(`packages/probe/test has ${String(LOOSE_FILE_LIMIT + 1)} files`),
    ]);
  });

  it.each(["fixtures", "__snapshots__", "support"])("ignores a %s folder", (name) => {
    expect(findings(filesIn(`packages/probe/test/${name}`, 40))).toEqual([]);
  });

  it("ignores a folder outside the source and test trees", () => {
    expect(findings(filesIn("docs/plans", 40))).toEqual([]);
  });
});

describe("a folder with a cap", () => {
  it("passes at its cap", () => {
    expect(findings(filesIn(PROBE, CAP), probeCap(CAP))).toEqual([]);
  });

  it("fails one file over, naming folder, count, cap and fix", () => {
    const [report, ...rest] = findings(filesIn(PROBE, CAP + 1), probeCap(CAP));

    expect(rest).toEqual([]);
    expect(report).toContain(`${PROBE} has ${String(CAP + 1)} files`);
    expect(report).toContain(`cap in ${WHERE_THE_CAPS_LIVE} is ${String(CAP)}`);
    expect(report).toContain("because a tool writes there");
    expect(report).toContain(`Raise the cap to ${String(CAP + 1)} in the same change`);
    expect(report).not.toContain("Move files into subfolders");
  });

  it("fails as stale once the folder holds fewer", () => {
    const [report, ...rest] = findings(filesIn(PROBE, CAP - 1), probeCap(CAP));

    expect(rest).toEqual([]);
    expect(report).toContain(
      `${PROBE} has ${String(CAP - 1)} files, fewer than its cap of ${String(CAP)}`,
    );
    expect(report).toContain(`Lower the cap to ${String(CAP - 1)}`);
  });

  it("fails as stale at the limit, asking to delete", () => {
    const [report, ...rest] = findings(filesIn(PROBE, LOOSE_FILE_LIMIT), probeCap(CAP));

    expect(rest).toEqual([]);
    expect(report).toContain(
      `has ${String(LOOSE_FILE_LIMIT)} files, within the limit of ${String(LOOSE_FILE_LIMIT)}`,
    );
    expect(report).toContain("Delete the entry");
  });

  it("fails as stale under the limit", () => {
    expect(findings(filesIn(PROBE, 10), probeCap(CAP))).toEqual([
      expect.stringContaining(`has 10 files, within the limit of ${String(LOOSE_FILE_LIMIT)}`),
    ]);
  });

  it("fails as stale once the folder is gone", () => {
    const [report, ...rest] = findings(filesIn("packages/probe/test", 3), probeCap(CAP));

    expect(rest).toEqual([]);
    expect(report).toContain("has no tracked files");
    expect(report).toContain("Delete the entry");
  });

  it("fails as stale when only a fixtures folder holds files", () => {
    expect(findings(filesIn(`${PROBE}/fixtures`, CAP + 5), probeCap(CAP))).toEqual([
      expect.stringContaining("has no tracked files"),
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

  it("caps only the folder a tool writes into", () => {
    expect(folders).toEqual(["apps/web/src/shared/ui"]);
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

const capOf = (folder: string): Cap => {
  const found = CAPS.find((one) => one.folder === folder);
  if (found === undefined) throw new Error(`no cap for ${folder}`);
  return found;
};

const SHARED_UI = capOf("apps/web/src/shared/ui");

describe("the gate over a throwaway repository", () => {
  it("fails a folder over the limit, naming it", () => {
    const ran = spawned(repositoryOf(filesIn(PROBE, LOOSE_FILE_LIMIT + 1)));

    expect(ran.status).toBe(1);
    expect(
      linesOf(ran.stdout).filter((line) =>
        line.startsWith(`${PROBE} has ${String(LOOSE_FILE_LIMIT + 1)} files`),
      ),
    ).toHaveLength(1);
  });

  it("tells a pinned folder over its cap to raise it", () => {
    const ran = spawned(repositoryOf(filesIn(SHARED_UI.folder, SHARED_UI.cap + 1)));

    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain(
      `${SHARED_UI.folder} has ${String(SHARED_UI.cap + 1)} files directly inside it. Its cap in ${WHERE_THE_CAPS_LIVE} is ${String(SHARED_UI.cap)}.`,
    );
    expect(ran.stdout).toContain("because the shadcn CLI writes its components there");
    expect(ran.stdout).toContain(
      `Raise the cap to ${String(SHARED_UI.cap + 1)} in the same change`,
    );
  });

  it("fails a cap its folder has fallen below", () => {
    const held = LOOSE_FILE_LIMIT + 2;
    const ran = spawned(repositoryOf(filesIn(SHARED_UI.folder, held)));

    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain(
      `${SHARED_UI.folder} has ${String(held)} files, fewer than its cap of ${String(SHARED_UI.cap)}`,
    );
    expect(ran.stdout).toContain(`Lower the cap to ${String(held)}`);
  });

  it("fails a cap whose folder is within the limit", () => {
    const ran = spawned(repositoryOf(filesIn(SHARED_UI.folder, LOOSE_FILE_LIMIT - 1)));

    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain(
      `${SHARED_UI.folder} has ${String(LOOSE_FILE_LIMIT - 1)} files, within the limit`,
    );
    expect(ran.stdout).toContain("Delete the entry");
  });

  it("reads tracked files only", () => {
    const ran = spawned(
      repositoryOf(
        filesIn(PROBE, LOOSE_FILE_LIMIT),
        filesIn(PROBE, LOOSE_FILE_LIMIT + 5).slice(LOOSE_FILE_LIMIT),
      ),
    );

    expect(ran.stdout).not.toContain(PROBE);
  });

  it("ignores tracked files that are fixtures", () => {
    const ran = spawned(repositoryOf(filesIn("packages/probe/test/fixtures", 40)));

    expect(ran.stdout).not.toContain("packages/probe");
  });

  it("does not count a tracked file deleted from disk", () => {
    const root = repositoryOf(filesIn(PROBE, LOOSE_FILE_LIMIT + 1));
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
  it("passes with no oversized folder and no stale cap", () => {
    const ran = spawned(repositoryRoot);

    expect(ran.stdout).toMatch(/^all \d+ folders checked hold 25 tracked files or fewer/u);
    expect(ran.status).toBe(0);
  });
});
