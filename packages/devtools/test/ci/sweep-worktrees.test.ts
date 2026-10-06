import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { gitIn, writeUnder } from "@better-answers/devtools/throwaway-tree";
import {
  commitIn,
  hookScript,
  mergeOnOrigin,
  originAndClone,
  recordsItsArgv,
  runHook,
  scratchRoot,
  stubsOnPath,
  worktreeUnder,
  type HookRun,
} from "@better-answers/devtools/worktree-hooks";

const sweep = hookScript("sweep-worktrees");

const scratch = scratchRoot("sweep-worktrees");

const LONG_AGO = "2026-01-01T00:00:00Z";

const NAMES = [
  "merged",
  "fresh",
  "recent",
  "untracked",
  "unmerged",
  "squashed",
  "locked",
  "elsewhere",
] as const;

type Name = (typeof NAMES)[number];

type Estate = {
  readonly primary: string;
  readonly worktrees: Readonly<Record<Name, string>>;
  readonly log: string;
  readonly run: HookRun;
};

/** jCodeMunch names each worktree `local/<name>`; gh says `t-squashed`'s head merged by squash. */
const stubTools = (
  primary: string,
  worktrees: Readonly<Record<Name, string>>,
  squashedHead: string,
  log: string,
): string => {
  const registry = JSON.stringify(
    NAMES.map((name) => ({ repo_id: `local/${name}`, source_root: realpathSync(worktrees[name]) })),
  );
  const under = path.dirname(realpathSync(worktrees.fresh));
  const docIndexes = JSON.stringify({
    repos: [
      { repo: "local/estate-primary", source_root: realpathSync(primary) },
      { repo: "local/fresh-worktree", source_root: realpathSync(worktrees.fresh) },
      { repo: "local/orphan", source_root: path.join(under, "orphan") },
      { repo: "local/gone-elsewhere", source_root: path.join(scratch, "gone-elsewhere") },
    ],
  });
  const merged = JSON.stringify([{ headRefOid: squashedHead, mergedAt: LONG_AGO }]);
  return stubsOnPath(path.join(scratch, "bin"), {
    "jcodemunch-mcp": recordsItsArgv(log, [`[ "$1" = list-repos ] && printf '%s' '${registry}'`]),
    "jdocmunch-mcp": recordsItsArgv(`${log}-doc`, [
      `[ "$1" = watch-status ] && printf '%s' '${docIndexes}'`,
      `[ "$1" = index-local ] && printf '{"success": true}'`,
    ]),
    gh: `case "$*" in *"--head t-squashed"*) printf '%s' '${merged}' ;; *) printf '[]' ;; esac\n`,
  });
};

/** One worktree per case, under the main checkout's `.claude/worktrees/` but for `elsewhere`. */
const arrangeAndSweep = (): Estate => {
  const { origin, primary } = originAndClone(scratch, "estate", { "README.md": "# estate\n" });
  const under = path.join(primary, ".claude/worktrees");
  const at = (name: Name): string => worktreeUnder(under, primary, name);
  const worktrees: Record<Name, string> = {
    merged: at("merged"),
    fresh: at("fresh"),
    recent: at("recent"),
    untracked: at("untracked"),
    unmerged: at("unmerged"),
    squashed: at("squashed"),
    locked: at("locked"),
    elsewhere: worktreeUnder(scratch, primary, "elsewhere"),
  };

  for (const name of ["merged", "untracked", "locked", "elsewhere"] as const) {
    commitIn(worktrees[name], `${name}.txt`);
    mergeOnOrigin(origin, primary, `t-${name}`, LONG_AGO);
  }
  commitIn(worktrees.recent, "recent.txt");
  mergeOnOrigin(origin, primary, "t-recent");
  commitIn(worktrees.unmerged, "unmerged.txt");
  const squashedHead = commitIn(worktrees.squashed, "squashed.txt");
  writeUnder(worktrees.untracked, "half-done.txt", "work in progress\n");
  gitIn(primary, "worktree", "lock", worktrees.locked);

  const log = path.join(scratch, "jcodemunch-argv");
  const bin = stubTools(primary, worktrees, squashedHead, log);
  const run = runHook(sweep, {
    argv: [primary],
    env: {
      PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
      DOC_INDEX_PATH: path.join(scratch, "doc-store"),
    },
  });
  return { primary, worktrees, log, run };
};

const branchListed = (primary: string, branch: string): boolean =>
  gitIn(primary, "branch", "--list", branch).trim() !== "";

