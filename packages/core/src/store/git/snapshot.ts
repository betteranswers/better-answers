import { BUNDLE_MANIFEST_PATH } from "@better-answers/schema";

import { err, ok, type Result, type UserPrincipal } from "../../kernel/index.ts";
import { bundleOf, git, gitBytes, type GitDoor } from "./door.ts";

type SnapshotFile = { readonly path: string; readonly bytes: Uint8Array };

const HELD_IN_MEMORY_BYTES_MAX = 256 * 1024 * 1024;

const KNOWLEDGE = "knowledge/";

/** `<mode> <type> <object> <size>\t<path>`, as `ls-tree -l` writes each entry. */
const LISTED = /^(?:100644|100755) blob ([0-9a-f]+) +(\d+)\t(.+)$/su;

/**
 * Bytes for each blob's header line (object id, type and size) and its two line feeds, with room
 * for a SHA-256 id.
 */
const BATCH_FRAMING = 128;

type Listed = { readonly path: string; readonly object: string; readonly size: number };

const listedIn = (tree: string): readonly Listed[] =>
  tree.split("\0").flatMap((entry) => {
    const [, object, size, path] = LISTED.exec(entry) ?? [];
    return object === undefined || size === undefined || path === undefined
      ? []
      : [{ path, object, size: Number(size) }];
  });

const blobsIn = (batch: Buffer, kept: readonly Listed[]): readonly SnapshotFile[] => {
  let at = 0;
  return kept.map(({ path, object, size }) => {
    const lineEnd = batch.indexOf(0x0a, at);
    const header = batch.toString("utf8", at, lineEnd);
    if (header !== `${object} blob ${String(size)}`) {
      throw new Error(`git: expected blob ${object} for ${path}, but read header ${header}`);
    }
    at = lineEnd + 1 + size + 1;
    return { path, bytes: batch.subarray(lineEnd + 1, lineEnd + 1 + size) };
  });
};

const commitStands = async (gitDir: string, commit: string): Promise<boolean> => {
  try {
    await git(gitDir, ["cat-file", "-e", `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};

const snapshotAt = async (
  gitDir: string,
  door: GitDoor,
  commit: string,
  readable: ReadonlySet<string>,
): Promise<Result<readonly SnapshotFile[], "export-too-large">> => {
  const tree = await git(gitDir, ["ls-tree", "-r", "-z", "-l", commit, KNOWLEDGE], { raw: true });
  const kept = listedIn(tree).filter(
    ({ path }) => path === BUNDLE_MANIFEST_PATH || readable.has(path),
  );
  const bytes = kept.reduce((sum, { size }) => sum + size, 0);
  if (bytes > (door.snapshotBytesMax ?? HELD_IN_MEMORY_BYTES_MAX)) return err("export-too-large");
  if (kept.length === 0) return ok([]);
  const batch = await gitBytes(gitDir, ["cat-file", "--batch", "--buffer"], {
    input: kept.map(({ object }) => `${object}\n`).join(""),
    maxBuffer: bytes + kept.length * BATCH_FRAMING,
  });
  return ok(blobsIn(batch, kept));
};

/** An erasure rewrites the history and prunes the commits it replaced, even mid-read. */
export const bundleSnapshot = async (
  principal: UserPrincipal,
  door: GitDoor,
  commit: string,
  readable: ReadonlySet<string>,
): Promise<Result<readonly SnapshotFile[], "export-too-large" | "commit-gone">> => {
  const gitDir = bundleOf(door, principal);
  try {
    return await snapshotAt(gitDir, door, commit, readable);
  } catch (cause) {
    if (await commitStands(gitDir, commit)) throw cause;
    return err("commit-gone");
  }
};
