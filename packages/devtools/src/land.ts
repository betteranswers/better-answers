import { spawnSync } from "node:child_process";
import path from "node:path";

import { z } from "zod";

import { flagValues } from "./flags.ts";

const USAGE =
  'usage: land --message "<type>(<scope>): <summary>", then a blank line, the body and a "Refs: T-nnn" footer';

const SLUG_WORDS = 5;
const BASE = "main";

/** This checkout's config and binary, whichever tree the command lands from. */
const REPOSITORY = path.resolve(import.meta.dirname, "../../..");
const COMMITLINT = path.join(REPOSITORY, "node_modules", ".bin", "commitlint");

/**
 * The repository tracks content of its own under `.claude/`, so only what git has never seen is
 * a session's.
 */
const KEPT_BY_THE_SESSION = [".claude/", ".scratch/"];
const UNTRACKED = "??";

const REFS_FOOTER = /^Refs: (T-\d+)\b/m;
const TYPE_AND_SCOPE = /^[^:]*:/;

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

const commitsWord = (count: string): string => (count === "1" ? "1 commit" : `${count} commits`);

const commitlintRefusal = (message: string): number | undefined => {
  const ran = spawnSync(COMMITLINT, [], { cwd: REPOSITORY, input: message, encoding: "utf8" });
  if (ran.error !== undefined) {
    complain(
      `commitlint could not run from ${COMMITLINT}: ${ran.error.message}; pnpm install puts it there`,
    );
    return 1;
  }
  const said = `${ran.stdout}${ran.stderr}`;
  if (ran.status === 0) {
    process.stdout.write(said);
    return undefined;
  }
  complain(`commitlint refused the message:\n${said}`);
  return 2;
};

const branchFor = (message: string): string => {
  const [subject = "", ...body] = message.split("\n");
  const ticket = REFS_FOOTER.exec(body.join("\n"))?.[1]?.toLowerCase() ?? "";
  const slug = subject
    .replace(TYPE_AND_SCOPE, "")
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, SLUG_WORDS)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return [ticket, slug].filter((part) => part.length > 0).join("-");
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

type Change = { readonly untracked: boolean; readonly path: string };

const changesIn = (porcelain: string): readonly Change[] =>
  porcelain
    .split("\n")
    .filter((line) => line.length > 3)
    .map((line) => {
      const named = line.slice(3);
      const renamed = named.lastIndexOf(" -> ");
      const one = renamed === -1 ? named : named.slice(renamed + 4);
      return {
        untracked: line.slice(0, 2) === UNTRACKED,
        path: one.startsWith('"') && one.endsWith('"') ? one.slice(1, -1) : one,
      };
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

/** The shape gh answers the queue query with; anything else is no queue state to report. */
const queueAnswer = z.object({
  data: z
    .object({
      repository: z
        .object({
          pullRequest: z
            .object({
              isInMergeQueue: z.boolean(),
              autoMergeRequest: z
                .object({ enabledAt: z.string().optional() })
                .nullable()
                .optional(),
            })
            .nullable()
            .optional(),
        })
        .nullable()
        .optional(),
    })
    .optional(),
});

const queueStateIn = (output: string): QueueState | undefined => {
  try {
    const pull = queueAnswer.parse(JSON.parse(output)).data?.repository?.pullRequest;
    if (pull === undefined || pull === null) return undefined;
    return { isInMergeQueue: pull.isInMergeQueue, enabledAt: pull.autoMergeRequest?.enabledAt };
  } catch {
    // gh answered with something other than JSON, or JSON of another shape.
    return undefined;
  }
};

type Landing = { readonly message: string; readonly branch: string };

const landingFrom = (argv: readonly string[]): Landing | number => {
  const message = flagValues(argv)?.get("message");
  if (message === undefined) {
    complain(USAGE);
    return 2;
  }
  const refused = commitlintRefusal(message);
  if (refused !== undefined) return refused;
  const branch = branchFor(message);
  if (branch.length === 0) {
    complain("the message carries no word a branch could be named from");
    return 2;
  }
  return { message, branch };
};

/**
 * Fetches origin's head for the whole run: HEAD is measured against it here, and the later
 * switch cuts the branch from it.
 */
const headRefusal = (): number | undefined => {
  if (runOrComplain("git", ["fetch", "origin", BASE]) === undefined) return 1;
  if (run("git", ["merge-base", "--is-ancestor", "HEAD", "FETCH_HEAD"]).status === 0) {
    return undefined;
  }
  const counted = runOrComplain("git", ["rev-list", "--count", "FETCH_HEAD..HEAD"]);
  if (counted === undefined) return 1;
  complain(
    `HEAD carries ${commitsWord(counted.out.trim())} that origin/${BASE} has not; land takes an uncommitted change, so the branch it makes carries this change and nothing else`,
  );
  return 2;
};

const treeRefusal = (branch: string): number | undefined => {
  /**
   * The default collapses a new directory to one line, and a path this never sees is one it
   * can neither show nor keep out.
   */
  const working = runOrComplain("git", ["status", "--porcelain", "--untracked-files=all"]);
  if (working === undefined) return 1;
  const changes = changesIn(working.out);
  if (changes.length === 0) {
    complain("nothing to commit; the working tree is clean");
    return 2;
  }
  const kept = changes.filter(
    (one) => one.untracked && KEPT_BY_THE_SESSION.some((under) => one.path.startsWith(under)),
  );
  if (kept.length > 0) {
    complain(
      `a session keeps these to itself and they never land: ${kept.map((one) => one.path).join(", ")}`,
    );
    return 2;
  }
  say(`landing ${String(changes.length)} paths on a branch named ${branch}:`);
  for (const one of changes) say(`  ${one.path}`);
  return undefined;
};

const branchRefusal = (branch: string): number | undefined => {
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
  if (already === undefined) return undefined;
  complain(
    `branch ${branch} already has an open pull request (#${String(already)}); land that one or close it first`,
  );
  return 2;
};

const commitFailure = ({ message, branch }: Landing): number | undefined => {
  const switched = run("git", ["switch", "-c", branch, "FETCH_HEAD"]);
  if (switched.status !== 0) {
    complain(
      `the working tree's changes could not be carried onto origin/${BASE}'s head:\n${switched.out}${switched.err}commit them, move them aside, or bring this tree up to date with origin/${BASE} first`,
    );
    return 1;
  }
  const went = runInOrder([
    ["git", "add", "-A"],
    ["git", "commit", "-m", message],
    ["git", "push", "-u", "origin", branch],
  ]);
  return went ? undefined : 1;
};

const queueReadBack = (pull: PullRequest): number => {
  const arming = `gh pr merge ${String(pull.number)} --auto --merge`;
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

const openAndArm = (): number => {
  const created = runOrComplain("gh", ["pr", "create", "--fill"]);
  if (created === undefined) return 1;
  const pull = addressIn(created.out);
  if (pull === undefined) {
    complain(`gh pr create printed no pull request address:\n${created.out}`);
    return 1;
  }
  if (
    runOrComplain("gh", ["pr", "merge", "--auto", "--merge", String(pull.number)]) === undefined
  ) {
    return 1;
  }
  return queueReadBack(pull);
};

/**
 * The exit status: 0 once the pull request is queued or armed, 2 for a refusal before anything
 * is committed, 1 for any other failure.
 */
export const land = (argv: readonly string[]): number => {
  const landing = landingFrom(argv);
  if (typeof landing === "number") return landing;
  return (
    headRefusal() ??
    treeRefusal(landing.branch) ??
    branchRefusal(landing.branch) ??
    commitFailure(landing) ??
    openAndArm()
  );
};
