import { spawnSync } from "node:child_process";

import { flagValues } from "./flags.ts";

const USAGE =
  'usage: land --message "<a sentence saying what changed, a ticket id last in brackets>"';

const MINIMUM_WORDS = 8;
const SLUG_WORDS = 5;
const BASE = "main";

const KEPT_BY_THE_SESSION = [".claude/", ".scratch/"];

const CONVENTIONAL_LABEL = /^[a-z]+(\([^)]*\))?!?:/;
const TICKET_ANYWHERE = /\bT-\d+\b/;
const TICKET_AT_THE_END = /\s\[(T-\d+)\]$/;
const LEADING_ARTICLE = /^(the|a|an)$/i;

const PULL_REQUEST_ADDRESS = /(https:\/\/\S*?\/pull\/(\d+))/g;

const QUEUE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      isInMergeQueue
      autoMergeRequest { enabledAt }
    }
  }
}`;

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const complain = (line: string): void => {
  process.stderr.write(`land: ${line}\n`);
};

const wordsOf = (subject: string): readonly string[] =>
  subject.split(/\s+/).filter((word) => word.length > 0);

const proseRefusal = (subject: string): string | undefined => {
  if (CONVENTIONAL_LABEL.test(subject)) {
    return `the message opens with a Conventional Commits label; this repository writes a sentence saying what changed — ${USAGE}`;
  }
  const words = wordsOf(subject);
  if (words.length < MINIMUM_WORDS) {
    return `the message is ${String(words.length)} words; a sentence saying what changed runs to at least eight`;
  }
  if (TICKET_ANYWHERE.test(subject) && !TICKET_AT_THE_END.test(subject)) {
    return "the message names a ticket somewhere other than its end; a ticket id goes last, in brackets, so the merge commit and the branch can both be read off it";
  }
  return undefined;
};

const branchFor = (subject: string): string => {
  const ticket = TICKET_AT_THE_END.exec(subject)?.[1];
  const words = wordsOf(subject.replace(TICKET_AT_THE_END, ""));
  const first = words[0];
  const named = first !== undefined && LEADING_ARTICLE.test(first) ? words.slice(1) : words;
  const slug = named
    .slice(0, SLUG_WORDS)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ticket === undefined ? slug : `${ticket.toLowerCase()}-${slug}`;
};

type Ran = { readonly status: number | null; readonly out: string; readonly err: string };

const run = (command: string, args: readonly string[]): Ran => {
  const result = spawnSync(command, [...args], { encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}`, err: `${result.stderr}` };
};

const runOrComplain = (command: string, args: readonly string[]): Ran | undefined => {
  const ran = run(command, args);
  if (ran.status === 0) return ran;
  complain(`${command} ${args.join(" ")} failed:\n${ran.out}${ran.err}`);
  return undefined;
};

type Step = readonly [string, ...string[]];

const runInOrder = (steps: readonly Step[]): boolean => {
  for (const [command, ...args] of steps) {
    if (runOrComplain(command, args) === undefined) return false;
  }
  return true;
};

const pathsIn = (porcelain: string): readonly string[] =>
  porcelain
    .split("\n")
    .filter((line) => line.length > 3)
    .map((line) => {
      const named = line.slice(3);
      const renamed = named.lastIndexOf(" -> ");
      const one = renamed === -1 ? named : named.slice(renamed + 4);
      return one.startsWith('"') && one.endsWith('"') ? one.slice(1, -1) : one;
    });

type OpenNumbers = { readonly open: readonly number[] } | { readonly unreadable: string };

const openNumbersIn = (output: string): OpenNumbers => {
  try {
    const parsed: unknown = JSON.parse(output);
    if (!Array.isArray(parsed)) {
      return { unreadable: "gh listed the branch's pull requests as something that is not a list" };
    }
    const rows: readonly unknown[] = parsed;
    const open: number[] = [];
    for (const row of rows) {
      if (typeof row !== "object" || row === null || !("number" in row)) continue;
      const found: unknown = row.number;
      if (typeof found === "number") open.push(found);
    }
    return { open };
  } catch (cause) {
    return {
      unreadable: `gh listed the branch's pull requests as something that is not JSON: ${String(cause)}`,
    };
  }
};

type PullRequest = { readonly number: number; readonly address: string };

const addressIn = (output: string): PullRequest | undefined => {
  const found = [...output.matchAll(PULL_REQUEST_ADDRESS)];
  const last = found[found.length - 1];
  const address = last?.[1];
  const number = Number(last?.[2]);
  return address === undefined || !Number.isInteger(number) ? undefined : { number, address };
};

type QueueState = { readonly isInMergeQueue: boolean; readonly enabledAt: string | undefined };

