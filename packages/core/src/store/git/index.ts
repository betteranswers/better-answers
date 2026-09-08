import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  err,
  ok,
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
 * A path inside the bundle and nothing else: relative, no `..` segment, no leading slash.
 * The path reaches `update-index --cacheinfo`, which writes into the repository's object
 * graph rather than the filesystem, so this is not a traversal guard — it is what keeps a
 * bundle's tree readable by any OKF tool (ADR 0012's export promise).
 */
const isBundlePath = (candidate: string): boolean =>
  candidate.length > 0 &&
  !candidate.startsWith("/") &&
  // No control character: a tab or a newline in a path is a name no OKF tool reads back and
  // a line git's own listings would have to quote — and the reader below takes NUL-delimited
  // listings for exactly the characters git does quote, so this is what keeps the two
  // ends of the door agreeing on what a path can be.
  !candidate.split("").some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  }) &&
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
  principal: UserPrincipal,
  door: GitDoor,
  request: CommitRequest,
): Promise<Result<Committed, CommitRefusal | Error>> => {
  if (!isBundlePath(request.path)) return err("malformed-path");
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
