import type { UserId } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { notErasedAt } from "./display-name.ts";

/**
 * Locks the person's row until commit, so actions on their second factor run one at a time and each
 * rechecks what the last one left. False when no unerased person holds the id.
 */
export const holdThePerson = async (tx: Tx, personId: UserId): Promise<boolean> => {
  const held = await tx.query(
    `SELECT 1 FROM "user" WHERE id = $1 AND ${notErasedAt("email")} FOR UPDATE`,
    [personId],
  );
  return (held.rowCount ?? 0) > 0;
};
