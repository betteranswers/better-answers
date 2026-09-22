import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { gitIn, throwawayRepository, writeUnder } from "@better-answers/devtools/throwaway-tree";
import { afterAll, describe, expect, it } from "vitest";

const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
const repositoryRoot = path.join(import.meta.dirname, "../../..");
const landScript = path.join(repositoryRoot, "scripts/land.mjs");

const lefthook = readFileSync(path.join(repositoryRoot, "lefthook.yml"), "utf8");

const subjectCeilingHook = (): string => {
  const block = /\n {4}subject-ceiling:\n {6}run: \|\n(?<body>(?: {8}.*\n|\n)+)/.exec(lefthook);
  const body = block?.groups?.["body"];
  if (body === undefined) {
    throw new Error("lefthook.yml declares no `subject-ceiling` command under `commit-msg`");
  }
  return body.replaceAll(/^ {8}/gm, "");
};

const ceilingIn = (command: string): number => {
  const found = /-gt (?<ceiling>\d+)/.exec(command)?.groups?.["ceiling"];
  if (found === undefined) throw new Error(`the hook compares against no number:\n${command}`);
  return Number(found);
};

const CEILING_IN_LEFTHOOK = ceilingIn(subjectCeilingHook());

const scratch = mkdtempSync(path.join(tmpdir(), "land-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const PR_URL = "https://github.com/betteranswers/better-answers/pull/131";

const queueAnswer = (isInMergeQueue: boolean, enabledAt: string | null): string =>
  JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          isInMergeQueue,
          autoMergeRequest: enabledAt === null ? null : { enabledAt },
        },
      },
    },
  });

type Answers = {
  readonly prList?: string;
  readonly prCreate?: string;
  readonly graphql?: string;
};

type Throwaway = { readonly root: string; readonly bin: string; readonly log: string };

const executable = (at: string, body: string): void => {
  writeFileSync(at, body);
  chmodSync(at, 0o755);
};

const workspace = (name: string, answers: Answers = {}): Throwaway => {
  // A bare repository stands in for origin, so the fetch is real and only the push and the
  // whole of gh are stubbed.
  const origin = path.join(scratch, `${name}-origin.git`);
  mkdirSync(origin, { recursive: true });
  spawnSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const root = throwawayRepository(path.join(scratch, name));
  writeUnder(root, "README.md", "tracked\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-q", "-m", "A throwaway repository stands up with one tracked file in it");
  gitIn(root, "remote", "add", "origin", origin);
  gitIn(root, "push", "-q", "origin", "main");

  // Outside the repository, so `git add -A` inside the run cannot commit the stubs or the log.
  const bin = path.join(scratch, `${name}-bin`);
  const canned = path.join(scratch, `${name}-answers`);
  const log = path.join(scratch, `${name}.log`);
  mkdirSync(bin, { recursive: true });
  mkdirSync(canned, { recursive: true });
  writeFileSync(path.join(canned, "pr-list.json"), answers.prList ?? "[]");
  writeFileSync(path.join(canned, "pr-create.txt"), `${answers.prCreate ?? PR_URL}\n`);
  writeFileSync(
    path.join(canned, "graphql.json"),
    answers.graphql ?? queueAnswer(false, "2026-09-22T09:00:00Z"),
  );

  executable(
    path.join(bin, "git"),
    `#!/bin/sh\nprintf '%s\\n' "git $*" >> "${log}"\nif [ "$1" = "push" ]; then exit 0; fi\nexec ${realGit} "$@"\n`,
  );
  executable(
    path.join(bin, "gh"),
    `#!/bin/sh
printf '%s\\n' "gh $*" >> "${log}"
case "$1 $2" in
  "pr list") cat "${canned}/pr-list.json" ;;
  "pr create") cat "${canned}/pr-create.txt" ;;
  "api graphql") cat "${canned}/graphql.json" ;;
esac
exit 0
`,
  );
  return { root, bin, log };
};

const dirty = (tree: Throwaway): Throwaway => {
  writeUnder(tree.root, "docs/note.md", "a line a reader can see\n");
  return tree;
};

