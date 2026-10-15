import { z } from "zod";

import { MODEL_PROVIDERS, type ModelProvider } from "@better-answers/schema";

import { ulid } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { LlmPurpose } from "./index.ts";

export type ModelChoiceStored = {
  readonly workspaceId: string;
  readonly purpose: LlmPurpose;
  readonly provider: ModelProvider;
  readonly model: string;
};

/** A retention tail is the provider's, so it is kept only while the provider stays the same. */
const CHOICE_STORED = `INSERT INTO model_choice (id, workspace_id, purpose, provider, model)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (workspace_id, purpose) DO UPDATE
    SET provider = EXCLUDED.provider,
        model = EXCLUDED.model,
        retention_tail = CASE WHEN model_choice.provider = EXCLUDED.provider
                              THEN model_choice.retention_tail END`;

/** Replaces the workspace's choice for the purpose in place, so its id outlives the change. */
export const storeModelChoice = async (tx: Tx, choice: ModelChoiceStored): Promise<void> => {
  await tx.query(CHOICE_STORED, [
    ulid(),
    choice.workspaceId,
    choice.purpose,
    choice.provider,
    choice.model,
  ]);
};

const PRICED_ON = `SELECT provider FROM model_price
  WHERE provider = $1 AND model = $2
    AND effective_from <= ($3::timestamptz AT TIME ZONE 'UTC')::date
  LIMIT 1`;

const pricedRow = z.object({ provider: z.enum(MODEL_PROVIDERS) });

/** The provider, as a price names it, when a price for the model is in effect on `now`'s day. */
export const pricedProviderOn = async (
  tx: Tx,
  model: { readonly provider: string; readonly model: string },
  now: Date,
): Promise<ModelProvider | undefined> => {
  const found = await tx.query(PRICED_ON, [model.provider, model.model, now]);
  const row = pricedRow.safeParse(found.rows[0]);
  return row.success ? row.data.provider : undefined;
};
