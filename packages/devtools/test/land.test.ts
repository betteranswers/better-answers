import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

const commitMsgHook = (): string => {
  const command = /\ncommit-msg:\n {2}commands:\n {4}commitlint:\n {6}run: (?<run>.+)\n/.exec(
    lefthook,
  )?.groups?.["run"];
  if (command === undefined) {
    throw new Error("lefthook.yml declares no `commitlint` command under `commit-msg`");
  }
  return command;
};

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
  readonly pushFails?: boolean;
};

type Throwaway = { readonly root: string; readonly bin: string; readonly log: string };

const executable = (at: string, body: string): void => {
  writeFileSync(at, body);
  chmodSync(at, 0o755);
};

const workspace = (name: string, answers: Answers = {}): Throwaway => {
  /**
   * A bare repository stands in for origin, so the fetch is real and only the push and the
   * whole of gh are stubbed.
   */
  const origin = path.join(scratch, `${name}-origin.git`);
  mkdirSync(origin, { recursive: true });
  spawnSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const root = throwawayRepository(path.join(scratch, name));
  writeUnder(root, "README.md", "tracked\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-q", "-m", "A throwaway repository stands up with one tracked file in it");
  gitIn(root, "remote", "add", "origin", origin);
  gitIn(root, "push", "-q", "origin", "main");

  /** The stubs, answers and log sit outside the repository, so `git add -A` cannot commit them. */
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
    `#!/bin/sh\nprintf '%s\\n' "git $*" >> "${log}"\nif [ "$1" = "push" ]; then exit ${answers.pushFails === true ? "1" : "0"}; fi\nexec ${realGit} "$@"\n`,
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

/**
 * The stubs and the log sit outside the repository, so a linked worktree borrows them
 * unchanged and only the working directory moves.
 */
const linked = (tree: Throwaway, branch: string): Throwaway => {
  const root = path.join(scratch, `${branch}-worktree`);
  gitIn(tree.root, "worktree", "add", "-q", "-b", branch, root);
  return { ...tree, root };
};

type Run = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

const ranOf = (result: SpawnSyncReturns<string>): Run => ({
  status: result.status,
  stdout: result.stdout,
  stderr: result.stderr,
});

const landIn = (tree: Throwaway, argv: readonly string[], script = landScript): Run =>
  ranOf(
    spawnSync(process.execPath, [script, ...argv], {
      cwd: tree.root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${tree.bin}:${process.env["PATH"] ?? ""}` },
    }),
  );

const landWith = (tree: Throwaway, message: string): Run => landIn(tree, ["--message", message]);

const logOf = (tree: Throwaway): string =>
  existsSync(tree.log) ? readFileSync(tree.log, "utf8") : "";

const branchOf = (tree: Throwaway): string =>
  gitIn(tree.root, "rev-parse", "--abbrev-ref", "HEAD").trim();

const messageOf = (tree: Throwaway): string => gitIn(tree.root, "log", "-1", "--format=%B").trim();

const GOOD_SUBJECT = "feat(devtools): take a change through the queue";
const GOOD = `${GOOD_SUBJECT}\n\nA paragraph saying what changed and why.\n\nRefs: T-332`;
const GOOD_BRANCH = "t-332-take-a-change-through-the";

const DECLARATIVE = "The land command takes a change through the queue";
const TICKET_IN_THE_SUBJECT = `${GOOD_SUBJECT} [T-332]`;
const OVER_THE_CEILING = `docs: say what changed${" and say it again".repeat(3)}`;
const AT_THE_CEILING = OVER_THE_CEILING.slice(0, 72);

const REFUSED_BY_COMMITLINT = [
  {
    shape: "a declarative subject",
    directory: "declarative",
    message: DECLARATIVE,
    named: "[type-empty]",
  },
  {
    shape: "a ticket id in the subject",
    directory: "ticket-in-the-subject",
    message: TICKET_IN_THE_SUBJECT,
    named: "[header-names-no-ticket]",
  },
  {
    shape: "a subject over 72 characters",
    directory: "over-the-ceiling",
    message: OVER_THE_CEILING,
    named: "[header-max-length]",
  },
  {
    shape: "a capital in the summary",
    directory: "capital",
    message: "docs: say how CI reads the title",
    named: "[subject-case]",
  },
  {
    shape: "a type off the list",
    directory: "style",
    message: "style: tidy the land command",
    named: "[type-enum]",
  },
  {
    shape: "a scope off the list",
    directory: "unscoped",
    message: "feat(land): take a change through the queue",
    named: "[scope-enum]",
  },
] as const;

const REFUSED_MESSAGES = [
  ...REFUSED_BY_COMMITLINT,
  {
    shape: "a wordless summary",
    directory: "nameless",
    message: "docs: — — —",
    named: "no word a branch could be named from",
  },
] as const;

describe("pnpm land over a throwaway repository", () => {
  it("branches, commits, pushes, opens the pull request and arms it", () => {
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
    expect(messageOf(tree)).toBe(GOOD);
    expect(logOf(tree)).toContain("git fetch origin main");
    expect(logOf(tree)).toContain(`git switch -c ${GOOD_BRANCH} FETCH_HEAD`);
    expect(logOf(tree)).toContain("git push");
    expect(logOf(tree)).toContain("gh pr create --fill");
    expect(logOf(tree)).toContain("gh pr merge --auto --merge 131");
  });

  it.each([
    {
      shape: "a message with no footer",
      directory: "no-footer",
      message: "docs: say how a moved ref is pushed to origin",
      branch: "say-how-a-moved-ref",
    },
    {
      shape: "a backticked name and punctuation",
      directory: "punctuated",
      message: "docs: say it's `CI`'s (pull request) title check",
      branch: "say-it-s-ci-s-pull-request",
    },
    {
      shape: "a summary opening on punctuation",
      directory: "opening-dash",
      message: "docs: (re)state how `CI` reads the title",
      branch: "re-state-how-ci-reads-the",
    },
    {
      shape: "a passing mention in the body",
      directory: "in-passing",
      message: "docs: say how a moved ref is pushed\n\nThe old form put Refs: T-100 nowhere.",
      branch: "say-how-a-moved-ref",
    },
    {
      shape: "a footer under a wordless summary",
      directory: "footer-alone",
      message: "docs: — — —\n\nA paragraph saying what changed.\n\nRefs: T-332",
      branch: "t-332",
    },
  ])("names the branch for $shape", ({ directory, message, branch }) => {
    const tree = dirty(workspace(directory));

    const run = landWith(tree, message);

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(branchOf(tree)).toBe(branch);
  });

  it("relays commitlint's warnings and lands the message anyway", () => {
    const tree = dirty(workspace("warned"));

    const run = landWith(tree, `${GOOD_SUBJECT}\nA body with no blank line above it.`);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("[body-leading-blank]");
    expect(branchOf(tree)).toBe("take-a-change-through-the");
  });

  it.each(REFUSED_MESSAGES)("refuses $shape and lands nothing", ({ directory, message, named }) => {
    const tree = dirty(workspace(directory));

    const run = landWith(tree, message);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain(named);
    expect(branchOf(tree)).toBe("main");
    expect(logOf(tree)).not.toContain("git commit");
    expect(logOf(tree)).not.toContain("git push");
  });

  it("stops at a failed push and opens no pull request", () => {
    const tree = dirty(workspace("push-fails", { pushFails: true }));

    const run = landWith(tree, GOOD);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`git push -u origin ${GOOD_BRANCH} failed`);
    expect(logOf(tree)).not.toContain("gh pr create");
  });

  it("takes a linked worktree's uncommitted change", () => {
    const worktree = linked(dirty(workspace("a-worktree")), "a-branch-of-its-own");
    writeUnder(worktree.root, "docs/note.md", "a line the worktree can see\n");

    const run = landWith(worktree, GOOD);

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("docs/note.md");
    expect(branchOf(worktree)).toBe(GOOD_BRANCH);
    expect(messageOf(worktree)).toBe(GOOD);
  });

  it("takes a detached head at origin's main", () => {
    const tree = dirty(workspace("detached"));
    gitIn(tree.root, "checkout", "-q", "--detach");

    const run = landWith(tree, GOOD);

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(branchOf(tree)).toBe(GOOD_BRANCH);
    expect(messageOf(tree)).toBe(GOOD);
  });

  it("commits a head behind origin's main onto the fetched head", () => {
    const tree = workspace("behind");
    const newer = "A commit origin's main carries and this tree has not seen";
    gitIn(tree.root, "commit", "-q", "--allow-empty", "-m", newer);
    gitIn(tree.root, "push", "-q", "origin", "main");
    gitIn(tree.root, "reset", "--hard", "-q", "HEAD~1");
    dirty(tree);

    const run = landWith(tree, GOOD);

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(messageOf(tree)).toBe(GOOD);
    expect(gitIn(tree.root, "log", "-1", "--format=%s", "HEAD~1").trim()).toBe(newer);
  });

  it.each([
    { held: 1, directory: "ahead-by-one", counted: "1 commit that" },
    { held: 2, directory: "ahead-by-two", counted: "2 commits that" },
  ])("refuses and counts a head $held ahead of origin's main", ({ held, directory, counted }) => {
    const tree = workspace(directory);
    for (let made = 0; made < held; made += 1) {
      gitIn(tree.root, "commit", "-q", "--allow-empty", "-m", `A commit this tree kept ${held}`);
    }
    dirty(tree);

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(counted);
    expect(logOf(tree)).not.toContain("git commit");
    expect(logOf(tree)).not.toContain("git push");
  });

  it("names a change it cannot carry onto origin's head", () => {
    const tree = workspace("overwritten");
    writeUnder(tree.root, "README.md", "the line origin's main carries\n");
    gitIn(tree.root, "add", "-A");
    gitIn(tree.root, "commit", "-q", "-m", "A line origin's main carries and this tree has not");
    gitIn(tree.root, "push", "-q", "origin", "main");
    gitIn(tree.root, "reset", "--hard", "-q", "HEAD~1");
    writeUnder(tree.root, "README.md", "the line this tree carries\n");

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("could not be carried onto origin/main's head");
    expect(run.stderr).toContain("README.md");
    expect(logOf(tree)).not.toContain("git push");
  });

  it("refuses a branch name that already stands", () => {
    const tree = dirty(workspace("branch-stands"));
    gitIn(tree.root, "branch", GOOD_BRANCH);

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("already stands here");
    expect(logOf(tree)).not.toContain("git commit");
    expect(logOf(tree)).not.toContain("git push");
  });

  it.each([
    { shape: "a session's own note", directory: "session-claude", path: ".claude/notes.md" },
    { shape: "a scratch working file", directory: "session-scratch", path: ".scratch/map.md" },
  ])("refuses $shape untracked under a kept folder", (kept) => {
    const tree = dirty(workspace(kept.directory));
    writeUnder(tree.root, kept.path, "a line this session kept\n");

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(kept.path);
    expect(logOf(tree)).not.toContain("git commit");
    expect(logOf(tree)).not.toContain("git push");
  });

  it("takes a file this repository tracks under .claude", () => {
    const tree = workspace("tracked-claude");
    const hook = ".claude/hooks/provision-worktree.sh";
    writeUnder(tree.root, hook, "#!/bin/sh\nexit 0\n");
    gitIn(tree.root, "add", "-A");
    gitIn(tree.root, "commit", "-q", "-m", "A hook this repository tracks stands under .claude");
    gitIn(tree.root, "push", "-q", "origin", "main");
    writeUnder(tree.root, hook, "#!/bin/sh\nexit 1\n");

    const run = landWith(tree, GOOD);

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(hook);
    expect(gitIn(tree.root, "show", "--name-only", "--format=", "HEAD")).toContain(hook);
  });

  it("refuses a clean working tree, naming it, and pushes nothing", () => {
    const tree = workspace("clean");

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("nothing to commit");
    expect(logOf(tree)).not.toContain("git push");
    expect(logOf(tree)).not.toContain("gh pr create");
  });

  it("refuses a branch with an open pull request, naming it", () => {
    const tree = dirty(workspace("open-pr", { prList: JSON.stringify([{ number: 99 }]) }));

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("#99");
    expect(logOf(tree)).not.toContain("git push");
    expect(logOf(tree)).not.toContain("gh pr create");
  });

  it("reads a non-numeric pull request number as none open", () => {
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

  it("names the arming command when neither queued nor armed", () => {
    const tree = dirty(workspace("unarmed", { graphql: queueAnswer(false, null) }));

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain("#131");
    expect(run.stderr).toContain("neither queued nor armed");
    expect(run.stderr).toContain("gh pr merge 131 --auto --merge");
  });

  it("refuses an empty queue read-back, naming the arming command", () => {
    const tree = dirty(workspace("unreadable", { graphql: "{}" }));

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("could not be read back");
    expect(run.stderr).toContain("gh pr merge 131 --auto --merge");
  });

  it("refuses a read-back whose queue flag is a word", () => {
    const tree = dirty(
      workspace("worded", { graphql: queueAnswer(true, null).replace("true", '"yes"') }),
    );

    const run = landWith(tree, GOOD);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("could not be read back");
  });

  it("names commitlint when it is not installed, and lands nothing", () => {
    const checkout = path.join(scratch, "uninstalled-checkout");
    for (const copied of [
      "scripts/land.mjs",
      "packages/devtools/package.json",
      "packages/devtools/src",
    ]) {
      cpSync(path.join(repositoryRoot, copied), path.join(checkout, copied), { recursive: true });
    }
    symlinkSync(
      path.join(repositoryRoot, "packages/devtools/node_modules"),
      path.join(checkout, "packages/devtools/node_modules"),
    );
    const tree = dirty(workspace("uninstalled"));

    const run = landIn(tree, ["--message", GOOD], path.join(checkout, "scripts/land.mjs"));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("commitlint could not run from");
    expect(run.stderr).toContain("node_modules/.bin/commitlint");
    expect(run.stderr).toContain("pnpm install");
    expect(logOf(tree)).not.toContain("git commit");
    expect(logOf(tree)).not.toContain("git push");
  });

  it("says the pull request is queued when the read-back does", () => {
    const tree = dirty(workspace("queued", { graphql: queueAnswer(true, null) }));

    const run = landWith(tree, GOOD);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("isInMergeQueue=true");
    expect(run.stdout).toContain("autoMergeRequest.enabledAt=none");
  });
});

/** lefthook runs a command from the repository root, `{1}` standing for the message file's path. */
const hooked = (name: string): string => {
  const root = throwawayRepository(path.join(scratch, name));
  const hooks = path.join(scratch, `${name}-hooks`);
  mkdirSync(hooks, { recursive: true });
  executable(
    path.join(hooks, "commit-msg"),
    `#!/bin/sh
message="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cd '${repositoryRoot}' || exit 1
${commitMsgHook().replaceAll("{1}", '"$message"')}
`,
  );
  gitIn(root, "config", "core.hooksPath", hooks);
  writeUnder(root, "README.md", "tracked\n");
  gitIn(root, "add", "-A");
  return root;
};

const commitIn = (root: string, message: string): Run =>
  ranOf(spawnSync("git", ["-C", root, "commit", "-q", "-m", message], { encoding: "utf8" }));

describe("lefthook's commit-msg hook over a throwaway repository", () => {
  it.each([
    { shape: "a Conventional message with a footer", directory: "hook-good", message: GOOD },
    { shape: "a subject of 72 characters", directory: "hook-at", message: AT_THE_CEILING },
  ])("commits $shape", ({ directory, message }) => {
    const root = hooked(directory);

    const run = commitIn(root, message);

    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(gitIn(root, "log", "-1", "--format=%B").trim()).toBe(message);
  });

  it.each(REFUSED_BY_COMMITLINT)(
    "refuses $shape, naming its rule",
    ({ directory, message, named }) => {
      const root = hooked(`hook-${directory}`);

      const run = commitIn(root, message);

      expect(run.status).not.toBe(0);
      expect(`${run.stdout}${run.stderr}`).toContain(named);
      expect(gitIn(root, "rev-list", "--all", "--count").trim()).toBe("0");
    },
  );
});
