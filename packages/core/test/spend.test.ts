import { describe, expect, it } from "vitest";

import { openRecord } from "../src/answering/index.ts";
import type { PlatformPrincipal, UserPrincipal } from "../src/kernel/index.ts";
import {
  reserveSpend,
  settleExpiredSpend,
  settleSpend,
  setModelPrice,
  type CallSize,
  type CallSpent,
} from "../src/llm/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import { setSpendingLimit } from "../src/workspaces/index.ts";
import { provisionedWorkspace } from "./platform.ts";
import { answered, postgresForSuite, racedAt, readingAs } from "./suite-postgres.ts";
import { principalFor } from "./workspace-with-bundle.ts";

const db = postgresForSuite();

const PLATFORM: PlatformPrincipal = { kind: "platform", actorId: "process:better-answers-sweeps" };

const SONNET = "claude-sonnet-5-5";

/** At $3 and $15 a million, 40,000 in and 2,000 out cost $0.15. */
const MOST: CallSize = { tokensIn: 40_000, tokensOut: 2_000 };

const A_CALL: CallSpent = { tokensIn: 1_580, tokensOut: 96, seconds: 1.118, outcome: "succeeded" };

const A_FAILED_ATTEMPT: CallSpent = {
  tokensIn: 1_000,
  tokensOut: 0,
  seconds: 30,
  outcome: "failed",
};

/** A stopped clock, mid-month, so no case's month runs out under it. */
const NOW = new Date("2026-10-14T12:00:00.000Z");

type Asker = { readonly asker: UserPrincipal; readonly recordId: string };

const priced = async (
  from: string,
  usdPerMillionIn: string,
  usdPerMillionOut: string,
  model: string = SONNET,
) =>
  answered(
    await setModelPrice(PLATFORM, openPostgres(db().pool), {
      provider: "anthropic",
      model,
      effectiveFrom: from,
      usdPerMillionIn,
      usdPerMillionOut,
    }),
  );

/** A workspace judging on `model`, its question on record, under `limit` when one is given. */
const anAsker = async (limit?: string, model: string = SONNET): Promise<Asker> => {
  const workspace = await provisionedWorkspace(db(), "Acme");
  const asker = await principalFor(db(), workspace.workspaceId, workspace.adminUserId);
  await db().pool.query(
    `INSERT INTO model_choice (id, workspace_id, purpose, provider, model)
     VALUES ($1, $2, 'judging', 'anthropic', $3)`,
    [`judge-${workspace.workspaceId}`, workspace.workspaceId, model],
  );
  if (limit !== undefined) {
    answered(
      await setSpendingLimit(PLATFORM, openPostgres(db().pool), {
        workspaceId: workspace.workspaceId,
        usd: limit,
      }),
    );
  }
  const { recordId } = answered(
    await readingAs(db().runtimePool, asker, (principal, tx) =>
      openRecord(principal, tx, {
        question: "How long are audit logs kept?",
        collections: [],
        transport: "mcp",
        askedAt: new Date(),
      }),
    ),
  );
  return { asker, recordId };
};

const reserving = ({ asker, recordId }: Asker, now: Date = NOW) =>
  readingAs(db().runtimePool, asker, (principal, tx) =>
    reserveSpend(principal, tx, { answerId: recordId, purpose: "judging", most: MOST, now }),
  );

const settling = ({ asker }: Asker, reservationId: string, calls: readonly CallSpent[]) =>
  readingAs(db().runtimePool, asker, (principal, tx) =>
    settleSpend(principal, tx, { reservationId, calls, now: NOW }),
  );

const reservationIdOf = (reserved: { readonly reserved: boolean }): string => {
  if (!("reservationId" in reserved) || typeof reserved.reservationId !== "string") {
    throw new Error("nothing was reserved");
  }
  return reserved.reservationId;
};

const reservationsOf = async ({ asker }: Asker) => {
  const read = await db().pool.query(
    "SELECT reserved_usd, expires_at FROM spend_reservation WHERE workspace_id = $1",
    [asker.workspaceId],
  );
  return read.rows;
};

const callsOf = async ({ asker }: Asker) => {
  const read = await db().pool.query(
    `SELECT purpose, model, tokens_in, tokens_out, seconds, cost_usd, outcome, run_id, answer_id
       FROM llm_call WHERE workspace_id = $1 ORDER BY tokens_in`,
    [asker.workspaceId],
  );
  return read.rows;
};

const spentAt = async ({ asker, recordId }: Asker, calledAt: Date, costUsd: string) => {
  await db().pool.query(
    `INSERT INTO llm_call
       (workspace_id, id, called_at, purpose, model_choice_id, model, tokens_in, tokens_out,
        seconds, cost_usd, outcome, answer_id)
     VALUES ($1, gen_random_uuid()::text, $2, 'judging', 'judge', $3, 1, 1, 1, $4, 'succeeded', $5)`,
    [asker.workspaceId, calledAt, SONNET, costUsd, recordId],
  );
};

