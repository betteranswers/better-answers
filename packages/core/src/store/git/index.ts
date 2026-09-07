import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { err, ok, type ActorId, type Result } from "../../kernel/index.ts";

/**
 * The git door: the governed write to the per-workspace bare repository (ADR 0024).
 *
 * RLS does not reach here, which is why Principal-first-argument is load-bearing rather
 * than decorative — the `Principal` is what carries workspace isolation to this store. The
 * door never sees a Principal: it takes the workspace id the slice read off one, which is
 * what makes "one repository per workspace" a path this module computes and never a caller's
 * string.
 *
 * **git is a binary we consume, never code we write** (ADR 0005), so this module is the
 * plumbing commands and nothing else: `hash-object`, `read-tree`, `update-index`,
 * `write-tree`, `commit-tree`, `update-ref`. Porcelain would need a working tree, and the
 * repositories are bare.
 *
 * ADR 0029 rule 2 — `store` imports only `kernel`. No store file imports another store file.
 */

const run = promisify(execFile);

/** Where the repositories live: `<root>/<workspace>.git`, one per workspace (ADR 0024). */
export type GitDoor = {
  readonly root: string;
};

export const openGit = (root: string): GitDoor => ({ root });

/**
 * The ref every bundle's history hangs off. One branch per repository and no other: the
 * bundle is written only by the app, one commit per act (ADR 0012), so there is nothing for
 * a second branch to be.
 */
const BUNDLE_REF = "refs/heads/main";

/**
 * The platform bot: the committer on every commit, whoever the author is. One identity
 * across every workspace, so `git log --committer` answers "which changes did the platform
 * make" with all of them and a person's name never appears in that half of the line.
 */
export const PLATFORM_BOT = {
  name: "Better Answers",
  email: "bot@better-answers.invalid",
} as const;

/**
 * The five trailers ADR 0012 fixes, in the order a commit carries them. `Actor:` and
 * `Audit:` are on every commit — who acted, and the ledger row minted before the commit,
 * which is the reconciler's idempotency key. The other three name the records an act came
 * from and are absent when it came from none.
 */
type CommitTrailers = {
  /** The kernel's `ActorId` — `human:<person id>` for a person, never an address (ADR 0035). */
  readonly actor: ActorId;
  /** The `audit_event` id, minted before this commit so the commit can carry it. */
  readonly audit: string;
  readonly run?: string;
  readonly suggestion?: string;
  readonly projection?: string;
};

/** The person a commit is attributed to: the git author line keeps a name and an address. */
export type CommitAuthor = {
  readonly name: string;
  readonly email: string;
};

export type CommitRequest = {
  readonly workspaceId: string;
  /** The file's path inside the bundle, and the content to put there. */
  readonly path: string;
  readonly content: string;
  /** The commit's subject line; the trailers are appended below it. */
  readonly message: string;
  readonly author: CommitAuthor;
  readonly trailers: CommitTrailers;
  /**
   * What the caller expects the ref to hold — the **hash precondition**. `null` means "this
   * bundle has no commits yet"; a sha that is not what the ref holds refuses the write.
   */
  readonly expectedHead: string | null;
  /** When the commit was made; the author and committer dates alike. */
  readonly at?: Date;
};

export type Committed = {
  readonly sha: string;
  /** What the ref held before, which is the row's `parent_sha`; `null` for a first commit. */
  readonly parent: string | null;
};

/**
 * Why a commit was refused. `stale-precondition` is the one a person sees — the content
 * moved under them, and the write is refused loudly rather than silently overwriting
 * somebody else's change (ADR 0012). The other two are a repository that is not there and
 * a path that is not one, both of which are a caller's error and never a race.
 */
export type CommitRefusal =
  | "no-such-repository"
  | "stale-precondition"
  | "malformed-path"
  | "malformed-message";

const repositoryPath = (door: GitDoor, workspaceId: string): string =>
  path.join(door.root, `${workspaceId}.git`);

