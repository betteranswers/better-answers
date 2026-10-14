import { randomUUID } from "node:crypto";
import { symlink } from "node:fs/promises";

import type pg from "pg";

import { openGit, type GitDoor } from "@better-answers/core/store/git";

const holdingTheFence = async (pool: pg.Pool, workspaceId: string, suffix: "" | "_shared") => {
  const holder = await pool.connect();
  await holder.query(`SELECT pg_advisory_lock${suffix}(hashtext('bundle'), hashtext($1))`, [
    workspaceId,
  ]);
  return {
    release: async (): Promise<void> => {
      await holder.query(`SELECT pg_advisory_unlock${suffix}(hashtext('bundle'), hashtext($1))`, [
        workspaceId,
      ]);
      holder.release();
    },
  };
};

/** A history rewrite in another process, as the fence sees one: the workspace's lock held alone. */
export const rewritingElsewhere = (pool: pg.Pool, workspaceId: string) =>
  holdingTheFence(pool, workspaceId, "");

/** A write in another process, as the fence sees one: the workspace's lock held shared. */
export const writingElsewhere = (pool: pg.Pool, workspaceId: string) =>
  holdingTheFence(pool, workspaceId, "_shared");

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
