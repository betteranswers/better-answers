import type pg from "pg";
import { describe, expect, it } from "vitest";

import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { postgresForSuite, privilegesHeld, refusalOf } from "./probes.ts";

const db = postgresForSuite();

const WS_A = "01J6AAAAAAAAAAAAAAAAAAAAAA";
const WS_B = "01J6BBBBBBBBBBBBBBBBBBBBBB";

const RECORD = "01J6QQQQQQQQQQQQQQQQQQQQQQ";

const A_QUESTION = `INSERT INTO question_asked
    (workspace_id, id, asked_at, asked_by, transport, predicate_role)
  VALUES ($1, $2, now(), 'human:01J6CCCCCCCCCCCCCCCCCCCCCC', 'mcp', 'Viewer')`;

const A_CALL = `INSERT INTO llm_call
    (workspace_id, id, called_at, purpose, model_choice_id, model, tokens_in, tokens_out, seconds,
     cost_usd, outcome, run_id, answer_id)
  VALUES ($1, $2, now(), 'judging', 'model-choice-judge', 'claude-sonnet-5-5', 1580, 96, 1.118,
          '0.006180', $3, $4, $5)`;

const A_RESERVATION = `INSERT INTO spend_reservation
    (workspace_id, id, taken_at, expires_at, purpose, model_choice_id, model, tokens_in,
     tokens_out, usd_per_million_in, usd_per_million_out, reserved_usd, answer_id)
  VALUES ($1, $2, now(), now() + interval '10 minutes', 'judging', 'model-choice-judge',
          'claude-sonnet-5-5', 40000, 2000, '3', '15', '0.15', $3)`;

const A_PRICE = `INSERT INTO model_price
    (provider, model, effective_from, usd_per_million_in, usd_per_million_out)
  VALUES ($1, 'claude-sonnet-5-5', '2026-10-01', '3', '15')`;

const spendInEach = async (client: pg.PoolClient): Promise<void> => {
  const seed = testData(client);
  for (const [workspaceId, at] of [
    [WS_A, "1"],
    [WS_B, "2"],
  ] as const) {
    await seed.workspace({ id: workspaceId, name: workspaceId });
    await client.query(A_QUESTION, [workspaceId, RECORD]);
    await client.query(A_CALL, [
      workspaceId,
      `01J6TTTTTTTTTTTTTTTTTTTTT${at}`,
      "succeeded",
      null,
      RECORD,
    ]);
    await client.query(A_RESERVATION, [workspaceId, `01J6RRRRRRRRRRRRRRRRRRRRR${at}`, RECORD]);
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
        ["llm_call", "spend_reservation", "model_price"].map(async (table) =>
          Object.values(await privilegesHeld(client, "worker_rt", table)),
        ),
      );

      expect(held.flat()).toEqual(held.flat().map(() => false));
    });
  });

  it("lets the api read prices with no workspace in scope", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query(A_PRICE, ["anthropic"]);

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
          client.query(A_CALL, [WS_A, "01J6TTTTTTTTTTTTTTTTTTTTT9", "succeeded", runId, answerId]),
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
          client.query(A_CALL, [WS_A, "01J6TTTTTTTTTTTTTTTTTTTTT9", "cancelled", null, RECORD]),
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
          client.query(A_CALL, [WS_A, "01J6TTTTTTTTTTTTTTTTTTTTT9", "succeeded", null, unrecorded]),
        ),
        reservation: await refusalOf(client, () =>
          client.query(A_RESERVATION, [WS_A, "01J6RRRRRRRRRRRRRRRRRRRRR9", unrecorded]),
        ),
      }).toEqual({ call: "llm_call_answer_fk", reservation: "spend_reservation_answer_fk" });
    });
  });

  it("holds one price for a model from each day", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query(A_PRICE, ["anthropic"]);

      expect({
        again: await refusalOf(client, () => client.query(A_PRICE, ["anthropic"])),
        elsewhere: await refusalOf(client, () => client.query(A_PRICE, ["openai"])),
      }).toEqual({
        again: "model_price_provider_model_effective_from_pk",
        elsewhere: "model_price_provider_check",
      });
    });
  });
});