describe("the sweep over worktrees left beside running agents", () => {
  let estate: Estate;
  beforeAll(() => {
    estate = arrangeAndSweep();
  }, 60_000);

  it("exits 0 over an estate it partly keeps", () => {
    expect(estate.run.status).toBe(0);
  });

  it("removes a clean worktree merged over an hour ago", () => {
    expect(existsSync(estate.worktrees.merged)).toBe(false);
  });

  it("deletes the branch of a merged worktree it removed", () => {
    expect(branchListed(estate.primary, "t-merged")).toBe(false);
  });

  it("removes a worktree whose exact head a pull request merged", () => {
    expect(existsSync(estate.worktrees.squashed)).toBe(false);
  });

  it("leaves a squash-merged branch for git branch -d to refuse", () => {
    expect(branchListed(estate.primary, "t-squashed")).toBe(true);
  });

  it("drops the jCodeMunch index of each removed worktree, no other", () => {
    const dropped = readFileSync(estate.log, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("delete-index"));
    expect(dropped).toEqual(["delete-index local/merged", "delete-index local/squashed"]);
  });

  it("drops each doc index whose worktree folder is gone", () => {
    const dropped = readFileSync(`${estate.log}-doc`, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("delete-index"));
    expect(dropped).toEqual([
      "delete-index --repo local/merged-worktree",
      "delete-index --repo local/squashed-worktree",
      "delete-index --repo local/orphan",
    ]);
    expect(estate.run.stderr).toContain("jdocmunch: dropped the index local/orphan");
  });

  it("refreshes the main checkout's doc index in place", () => {
    const refreshed = readFileSync(`${estate.log}-doc`, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("index-local"));
    expect(refreshed).toEqual([
      `index-local --path ${realpathSync(estate.primary)} --no-ai-summaries --no-embeddings`,
    ]);
    expect(estate.run.stderr).toContain("jdocmunch: refreshed the index local/estate-primary");
  });

  it.each([
    ["a fresh worktree, holding no commit of its own", "fresh"],
    ["a worktree merged under an hour ago", "recent"],
    ["a merged worktree holding untracked files", "untracked"],
    ["a worktree whose commits nothing merged", "unmerged"],
    ["a locked worktree", "locked"],
    ["a merged worktree outside .claude/worktrees", "elsewhere"],
  ] as const)("keeps %s", (_, name) => {
    expect(existsSync(estate.worktrees[name])).toBe(true);
  });
});

/** A hook the desktop client starts inherits launchd's PATH, which holds no user tool folder. */
describe("the sweep under a PATH without the user's tool folders", () => {
  let docLog: string;
  let run: HookRun;
  beforeAll(() => {
    const { primary } = originAndClone(scratch, "bare", { "README.md": "# bare\n" });
    const home = path.join(scratch, "bare-home");
    docLog = path.join(scratch, "bare-doc-argv");
    mkdirSync(path.join(home, ".local"), { recursive: true });
    stubsOnPath(path.join(home, ".local/bin"), {
      "jdocmunch-mcp": recordsItsArgv(docLog, [`[ "$1" = watch-status ] && printf '{"repos":[]}'`]),
    });
    run = runHook(sweep, {
      argv: [primary],
      env: { HOME: home, PATH: "/usr/bin:/bin", DOC_INDEX_PATH: path.join(scratch, "bare-store") },
    });
  }, 60_000);

  it("finds jdocmunch-mcp in the user's ~/.local/bin", () => {
    expect(run.status).toBe(0);
    expect(readFileSync(docLog, "utf8")).toContain("watch-status");
  });

  it("creates no doc index where the main checkout had none", () => {
    expect(readFileSync(docLog, "utf8")).not.toContain("index-local");
  });
});

describe("the sweep when jdocmunch-mcp refuses the refresh", () => {
  it("says the refresh failed, though the tool exited 0", () => {
    const { primary } = originAndClone(scratch, "refused", { "README.md": "# refused\n" });
    const indexes = JSON.stringify({
      repos: [{ repo: "local/refused-primary", source_root: realpathSync(primary) }],
    });
    const bin = stubsOnPath(path.join(scratch, "refused-bin"), {
      "jdocmunch-mcp": [
        `[ "$1" = watch-status ] && printf '%s' '${indexes}'`,
        `[ "$1" = index-local ] && printf '{"success": false}'`,
        "exit 0",
        "",
      ].join("\n"),
    });
    const run = runHook(sweep, {
      argv: [primary],
      env: { PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}` },
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain("jdocmunch: could not refresh local/refused-primary");
  }, 60_000);
});

const jdocmunchInstalled = spawnSync("jdocmunch-mcp", ["--version"]).status === 0;

/** Real jdocmunch-mcp over a private store, which no watcher watches: an outage by construction. */
describe.skipIf(!jdocmunchInstalled)("the sweep after docs change through git unwatched", () => {
  const indexSchema = z.object({ sections: z.array(z.object({ title: z.string() })) });
  const titles = (store: string, name: string): string[] =>
    indexSchema
      .parse(JSON.parse(readFileSync(path.join(store, "local", `${name}.json`), "utf8")))
      .sections.map((section) => section.title);
  let store: string;
  let name: string;
  let before: string[];
  let swept: HookRun;
  beforeAll(() => {
    const { primary } = originAndClone(scratch, "docs", {
      "guide.md": "# Guide\n\n## Old heading\n\ntext\n",
    });
    store = path.join(scratch, "docs-store");
    name = path.basename(primary);
    const env = { ...process.env, DOC_INDEX_PATH: store };
    const flags = ["--no-ai-summaries", "--no-embeddings"];
    spawnSync("jdocmunch-mcp", ["index-local", "--path", primary, ...flags], { env });
    gitIn(primary, "switch", "-q", "-c", "side");
    writeUnder(primary, "guide.md", "# Guide\n\n## New heading\n\ntext\n");
    gitIn(primary, "commit", "-q", "-am", "rename the heading");
    gitIn(primary, "switch", "-q", "-");
    gitIn(primary, "merge", "-q", "--ff-only", "side");
    before = titles(store, name);
    swept = runHook(sweep, { argv: [primary], env: { DOC_INDEX_PATH: store } });
  }, 120_000);

  it("leaves the main checkout's outline matching the files on disk", () => {
    expect(before).toContain("Old heading");
    expect(titles(store, name)).toContain("New heading");
    expect(titles(store, name)).not.toContain("Old heading");
    expect(swept.stderr).toContain(`jdocmunch: refreshed the index local/${name}`);
  });
});
