import { openPostgres } from "../src/store/postgres/index.ts";
import { sessionFor } from "./identity-rows.ts";
import { postgresForSuite } from "./suite-postgres.ts";

export const AT = new Date("2026-10-02T12:00:00.000Z");

const EXPIRES_AT = new Date("2026-10-09T12:00:00.000Z");

/** The age `aSession` writes, so carrying it moves nothing. */
export const ITS_OWN_AGE = { createdAt: AT, expiresAt: EXPIRES_AT };

/** A suite's database, and the reads its second-factor tests share; called once per test file. */
export const secondFactorSuite = () => {
  const db = postgresForSuite();
  const query = <Row extends object>(sql: string, values: readonly unknown[]) =>
    db().pool.query<Row>(sql, [...values]);

  return {
    db,
    door: () => openPostgres(db().runtimePool),

    aSession: (userId: string, pendingSince?: Date) =>
      sessionFor(db().pool, userId, {
        createdAt: AT,
        lastUsedAt: AT,
        expiresAt: EXPIRES_AT,
        ...(pendingSince === undefined ? {} : { pendingSince }),
      }),

    identitySetRowsFor: async (personId: string) =>
      (
        await query<{ act: string; detail: unknown }>(
          "SELECT action AS act, detail FROM identity_audit_event WHERE subject_id = $1 ORDER BY at, id",
          [personId],
        )
      ).rows,

    confirmedAt: async (sessionId: string) =>
      (
        await query<{ confirmed: Date | null; pending: Date | null }>(
          "SELECT second_factor_confirmed_at AS confirmed, pending_since AS pending FROM session WHERE id = $1",
          [sessionId],
        )
      ).rows[0],

    recoveryCodesHeldBy: async (personId: string) =>
      (
        await query<{ count: number }>(
          "SELECT count(*)::int AS count FROM recovery_code WHERE user_id = $1",
          [personId],
        )
      ).rows[0]?.count,
  };
};