const git = async (
  gitDir: string,
  arguments_: readonly string[],
  options: { readonly input?: string; readonly env?: Readonly<Record<string, string>> } = {},
): Promise<string> => {
  const child = run("git", ["--git-dir", gitDir, ...arguments_], {
    // The parent's environment handed to a child process, not configuration read at a call
    // site: `env` replaces rather than extends, so a bare object would leave the binary
    // without a PATH to be found on. `packages/devtools/src/throwaway-tree.ts` spawns the
    // repository's own tools the same way.
    env: { ...process.env, ...options.env },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (options.input !== undefined) {
    child.child.stdin?.end(options.input);
  }
  const { stdout } = await child;
  return stdout.trim();
};

/**
 * Create a workspace's bare repository. Called by the test harness today and by
 * provisioning when the workspace lifecycle reaches this store; the governed write never
 * creates one, so a commit against a workspace with no repository is a refusal a caller can
 * read rather than a repository nobody asked for.
 */
export const initRepository = async (door: GitDoor, workspaceId: string): Promise<string> => {
  const gitDir = repositoryPath(door, workspaceId);
  await run("git", ["init", "--bare", "--initial-branch", "main", gitDir]);
  return gitDir;
};

/** What the bundle's ref holds now; `null` when the repository has no commits yet. */
export const head = async (door: GitDoor, workspaceId: string): Promise<string | null> => {
  const gitDir = repositoryPath(door, workspaceId);
  try {
    return await git(gitDir, ["rev-parse", "--verify", `${BUNDLE_REF}^{commit}`]);
  } catch {
    // An unborn branch is not a failure: a bundle with no commits is where every bundle
    // starts, and `rev-parse --verify` has no way of saying so but a non-zero exit.
    return null;
  }
};

/**
 * A commit's subject: one line, and one line only.
 *
 * The trailers sit under this text, and a parser reads them by line — so a subject carrying
 * its own newline could open an `Audit:` line of its own choosing, and a first-match read
 * would take the forged id instead of the real one. Through the unique index over
 * `(workspace_id, audit_event_id)` that is a commit the reconciler could be told had already
 * landed when nothing of it ever did. Refused here, at the door that composes the message,
 * because that is the one place the two halves are joined.
 */
const isSubjectLine = (message: string): boolean => message.length > 0 && !/[\r\n]/.test(message);

/** The commit's message: the subject, a blank line, then the trailers in ADR 0012's order. */
const messageWith = (message: string, trailers: CommitTrailers): string => {
  const lines = [
    `Actor: ${trailers.actor}`,
    `Audit: ${trailers.audit}`,
    ...(trailers.run === undefined ? [] : [`Run: ${trailers.run}`]),
    ...(trailers.suggestion === undefined ? [] : [`Suggestion: ${trailers.suggestion}`]),
    ...(trailers.projection === undefined ? [] : [`Projection: ${trailers.projection}`]),
  ];
  return `${message}\n\n${lines.join("\n")}\n`;
};

/**
 * A path inside the bundle and nothing else: relative, no `..` segment, no leading slash.
 * The path reaches `update-index --cacheinfo`, which writes into the repository's object
 * graph rather than the filesystem, so this is not a traversal guard — it is what keeps a
 * bundle's tree readable by any OKF tool (ADR 0012's export promise).
 */
const isBundlePath = (candidate: string): boolean =>
  candidate.length > 0 &&
  !candidate.startsWith("/") &&
  !candidate.split("/").some((segment) => segment === "" || segment === "." || segment === "..");

/**
 * One governed write's commit: the hash precondition, then one commit with the person as
 * author and the platform bot as committer, then the ref moved under the same precondition.
 *
 * The precondition is checked twice on purpose, and the second is the one that holds: the
 * read below is what turns a stale write into a refusal a caller can show a person, and
 * `update-ref`'s `<oldvalue>` argument is git's own compare-and-swap, which refuses the move
 * if anything reached the ref in between. The in-process lock (`withRepositoryLock`) is what
 * makes the pair one act for this process; the compare-and-swap is what makes it safe
 * against anything else that ever touches the repository.
 */
export const commit = async (
  door: GitDoor,
  request: CommitRequest,
): Promise<Result<Committed, CommitRefusal | Error>> => {
  if (!isBundlePath(request.path)) return err("malformed-path");
  if (!isSubjectLine(request.message)) return err("malformed-message");
  const gitDir = repositoryPath(door, request.workspaceId);

  try {
    await run("git", ["--git-dir", gitDir, "rev-parse", "--git-dir"]);
  } catch {
    // Not there, or not a repository: either way there is no bundle to commit to, and the
    // caller hears the same word for both because neither is something it can act on.
    return err("no-such-repository");
  }

  const parent = await head(door, request.workspaceId);
  if (parent !== request.expectedHead) return err("stale-precondition");

  const index = await mkdtemp(path.join(tmpdir(), "better-answers-index-"));
  try {
    const indexFile = path.join(index, "index");
    const env = { GIT_INDEX_FILE: indexFile };
    // The parent's tree first, so a commit that touches one file keeps every other file.
    if (parent !== null) await git(gitDir, ["read-tree", parent], { env });

    const blob = await git(gitDir, ["hash-object", "-w", "--stdin"], { input: request.content });
    await git(gitDir, ["update-index", "--add", "--cacheinfo", `100644,${blob},${request.path}`], {
      env,
    });
    const tree = await git(gitDir, ["write-tree"], { env });

    const at = (request.at ?? new Date()).toISOString();
    const sha = await git(
      gitDir,
      [
        "commit-tree",
        tree,
        ...(parent === null ? [] : ["-p", parent]),
        "-m",
        messageWith(request.message, request.trailers),
      ],
      {
        env: {
          ...env,
          // The person authors and the platform bot commits (ADR 0012): every change is
          // attributable to a person, and every change was made by the platform.
          GIT_AUTHOR_NAME: request.author.name,
          GIT_AUTHOR_EMAIL: request.author.email,
          GIT_AUTHOR_DATE: at,
          GIT_COMMITTER_NAME: PLATFORM_BOT.name,
          GIT_COMMITTER_EMAIL: PLATFORM_BOT.email,
          GIT_COMMITTER_DATE: at,
        },
      },
    );

    // `<oldvalue>`: the empty string means "the ref must not exist", a sha means "it must
    // hold exactly this". Either way the move happens only if the precondition still holds.
    await git(gitDir, ["update-ref", BUNDLE_REF, sha, parent ?? ""]);
    return ok({ sha, parent });
  } catch (cause) {
    // Anything the binary refused after the precondition passed: the object write, the
    // tree, or a ref that moved between the read and the compare-and-swap. The last is the
    // stale precondition again, and it is told apart by what git says about it.
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/cannot lock ref|reference already exists|but expected/i.test(message)) {
      return err("stale-precondition");
    }
    return err(cause instanceof Error ? cause : new Error(message));
  } finally {
    await rm(index, { recursive: true, force: true });
  }
};

/**
 * The per-repository lock (ADR 0012; T-006 spec, *The governed write*): one act at a time
 * per workspace repository, held by the slice from the hash precondition through the
 * Postgres COMMIT — so `bundle_commit` history is always a prefix of git history and the
 * reconciler stays a watermark scan rather than a hole scan.
 *
 * **In-process, one api process** (ADR 0024's estate). Multi-process locking is a written
 * trigger and not built: a second api process changes this function's body to a Postgres
 * advisory lock keyed by workspace, and changes nothing else — the prefix invariant and the
 * watermark reconciler survive the promotion (`.scratch/t-052-prior-art-git-db-consistency.md`).
 *
 * The registry lives here, in the git store door, because the repository is what is being
 * serialised. Waiters are chained onto one promise per workspace rather than polling, and
 * the chain never rejects — a failed act releases the lock for the next one, which is why
 * the `catch` returns rather than swallowing anything: the caller's own outcome is `work`'s.
 */
const locks = new Map<string, Promise<unknown>>();

export const withRepositoryLock = async <T>(
  door: GitDoor,
  workspaceId: string,
  work: () => Promise<T>,
): Promise<T> => {
  const key = repositoryPath(door, workspaceId);
  const ahead = locks.get(key) ?? Promise.resolve();
  const mine = ahead.then(work, work);
  // The chain the next waiter joins never rejects, so one act's failure does not become
  // every later act's. `mine` itself is what the caller awaits, rejection and all.
  const chained = mine.catch(() => undefined);
  locks.set(key, chained);
  try {
    return await mine;
  } finally {
    // The last act out clears its own entry — and only its own, so a waiter that has
    // already taken the lock keeps it. Without this the registry grows one key per
    // workspace for the life of the process.
    if (locks.get(key) === chained) locks.delete(key);
  }
};
