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
  return ok(
    LLM_PURPOSES.map((purpose) => {
      const row = byPurpose.get(purpose);
      return {
        purpose,
        provider: row?.provider ?? null,
        model: row?.model ?? null,
        dimensions: row?.dimensions ?? null,
        fixed: row !== undefined && purpose === FIXED_PURPOSE,
        retentionTail: row?.retentionTail ?? null,
      };
    }),
  );
};
