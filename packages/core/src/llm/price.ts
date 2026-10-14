import { boundarySchemas, type ModelProvider } from "@better-answers/schema";

import {
  attempt,
  err,
  MALFORMED,
  ok,
  type KernelRefusal,
  type PlatformPrincipal,
  type Result,
} from "../kernel/index.ts";
import { type PostgresDoor, withIdentityWrite } from "../store/postgres/index.ts";

type SetModelPriceInput = {
  readonly provider: string;
  readonly model: string;
  /** A day, `yyyy-mm-dd`, from which the price applies. */
  readonly effectiveFrom: string;
  readonly usdPerMillionIn: string;
  readonly usdPerMillionOut: string;
};

export type ModelPriceSet = {
  readonly provider: ModelProvider;
  readonly model: string;
  readonly effectiveFrom: string;
};

export type SetModelPriceRefusal = KernelRefusal<"malformed">;

/** The column takes a day the calendar has, which the pattern alone does not prove. */
const isACalendarDay = (day: string): boolean => {
  const read = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(read.getTime()) && read.toISOString().startsWith(day);
};

const PRICE_SET = `INSERT INTO model_price
    (provider, model, effective_from, usd_per_million_in, usd_per_million_out)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (provider, model, effective_from)
  DO UPDATE SET usd_per_million_in = EXCLUDED.usd_per_million_in,
                usd_per_million_out = EXCLUDED.usd_per_million_out`;

/** Sets what a model costs from a day on, replacing a price set for that same day. */
export const setModelPrice = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: SetModelPriceInput,
): Promise<Result<ModelPriceSet, SetModelPriceRefusal | Error>> => {
  const asked = boundarySchemas.modelPrice.insert.safeParse(input);
  if (!asked.success || !isACalendarDay(asked.data.effectiveFrom)) return err(MALFORMED);
  const price = asked.data;
  const set = await attempt(() =>
    withIdentityWrite(platform, door, (tx) =>
      tx.query(PRICE_SET, [
        price.provider,
        price.model,
        price.effectiveFrom,
        price.usdPerMillionIn,
        price.usdPerMillionOut,
      ]),
    ),
  );
  if (!set.ok) return err(set.error);
  return ok({ provider: price.provider, model: price.model, effectiveFrom: price.effectiveFrom });
};
