import type { Role, UserId } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

const ADMIN: Role = "Admin";

const REQUIRED = `
  SELECT u.operator OR EXISTS (SELECT 1 FROM member m WHERE m.user_id = u.id AND m.role = $2)
           AS required
    FROM "user" u WHERE u.id = $1`;

/**
 * Called inside the act making the person an Admin or the operator, before its own write. One
 * who needed no second factor until now has every session's confirmation and pending hour
 * cleared, and is marked promoted until they first confirm. True when so.
 */
export const promoting = async (tx: Tx, personId: UserId): Promise<boolean> => {
  const held = await tx.query<{ required: boolean }>(REQUIRED, [personId, ADMIN]);
  if (held.rows[0]?.required !== false) return false;
  await tx.query(
    "UPDATE session SET second_factor_confirmed_at = NULL, pending_since = NULL WHERE user_id = $1",
    [personId],
  );
  await tx.query('UPDATE "user" SET promoted_at = now() WHERE id = $1', [personId]);
  return true;
};
