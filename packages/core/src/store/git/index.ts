import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  err,
  isPortablePath,
  ok,
  PERSON_PREFIX,
  type ActorId,
  type PlatformPrincipal,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";

/**
 * The git door: the governed write to the per-workspace bare repository (ADR 0024).
 *
 * RLS does not reach here, which is why **Principal-first-argument is load-bearing rather
 * than decorative — the `Principal` is what carries workspace isolation to this store**
 * (ADR 0029's tenancy section, in those words; the constitution's rule binds every
 * `packages/core` function that reads or writes tenant data, doors included). So every entry
 * that reaches a workspace's bundle takes the Principal first and derives the repository from
 * `principal.workspaceId`: which repository is opened is this module's arithmetic and never a
 * caller's string, and no call site can name one workspace's bundle while acting as another's
 * member.
 *
 * `initRepository` is the exception and says why where it stands. The **platform's** entries —
 * the reconciler's, which replays a bundle's commits under `process:better-answers-reconciler`
 * (ADR 0012's 2026-09-06 amendment) — take the platform principal and the workspace it acts
 * in beside it, `withScope`'s shape in the Postgres door: a platform principal carries no
 * workspace (`CONTEXT.md`, *platform principal*), so the pair is what names the repository,
 * and the repository is still this module's arithmetic and never a caller's path.
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

/** Why `openGit` refuses the root it was given — checked once, before a `GitDoor` exists. */
export type GitRootRefusal = "root-not-absolute" | "no-such-root";

/**
 * The door's one constructor, and the one place a root is ever checked (ADR 0024's
 * 2026-09-08 amendment): absolute, and an existing directory, or refused before a `GitDoor`
 * can be built from it. Every entry below trusts `door.root` rather than checking it again —
 * one guard, at the boundary — because before this guard existed, a root that arrived empty
 * or relative was joined against it anyway, which is how a mutation once wrote a bare
 * repository at `packages/core/undefined/`, beside whatever the process's own cwd was.
 *
 * Synchronous on purpose: this runs once, at boot, against a filesystem the process already
 * has open, so there is nothing worth awaiting — and an async opener would ripple into every
 * test and call site that holds a `GitDoor`.
 */
export const openGit = (root: string): Result<GitDoor, GitRootRefusal> => {
  if (!path.isAbsolute(root)) return err("root-not-absolute");
  try {
    if (!statSync(root).isDirectory()) return err("no-such-root");
  } catch {
    // Nothing at `root` to stat — the same refusal as a root that resolves to a file: either
    // way there is no directory here for a workspace's repository to live under.
    return err("no-such-root");
  }
  return ok({ root });
};

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
  // The three that name the records an act came from are explicitly `| undefined`, so an
  // act passes what it holds — a suggestion id or nothing — rather than composing the
  // trailer set around whether it has one.
  readonly run?: string | undefined;
  readonly suggestion?: string | undefined;
  readonly projection?: string | undefined;
};

/** The person a commit is attributed to: the git author line keeps a name and an address. */
export type CommitAuthor = {
  readonly name: string;
  readonly email: string;
};

export type CommitRequest = {
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
  /**
   * When the commit was made; the author and committer dates alike. The caller's own
   * Clock, read once (ADR 0040) — required, because a default here would be this door
   * reading the ambient clock on a caller's behalf.
   */
  readonly at: Date;
};

export type Committed = {
  readonly sha: string;
  /** What the ref held before, which is the row's `parent_sha`; `null` for a first commit. */
  readonly parent: string | null;
};

/**
 * Why a commit was refused. `stale-precondition` is the one a person sees — the content
 * moved under them, and the write is refused loudly rather than silently overwriting
 * somebody else's change (ADR 0012). The other three are a repository that is not there, a
 * path that is not one inside a bundle, and a subject that is not one line: a caller's error
 * every time, and never a race.
 */
export type CommitRefusal =
  | "no-such-repository"
  | "stale-precondition"
  | "malformed-path"
  | "malformed-message";

