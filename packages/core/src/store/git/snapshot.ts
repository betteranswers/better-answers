import { BUNDLE_MANIFEST_PATH } from "@better-answers/schema";

import { err, ok, type Result, type UserPrincipal } from "../../kernel/index.ts";
import { bundleOf, git, gitBytes, headOf, type GitDoor } from "./door.ts";

type SnapshotFile = { readonly path: string; readonly bytes: Uint8Array };

type BundleSnapshot = { readonly head: string; readonly files: readonly SnapshotFile[] };

/** Every kept blob is held in memory at once, so the snapshot refuses past this many bytes. */
const SNAPSHOT_BYTES_MAX = 256 * 1024 * 1024;

const KNOWLEDGE = "knowledge/";

/** `<mode> <type> <object> <size>\t<path>`, as `ls-tree -l` writes each entry. */
const LISTED = /^(?:100644|100755) blob ([0-9a-f]+) +(\d+)\t(.+)$/su;

/** An object id, a type and a size around two line feeds, with room for a SHA-256 id. */
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
      throw new Error(`git: read ${header} where blob ${object} of ${path} was asked for`);
    }
    at = lineEnd + 1 + size + 1;
    return { path, bytes: batch.subarray(lineEnd + 1, lineEnd + 1 + size) };
  });
};

/** The manifest and `readable` paths under `knowledge/` at one head; null for a bundle with none. */
export const bundleSnapshot = async (
  principal: UserPrincipal,
  door: GitDoor,
  readable: ReadonlySet<string>,
): Promise<Result<BundleSnapshot | null, "export-too-large">> => {
  const gitDir = bundleOf(door, principal);
  const head = await headOf(gitDir);
  if (head === null) return ok(null);
  const tree = await git(gitDir, ["ls-tree", "-r", "-z", "-l", head, KNOWLEDGE], { raw: true });
  const kept = listedIn(tree).filter(
    ({ path }) => path === BUNDLE_MANIFEST_PATH || readable.has(path),
  );
  const bytes = kept.reduce((sum, { size }) => sum + size, 0);
  if (bytes > (door.snapshotBytesMax ?? SNAPSHOT_BYTES_MAX)) return err("export-too-large");
  if (kept.length === 0) return ok({ head, files: [] });
  const batch = await gitBytes(gitDir, ["cat-file", "--batch", "--buffer"], {
    input: kept.map(({ object }) => `${object}\n`).join(""),
    maxBuffer: bytes + kept.length * BATCH_FRAMING,
  });
  return ok({ head, files: blobsIn(batch, kept) });
};
