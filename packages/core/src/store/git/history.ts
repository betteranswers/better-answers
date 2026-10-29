import {
  err,
  isPortablePath,
  normalizeError,
  ok,
  type PlatformPrincipal,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";
import {
  repositoryPath,
  standingHead,
  git,
  BUNDLE_REF,
  exitStatusOf,
  stderrOf,
  bundleOf,
  headOf,
  type GitDoor,
} from "./door.ts";

export const commitsAfter = async (
  platform: PlatformPrincipal,
  door: GitDoor,
  workspaceId: string,
  since: string | null,
): Promise<
  Result<
    { readonly head: string | null; readonly missed: readonly string[] },
    "no-such-repository" | "history-diverged" | Error
  >
> => {
  const gitDir = repositoryPath(door, workspaceId);
  const standing = await standingHead(gitDir);
  if (!standing.ok) return err(standing.error);
  const headCommit = standing.value;
  if (headCommit === null)
    return since === null ? ok({ head: headCommit, missed: [] }) : err("history-diverged");
  if (since !== null) {
    try {
      await git(gitDir, ["merge-base", "--is-ancestor", since, BUNDLE_REF]);
    } catch {
      return err("history-diverged");
    }
  }
  try {
    const listed = await git(gitDir, [
      "rev-list",
      "--reverse",
      since === null ? BUNDLE_REF : `${since}..${BUNDLE_REF}`,
    ]);
    return ok({ head: headCommit, missed: listed.split("\n").filter((sha) => sha !== "") });
  } catch (cause) {
    return err(normalizeError(cause));
  }
};

export type HistoryNaming = {
  readonly blobs: readonly { readonly commit: string; readonly path: string }[];

  readonly authors: readonly string[];
};

const NAMES_NOBODY: HistoryNaming = { blobs: [], authors: [] };

export const carries = (line: string, needles: readonly string[]): boolean => {
  const lowered = line.toLowerCase();
  return needles.some((needle) => lowered.includes(needle.toLowerCase()));
};

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

export const allCommits = async (gitDir: string): Promise<readonly string[]> =>
  (await git(gitDir, ["rev-list", "--all"])).split("\n").filter((sha) => sha !== "");

export const historyNaming = async (
  platform: PlatformPrincipal,
  door: GitDoor,
  workspaceId: string,
  needles: readonly string[],
): Promise<HistoryNaming> => {
  const wanted = needles.filter((needle) => needle.trim() !== "");
  if (wanted.length === 0) return NAMES_NOBODY;
  const gitDir = repositoryPath(door, workspaceId);
  const history = await allCommits(gitDir);

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

const TRAILER_LINE = /^([A-Za-z][A-Za-z-]*): (.+)$/u;

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

const soleParentOf = (parents: string): string | null => {
  const parentList = parents.split(" ").filter((parent) => parent !== "");
  return parentList.length === 1 ? (parentList[0] ?? null) : null;
};

const addedOrModified = (changed: string): readonly string[] => {
  const fields = changed.split("\0");
  const files: string[] = [];
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const [status, file] = [fields[at], fields[at + 1]];

    if ((status === "A" || status === "M") && file !== undefined && file !== "") files.push(file);
  }
  return files;
};

const changeIn = async (gitDir: string, sha: string): Promise<CommitRead["change"]> => {
  const changed = await git(gitDir, [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--name-status",
    "-r",
    "-z",
    sha,
  ]);
  const files = addedOrModified(changed);
  const file = files[0];
  return files.length === 1 && file !== undefined
    ? { path: file, content: await git(gitDir, ["show", `${sha}:${file}`], { raw: true }) }
    : undefined;
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
  const change = await changeIn(gitDir, sha);
  return {
    sha: id,
    parent: soleParentOf(parents),
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
