import { z } from "zod";

import { llmPurpose } from "@better-answers/schema";

import {
  admit,
  ANY_ROLE,
  attempt,
  declareAction,
  err,
  ok,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

export { pricedProviderOn, storeModelChoice } from "./choice.ts";
export type { ModelChoiceStored } from "./choice.ts";
export {
  ATTEMPT_TIMEOUT_MS,
  LONGEST_RETRY_WAIT_MS,
  MAX_ATTEMPTS,
  openModelClient,
  resolveModel,
  RETRY_WAITS_MS,
  wireShapeOf,
} from "./client.ts";
export type {
  DecisionModelCall,
  ModelAttemptLine,
  ModelCall,
  ModelClient,
  ModelOutcome,
  ModelToCall,
  WireShapeName,
} from "./client.ts";
export type { NoulInstructions, Probabilities } from "./wire/decision.ts";
export { openStreamingClient } from "./stream.ts";
export type { StreamedCall, StreamedOutcome, StreamingClient, StreamModel } from "./stream.ts";
export { openCredentials, openModelKeySetting } from "./credentials.ts";
export type { Credentials, ModelKeySetting } from "./credentials.ts";
export { CHOOSABLE_PROVIDERS, SUB_PROCESSORS } from "./sub-processors.ts";
export { checkTypedText } from "./typed-text.ts";
export {
  RESERVATION_LIFETIME_MS,
  reserveSpend,
  settleExpiredSpend,
  settleSpend,
  SPENDING_LIMIT_KEY,
} from "./spend.ts";
export type { CallSize, CallSpent } from "./spend.ts";
export { storeModelPrice } from "./price.ts";
export type { ModelPrice } from "./price.ts";

export const LLM_PURPOSES = llmPurpose.enumValues;
export type LlmPurpose = (typeof LLM_PURPOSES)[number];

export type WorkspaceModelChoice = {
  readonly purpose: LlmPurpose;
  readonly provider: string | null;
  readonly model: string | null;

  readonly dimensions: number | null;

  readonly fixed: boolean;

  readonly retentionTail: string | null;
};

export const FIXED_PURPOSE: LlmPurpose = "embedding";

type ModelChoiceRow = {
  readonly purpose: string;
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number | null;
  readonly retentionTail: string | null;
};

const modelChoiceOf = (
  purpose: LlmPurpose,
  row: ModelChoiceRow | undefined,
): WorkspaceModelChoice =>
  row === undefined
    ? { purpose, provider: null, model: null, dimensions: null, fixed: false, retentionTail: null }
    : {
        purpose,
        provider: row.provider,
        model: row.model,
        dimensions: row.dimensions,
        fixed: purpose === FIXED_PURPOSE,
        retentionTail: row.retentionTail,
      };

const listModelChoicesAction = declareAction({
  admits: ANY_ROLE,
  input: z.object({}),
  refuses: ["role-forbids"],
});

/** One model choice per purpose, in `LLM_PURPOSES` order; a purpose with none configured has nulls. */
export const listModelChoices = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<
  Result<readonly WorkspaceModelChoice[], RefusalOf<typeof listModelChoicesAction> | Error>
> => {
  const admitted = admit(listModelChoicesAction, principal, {});
  if (!admitted.ok) return err(admitted.error);

  const configured = await attempt(() =>
    tx.query<ModelChoiceRow>(
      `SELECT purpose, provider, model, dimensions, retention_tail AS "retentionTail"
         FROM model_choice WHERE workspace_id = $1`,
      [admitted.value.workspaceId],
    ),
  );
  if (!configured.ok) return err(configured.error);
  const byPurpose = new Map(configured.value.rows.map((row) => [row.purpose, row]));
  return ok(LLM_PURPOSES.map((purpose) => modelChoiceOf(purpose, byPurpose.get(purpose))));
};
