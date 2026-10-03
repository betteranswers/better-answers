import { randomBytes } from "node:crypto";

import type pg from "pg";

import { hashOfTyped } from "../src/workspaces/index.ts";
import { restoreCodeFor } from "./identity-rows.ts";

/** How long the operator's restore code stays good. */
const RESTORE_CODE_LIFETIME_MS = 24 * 60 * 60_000;

/**
 * An operator's restore: the person marked restored, a fresh code kept as its hash. Answers the code.
 * @throws when no person holds `email`.
 */
export const restoredWithACode = async (
  pool: pg.Pool,
  email: string,
  now: Date,
): Promise<string> => {
  const marked = await pool.query(
    'UPDATE "user" SET restore_required_at = $2 WHERE lower(email) = lower($1)',
    [email, now],
  );
  if (marked.rowCount !== 1) throw new Error(`no person holds ${email}`);
  const code = randomBytes(10).toString("hex");
  await restoreCodeFor(pool, email, {
    hash: hashOfTyped(code),
    expiresAt: new Date(now.getTime() + RESTORE_CODE_LIFETIME_MS),
  });
  return code;
};
