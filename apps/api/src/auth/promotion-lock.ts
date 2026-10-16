import { type PostgresDoor, withIdentityWrite } from "@better-answers/core/store/postgres";

import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";

export const PROMOTION_LOCK_PREFIX = "revoke-unproven-account-access:";

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
