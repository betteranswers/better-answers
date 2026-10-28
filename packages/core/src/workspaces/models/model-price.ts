import { boundarySchemas } from "@better-answers/schema";

import {
  action,
  declareIdentitySetActions,
  record,
  STORED_DETAIL_KEYS,
} from "../../audit/index.ts";
import {
  attempt,
  err,
  MALFORMED,
  ok,
  ulid,
  type KernelRefusal,
  type PlatformPrincipal,
  type Result,
} from "../../kernel/index.ts";
import { storeModelPrice, type ModelPrice } from "../../llm/index.ts";
import { type PostgresDoor, withIdentityWrite } from "../../store/postgres/index.ts";

const PRICE_ACTIONS = declareIdentitySetActions("platform", {
  priced: action("platform.model.priced", {
    [STORED_DETAIL_KEYS.modelProvider]: "modelProvider",
    [STORED_DETAIL_KEYS.modelName]: "modelName",
    [STORED_DETAIL_KEYS.effectiveFrom]: "day",
    [STORED_DETAIL_KEYS.gbpPerMillionIn]: "gbp",
    [STORED_DETAIL_KEYS.gbpPerMillionOut]: "gbp",
  }),
});

type SetModelPriceInput = { readonly [Field in keyof ModelPrice]: string };

export type SetModelPriceRefusal = KernelRefusal<"malformed">;

const isACalendarDay = (day: string): boolean => {
  const read = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(read.getTime()) && read.toISOString().startsWith(day);
};

/** Sets what a model costs in pounds from a day on, replacing a price set for that same day. */
export const setModelPrice = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: SetModelPriceInput,
): Promise<
  Result<Pick<ModelPrice, "provider" | "model" | "effectiveFrom">, SetModelPriceRefusal | Error>
> => {
  const asked = boundarySchemas.modelPrice.insert.safeParse(input);
  if (!asked.success || !isACalendarDay(asked.data.effectiveFrom)) return err(MALFORMED);
  const price = asked.data;
  const set = await attempt(() =>
    withIdentityWrite(platform, door, async (tx) => {
      await storeModelPrice(tx, price);
      await record(platform, tx, {
        id: ulid(),
        action: PRICE_ACTIONS.priced,
        subjectId: `${price.provider}/${price.model}`,
        detail: {
          [STORED_DETAIL_KEYS.modelProvider]: price.provider,
          [STORED_DETAIL_KEYS.modelName]: price.model,
          [STORED_DETAIL_KEYS.effectiveFrom]: price.effectiveFrom,
          [STORED_DETAIL_KEYS.gbpPerMillionIn]: price.gbpPerMillionIn,
          [STORED_DETAIL_KEYS.gbpPerMillionOut]: price.gbpPerMillionOut,
        },
      });
    }),
  );
  if (!set.ok) return err(set.error);
  return ok({ provider: price.provider, model: price.model, effectiveFrom: price.effectiveFrom });
};
