import { llmPurpose } from "@better-answers/schema";

import { attempt, err, ok, type Result, type UserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

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

const FIXED_PURPOSE: LlmPurpose = "embedding";

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

/** One model choice per purpose, in `LLM_PURPOSES` order; a purpose with none configured has nulls. */
export const listModelChoices = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<readonly WorkspaceModelChoice[], Error>> => {
  const configured = await attempt(() =>
    tx.query<ModelChoiceRow>(
      `SELECT purpose, provider, model, dimensions, retention_tail AS "retentionTail"
         FROM model_choice WHERE workspace_id = $1`,
      [principal.workspaceId],
    ),
  );
  if (!configured.ok) return err(configured.error);
  const byPurpose = new Map(configured.value.rows.map((row) => [row.purpose, row]));
  return ok(LLM_PURPOSES.map((purpose) => modelChoiceOf(purpose, byPurpose.get(purpose))));
};
