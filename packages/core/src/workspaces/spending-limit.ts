import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { action, declareActions, record } from "../audit/index.ts";
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
import { SPENDING_LIMIT_KEY } from "../llm/index.ts";
import { type PostgresDoor, withScope, writeWorkspaceConfig } from "../store/postgres/index.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

/** The amount stays in the setting it sets: no detail key holds a sum of money. */
const SPENDING_LIMIT_ACTIONS = declareActions("platform", {
  set: action("platform.workspace.spending_limit_set", {}),
});

/** Whole dollars and cents beyond them, as a decimal string: money is never a float. */
const named = z.object({
  workspaceId: boundarySchemas.workspace.select.shape.id,
  usd: z.string().regex(/^\d{1,9}(\.\d{1,6})?$/),
});

type SpendingLimit = { readonly workspaceId: string; readonly usd: string };

export type SetSpendingLimitRefusal =
  | KernelRefusal<"malformed">
  | WorkspaceRefusal<"no-such-workspace">;

/**
 * Sets the most the workspace's model calls may spend in a calendar month, replacing any limit, and
 * records that it was set.
 */
export const setSpendingLimit = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: SpendingLimit,
): Promise<Result<SpendingLimit, SetSpendingLimitRefusal | Error>> => {
  const asked = named.safeParse(input);
  if (!asked.success) return err(MALFORMED);
  const { workspaceId, usd } = asked.data;

  const set = await attempt(() =>
    withScope(
      platform,
      door,
      workspaceId,
      async (tx): Promise<Result<SpendingLimit, SetSpendingLimitRefusal>> => {
        const held = await tx.query("SELECT 1 FROM workspace WHERE id = $1", [workspaceId]);
        if (held.rows.length === 0) return err("no-such-workspace");
        await writeWorkspaceConfig(tx, { workspaceId, key: SPENDING_LIMIT_KEY, value: usd });
        await record(platform, tx, {
          id: ulid(),
          action: SPENDING_LIMIT_ACTIONS.set,
          subjectId: workspaceId,
          detail: {},
        });
        return ok({ workspaceId, usd });
      },
    ),
  );
  if (!set.ok) return err(set.error);
  return set.value;
};
