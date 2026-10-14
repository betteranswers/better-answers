import { randomUUID } from "node:crypto";
import { symlink } from "node:fs/promises";

import type pg from "pg";

import { openGit, type GitDoor } from "@better-answers/core/store/git";

/** A history rewrite in another process, as the fence sees one: the workspace's lock held alone. */
export const rewritingElsewhere = async (pool: pg.Pool, workspaceId: string) => {
  const holder = await pool.connect();
  await holder.query("SELECT pg_advisory_lock(hashtext('bundle'), hashtext($1))", [workspaceId]);
  return {
    release: async (): Promise<void> => {
      await holder.query("SELECT pg_advisory_unlock(hashtext('bundle'), hashtext($1))", [
        workspaceId,
      ]);
      holder.release();
    },
  };
};

/**
 * The same repositories by another path, which the in-process lock keys apart: what a second
 * process writing the bundle looks like from this one.
 */
export const asAnotherProcess = async (git: GitDoor): Promise<GitDoor> => {
  const elsewhere = `${git.root}-elsewhere-${randomUUID()}`;
  await symlink(git.root, elsewhere);
  const opened = openGit(elsewhere);
  if (!opened.ok) throw new Error(`the second path did not open: ${opened.error}`);
  return opened.value;
};
