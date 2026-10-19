import type pg from "pg";
import { describe, expect, it } from "vitest";

import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { ADMITTED, postgresForSuite, privilegesHeld, refusalOf, sqlstateOf } from "./probes.ts";

const db = postgresForSuite();

const readBeforeTheHook = ((): unknown => {
  try {
    return db();
  } catch (error) {
    return error;
  }
})();

const workspacesIn = async (client: pg.PoolClient): Promise<number> =>
  (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM workspace")).rows[0]?.n ?? -1;

describe("the suite's database", () => {
  it("the suite's getter throws before its beforeAll has run", () => {
    expect(readBeforeTheHook).toBeInstanceOf(Error);
  });

  it("is open once its beforeAll has run", async () => {
    const answered = await db().pool.query<{ one: number }>("SELECT 1 AS one");

    expect(answered.rows).toEqual([{ one: 1 }]);
  });
});

describe("the probes", () => {
  it("sqlstateOf answers none for an error with no code", () => {
    expect({
      coded: sqlstateOf(Object.assign(new Error("refused"), { code: "42501" })),
      uncoded: sqlstateOf(new Error("refused")),
    }).toEqual({ coded: "42501", uncoded: "none" });
  });

  it("privilegesHeld asks of every table privilege the image has", async () => {
    const asked = await withRollback(db().pool, async (client) => {
      const held = await privilegesHeld(client, "app_rt", "model_choice");
      const every = await client.query<{ privilege: string }>(
        "SELECT DISTINCT privilege_type AS privilege FROM aclexplode(acldefault('r', 10))",
      );
      return {
        asked: Object.keys(held).toSorted(),
        every: every.rows.map((row) => row.privilege).toSorted(),
      };
    });

    expect(asked.asked).toEqual(asked.every);
  });

  it("refusalOf leaves no row behind, admitted or refused", async () => {
    const probed = await withRollback(db().pool, async (client) => {
      const seed = testData(client);
      const standing = await seed.workspace();
      const before = await workspacesIn(client);

      const admitted = await refusalOf(client, () => seed.workspace());
      const afterAdmitted = await workspacesIn(client);
      const refused = await refusalOf(client, () => seed.workspace({ id: standing.id }));

      return {
        admitted,
        refused,
        added: [afterAdmitted, await workspacesIn(client)].map((n) => n - before),
      };
    });

    expect(probed).toEqual({ admitted: ADMITTED, refused: "workspace_pkey", added: [0, 0] });
  });
});