const queueStateIn = (output: string): QueueState | undefined => {
  try {
    const parsed: unknown = JSON.parse(output);

    // SAFETY: every field below is checked with `typeof`, so an answer of another shape is
    // refused rather than reported as a queue state.
    const answer = parsed as {
      readonly data?: {
        readonly repository?: {
          readonly pullRequest?: {
            readonly isInMergeQueue?: boolean;
            readonly autoMergeRequest?: { readonly enabledAt?: string } | null;
          } | null;
        } | null;
      };
    };
    const pull = answer.data?.repository?.pullRequest;
    if (pull === undefined || pull === null) return undefined;
    const queued = pull.isInMergeQueue;
    if (typeof queued !== "boolean") return undefined;
    const enabledAt = pull.autoMergeRequest?.enabledAt;
    return {
      isInMergeQueue: queued,
      enabledAt: typeof enabledAt === "string" ? enabledAt : undefined,
    };
  } catch {
    // gh answered with something other than JSON, which is no queue state to report.
    return undefined;
  }
};

export const land = (argv: readonly string[]): number => {
  const message = flagValues(argv)?.get("message");
  if (message === undefined) {
    complain(USAGE);
    return 2;
  }
  const subject = message.split("\n")[0] ?? "";
  const refused = proseRefusal(subject);
  if (refused !== undefined) {
    complain(refused);
    return 2;
  }
  const branch = branchFor(subject);
  if (branch.length === 0) {
    complain("the message carries no word a branch could be named from");
    return 2;
  }

  const head = runOrComplain("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (head === undefined) return 1;
  const standing = head.out.trim();
  if (standing !== BASE) {
    complain(
      `the tree stands on ${standing}; land takes a change that sits on ${BASE}, so the branch it makes carries this change and nothing else`,
    );
    return 2;
  }

  // The default collapses a new directory to one line, and a path this never sees is one it
  // can neither show nor keep out.
  const working = runOrComplain("git", ["status", "--porcelain", "--untracked-files=all"]);
  if (working === undefined) return 1;
  const paths = pathsIn(working.out);
  if (paths.length === 0) {
    complain("nothing to commit; the working tree is clean");
    return 2;
  }
  const kept = paths.filter((one) => KEPT_BY_THE_SESSION.some((under) => one.startsWith(under)));
  if (kept.length > 0) {
    complain(`a session keeps these to itself and they never land: ${kept.join(", ")}`);
    return 2;
  }
  say(`landing ${String(paths.length)} paths on a branch named ${branch}:`);
  for (const one of paths) say(`  ${one}`);

  if (run("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0) {
    complain(`branch ${branch} already stands here; delete it, or say it in other words`);
    return 2;
  }
  const listed = runOrComplain("gh", [
    "pr",
    "list",
    "--head",
    branch,
    "--state",
    "open",
    "--json",
    "number",
  ]);
  if (listed === undefined) return 1;
  const numbers = openNumbersIn(listed.out);
  if ("unreadable" in numbers) {
    complain(`${numbers.unreadable}\n${listed.out}`);
    return 1;
  }
  const already = numbers.open[0];
  if (already !== undefined) {
    complain(
      `branch ${branch} already has an open pull request (#${String(already)}); land that one or close it first`,
    );
    return 2;
  }

  const went = runInOrder([
    ["git", "fetch", "origin", BASE],
    ["git", "switch", "-c", branch, "FETCH_HEAD"],
    ["git", "add", "-A"],
    ["git", "commit", "-m", message],
    ["git", "push", "-u", "origin", branch],
  ]);
  if (!went) return 1;

  const created = runOrComplain("gh", ["pr", "create", "--fill"]);
  if (created === undefined) return 1;
  const pull = addressIn(created.out);
  if (pull === undefined) {
    complain(`gh pr create printed no pull request address:\n${created.out}`);
    return 1;
  }
  const arming = `gh pr merge ${String(pull.number)} --auto --merge`;
  if (
    runOrComplain("gh", ["pr", "merge", "--auto", "--merge", String(pull.number)]) === undefined
  ) {
    return 1;
  }

  const read = run("gh", [
    "api",
    "graphql",
    "-F",
    "owner={owner}",
    "-F",
    "name={repo}",
    "-F",
    `number=${String(pull.number)}`,
    "-f",
    `query=${QUEUE_QUERY}`,
  ]);
  say(`pr: #${String(pull.number)} ${pull.address}`);
  if (read.status !== 0) {
    complain(
      `gh api graphql failed:\n${read.err}\nthe pull request is open; arm it with ${arming}`,
    );
    return 1;
  }
  const state = queueStateIn(read.out);
  if (state === undefined) {
    complain(
      `the queue state could not be read back out of gh's answer:\n${read.out}\nthe pull request is open; arm it with ${arming}`,
    );
    return 1;
  }
  say(
    `queue: isInMergeQueue=${String(state.isInMergeQueue)} autoMergeRequest.enabledAt=${state.enabledAt ?? "none"}`,
  );
  if (!state.isInMergeQueue && state.enabledAt === undefined) {
    complain(
      `pull request #${String(pull.number)} is open and neither queued nor armed; arm it with ${arming}`,
    );
    return 1;
  }
  return 0;
};
