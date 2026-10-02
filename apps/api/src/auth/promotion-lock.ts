import { type PostgresDoor, withIdentityWrite } from "@better-answers/core/store/postgres";

import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";

/**
 * Better Auth's name for the lock it holds while it proves an unverified person's address, the
 * person's id following it (`dist/db/revoke-unproven-account-access.mjs`).
 */
export const PROMOTION_LOCK_PREFIX = "revoke-unproven-account-access:";

/**
 * A lock left by a dead sign-in makes the next skip ending earlier access; a live one stays.
 * Answers how many rows went.
 */
export const dropAnExpiredPromotionLock = async (
  door: PostgresDoor,
  email: string,
  now: Date,
): Promise<number> => {
  const dropped = await withIdentityWrite(IDENTITY_PRINCIPAL, door, (tx) =>
    tx.query(
      `DELETE FROM verification v USING "user" u
        WHERE u.email = $1 AND NOT u.email_verified
          AND v.identifier = $2::text || u.id AND v.expires_at <= $3`,
      [email.toLowerCase(), PROMOTION_LOCK_PREFIX, now],
    ),
  );
  return dropped.rowCount ?? 0;
};