describe("spend", () => {
  it("settles a reservation as one priced row per call", async () => {
    await priced("2026-10-01", "3", "15");
    const asking = await anAsker("10");

    const reservationId = reservationIdOf(answered(await reserving(asking)));
    answered(await settling(asking, reservationId, [A_FAILED_ATTEMPT, A_CALL]));

    expect(await reservationsOf(asking)).toEqual([]);
    expect(await callsOf(asking)).toEqual([
      {
        purpose: "judging",
        model: SONNET,
        tokens_in: 1_000,
        tokens_out: 0,
        seconds: 30,
        cost_usd: "0.003",
        outcome: "failed",
        run_id: null,
        answer_id: asking.recordId,
      },
      {
        purpose: "judging",
        model: SONNET,
        tokens_in: 1_580,
        tokens_out: 96,
        seconds: 1.118,
        cost_usd: "0.00618",
        outcome: "succeeded",
        run_id: null,
        answer_id: asking.recordId,
      },
    ]);
  });

  it("refuses past the limit and leaves no row (AE9)", async () => {
    await priced("2026-10-01", "3", "15");
    const asking = await anAsker("0.149999");

    expect(await reserving(asking)).toEqual({ ok: false, error: "spending-limit-met" });
    expect(await reservationsOf(asking)).toEqual([]);
    expect(await callsOf(asking)).toEqual([]);
  });

  it("passes one of two raced reservations under the limit", async () => {
    await priced("2026-10-01", "3", "15");
    const asking = await anAsker("0.25");

    const answers = await racedAt(
      db().pool,
      "spend_reservation",
      [() => reserving(asking), () => reserving(asking)],
      "together",
    );

    expect(answers.map((answer) => answer.ok).toSorted()).toEqual([false, true]);
    expect(await reservationsOf(asking)).toHaveLength(1);
  });

  it("calls no model and reserves nothing with no limit", async () => {
    await priced("2026-10-01", "3", "15");
    const asking = await anAsker();

    expect(answered(await reserving(asking))).toEqual({
      reserved: false,
      because: "no-spending-limit",
    });
    expect(await reservationsOf(asking)).toEqual([]);
  });

  it("sweeps expired reservations into failed calls at reserved cost", async () => {
    await priced("2026-10-01", "3", "15");
    const asking = await anAsker("10");
    answered(await reserving(asking, NOW));
    const pastItsExpiry = new Date(NOW.getTime() + 10 * 60_000 + 1);

    const swept = await settleExpiredSpend(PLATFORM, openPostgres(db().pool), {
      workspaceId: asking.asker.workspaceId,
      now: pastItsExpiry,
    });

    expect(swept).toEqual({ ok: true, value: 1 });
    expect(await reservationsOf(asking)).toEqual([]);
    expect(await callsOf(asking)).toEqual([
      {
        purpose: "judging",
        model: SONNET,
        tokens_in: 40_000,
        tokens_out: 2_000,
        seconds: 600,
        cost_usd: "0.15",
        outcome: "failed",
        run_id: null,
        answer_id: asking.recordId,
      },
    ]);
  });

  it("keeps a reservation inside its expiry from the sweep", async () => {
    await priced("2026-10-01", "3", "15");
    const asking = await anAsker("10");
    answered(await reserving(asking, NOW));
    const atItsExpiry = new Date(NOW.getTime() + 10 * 60_000);

    const swept = await settleExpiredSpend(PLATFORM, openPostgres(db().pool), {
      workspaceId: asking.asker.workspaceId,
      now: atItsExpiry,
    });

    expect(swept).toEqual({ ok: true, value: 0 });
    expect(await reservationsOf(asking)).toHaveLength(1);
    expect(await callsOf(asking)).toEqual([]);
  });

  it("leaves last month's spend out of this month's limit", async () => {
    await priced("2026-10-01", "3", "15");
    const asking = await anAsker("0.20");
    const firstOfNovember = new Date("2026-11-01T00:00:00.000Z");
    await spentAt(asking, new Date("2026-10-31T23:59:59.999Z"), "0.10");

    expect(answered(await reserving(asking, firstOfNovember))).toMatchObject({ reserved: true });

    await spentAt(asking, firstOfNovember, "0.10");
    expect(await reserving(asking, firstOfNovember)).toEqual({
      ok: false,
      error: "spending-limit-met",
    });
  });

  it("prices a call by today's price, never a later one", async () => {
    const pricedLater = "claude-priced-later";
    const asking = await anAsker("10", pricedLater);
    const tomorrow = new Date(NOW.getTime() + 86_400_000).toISOString().slice(0, 10);
    await priced(tomorrow, "300", "1500", pricedLater);

    expect(answered(await reserving(asking))).toEqual({ reserved: false, because: "no-price" });

    await priced(NOW.toISOString().slice(0, 10), "3", "15", pricedLater);
    answered(await reserving(asking));
    expect(await reservationsOf(asking)).toMatchObject([{ reserved_usd: "0.15" }]);
  });

  it("releases what a settle spent less than it reserved", async () => {
    await priced("2026-10-01", "3", "15");
    const asking = await anAsker("0.20");
    const first = reservationIdOf(answered(await reserving(asking)));
    expect(await reserving(asking)).toEqual({ ok: false, error: "spending-limit-met" });

    answered(await settling(asking, first, [A_CALL]));

    expect(answered(await reserving(asking))).toMatchObject({ reserved: true });
  });

  it("holds no prompt and no completion in a call's row", async () => {
    await priced("2026-10-01", "3", "15");
    const asking = await anAsker("10");
    const reservationId = reservationIdOf(answered(await reserving(asking)));
    answered(await settling(asking, reservationId, [A_CALL]));

    const read = await db().pool.query("SELECT * FROM llm_call WHERE workspace_id = $1", [
      asking.asker.workspaceId,
    ]);

    expect(Object.keys(read.rows[0] ?? {}).toSorted()).toEqual([
      "answer_id",
      "called_at",
      "cost_usd",
      "id",
      "model",
      "model_choice_id",
      "outcome",
      "purpose",
      "run_id",
      "seconds",
      "tokens_in",
      "tokens_out",
      "workspace_id",
    ]);
  });
});
