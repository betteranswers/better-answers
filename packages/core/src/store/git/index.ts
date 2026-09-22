import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  err,
  isPortablePath,
  normalizeError,
  ok,
  PERSON_PREFIX,
  type ActorId,
  type PlatformPrincipal,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";

const run = promisify(execFile);

export type GitDoor = {
  readonly root: string;
};

export type GitRootRefusal = "root-not-absolute" | "no-such-root";

export const openGit = (root: string): Result<GitDoor, GitRootRefusal> => {
  if (!path.isAbsolute(root)) return err("root-not-absolute");
  try {
    if (!statSync(root).isDirectory()) return err("no-such-root");
  } catch {
    return err("no-such-root");
  }
  return ok({ root });
};

const BUNDLE_REF = "refs/heads/main";

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

export type CommitRequest = {
  readonly path: string;
  readonly content: string;

  readonly message: string;
  readonly author: CommitAuthor;
  readonly trailers: CommitTrailers;

  readonly expectedHead: string | null;

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

const repositoryPath = (door: GitDoor, workspaceId: string): string =>
  path.join(door.root, `${workspaceId}.git`);

const bundleOf = (door: GitDoor, principal: UserPrincipal): string =>
  repositoryPath(door, principal.workspaceId);

// `env` replaces rather than extends, so the spread keeps PATH; `LC_ALL=C` keeps git's
// messages English for the compare-and-swap match below.
const childEnvironment = (added: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  ...added,
  LC_ALL: "C",
});

const git = async (
  gitDir: string,
  arguments_: readonly string[],
  options: {
    readonly input?: string;
    readonly env?: Readonly<Record<string, string>>;

    readonly raw?: boolean;
  } = {},
): Promise<string> => {
  const child = run("git", ["--git-dir", gitDir, ...arguments_], {
    env: childEnvironment(options.env),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (options.input !== undefined) {
    child.child.stdin?.end(options.input);
  }
  const { stdout } = await child;
  return options.raw === true ? stdout : stdout.trim();
};

const exitStatusOf = (cause: unknown): number | null => {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return null;
  const { code } = cause;
  return typeof code === "number" ? code : null;
};

const stderrOf = (cause: unknown): string => {
  if (typeof cause !== "object" || cause === null || !("stderr" in cause)) return "";
  const { stderr } = cause;
  return typeof stderr === "string" ? stderr.trim() : "";
};

export const initRepository = async (door: GitDoor, workspaceId: string): Promise<string> => {
  const gitDir = repositoryPath(door, workspaceId);
  await run("git", ["init", "--bare", "--initial-branch", "main", gitDir]);
  return gitDir;
};

export const head = (principal: UserPrincipal, door: GitDoor): Promise<string | null> =>
  headOf(bundleOf(door, principal));

const headOf = async (gitDir: string): Promise<string | null> => {
  try {
    return await git(gitDir, ["rev-parse", "--verify", `${BUNDLE_REF}^{commit}`]);
  } catch {
    return null;
  }
};

const isSubjectLine = (message: string): boolean => message.length > 0 && !/[\r\n]/.test(message);

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

export const commit = async (
  principal: UserPrincipal,
  door: GitDoor,
  request: CommitRequest,
): Promise<Result<Committed, CommitRefusal | Error>> => {
  if (!isPortablePath(request.path)) return err("malformed-path");
  const trailers = trailerLines(request.trailers);
  if (!isSubjectLine(request.message) || trailers === undefined) return err("malformed-message");
  const gitDir = bundleOf(door, principal);

  try {
    await run("git", ["--git-dir", gitDir, "rev-parse", "--git-dir"]);
  } catch {
    return err("no-such-repository");
  }

  const parent = await head(principal, door);
  if (parent !== request.expectedHead) return err("stale-precondition");

  const index = await mkdtemp(path.join(tmpdir(), "better-answers-index-"));
  try {
    const indexFile = path.join(index, "index");
    const env = { GIT_INDEX_FILE: indexFile };

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

          GIT_AUTHOR_NAME: request.author.name,
          GIT_AUTHOR_EMAIL: request.author.email,
          GIT_AUTHOR_DATE: at,
          GIT_COMMITTER_NAME: PLATFORM_BOT.name,
          GIT_COMMITTER_EMAIL: PLATFORM_BOT.email,
          GIT_COMMITTER_DATE: at,
        },
      },
    );

    await git(gitDir, ["update-ref", BUNDLE_REF, sha, parent ?? ""]);
    return ok({ sha, parent });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/cannot lock ref|reference already exists|but expected/i.test(message)) {
      return err("stale-precondition");
    }
    return err(cause instanceof Error ? cause : new Error(message));
  } finally {
    await rm(index, { recursive: true, force: true });
  }
};

const locks = new Map<string, Promise<unknown>>();

export const withRepositoryLock = <T>(
  principal: UserPrincipal,
  door: GitDoor,
  work: () => Promise<T>,
): Promise<T> => lockedRepository(bundleOf(door, principal), work);

export const withRepositoryLockAs = <T>(
  platform: PlatformPrincipal,
  door: GitDoor,
  workspaceId: string,
  work: () => Promise<T>,
): Promise<T> => lockedRepository(repositoryPath(door, workspaceId), work);