type Run = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

const landIn = (tree: Throwaway, argv: readonly string[]): Run => {
  const result = spawnSync(process.execPath, [landScript, ...argv], {
    cwd: tree.root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${tree.bin}:${process.env["PATH"] ?? ""}` },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const landWith = (tree: Throwaway, message: string): Run => landIn(tree, ["--message", message]);

const logOf = (tree: Throwaway): string =>
  existsSync(tree.log) ? readFileSync(tree.log, "utf8") : "";

const branchOf = (tree: Throwaway): string =>
  gitIn(tree.root, "rev-parse", "--abbrev-ref", "HEAD").trim();

const subjectOf = (tree: Throwaway): string => gitIn(tree.root, "log", "-1", "--format=%s").trim();

const GOOD = "The land command takes a change through the queue [T-332]";
const GOOD_BRANCH = "t-332-land-command-takes-a-change";

const OVER_THE_CEILING = `The land command says what changed ${"and says it again ".repeat(4)}[T-332]`;

const REFUSED_MESSAGES = [
  {
    shape: "a Conventional Commits label",
    directory: "label",
    message: "chore: update the api coding rules again",
    named: "Conventional Commits",
  },
  {
    shape: "a message too short to be a sentence",
    directory: "short",
    message: "Docs updated",
    named: "at least eight",
  },
  {
    shape: "a ticket id written anywhere but the end",
    directory: "stray-ticket",
    message: "T-332 lands a small change through the queue rather than around it",
    named: "a ticket id goes last",
  },
  {
    shape: "a message with no word a branch could carry",
    directory: "nameless",
    message: "— — — — — — — —",
    named: "no word a branch could be named from",
  },
  {
    shape: "a subject over the ceiling",
    directory: "over-the-ceiling",
    message: OVER_THE_CEILING,
    named: `this repository's ceiling is ${String(CEILING_IN_LEFTHOOK)}`,
  },
] as const;

describe("pnpm land over a throwaway repository", () => {
  it("branches off origin's main, commits, pushes, opens the pull request and arms the merge", () => {
    const tree = dirty(workspace("armed"));

    const run = landWith(tree, GOOD);

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("docs/note.md");
    expect(run.stdout).toContain("#131");
    expect(run.stdout).toContain(PR_URL);
    expect(run.stdout).toContain("isInMergeQueue=false");
    expect(run.stdout).toContain("autoMergeRequest.enabledAt=2026-09-22T09:00:00Z");
    expect(branchOf(tree)).toBe(GOOD_BRANCH);
    expect(subjectOf(tree)).toBe(GOOD);
    expect(logOf(tree)).toContain("git fetch origin main");
    expect(logOf(tree)).toContain(`git switch -c ${GOOD_BRANCH} FETCH_HEAD`);
    expect(logOf(tree)).toContain("git push");
    expect(logOf(tree)).toContain("gh pr create --fill");
    expect(logOf(tree)).toContain("gh pr merge --auto --merge 131");
  });

  it("names the branch from the message alone when the message carries no ticket", () => {
    const tree = dirty(workspace("no-ticket"));

    const run = landWith(tree, "The issue tracker note says how a moved ref is pushed to origin");

    expect(run.status).toBe(0);
    expect(branchOf(tree)).toBe("issue-tracker-note-says-how");
  });

  it.each(REFUSED_MESSAGES)(
    "refuses $shape, naming it, and neither branches, commits nor pushes",
    ({ directory, message, named }) => {
      const tree = dirty(workspace(directory));

      const run = landWith(tree, message);

      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain(named);
      expect(branchOf(tree)).toBe("main");
      expect(logOf(tree)).not.toContain("git commit");
      expect(logOf(tree)).not.toContain("git push");
    },
  );

  it("refuses a tree standing anywhere but main, naming where it stands, and pushes nothing", () => {
    const tree = dirty(workspace("off-main"));
    gitIn(tree.root, "switch", "-q", "-c", "a-branch-of-its-own");

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("a-branch-of-its-own");
    expect(logOf(tree)).not.toContain("git commit");
    expect(logOf(tree)).not.toContain("git push");
  });

  it("refuses a branch of the name it would make that already stands, and pushes nothing", () => {
    const tree = dirty(workspace("branch-stands"));
    gitIn(tree.root, "branch", GOOD_BRANCH);

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("already stands here");
    expect(logOf(tree)).not.toContain("git commit");
    expect(logOf(tree)).not.toContain("git push");
  });

  it("refuses a path a session keeps to itself, naming it, and commits nothing", () => {
    const tree = dirty(workspace("session-scratch"));
    writeUnder(tree.root, ".claude/notes.md", "a note this session kept\n");

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(".claude/notes.md");
    expect(logOf(tree)).not.toContain("git commit");
    expect(logOf(tree)).not.toContain("git push");
  });

  it("refuses a clean working tree, naming it, and pushes nothing", () => {
    const tree = workspace("clean");

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("nothing to commit");
    expect(logOf(tree)).not.toContain("git push");
    expect(logOf(tree)).not.toContain("gh pr create");
  });

  it("refuses a branch that already has an open pull request, naming it, and pushes nothing", () => {
    const tree = dirty(workspace("open-pr", { prList: JSON.stringify([{ number: 99 }]) }));

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("#99");
    expect(logOf(tree)).not.toContain("git push");
    expect(logOf(tree)).not.toContain("gh pr create");
  });

  it("reads a pull request number that is not a number as no open pull request", () => {
    const tree = dirty(workspace("string-number", { prList: JSON.stringify([{ number: "99" }]) }));

    const run = landWith(tree, GOOD);

    expect(run.status).toBe(0);
    expect(logOf(tree)).toContain("gh pr create --fill");
  });

  it("refuses a run with no message, naming the usage", () => {
    const tree = dirty(workspace("no-message"));

    const run = landIn(tree, []);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("--message");
    expect(logOf(tree)).not.toContain("git push");
  });

  it("names the command that arms it when the queue read-back says it is neither", () => {
    const tree = dirty(workspace("unarmed", { graphql: queueAnswer(false, null) }));

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain("#131");
    expect(run.stderr).toContain("neither queued nor armed");
    expect(run.stderr).toContain("gh pr merge 131 --auto --merge");
  });

  it("refuses to call the pull request armed when the queue read-back has no answer in it", () => {
    const tree = dirty(workspace("unreadable", { graphql: "{}" }));

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("could not be read back");
    expect(run.stderr).toContain("gh pr merge 131 --auto --merge");
  });

  it("refuses to call the pull request armed when the read-back says it is queued by a word", () => {
    const tree = dirty(
      workspace("worded", { graphql: queueAnswer(true, null).replace("true", '"yes"') }),
    );

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("could not be read back");
  });

  it("holds every commit to the same ceiling through lefthook, over a message file both ways", () => {
    const messages = path.join(scratch, "commit-msg");
    mkdirSync(messages, { recursive: true });
    const hook = subjectCeilingHook();
    const over = `${OVER_THE_CEILING}\n\nA paragraph saying what changed and why.\n`;
    const under = `${GOOD}\n\nA paragraph saying what changed and why.\n`;

    const ranOver = path.join(messages, "over");
    const ranUnder = path.join(messages, "under");
    writeFileSync(ranOver, over);
    writeFileSync(ranUnder, under);
    const refused = spawnSync("sh", ["-c", hook.replace("{1}", ranOver)], { encoding: "utf8" });
    const taken = spawnSync("sh", ["-c", hook.replace("{1}", ranUnder)], { encoding: "utf8" });

    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain(`ceiling is ${String(CEILING_IN_LEFTHOOK)}`);
    expect(refused.stdout).toContain(String(OVER_THE_CEILING.length));
    expect(taken.status).toBe(0);
    expect(taken.stdout).toBe("");
  });

  it("says the pull request is queued when the read-back says so", () => {
    const tree = dirty(workspace("queued", { graphql: queueAnswer(true, null) }));

    const run = landWith(tree, GOOD);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("isInMergeQueue=true");
    expect(run.stdout).toContain("autoMergeRequest.enabledAt=none");
  });
});
