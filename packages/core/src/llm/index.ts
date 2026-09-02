import { llmPurpose } from "@better-answers/schema";

import type { UserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/**
 * Route resolution per workspace and purpose, and the `llm_call` ledger.
 *
 * ADR 0029 rule 3 — imports `kernel`, `access` and `store`; never a slice, never `audit`.
 */

/** The five purposes, in the order the enum declares and a reader reads them. */
export const LLM_PURPOSES = llmPurpose.enumValues;
export type LlmPurpose = (typeof LLM_PURPOSES)[number];

/**
 * One purpose's choice as the platform speaks of it (`CONTEXT.md`, *route*), not as
 * `llm_route` stores it: a purpose the workspace has not configured is a route with
 * nothing chosen rather than a missing row, and `fixed` says the choice is not the
 * workspace's to make. `null`, not `undefined`, because this shape crosses a wire
 * with no transformer under it and an absent key would read as an absent purpose.
 */
export type WorkspaceRoute = {
  readonly purpose: LlmPurpose;
  readonly provider: string | null;
  readonly model: string | null;
  /** The embedding route's vector width; every other purpose carries none. */
  readonly dimensions: number | null;
  /**
   * A chosen embedding route is fixed: changing it invalidates every vector already
   * written (ADR 0020's hosted-embedding amendment). The database refusing the
   * change is T-029's; this is the word a screen shows. An embedding purpose with no
   * route yet is not fixed — there is nothing chosen for a vector to depend on.
   */
  readonly fixed: boolean;
};

const FIXED_PURPOSE: LlmPurpose = "embedding";

type RouteRow = {
  readonly purpose: string;
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number | null;
};

/**
 * The workspace's routes, one row per purpose in purpose order, read as the Principal
 * inside the transaction that resolved it — so RLS is the guarantee (`[DESIGN4]`) and
 * the statement names the workspace anyway (`[SEC2]`).
 */
export const listRoutes = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<readonly WorkspaceRoute[]> => {
  const configured = await tx.query<RouteRow>(
    "SELECT purpose, provider, model, dimensions FROM llm_route WHERE workspace_id = $1",
    [principal.workspaceId],
  );
  const byPurpose = new Map(configured.rows.map((row) => [row.purpose, row]));
  return LLM_PURPOSES.map((purpose) => {
    const row = byPurpose.get(purpose);
    return {
      purpose,
      provider: row?.provider ?? null,
      model: row?.model ?? null,
      dimensions: row?.dimensions ?? null,
      fixed: row !== undefined && purpose === FIXED_PURPOSE,
    };
  });
};
