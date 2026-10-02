import { type PostgresDoor, withIdentityWrite } from "@better-answers/core/store/postgres";

import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import { VERIFICATION_KEPT_PAST_EXPIRY_SECONDS } from "./constants.ts";

/** Answers how many rows went. */
export const dropExpiredVerifications = async (door: PostgresDoor, now: Date): Promise<number> => {
  const keptFrom = new Date(now.getTime() - VERIFICATION_KEPT_PAST_EXPIRY_SECONDS * 1000);
  const dropped = await withIdentityWrite(IDENTITY_PRINCIPAL, door, (tx) =>
    tx.query("DELETE FROM verification WHERE expires_at < $1", [keptFrom]),
  );
  return dropped.rowCount ?? 0;
};
