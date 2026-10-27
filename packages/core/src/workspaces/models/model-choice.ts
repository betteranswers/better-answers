import { z } from "zod";

import { boundarySchemas, MODEL_NAME } from "@better-answers/schema";

import { action, declareActions, record, STORED_DETAIL_KEYS } from "../../audit/index.ts";
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
import {
  CHOOSABLE_PROVIDERS,
  decisionThresholdOf,
  FIXED_PURPOSE,
  LLM_PURPOSES,
  pricedProviderOn,
  speaksDecision,
  storeModelChoice,
  type ModelChoiceStored,
} from "../../llm/index.ts";
import { type PostgresDoor, withScope } from "../../store/postgres/index.ts";
import type { WorkspaceRefusal } from "../vocabulary.ts";

const MODEL_CHOICE_ACTIONS = declareActions("platform", {
  set: action("platform.workspace.model_choice_set", {
    [STORED_DETAIL_KEYS.llmPurpose]: "llmPurpose",
    [STORED_DETAIL_KEYS.modelProvider]: "modelProvider",
    [STORED_DETAIL_KEYS.modelName]: "modelName",
  }),
});

const named = z.object({
  workspaceId: boundarySchemas.workspace.select.shape.id,
  purpose: z.enum(LLM_PURPOSES),
  provider: z.string().regex(MODEL_NAME),
  model: z.string().regex(MODEL_NAME),
});

type SetModelChoiceInput = {
  readonly workspaceId: string;
  readonly purpose: string;
  readonly provider: string;
  readonly model: string;
  readonly now: Date;
};

export type SetModelChoiceRefusal =
  | KernelRefusal<"malformed">
  | WorkspaceRefusal<
      | "no-such-workspace"
      | "fixed-model-choice"
      | "no-decision-threshold"
      | "no-sub-processor"
      | "no-model-price"
    >;

export const setModelChoice = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: SetModelChoiceInput,
): Promise<Result<ModelChoiceStored, SetModelChoiceRefusal | Error>> => {
  const asked = named.safeParse(input);
  if (!asked.success) return err(MALFORMED);
  const { workspaceId, purpose, provider, model } = asked.data;
  if (purpose === FIXED_PURPOSE) return err("fixed-model-choice");

  const set = await attempt(() =>
    withScope(
      platform,
      door,
      workspaceId,
      async (tx): Promise<Result<ModelChoiceStored, SetModelChoiceRefusal>> => {
        if (
          speaksDecision(provider) &&
          (await decisionThresholdOf(tx, { provider, model })) === undefined
        ) {
          return err("no-decision-threshold");
        }
        if (!CHOOSABLE_PROVIDERS.has(provider)) return err("no-sub-processor");
        const held = await tx.query("SELECT 1 FROM workspace WHERE id = $1", [workspaceId]);
        if (held.rows.length === 0) return err("no-such-workspace");
        const priced = await pricedProviderOn(tx, { provider, model }, input.now);
        if (priced === undefined) return err("no-model-price");

        const choice = { workspaceId, purpose, provider: priced, model };
        await storeModelChoice(tx, choice);
        await record(platform, tx, {
          id: ulid(),
          action: MODEL_CHOICE_ACTIONS.set,
          subjectId: workspaceId,
          detail: {
            [STORED_DETAIL_KEYS.llmPurpose]: purpose,
            [STORED_DETAIL_KEYS.modelProvider]: priced,
            [STORED_DETAIL_KEYS.modelName]: model,
          },
        });
        return ok(choice);
      },
    ),
  );

  if (!set.ok) return err(set.error);
  return set.value;
};