const lockedRepository = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const ahead = locks.get(key) ?? Promise.resolve();
  const mine = ahead.then(work, work);

  const chained = mine.catch(() => undefined);
  locks.set(key, chained);
  try {
    return await mine;
  } finally {
    if (locks.get(key) === chained) locks.delete(key);
  }
};

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
    return err("no-such-repository");
  }
  const head = await headOf(gitDir);
  if (head === null) return since === null ? ok({ head, missed: [] }) : err("history-diverged");
  if (since !== null) {
    try {
      await git(gitDir, ["merge-base", "--is-ancestor", since, BUNDLE_REF]);
    } catch {
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

export type HistoryNaming = {
  readonly blobs: readonly { readonly commit: string; readonly path: string }[];

  readonly authors: readonly string[];
};

const NAMES_NOBODY: HistoryNaming = { blobs: [], authors: [] };

const carries = (line: string, needles: readonly string[]): boolean => {
  const lowered = line.toLowerCase();
  return needles.some((needle) => lowered.includes(needle.toLowerCase()));
};

// git grep exits 1 both for no match and for an object it could not read; only the silent one
// means nobody is named.
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
  ]).catch((cause: unknown) => {
    if (exitStatusOf(cause) === 1 && stderrOf(cause) === "") return "";
    throw normalizeError(cause);
  });
  return listed.split("\n").flatMap((entry) => {
    const at = entry.indexOf(":");
    const file = entry.slice(at + 1);
    return at === -1 || file === "" ? [] : [{ commit: entry.slice(0, at), path: file }];
  });
};

const authorsNaming = async (
  gitDir: string,
  needles: readonly string[],
): Promise<readonly string[]> => {
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

  if (history.length === 0) return NAMES_NOBODY;
  return {
    blobs: await blobsNaming(gitDir, wanted, history),
    authors: await authorsNaming(gitDir, wanted),
  };
};

export type CommitRead = {
  readonly sha: string;
  readonly parent: string | null;

  readonly trailers: Readonly<Record<string, string>>;
  readonly change: { readonly path: string; readonly content: string } | undefined;
};

const TRAILER_LINE = /^([A-Za-z][A-Za-z-]*): (.+)$/;

const trailersOf = (message: string) => {
  // The last paragraph, never the first match: isSubjectLine keeps a forged trailer out at the
  // write door, and this is the read half.
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

  const shown = await git(gitDir, ["show", "-s", "--format=%H%x00%P%x00%B", sha]);
  const [id = "", parents = "", ...message] = shown.split("\0");
  const parentList = parents.split(" ").filter((parent) => parent !== "");

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

const fileIn = async (
  gitDir: string,
  revision: string,
  filePath: string,
): Promise<string | null> => {
  try {
    return await git(gitDir, ["show", `${revision}:${filePath}`], { raw: true });
  } catch (thrown) {
    const listed = await git(gitDir, ["ls-tree", "--name-only", revision, "--", filePath]);
    if (listed === "") return null;
    throw normalizeError(thrown);
  }
};

export const fileAt = async (
  platform: PlatformPrincipal,
  door: GitDoor,
  workspaceId: string,
  sha: string,
  filePath: string,
): Promise<string | null> =>
  isPortablePath(filePath) ? fileIn(repositoryPath(door, workspaceId), sha, filePath) : null;

export const fileAtHead = async (
  principal: UserPrincipal,
  door: GitDoor,
  filePath: string,
): Promise<string | null> => {
  if (!isPortablePath(filePath)) return null;
  const gitDir = bundleOf(door, principal);
  return (await headOf(gitDir)) === null ? null : fileIn(gitDir, BUNDLE_REF, filePath);
};

export type Pseudonymisation = {
  readonly addresses: readonly string[];
  readonly pseudonym: string;
};

export type HistoryRewritten = {
  readonly moved: readonly (readonly [string, string])[];
};

const NOTHING_MOVED: HistoryRewritten = { moved: [] };

export const ERASED_DOMAIN = "erased.better-answers.invalid";

const PYTHON_SPECIAL = /[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g;

const escapedForPython = (literal: string): string =>
  literal.replace(PYTHON_SPECIAL, (character) => `\\${character}`);

const replacementsFor = (addresses: readonly string[], pseudonym: string): string =>
  addresses
    .map(
      (address) =>
        `regex:(?i)${escapedForPython(`${PERSON_PREFIX}${address}`)}==>${PERSON_PREFIX}${pseudonym}\n`,
    )
    .join("");

const identitiesNaming = async (
  gitDir: string,
  needles: readonly string[],
): Promise<readonly string[]> => {
  const logged = await git(gitDir, ["log", "--all", "--format=%an%x00%ae%x00%cn%x00%ce"]);

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

const mailmapFor = (addresses: readonly string[], pseudonym: string): string =>
  addresses
    .map((address) => `${PERSON_PREFIX}${pseudonym} <${pseudonym}@${ERASED_DOMAIN}> <${address}>\n`)
    .join("");

const filterRepo = async (gitDir: string, arguments_: readonly string[]): Promise<void> => {
  await run("git", ["filter-repo", ...arguments_], {
    cwd: gitDir,
    env: childEnvironment(),
    maxBuffer: 64 * 1024 * 1024,
  });
};

const DROPPED = "0".repeat(40);

const COMMIT_MAP_LINE = /^([0-9a-f]{40})\s+([0-9a-f]{40})$/;

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

      "--replace-message",
      text,

      ...(signed.length === 0 ? [] : ["--mailmap", mailmap]),
      "--prune-empty",
      "never",
      "--prune-degenerate",
      "never",
    ]);
    const moved = await commitMapOf(gitDir, started);

    // The reflog first: an entry in it is a reference, and gc prunes nothing something still
    // refers to.
    await git(gitDir, ["reflog", "expire", "--expire=now", "--all"]);
    await git(gitDir, ["gc", "--prune=now", "--quiet"]);
    return { moved };
  } finally {
    await rm(written, { recursive: true, force: true });
  }
};