const repositoryPath = (door: GitDoor, workspaceId: string): string =>
  path.join(door.root, `${workspaceId}.git`);

/** The bundle of the workspace this call is made in, and of no other. */
const bundleOf = (door: GitDoor, principal: UserPrincipal): string =>
  repositoryPath(door, principal.workspaceId);

const git = async (
  gitDir: string,
  arguments_: readonly string[],
  options: {
    readonly input?: string;
    readonly env?: Readonly<Record<string, string>>;
    /** Keep the output's own whitespace — a blob's bytes are the file, trailing newline and all. */
    readonly raw?: boolean;
  } = {},
): Promise<string> => {
  const child = run("git", ["--git-dir", gitDir, ...arguments_], {
    // The parent's environment handed to a child process, not configuration read at a call
    // site: `env` replaces rather than extends, so a bare object would leave the binary
    // without a PATH to be found on. `packages/devtools/src/throwaway-tree.ts` spawns the
    // repository's own tools the same way.
    //
    // `LC_ALL=C` pins the binary's messages to English, because one of them is read below to
    // tell a lost compare-and-swap from a real failure. A machine that ran under another
    // locale would classify a stale precondition as a store error and hand a person the
    // wrong outcome.
    env: { ...process.env, ...options.env, LC_ALL: "C" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (options.input !== undefined) {
    child.child.stdin?.end(options.input);
  }
  const { stdout } = await child;
  return options.raw === true ? stdout : stdout.trim();
};

/**
 * Create a workspace's empty bare repository — the one entry here that takes a workspace id
 * rather than a Principal, and the reason is what it does: it runs **before anybody can be a
 * member acting in that workspace**, at provisioning, and it reads and writes no tenant data,
 * only an empty object store. Every entry below reaches a bundle's contents and takes the
 * Principal.
 *
 * The governed write never calls this, so a commit against a workspace with no repository is
 * a refusal a caller can read rather than a repository nobody asked for.
 *
 * `door.root` is trusted, not re-checked: `openGit` is the door's one constructor, and the
 * root it holds was already proved absolute and present there (ADR 0024).
 */
export const initRepository = async (door: GitDoor, workspaceId: string): Promise<string> => {
  const gitDir = repositoryPath(door, workspaceId);
  await run("git", ["init", "--bare", "--initial-branch", "main", gitDir]);
  return gitDir;
};

/** What this workspace's bundle ref holds now; `null` when the repository has no commits yet. */
export const head = (principal: UserPrincipal, door: GitDoor): Promise<string | null> =>
  headOf(bundleOf(door, principal));

const headOf = async (gitDir: string): Promise<string | null> => {
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

/**
 * The trailers, each on its own line. A **value** carrying a line break would open a trailer
 * of its own exactly as a subject would, so every one is held to a single line here.
 *
 * No value's type refuses a newline on its own — `ActorId` is a template-literal union whose
 * tail is `string`, and the other four are plain strings — so this check is the whole of the
 * guarantee rather than a second layer over one. It costs a regular expression per trailer.
 */
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

/** The commit's message: the subject, a blank line, then the trailers in ADR 0012's order. */
const messageWith = (message: string, lines: readonly string[]): string =>
  `${message}\n\n${lines.join("\n")}\n`;

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
  principal: UserPrincipal,
  door: GitDoor,
  request: CommitRequest,
): Promise<Result<Committed, CommitRefusal | Error>> => {
  // A path inside the bundle and nothing else. It reaches `update-index --cacheinfo`, which
  // writes into the repository's object graph rather than the filesystem, so the refusal is
  // not a traversal guard: it is what keeps a bundle's tree readable by any OKF tool, which
  // is ADR 0012's export promise (`kernel/portable-path.ts`).
  if (!isPortablePath(request.path)) return err("malformed-path");
  const trailers = trailerLines(request.trailers);
  if (!isSubjectLine(request.message) || trailers === undefined) return err("malformed-message");
  const gitDir = bundleOf(door, principal);

  try {
    await run("git", ["--git-dir", gitDir, "rev-parse", "--git-dir"]);
  } catch {
    // Not there, or not a repository: either way there is no bundle to commit to, and the
    // caller hears the same word for both because neither is something it can act on.
    return err("no-such-repository");
  }

  const parent = await head(principal, door);
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

    const at = request.at.toISOString();
    const sha = await git(
      gitDir,
      [
        "commit-tree",
        tree,
        ...(parent === null ? [] : ["-p", parent]),
        "-m",
        messageWith(request.message, trailers),
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

export const withRepositoryLock = <T>(
  principal: UserPrincipal,
  door: GitDoor,
  work: () => Promise<T>,
): Promise<T> => lockedRepository(bundleOf(door, principal), work);

/**
 * The same lock, taken by the platform on a workspace it names — the reconciler's, so a
 * replay and a live write on one bundle are one after the other, and a second replay of
 * the same bundle waits behind the first rather than running beside it. One registry and
 * one body for both entries, because two locks over one repository would be no lock.
 */
export const withRepositoryLockAs = <T>(
  platform: PlatformPrincipal,
  door: GitDoor,
  workspaceId: string,
  work: () => Promise<T>,
): Promise<T> => lockedRepository(repositoryPath(door, workspaceId), work);

const lockedRepository = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
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

/**
 * What the reconciler's scan answers (ADR 0012's 2026-09-06 amendment): the bundle's head,
 * and the commits after the last one the rows know about — **oldest first**, which is the
 * order they must be replayed in, because each commit's row names its parent's.
 *
 * A **watermark scan and never a hole scan**: `since` is the last recorded commit, and the
 * prefix invariant — `bundle_commit` history is a prefix of git history, which the lock
 * buys — means everything after it is missing and nothing before it is. So the one thing
 * checked about `since` is that it *is* a prefix: a recorded commit the ref's history does
 * not contain (or does not hold at all) is a repository and a database that disagree about
 * the past, and no replay can make that right — `history-diverged` is the word, and the
 * caller stops.
 *
 * `null` for `since` is a bundle whose rows know no commit yet: every commit is missed.
 */
export const commitsAfter = async (
  platform: PlatformPrincipal,
  door: GitDoor,
  workspaceId: string,
  since: string | null,
): Promise<
  Result<
    { readonly head: string | null; readonly missed: readonly string[] },
    "no-such-repository" | "history-diverged"
  >
> => {
  const gitDir = repositoryPath(door, workspaceId);
  try {
    await run("git", ["--git-dir", gitDir, "rev-parse", "--git-dir"]);
  } catch {
    // Not there, or not a repository: the reconciler cannot replay a bundle it cannot open,
    // and the restore path hears the one word for both.
    return err("no-such-repository");
  }
  const head = await headOf(gitDir);
  if (head === null) return since === null ? ok({ head, missed: [] }) : err("history-diverged");
  if (since !== null) {
    try {
      await git(gitDir, ["merge-base", "--is-ancestor", since, BUNDLE_REF]);
    } catch {
      // A non-zero exit is git's whole answer: not an ancestor, or not a commit this
      // repository holds — both are the recorded history disagreeing with the ref's.
      return err("history-diverged");
    }
  }
  const listed = await git(gitDir, [
    "rev-list",
    "--reverse",
    since === null ? BUNDLE_REF : `${since}..${BUNDLE_REF}`,
  ]);
  return ok({ head, missed: listed.split("\n").filter((sha) => sha !== "") });
};

/**
 * Where a bundle's history names somebody: the commits and paths whose file carries one of
 * the needles, and the commits whose **author line** does.
 *
 * The erasure map's git arm (the S0 spec, the routine's step 2). The two answers are
 * separate because the two forms are: a concept file names a person by `human:<email>` (ADR
 * 0019), a commit's author line by `Name <address>`, and the routine rewrites each its own
 * way — a text replacement over blobs, a mailmap over author lines. It is a read of the
 * store and not of a slice: no slice shells out to `git` (ADR 0029, the four doors).
 */
export type HistoryNaming = {
  /** The file at that commit carries a needle; `git show <commit>:<path>` is the bytes. */
  readonly blobs: readonly { readonly commit: string; readonly path: string }[];
  /** The commits whose author line carries a needle. */
  readonly authors: readonly string[];
};

/** The answer for a needle set worth nothing and for a bundle with no commits alike. */
const NAMES_NOBODY: HistoryNaming = { blobs: [], authors: [] };

/**
 * Matched **without regard to case**, because the two ends were typed by different people:
 * the address on a concept file is the one the platform wrote from the identity set, and a
 * needle is what a subject wrote down on a form.
 */
const carries = (line: string, needles: readonly string[]): boolean => {
  const lowered = line.toLowerCase();
  return needles.some((needle) => lowered.includes(needle.toLowerCase()));
};

/**
 * `git grep` exits non-zero when nothing matched, which is an answer and not a failure — so
 * an empty listing is what a needle nobody's file carries comes back as. `core.quotePath`
 * off, because a concept whose filename carries an accent would otherwise come back
 * octal-escaped as a name the repository does not hold; `-I` so no binary blob is read.
 */
const blobsNaming = async (
  gitDir: string,
  needles: readonly string[],
  history: readonly string[],
): Promise<HistoryNaming["blobs"]> => {
  const listed = await git(gitDir, [
    "-c",
    "core.quotePath=false",
    "grep",
    "--files-with-matches",
    "--fixed-strings",
    "--ignore-case",
    "-I",
    ...needles.flatMap((needle) => ["-e", needle]),
    ...history,
  ]).catch(() => "");
  return listed.split("\n").flatMap((entry) => {
    // `<commit>:<path>`, and a commit is a hash, so the first colon is the separator and
    // every later one belongs to the path.
    const at = entry.indexOf(":");
    const file = entry.slice(at + 1);
    return at === -1 || file === "" ? [] : [{ commit: entry.slice(0, at), path: file }];
  });
};

/** The author's name and address off every commit, so a needle is read against both. */
const authorsNaming = async (
  gitDir: string,
  needles: readonly string[],
): Promise<readonly string[]> => {
  // NUL between the fields, because a display name may hold anything but a newline.
  const logged = await git(gitDir, ["log", "--all", "--format=%H%x00%an%x00%ae"]);
  return logged.split("\n").flatMap((line) => {
    const [sha = "", name = "", address = ""] = line.split("\0");
    return sha !== "" && carries(`${name} <${address}>`, needles) ? [sha] : [];
  });
};

export const historyNaming = async (
  platform: PlatformPrincipal,
  door: GitDoor,
  workspaceId: string,
  needles: readonly string[],
): Promise<HistoryNaming> => {
  const wanted = needles.filter((needle) => needle.trim() !== "");
  if (wanted.length === 0) return NAMES_NOBODY;
  const gitDir = repositoryPath(door, workspaceId);
  const history = (await git(gitDir, ["rev-list", "--all"]))
    .split("\n")
    .filter((sha) => sha !== "");
  // A bundle with no commits is where every bundle starts, and `git grep` over no revisions
  // would fall through to a working tree these repositories do not have.
  if (history.length === 0) return NAMES_NOBODY;
  return {
    blobs: await blobsNaming(gitDir, wanted, history),
    authors: await authorsNaming(gitDir, wanted),
  };
};

/**
 * One commit as the reconciler reads it back: its parent, the trailers the act wrote, and
 * the one file the act changed with its content at that commit. `change` is absent for a
 * commit that changed no file or more than one — not a shape the governed write makes, so
 * not one the replay can land.
 */
export type CommitRead = {
  readonly sha: string;
  readonly parent: string | null;
  /** The trailers by key, in ADR 0012's names — `Actor`, `Audit`, `Run`, `Suggestion`, `Projection`. */
  readonly trailers: Readonly<Record<string, string>>;
  readonly change: { readonly path: string; readonly content: string } | undefined;
};

/** A trailer line as this door writes them: `Key: value`, the key a word in letters and hyphens. */
const TRAILER_LINE = /^([A-Za-z][A-Za-z-]*): (.+)$/;

/**
 * The trailers off a commit's message: the block **after the message's last blank line**, read
 * the way the door wrote it (`messageWith`). The subject is held to one line at the door, so
 * no forged `Audit:` can sit in the subject and be read first — but the reader still takes
 * the last paragraph and never the first match, so this half keeps the promise the other
 * half made.
 */
const trailersOf = (message: string) => {
  const block = message.trimEnd().split("\n\n").at(-1) ?? "";
  return Object.fromEntries(
    block.split("\n").flatMap((line) => {
      const match = TRAILER_LINE.exec(line);
      return match?.[1] !== undefined && match[2] !== undefined
        ? [[match[1], match[2]] as const]
        : [];
    }),
  );
};

export const readCommit = async (
  platform: PlatformPrincipal,
  door: GitDoor,
  workspaceId: string,
  sha: string,
): Promise<CommitRead> => {
  const gitDir = repositoryPath(door, workspaceId);
  // NUL between the fields, because the message is the one field that holds newlines.
  const shown = await git(gitDir, ["show", "-s", "--format=%H%x00%P%x00%B", sha]);
  const [id = "", parents = "", ...message] = shown.split("\0");
  const parentList = parents.split(" ").filter((parent) => parent !== "");
  // `--root` so a bundle's first commit lists its files against the empty tree rather
  // than against nothing; `-r` so a file under a directory is one line and not a tree; `-z`
  // so the listing is NUL-delimited and **never quoted** — with a line-shaped listing git
  // quotes and octal-escapes any path outside ASCII (`core.quotePath`), and a concept whose
  // filename carries an accent would come back as a name the repository does not hold.
  const changed = await git(gitDir, [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--name-status",
    "-r",
    "-z",
    sha,
  ]);
  const fields = changed.split("\0");
  const files: string[] = [];
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const [status, file] = [fields[at], fields[at + 1]];
    // Added or modified, and nothing else: a deletion has no content to land, and a
    // rename or a copy is not a change this door's `commit` makes.
    if ((status === "A" || status === "M") && file !== undefined && file !== "") files.push(file);
  }
  const file = files[0];
  const change =
    files.length === 1 && file !== undefined
      ? { path: file, content: await git(gitDir, ["show", `${sha}:${file}`], { raw: true }) }
      : undefined;
  return {
    sha: id,
    parent: parentList.length === 1 ? (parentList[0] ?? null) : null,
    trailers: trailersOf(message.join("\0")),
    change,
  };
};

/**
 * **One file's bytes at one commit** — `git show <commit>:<path>`, the read a routine makes
 * when it already knows which commit to ask: a `concept_index` row names its own commit and
 * its own path, so this is how the platform reads back the file that row describes without
 * walking a history for it.
 *
 * `null` for a path that commit's tree does not hold, and for a path outside the bundle: a
 * caller asking about a file that is not there is asking a fair question, and the answer is
 * that there is nothing there — not a failure. Raw, so what comes back is the file's bytes
 * with their own trailing newline, which is what a content hash is taken over.
 */
export const fileAt = async (
  platform: PlatformPrincipal,
  door: GitDoor,
  workspaceId: string,
  sha: string,
  filePath: string,
): Promise<string | null> => {
  if (!isPortablePath(filePath)) return null;
  try {
    return await git(repositoryPath(door, workspaceId), ["show", `${sha}:${filePath}`], {
      raw: true,
    });
  } catch {
    // A path the tree does not hold, or a commit this repository does not: `git show` has no
    // way of saying either but a non-zero exit, and neither is something a caller can act on.
    return null;
  }
};

/**
 * The **history rewrite** — the erasure routine's git step (ADR 0020; ADR 0012; the S0 spec,
 * step 3).
 *
 * The one entry here that changes a commit already written. Every other write this door makes
 * adds to a history; this one replaces it, which is why it is a routine with a report against
 * it and not an act a person can reach. It runs `git filter-repo`, the tool ADR 0020 fixes,
 * because a rewrite of a whole history is a thing to consume and not a thing to write (ADR
 * 0005) — and the app runs it, the app being the only writer of the bundle (ADR 0012) and the
 * worker holding no git credential, which is why a rewrite in the worker was rejected.
 *
 * **The shelling out is this door's and never a slice's.** A slice that ran git for an erasure
 * would be a second place that knows where a workspace's repository lives, and that arithmetic
 * is the one thing this module exists to keep.
 *
 * The caller holds the per-repository lock across this call and across whatever it writes
 * about the result, because a rewrite and the rows that name its commits have to move together
 * or the reconciler finds a head its watermark cannot reach.
 */

/**
 * Who the rewrite is about in this repository, and what they become.
 *
 * The addresses are the identifier set's, because the two places a bundle names a person are
 * both by address: a concept file's `generated.by` and `verified[].by` carry `human:<address>`
 * (ADR 0019) and a commit's author line carries the address itself. The records keep
 * `human:<person id>` instead and are never rewritten — the decision `kernel/actor.ts` writes
 * down, and the reason this takes addresses and no person id.
 *
 * The **erasure pseudonym** (`CONTEXT.md`) is what replaces them: minted at erasure, one per
 * workspace, never the person id, so two workspaces' rewritten histories cannot be joined on
 * one person (ADR 0035; ADR 0020, amended 2026-09-05).
 */
export type Pseudonymisation = {
  readonly addresses: readonly string[];
  readonly pseudonym: string;
};

/**
 * What the rewrite moved: one pair per commit whose hash changed, old then new.
 *
 * A commit the rewrite left where it was is **not** here. The caller's work is to carry rows
 * that name a hash onto the hash that replaced it, and a commit that did not move is a row
 * with nothing to do — so the empty list is the whole answer for a repository that named
 * nobody, which is what makes a second run of the routine a run that writes nothing.
 */
export type HistoryRewritten = {
  readonly moved: readonly (readonly [string, string])[];
};

const NOTHING_MOVED: HistoryRewritten = { moved: [] };

/**
 * Where a rewritten author line points. `.invalid` is reserved and resolves nowhere (RFC
 * 2606), as the platform bot's address above is: an author line has to carry *an* address, and
 * the one it carries after an erasure must not be a mailbox anybody can reach.
 *
 * Exported because the identity set's tombstone is the same address (the S0 spec, step 5): one
 * person erased in one workspace is one address wherever the platform had written theirs, and
 * two domains for one idea would be two things to keep in step.
 */
export const ERASED_DOMAIN = "erased.better-answers.invalid";

/**
 * The characters Python's own `re.escape` escapes, which is the dialect `filter-repo` compiles
 * a `regex:` expression in. An address is matched as literal text, so each of them is
 * neutralised before it reaches that compiler — `+` in a tagged address and `.` in a domain
 * are the two that would otherwise match text belonging to somebody else.
 */
const PYTHON_SPECIAL = /[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g;

const escapedForPython = (literal: string): string =>
  literal.replace(PYTHON_SPECIAL, (character) => `\\${character}`);

/**
 * One replacement expression per address, matched **without regard to case**, because the two
 * ends were typed by different people: the address in the identifier set by whoever made the
 * request, the one in the file by whoever wrote the concept. `historyNaming` reads the history
 * the same way, so a rewrite that matched case would leave behind exactly the naming the map
 * had just reported.
 *
 * `filter-repo` splits each line on its **last** `==>`, and what follows here is a minted id,
 * so the separator cannot be mistaken for part of an expression however an address was spelled.
 */
const replacementsFor = (addresses: readonly string[], pseudonym: string): string =>
  addresses
    .map(
      (address) =>
        `regex:(?i)${escapedForPython(`${PERSON_PREFIX}${address}`)}==>${PERSON_PREFIX}${pseudonym}\n`,
    )
    .join("");

/**
 * The identities in this history that name the person, each address spelled the way the
 * commits spell it — read off the history rather than taken from the identifier set, because
 * a mailmap matches an address as written and the two ends were typed by different people. An
 * address the request spells in lower case and a commit signs in another is one identity, and
 * this is where the two are reconciled.
 *
 * Both lines a commit carries are read. The committer is the platform bot on every commit this
 * door writes, but a repository restored from elsewhere is not this door's to assume about.
 */
const identitiesNaming = async (
  gitDir: string,
  needles: readonly string[],
): Promise<readonly string[]> => {
  const logged = await git(gitDir, ["log", "--all", "--format=%an%x00%ae%x00%cn%x00%ce"]);
  // Keyed by the lowered address so one identity signed two ways is one mailmap line, and
  // valued by the spelling the history holds, which is what a mailmap has to match.
  const found = new Map<string, string>();
  for (const line of logged.split("\n")) {
    const [author = "", authorAddress = "", committer = "", committerAddress = ""] =
      line.split("\0");
    for (const [name, address] of [
      [author, authorAddress],
      [committer, committerAddress],
    ] as const) {
      if (address !== "" && carries(`${name} <${address}>`, needles)) {
        found.set(address.toLowerCase(), address);
      }
    }
  }
  return [...found.values()];
};

/**
 * The mailmap, which is how an author line is rewritten: `Proper Name <proper@address> <the
 * address on the commit>`. The display name goes with the address — a mailmap replaces both —
 * and what stands in their place is the one id the rest of the rewrite names this person by.
 */
const mailmapFor = (addresses: readonly string[], pseudonym: string): string =>
  addresses
    .map((address) => `${PERSON_PREFIX}${pseudonym} <${pseudonym}@${ERASED_DOMAIN}> <${address}>\n`)
    .join("");

/**
 * `filter-repo` is run **inside** the repository rather than through `--git-dir`, which it does
 * not take: it reads the repository from the working directory, and a bare repository is its
 * own. The environment is the parent's plus `LC_ALL=C`, as every other call here is.
 */
const filterRepo = async (gitDir: string, arguments_: readonly string[]): Promise<void> => {
  await run("git", ["filter-repo", ...arguments_], {
    cwd: gitDir,
    env: { ...process.env, LC_ALL: "C" },
    maxBuffer: 64 * 1024 * 1024,
  });
};

/** A commit `filter-repo` dropped rather than carried over: the mapping it writes for one. */
const DROPPED = "0".repeat(40);

const COMMIT_MAP_LINE = /^([0-9a-f]{40})\s+([0-9a-f]{40})$/;

/**
 * The mapping read back from the file `filter-repo` writes under the repository it rewrote,
 * rather than worked out by rewriting the history a second time in our own head. It is the
 * tool's own record of what it did, and the only thing that knows which commit became which.
 *
 * Two things about that file decide this function's shape. It is **cumulative**: a second run
 * over the same repository leaves the first run's pairs in place and composes onto them, so a
 * pair whose old hash was not in the history *this* run started from belongs to a run already
 * accounted for and is skipped. And a commit the rewrite dropped is mapped to forty zeroes —
 * which cannot happen here because the pruning is turned off below, and which is a throw
 * rather than a silent skip if it ever does: a governed write whose commit has gone is a row
 * the ledger can no longer be joined to.
 */
const commitMapOf = async (
  gitDir: string,
  started: ReadonlySet<string>,
): Promise<readonly (readonly [string, string])[]> => {
  const mapped = await readFile(path.join(gitDir, "filter-repo", "commit-map"), "utf8");
  const moved: (readonly [string, string])[] = [];
  for (const line of mapped.split("\n")) {
    const match = COMMIT_MAP_LINE.exec(line.trim());
    const before = match?.[1];
    const after = match?.[2];
    if (before === undefined || after === undefined || !started.has(before)) continue;
    if (after === DROPPED) {
      throw new Error(`git: the history rewrite dropped commit ${before} rather than moving it`);
    }
    if (before !== after) moved.push([before, after]);
  }
  return moved;
};

/**
 * Rewrite this workspace's bundle so nothing in it names the person by address: every
 * `human:<address>` in a file or a commit message becomes `human:<erasure pseudonym>`, every
 * author line that address signed is mailmapped onto it, and the objects the old history held
 * are pruned, so `git cat-file -e` on a hash anybody kept answers with a failure.
 *
 * **It reads the history before it rewrites it and does nothing at all when nothing names the
 * person.** That is the whole of the routine's idempotence at this store, and it is a property
 * rather than a remembered check: the replay runs every completed request through the routine
 * again and has no branch that asks whether one already ran, so the second pass has to find an
 * unnamed history and leave it exactly where the first pass put it.
 *
 * Three things `filter-repo` does that this call is shaped around. It refuses to run on a
 * repository it does not take for a fresh clone — which any repository it has already
 * rewritten is — so `--force` is passed, and that is what makes a second run possible at all.
 * Pruning is turned **off** in both its senses, because one `bundle_commit` row names one
 * commit and a rewrite that dropped a commit for being empty would leave a governed write with
 * nothing to join to. And the tool repacks and expires as it finishes; the two commands ADR
 * 0020 names are run after it regardless, because the ADR's sentence is the contract and a
 * tool that quietly stopped doing it for us would leave the old objects reachable in silence.
 */
export const rewriteHistory = async (
  platform: PlatformPrincipal,
  door: GitDoor,
  workspaceId: string,
  who: Pseudonymisation,
): Promise<HistoryRewritten> => {
  const addresses = who.addresses.map((address) => address.trim()).filter((one) => one !== "");
  const pseudonym = who.pseudonym.trim();
  if (addresses.length === 0 || pseudonym === "") return NOTHING_MOVED;

  const naming = await historyNaming(platform, door, workspaceId, addresses);
  if (naming.blobs.length === 0 && naming.authors.length === 0) return NOTHING_MOVED;

  const gitDir = repositoryPath(door, workspaceId);
  const started = new Set(
    (await git(gitDir, ["rev-list", "--all"])).split("\n").filter((sha) => sha !== ""),
  );
  const signed = await identitiesNaming(gitDir, addresses);
  const written = await mkdtemp(path.join(tmpdir(), "better-answers-rewrite-"));
  try {
    const text = path.join(written, "replacements");
    const mailmap = path.join(written, "mailmap");
    await writeFile(text, replacementsFor(addresses, pseudonym), "utf8");
    await writeFile(mailmap, mailmapFor(signed, pseudonym), "utf8");
    await filterRepo(gitDir, [
      "--force",
      "--replace-text",
      text,
      // A commit message is text in this repository too, and an act's message is written by
      // the person whose address is being taken out of it.
      "--replace-message",
      text,
      // A history that names the person only inside its files signs nothing, and a mailmap
      // with no lines in it is a file to leave unpassed rather than one to hand over empty.
      ...(signed.length === 0 ? [] : ["--mailmap", mailmap]),
      "--prune-empty",
      "never",
      "--prune-degenerate",
      "never",
    ]);
    const moved = await commitMapOf(gitDir, started);
    // ADR 0020's two commands, in its words: the reflog first, because an entry in it is a
    // reference and `gc` does not prune what something still refers to.
    await git(gitDir, ["reflog", "expire", "--expire=now", "--all"]);
    await git(gitDir, ["gc", "--prune=now", "--quiet"]);
    return { moved };
  } finally {
    await rm(written, { recursive: true, force: true });
  }
};
