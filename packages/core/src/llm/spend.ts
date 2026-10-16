import { LLM_CALL_FAILED, type LlmCallOutcome } from "@better-answers/schema";

import {
  attempt,
  attemptResult,
  err,
  ok,
  ulid,
  type KernelRefusal,
  type PlatformPrincipal,
  type Result,
  type UserPrincipal,
  type WorkspaceId,
} from "../kernel/index.ts";
import {
  holdWorkspaceConfig,
  type PostgresDoor,
  type Tx,
  withScope,
} from "../store/postgres/index.ts";
import type { LlmPurpose } from "./index.ts";

/** Its value is a decimal string of pounds sterling, the currency every price is set in. */
export const SPENDING_LIMIT_KEY = "llm.spending_limit_gbp";

/**
 * Past the longest a call's timeout and its provider's retries can run, so a live call is never
 * settled as failed under it.
 */
export const RESERVATION_LIFETIME_MS = 10 * 60_000;

export type CallSize = { readonly tokensIn: number; readonly tokensOut: number };

export type SpendReserved = {
  readonly reserved: true;
  readonly reservationId: string;
  readonly modelChoiceId: string;
  readonly provider: string;
  readonly model: string;
};

/** No model may be called, so nothing was reserved: not a refusal, since `ask` still answers. */
export type NoModelToCall = {
  readonly reserved: false;
  readonly because: "no-model-choice" | "no-price" | "no-spending-limit";
};

export type ReserveSpendRefusal = KernelRefusal<"spending-limit-met"> | Error;

type PricedChoice = {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly gbpPerMillionIn: string | null;
  readonly gbpPerMillionOut: string | null;
};

type Priced = PricedChoice & {
  readonly gbpPerMillionIn: string;
  readonly gbpPerMillionOut: string;
};

const PRICED_CHOICE = `SELECT c.id, c.provider, c.model,
       p.gbp_per_million_in AS "gbpPerMillionIn", p.gbp_per_million_out AS "gbpPerMillionOut"
  FROM model_choice c
  LEFT JOIN LATERAL (
    SELECT gbp_per_million_in, gbp_per_million_out FROM model_price
     WHERE provider = c.provider AND model = c.model
       AND effective_from <= ($3::timestamptz AT TIME ZONE 'UTC')::date
     ORDER BY effective_from DESC LIMIT 1
  ) AS p ON true
 WHERE c.workspace_id = $1 AND c.purpose = $2`;

/**
 * Inserts nothing past the limit. Open reservations count whatever month they were taken in, since
 * each lives minutes.
 */
const RESERVED_UNDER_THE_LIMIT = `WITH spent AS (
    SELECT (SELECT COALESCE(sum(cost_gbp), 0) FROM llm_call
             WHERE workspace_id = $1 AND called_at >= $2 AND called_at < $3)
         + (SELECT COALESCE(sum(reserved_gbp), 0) FROM spend_reservation
             WHERE workspace_id = $1) AS gbp
  ), sized AS (
    SELECT trim_scale(($4::integer * $6::numeric + $5::integer * $7::numeric) / 1000000) AS gbp
  )
  INSERT INTO spend_reservation
    (workspace_id, id, taken_at, expires_at, purpose, model_choice_id, model, tokens_in,
     tokens_out, gbp_per_million_in, gbp_per_million_out, reserved_gbp, answer_id)
  SELECT $1, $8, $9, $10, $11, $12, $13, $4::integer, $5::integer, $6::numeric, $7::numeric,
         sized.gbp, $14
    FROM spent, sized
   WHERE spent.gbp + sized.gbp <= $15::numeric
  RETURNING id`;

const monthOf = (now: Date) => ({
  from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
});

type ReserveSpendInput = {
  readonly answerId: string;
  readonly purpose: LlmPurpose;
  readonly most: CallSize;
  readonly now: Date;
};

const reservedUnderTheLimit = async (
  asker: UserPrincipal,
  tx: Tx,
  input: ReserveSpendInput,
  choice: Priced,
  limit: string,
): Promise<Result<SpendReserved, ReserveSpendRefusal>> => {
  const { from, to } = monthOf(input.now);
  const reservationId = ulid();
  const taken = await tx.query(RESERVED_UNDER_THE_LIMIT, [
    asker.workspaceId,
    from,
    to,
    String(input.most.tokensIn),
    String(input.most.tokensOut),
    choice.gbpPerMillionIn,
    choice.gbpPerMillionOut,
    reservationId,
    input.now,
    new Date(input.now.getTime() + RESERVATION_LIFETIME_MS),
    input.purpose,
    choice.id,
    choice.model,
    input.answerId,
    limit,
  ]);
  if (taken.rowCount !== 1) return err("spending-limit-met");
  return ok({
    reserved: true,
    reservationId,
    modelChoiceId: choice.id,
    provider: choice.provider,
    model: choice.model,
  });
};

