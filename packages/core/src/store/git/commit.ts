import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  err,
  isPortablePath,
  ok,
  type ActorId,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";
import { git, standingHead, BUNDLE_REF, bundleOf, type GitDoor } from "./door.ts";

export const PLATFORM_BOT = {
  name: "Better Answers",
  email: "bot@better-answers.invalid",
} as const;

type CommitTrailers = {
  readonly actor: ActorId;

  readonly audit: string;

  readonly run?: string | undefined;
  readonly suggestion?: string | undefined;
  readonly projection?: string | undefined;
};

export type CommitAuthor = {
  readonly name: string;
  readonly email: string;
};

export const ANY_HEAD: unique symbol = Symbol("any head");

export type CommitRequest = {
  readonly path: string;
  readonly content: string;

  readonly message: string;
  readonly author: CommitAuthor;
  readonly trailers: CommitTrailers;

  readonly expectedHead: string | null | typeof ANY_HEAD;

  readonly at: Date;
};

export type Committed = {
  readonly sha: string;

  readonly parent: string | null;
};

export type CommitRefusal =
  | "no-such-repository"
  | "stale-precondition"
  | "malformed-path"
  | "malformed-message";

const isSubjectLine = (message: string): boolean => message.length > 0 && !/[\r\n]/u.test(message);

const trailerLines = (trailers: CommitTrailers): readonly string[] | undefined => {
  const named: readonly (readonly [string, string | undefined])[] = [
    ["Actor", trailers.actor],
    ["Audit", trailers.audit],
    ["Run", trailers.run],
    ["Suggestion", trailers.suggestion],
    ["Projection", trailers.projection],
  ];
  const lines: string[] = [];
  for (const [key, value] of named) {
    if (value === undefined) continue;
    if (!isSubjectLine(value)) return undefined;
    lines.push(`${key}: ${value}`);
  }
  return lines;
};

const messageWith = (message: string, lines: readonly string[]): string =>
  `${message}\n\n${lines.join("\n")}\n`;

const danglingCommit = async (
  gitDir: string,
  indexFile: string,
  parent: string | null,
  request: CommitRequest,
  message: string,
  signal: AbortSignal,
): Promise<string> => {
  const env = { GIT_INDEX_FILE: indexFile };

  if (parent !== null) await git(gitDir, ["read-tree", parent], { env, signal });

  const blob = await git(gitDir, ["hash-object", "-w", "--stdin"], {
    input: request.content,
    signal,
  });
  await git(gitDir, ["update-index", "--add", "--cacheinfo", `100644,${blob},${request.path}`], {
    env,
    signal,
  });
  const tree = await git(gitDir, ["write-tree"], { env, signal });

  const at = request.at.toISOString();
  return git(
    gitDir,
    ["commit-tree", tree, ...(parent === null ? [] : ["-p", parent]), "-m", message],
    {
      env: {
        ...env,

        GIT_AUTHOR_NAME: request.author.name,
        GIT_AUTHOR_EMAIL: request.author.email,
        GIT_AUTHOR_DATE: at,
        GIT_COMMITTER_NAME: PLATFORM_BOT.name,
        GIT_COMMITTER_EMAIL: PLATFORM_BOT.email,
        GIT_COMMITTER_DATE: at,
      },
      signal,
    },
  );
};

const meetsExpectedHead = (
  expectedHead: CommitRequest["expectedHead"],
  parent: string | null,
): boolean => expectedHead === ANY_HEAD || expectedHead === parent;

const commitFailure = (cause: unknown): "stale-precondition" | Error => {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/cannot lock ref|reference already exists|but expected/iu.test(message)) {
    return "stale-precondition";
  }
  return cause instanceof Error ? cause : new Error(message);
};

const COMMIT_BUDGET_MS = 60_000;

type Budget = { readonly ms: number; readonly signal: AbortSignal };

const budgetOf = (door: GitDoor): Budget => {
  const ms = door.commitBudgetMs ?? COMMIT_BUDGET_MS;
  return { ms, signal: AbortSignal.timeout(ms) };
};

const overBudget = (budget: Budget): Error =>
  new Error(`git: the commit ran past its ${budget.ms} ms budget, so its git child was stopped`);

const commitWithin = async (
  gitDir: string,
  request: CommitRequest,
  message: string,
  budget: Budget,
): Promise<Result<Committed, CommitRefusal | Error>> => {
  const { signal } = budget;
  const index = await mkdtemp(path.join(tmpdir(), "better-answers-index-"));
  try {
    const standing = await standingHead(gitDir, signal);
    if (!standing.ok) return err(standing.error);

    const parent = standing.value;
    if (!meetsExpectedHead(request.expectedHead, parent)) return err("stale-precondition");

    const indexFile = path.join(index, "index");
    const sha = await danglingCommit(gitDir, indexFile, parent, request, message, signal);
    await git(gitDir, ["update-ref", BUNDLE_REF, sha, parent ?? ""], { signal });
    return ok({ sha, parent });
  } catch (cause) {
    return err(signal.aborted ? overBudget(budget) : commitFailure(cause));
  } finally {
    await rm(index, { recursive: true, force: true });
  }
};

export const commit = async (
  principal: UserPrincipal,
  door: GitDoor,
  request: CommitRequest,
): Promise<Result<Committed, CommitRefusal | Error>> => {
  if (!isPortablePath(request.path)) return err("malformed-path");
  const trailers = trailerLines(request.trailers);
  if (!isSubjectLine(request.message) || trailers === undefined) return err("malformed-message");
  const message = messageWith(request.message, trailers);
  return commitWithin(bundleOf(door, principal), request, message, budgetOf(door));
};
