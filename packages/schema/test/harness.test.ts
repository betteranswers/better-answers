import { describe, expect, it } from "vitest";

import { testData } from "./factory.ts";
import { whileAnAuditWriteIsOpen, withCommit, withRollback } from "./harness.ts";
import { postgresForSuite, sqlstateOf } from "./probes.ts";

const db = postgresForSuite();

const LOCK_NOT_AVAILABLE = "55P03";

const aShareLockOnTheAuditLog = (): Promise<string> =>
  withRollback(db().pool, async (client) => {
    try {
      await client.query("LOCK TABLE audit_event IN SHARE MODE NOWAIT");
      return "granted";
    } catch (error) {
      return sqlstateOf(error);
    }
  });

describe("the harness's pools", () => {
  it("connects pool as a superuser, whom no policy binds", async () => {
    const read = await withRollback(db().pool, async (client) => {
      await testData(client).modelChoice();
      const found = await client.query<{ superuser: boolean; modelChoices: number }>(
        `SELECT rolsuper AS superuser, (SELECT count(*)::int FROM model_choice) AS "modelChoices"
           FROM pg_roles WHERE rolname = current_user`,
      );
      return found.rows[0];
    });

    expect(read).toEqual({ superuser: true, modelChoices: 1 });
  });
});

describe("the harness's transactions", () => {
  it("withCommit keeps its writes for the next case", async () => {
    let written = "";
    await withCommit(db().pool, async (client) => {
      written = (await testData(client).modelChoice()).id;
    });

    const found = await db().pool.query("SELECT 1 FROM model_choice WHERE id = $1", [written]);

    expect(found.rowCount).toBe(1);
  });

  it("whileAnAuditWriteIsOpen holds audit_event row-exclusive until its work ends", async () => {
    const during = await whileAnAuditWriteIsOpen(db().pool, aShareLockOnTheAuditLog);

    expect({ during, after: await aShareLockOnTheAuditLog() }).toEqual({
      during: LOCK_NOT_AVAILABLE,
      after: "granted",
    });
  });
});