/**
 * Reserves the most one call may cost, in the caller's transaction, which a refusal rolls back
 * whole. The limit's row is held to the commit, so two reservations cannot both pass it.
 */
export const reserveSpend = async (
  asker: UserPrincipal,
  tx: Tx,
  input: ReserveSpendInput,
): Promise<Result<SpendReserved | NoModelToCall, ReserveSpendRefusal>> =>
  attemptResult(async (): Promise<Result<SpendReserved | NoModelToCall, ReserveSpendRefusal>> => {
    const found = await tx.query<PricedChoice>(PRICED_CHOICE, [
      asker.workspaceId,
      input.purpose,
      input.now,
    ]);
    const choice = found.rows[0];
    if (choice === undefined) return ok({ reserved: false, because: "no-model-choice" });
    const { gbpPerMillionIn, gbpPerMillionOut } = choice;
    if (gbpPerMillionIn === null || gbpPerMillionOut === null) {
      return ok({ reserved: false, because: "no-price" });
    }
    const limit = await holdWorkspaceConfig(asker, tx, SPENDING_LIMIT_KEY);
    if (limit === undefined) return ok({ reserved: false, because: "no-spending-limit" });
    return reservedUnderTheLimit(
      asker,
      tx,
      input,
      { ...choice, gbpPerMillionIn, gbpPerMillionOut },
      limit,
    );
  });

export type CallSpent = {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly seconds: number;
  readonly outcome: LlmCallOutcome;
};

/** Each attempt is priced at the rates its reservation carries, so a settle bills what was sized. */
const SETTLED = `WITH taken AS (
    DELETE FROM spend_reservation WHERE workspace_id = $1 AND id = $2 RETURNING *
  ), written AS (
    INSERT INTO llm_call
      (workspace_id, id, called_at, purpose, model_choice_id, model, tokens_in, tokens_out,
       seconds, cost_gbp, outcome, run_id, answer_id)
    SELECT taken.workspace_id, call.id, $3, taken.purpose, taken.model_choice_id, taken.model,
           call.tokens_in, call.tokens_out, call.seconds,
           trim_scale((call.tokens_in * taken.gbp_per_million_in
                       + call.tokens_out * taken.gbp_per_million_out) / 1000000),
           call.outcome, taken.run_id, taken.answer_id
      FROM taken
     CROSS JOIN unnest($4::text[], $5::integer[], $6::integer[], $7::float8[], $8::text[])
             AS call(id, tokens_in, tokens_out, seconds, outcome)
  )
  SELECT count(*)::integer AS taken FROM taken`;

/**
 * Replaces the reservation with one `llm_call` row per attempt, in the caller's transaction; what
 * was reserved and not spent is released, all of it when no attempt was made. A reservation the
 * sweep already settled is an error, and writes nothing.
 */
export const settleSpend = async (
  asker: UserPrincipal,
  tx: Tx,
  input: {
    readonly reservationId: string;
    readonly calls: readonly CallSpent[];
    readonly now: Date;
  },
): Promise<Result<void, Error>> =>
  attemptResult(async (): Promise<Result<void, Error>> => {
    const settled = await tx.query<{ taken: number }>(SETTLED, [
      asker.workspaceId,
      input.reservationId,
      input.now,
      input.calls.map(() => ulid()),
      input.calls.map((call) => call.tokensIn),
      input.calls.map((call) => call.tokensOut),
      input.calls.map((call) => call.seconds),
      input.calls.map((call) => call.outcome),
    ]);
    if (settled.rows[0]?.taken === 1) return ok(undefined);
    return err(new Error(`llm: no open reservation ${input.reservationId} to settle`));
  });

/**
 * Billed whole: a provider may have billed a call cut off. It returned no tokens; the most it could
 * send and run stand in.
 */
const EXPIRED_SETTLED = `WITH expired AS (
    DELETE FROM spend_reservation WHERE workspace_id = $1 AND expires_at < $2 RETURNING *
  )
  INSERT INTO llm_call
    (workspace_id, id, called_at, purpose, model_choice_id, model, tokens_in, tokens_out,
     seconds, cost_gbp, outcome, run_id, answer_id)
  SELECT workspace_id, id, taken_at, purpose, model_choice_id, model, tokens_in, 0,
         extract(epoch FROM expires_at - taken_at), reserved_gbp, $3, run_id, answer_id
    FROM expired`;

/**
 * Settles each reservation of the workspace past its expiry as one failed `llm_call` row at its
 * reserved cost, and answers how many.
 */
export const settleExpiredSpend = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly workspaceId: WorkspaceId; readonly now: Date },
): Promise<Result<number, Error>> =>
  attempt(async () => {
    const settled = await withScope(platform, door, input.workspaceId, (tx) =>
      tx.query(EXPIRED_SETTLED, [input.workspaceId, input.now, LLM_CALL_FAILED]),
    );
    return settled.rowCount ?? 0;
  });
