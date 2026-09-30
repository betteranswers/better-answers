import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";
import { gitIn, throwawayRepository, writeUnder } from "@better-answers/devtools/throwaway-tree";

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

const scratch = mkdtempSync(path.join(tmpdir(), "commit-msg-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const GOOD_SUBJECT = "feat(devtools): take a change through the queue";
const GOOD = `${GOOD_SUBJECT}\n\nA paragraph saying what changed and why.\n\nRefs: T-332`;
const OVER_THE_CEILING = `docs: say what changed${" and say it again".repeat(3)}`;
const AT_THE_CEILING = OVER_THE_CEILING.slice(0, 72);

const REFUSED_BY_COMMITLINT = [
  {
    shape: "a declarative subject",
    directory: "declarative",
    message: "The hook takes a change through the queue",
    named: "[type-empty]",
  },
  {
    shape: "a ticket id in the subject",
    directory: "ticket-in-the-subject",
    message: `${GOOD_SUBJECT} [T-332]`,
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
    message: "style: tidy the hook",
    named: "[type-enum]",
  },
  {
    shape: "a scope off the list",
    directory: "unscoped",
    message: "feat(hook): take a change through the queue",
    named: "[scope-enum]",
  },
] as const;

/** lefthook runs a command from the repository root, `{1}` standing for the message file's path. */
const hooked = (name: string): string => {
  const root = throwawayRepository(path.join(scratch, name));
  const hooks = path.join(scratch, `${name}-hooks`);
  mkdirSync(hooks, { recursive: true });
  const hook = path.join(hooks, "commit-msg");
  writeFileSync(
    hook,
    `#!/bin/sh
message="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cd '${repositoryRoot}' || exit 1
${commitMsgHook().replaceAll("{1}", '"$message"')}
`,
  );
  chmodSync(hook, 0o755);
  gitIn(root, "config", "core.hooksPath", hooks);
  writeUnder(root, "README.md", "tracked\n");
  gitIn(root, "add", "-A");
  return root;
};

const commitIn = (root: string, message: string): SpawnSyncReturns<string> =>
  spawnSync("git", ["-C", root, "commit", "-q", "-m", message], { encoding: "utf8" });

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
