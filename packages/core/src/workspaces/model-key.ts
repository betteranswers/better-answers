import { z } from "zod";

import { boundarySchemas, MODEL_PROVIDERS, type ModelProvider } from "@better-answers/schema";

import { action, declareActions, record, STORED_DETAIL_KEYS } from "../audit/index.ts";
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
import type { ModelKeySetting } from "../llm/index.ts";
import { type PostgresDoor, withScope } from "../store/postgres/index.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

/** The event names the model provider and never the key: its detail takes one of a closed set. */
const MODEL_KEY_ACTIONS = declareActions("platform", {
  set: action("platform.workspace.model_key_set", {
    [STORED_DETAIL_KEYS.modelProvider]: "modelProvider",
  }),
});

const named = z.object({
  workspaceId: boundarySchemas.workspace.select.shape.id,
  provider: z.enum(MODEL_PROVIDERS),
});

type SetModelKeyInput = {
  readonly workspaceId: string;
  readonly provider: string;
  readonly key: string;
};

type ModelKeySet = {
  readonly workspaceId: string;
  readonly provider: ModelProvider;
};

export type SetModelKeyRefusal = KernelRefusal<"malformed"> | WorkspaceRefusal<"no-such-workspace">;

/**
 * Sets the workspace's key for one model provider, replacing any it held, and records that it was
 * set. The key is neither answered nor recorded.
 */
export const setModelKey = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  setting: ModelKeySetting,
  input: SetModelKeyInput,
): Promise<Result<ModelKeySet, SetModelKeyRefusal | Error>> => {
  const asked = named.safeParse({ workspaceId: input.workspaceId, provider: input.provider });
  if (!asked.success) return err(MALFORMED);
  const of = asked.data;

  const set = await attempt(() =>
    withScope(
      platform,
      door,
      of.workspaceId,
      async (tx): Promise<Result<ModelKeySet, SetModelKeyRefusal>> => {
        const held = await tx.query("SELECT 1 FROM workspace WHERE id = $1", [of.workspaceId]);
        if (held.rows.length === 0) return err("no-such-workspace");

        const stored = await setting.storeModelKey(tx, of, input.key, () =>
          record(platform, tx, {
            id: ulid(),
            action: MODEL_KEY_ACTIONS.set,
            subjectId: of.workspaceId,
            detail: { [STORED_DETAIL_KEYS.modelProvider]: of.provider },
          }),
        );
        return stored.ok ? ok(of) : stored;
      },
    ),
  );

  if (!set.ok) return err(set.error);
  return set.value;
};
