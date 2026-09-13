import { llmPurpose } from "@better-answers/schema";

import { attempt, err, ok, type Result, type UserPrincipal } from "../kernel/index.ts";
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
  /**
   * How long the provider keeps what is sent to it, in the provider's own words — the
   * sentence the **DPIA input** prints for this route (ADR 0020 amending ADR 0013's route
   * slot; the S0 spec, *The DPIA input*). It is on the read because a DPIA is assembled from
   * a route as a reader sees one, and this is the one door a route is read through.
   *
   * `null` where nobody has read the provider's terms yet, which is a different fact from a
   * tail of nothing — an unconfigured purpose has no tail, as it has no provider.
   */
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

/**
 * The workspace's routes, one row per purpose in purpose order, read as the Principal
 * inside the transaction that resolved it — so RLS is the guarantee (ADR 0032) and
 * the statement names the workspace anyway.
 *
 * No refusal word: a workspace that has configured nothing is five routes with nothing
 * chosen, not a failure. So the error arm is the store's alone (the kernel's result
 * convention, `kernel/result.ts`) and a caller reads a failure rather than catching one.
 */
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
