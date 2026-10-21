import { z } from "zod";

import {
  DECISION_THRESHOLD,
  type DecisionThreshold,
  type ModelProvider,
} from "@better-answers/schema";

import type { Tx } from "../store/postgres/index.ts";

export type StoredDecisionThreshold = {
  readonly provider: ModelProvider;
  readonly model: string;
  readonly threshold: DecisionThreshold;
};

const THRESHOLD_SET = `INSERT INTO decision_threshold (provider, model, threshold)
  VALUES ($1, $2, $3)
  ON CONFLICT (provider, model) DO UPDATE SET threshold = EXCLUDED.threshold`;

export const storeDecisionThreshold = async (
  tx: Tx,
  stored: StoredDecisionThreshold,
): Promise<void> => {
  await tx.query(THRESHOLD_SET, [stored.provider, stored.model, stored.threshold]);
};

const thresholdRow = z.object({ threshold: DECISION_THRESHOLD });

export const decisionThresholdOf = async (
  tx: Tx,
  named: { readonly provider: string; readonly model: string },
): Promise<DecisionThreshold | undefined> => {
  const found = await tx.query(
    "SELECT threshold FROM decision_threshold WHERE provider = $1 AND model = $2",
    [named.provider, named.model],
  );
  return thresholdRow.safeParse(found.rows[0]).data?.threshold;
};
