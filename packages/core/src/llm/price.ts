import type { ModelProvider } from "@better-answers/schema";

import type { Tx } from "../store/postgres/index.ts";

export type ModelPrice = {
  readonly provider: ModelProvider;
  readonly model: string;
  readonly effectiveFrom: string;
  readonly gbpPerMillionIn: string;
  readonly gbpPerMillionOut: string;
};

const PRICE_SET = `INSERT INTO model_price
    (provider, model, effective_from, gbp_per_million_in, gbp_per_million_out)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (provider, model, effective_from)
  DO UPDATE SET gbp_per_million_in = EXCLUDED.gbp_per_million_in,
                gbp_per_million_out = EXCLUDED.gbp_per_million_out`;

/** Replaces a price set for the same day; the audited action that calls it records the change. */
export const storeModelPrice = async (tx: Tx, price: ModelPrice): Promise<void> => {
  await tx.query(PRICE_SET, [
    price.provider,
    price.model,
    price.effectiveFrom,
    price.gbpPerMillionIn,
    price.gbpPerMillionOut,
  ]);
};
