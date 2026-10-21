import type pg from "pg";
import { describe, expect, it } from "vitest";

import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { postgresForSuite, privilegesHeld, refusalOf, refusesEach } from "./probes.ts";
import {
  A_CALL_SERVING,
  A_PRICE_FROM_OCTOBER,
  A_RESERVATION_SERVING,
  A_THRESHOLD_OF,
} from "./rls-probes.ts";

const db = postgresForSuite();

const WS_A = "01J6AAAAAAAAAAAAAAAAAAAAAA";
const WS_B = "01J6BBBBBBBBBBBBBBBBBBBBBB";

const RECORD = "01J6QQQQQQQQQQQQQQQQQQQQQQ";

const spendInEach = async (client: pg.PoolClient): Promise<void> => {
  const seed = testData(client);
  for (const workspaceId of [WS_A, WS_B]) {
    await seed.workspace({ id: workspaceId, name: workspaceId });
    await seed.questionAsked({ workspaceId, id: RECORD });
    await seed.llmCall({ workspaceId, answerId: RECORD });
    await seed.spendReservation({ workspaceId, answerId: RECORD });
  }
};

const asTheApiIn = async (client: pg.PoolClient, workspaceId: string): Promise<void> => {
  await client.query("SET LOCAL ROLE app_rt");
  await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
};

const workspacesIn = async (client: pg.PoolClient, table: string): Promise<readonly string[]> => {
  const read = await client.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM ${table} ORDER BY workspace_id`,
  );
  return read.rows.map((row) => row.workspace_id);
};

describe("spend", () => {
  it("is kept from every other workspace", async () => {
    await withRollback(db().pool, async (client) => {
      await spendInEach(client);

      await asTheApiIn(client, WS_A);

      expect({
        calls: await workspacesIn(client, "llm_call"),
        reservations: await workspacesIn(client, "spend_reservation"),
      }).toEqual({ calls: [WS_A], reservations: [WS_A] });
    });
  });

  it("lets the api write a call's row, never change it", async () => {
    await withRollback(db().pool, async (client) => {
      const held = await privilegesHeld(client, "app_rt", "llm_call");

      expect(held).toMatchObject({ SELECT: true, INSERT: true, UPDATE: false, DELETE: false });
    });
  });

  it("leaves a reservation removable, never changeable, by the api", async () => {
    await withRollback(db().pool, async (client) => {
      const held = await privilegesHeld(client, "app_rt", "spend_reservation");

      expect(held).toMatchObject({ SELECT: true, INSERT: true, UPDATE: false, DELETE: true });
    });
  });

  it("gives the worker no privilege on any table", async () => {
    await withRollback(db().pool, async (client) => {
      const held = await Promise.all(
        ["llm_call", "spend_reservation", "model_price", "decision_threshold"].map(async (table) =>
          Object.values(await privilegesHeld(client, "worker_rt", table)),
        ),
      );

      expect(held.flat()).toEqual(held.flat().map(() => false));
    });
  });

  it("lets the api read prices with no workspace in scope", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query(A_PRICE_FROM_OCTOBER, ["anthropic"]);

      await asTheApiIn(client, "");

      const read = await client.query("SELECT model FROM model_price");
      expect(read.rows).toEqual([{ model: "claude-sonnet-5-5" }]);
    });
  });

  it("names exactly one of the run or the answer", async () => {
    await withRollback(db().pool, async (client) => {
      await spendInEach(client);
      const call = (runId: string | null, answerId: string | null) =>
        refusalOf(client, () =>
          client.query(A_CALL_SERVING, [
            WS_A,
            "01J6TTTTTTTTTTTTTTTTTTTTT9",
            "succeeded",
            runId,
            answerId,
          ]),
        );

      expect({
        neither: await call(null, null),
        both: await call("a run", RECORD),
        aRun: await call("a run", null),
      }).toEqual({
        neither: "llm_call_served_check",
        both: "llm_call_served_check",
        aRun: "admitted",
      });
    });
  });

  it("refuses an outcome the cost ledger does not name", async () => {
    await withRollback(db().pool, async (client) => {
      await spendInEach(client);

      expect(
        await refusalOf(client, () =>
          client.query(A_CALL_SERVING, [
            WS_A,
            "01J6TTTTTTTTTTTTTTTTTTTTT9",
            "cancelled",
            null,
            RECORD,
          ]),
        ),
      ).toBe("llm_call_outcome_check");
    });
  });

  it("refuses spend for a question never recorded", async () => {
    await withRollback(db().pool, async (client) => {
      await spendInEach(client);
      const unrecorded = "01J6QQQQQQQQQQQQQQQQQQQQQ9";

      expect({
        call: await refusalOf(client, () =>
          client.query(A_CALL_SERVING, [
            WS_A,
            "01J6TTTTTTTTTTTTTTTTTTTTT9",
            "succeeded",
            null,
            unrecorded,
          ]),
        ),
        reservation: await refusalOf(client, () =>
          client.query(A_RESERVATION_SERVING, [WS_A, "01J6RRRRRRRRRRRRRRRRRRRRR9", unrecorded]),
        ),
      }).toEqual({ call: "llm_call_answer_fk", reservation: "spend_reservation_answer_fk" });
    });
  });

  it("holds one price for a model from each day", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query(A_PRICE_FROM_OCTOBER, ["anthropic"]);

      expect({
        again: await refusalOf(client, () => client.query(A_PRICE_FROM_OCTOBER, ["anthropic"])),
        elsewhere: await refusalOf(client, () => client.query(A_PRICE_FROM_OCTOBER, ["openai"])),
      }).toEqual({
        again: "model_price_provider_model_effective_from_pk",
        elsewhere: "model_price_provider_check",
      });
    });
  });

  it("holds a threshold strictly between nought and one", async () => {
    await withRollback(db().pool, async (client) => {
      const threshold = (provider: string, value: number) =>
        refusalOf(client, () => client.query(A_THRESHOLD_OF, [provider, value]));

      expect({
        nought: await threshold("cloudflare", 0),
        one: await threshold("cloudflare", 1),
        elsewhere: await threshold("openai", 0.7),
        within: await threshold("cloudflare", 0.7),
      }).toEqual({
        nought: "decision_threshold_probability_check",
        one: "decision_threshold_probability_check",
        elsewhere: "decision_threshold_provider_check",
        within: "admitted",
      });
    });
  });

  it("lets the api replace a threshold, never remove it", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query(A_THRESHOLD_OF, ["cloudflare", 0.7]);

      await asTheApiIn(client, "");

      await client.query("UPDATE decision_threshold SET threshold = 0.6");
      await refusesEach(client, [
        ["DELETE FROM decision_threshold", "the api never removes a threshold"],
      ]);
      const read = await client.query("SELECT threshold FROM decision_threshold");
      expect(read.rows).toEqual([{ threshold: 0.6 }]);
    });
  });
});
