import { z } from "zod";

import { boundarySchemas, DECIMAL_STRING, DECISION_THRESHOLD } from "@better-answers/schema";

import { action, declareIdentitySetActions, record, STORED_DETAIL_KEYS } from "../audit/index.ts";
import {
  attempt,
  err,
  MALFORMED,
  ok,
  ulid,
  type KernelRefusal,
  type PlatformPrincipal,
  type Result,
} from "../kernel/index.ts";
import {
  speaksDecision,
  storeDecisionThreshold,
  type StoredDecisionThreshold,
} from "../llm/index.ts";
import { type PostgresDoor, withIdentityWrite } from "../store/postgres/index.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

const THRESHOLD_ACTIONS = declareIdentitySetActions("platform", {
  thresholdSet: action("platform.model.threshold_set", {
    [STORED_DETAIL_KEYS.modelProvider]: "modelProvider",
    [STORED_DETAIL_KEYS.modelName]: "modelName",
    [STORED_DETAIL_KEYS.threshold]: "decisionThreshold",
  }),
});

const named = boundarySchemas.decisionThreshold.insert.extend({
  threshold: z.string().regex(DECIMAL_STRING).transform(Number).pipe(DECISION_THRESHOLD),
});

type SetDecisionThresholdInput = {
  readonly [Field in keyof StoredDecisionThreshold]: string;
};

export type SetDecisionThresholdRefusal =
  | KernelRefusal<"malformed">
  | WorkspaceRefusal<"not-a-decision-model">;

export const setDecisionThreshold = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: SetDecisionThresholdInput,
): Promise<Result<StoredDecisionThreshold, SetDecisionThresholdRefusal | Error>> => {
  const asked = named.safeParse(input);
  if (!asked.success) return err(MALFORMED);
  const stored = asked.data;
  if (!speaksDecision(stored.provider)) return err("not-a-decision-model");
  const set = await attempt(() =>
    withIdentityWrite(platform, door, async (tx) => {
      await storeDecisionThreshold(tx, stored);
      await record(platform, tx, {
        id: ulid(),
        action: THRESHOLD_ACTIONS.thresholdSet,
        subjectId: `${stored.provider}/${stored.model}`,
        detail: {
          [STORED_DETAIL_KEYS.modelProvider]: stored.provider,
          [STORED_DETAIL_KEYS.modelName]: stored.model,
          [STORED_DETAIL_KEYS.threshold]: stored.threshold,
        },
      });
    }),
  );
  if (!set.ok) return err(set.error);
  return ok({ provider: stored.provider, model: stored.model, threshold: stored.threshold });
};
