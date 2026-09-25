import { llmPurpose } from "@better-answers/schema";

import { attempt, err, ok, type Result, type UserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

export const LLM_PURPOSES = llmPurpose.enumValues;
export type LlmPurpose = (typeof LLM_PURPOSES)[number];

export type WorkspaceRoute = {
  readonly purpose: LlmPurpose;
  readonly provider: string | null;
  readonly model: string | null;

  readonly dimensions: number | null;

  readonly fixed: boolean;

  readonly retentionTail: string | null;
};

const FIXED_PURPOSE: LlmPurpose = "embedding";

type RouteRow = {
  readonly purpose: string;
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number | null;
  readonly retentionTail: string | null;
};

const routeOf = (purpose: LlmPurpose, row: RouteRow | undefined): WorkspaceRoute =>
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

/** One route per purpose, in `LLM_PURPOSES` order; a purpose with no route configured has nulls. */
export const listRoutes = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<readonly WorkspaceRoute[], Error>> => {
  const configured = await attempt(() =>
    tx.query<RouteRow>(
      `SELECT purpose, provider, model, dimensions, retention_tail AS "retentionTail"
         FROM llm_route WHERE workspace_id = $1`,
      [principal.workspaceId],
    ),
  );
  if (!configured.ok) return err(configured.error);
  const byPurpose = new Map(configured.value.rows.map((row) => [row.purpose, row]));
  return ok(LLM_PURPOSES.map((purpose) => routeOf(purpose, byPurpose.get(purpose))));
};
