import { sql } from "drizzle-orm";
import { check, customType, primaryKey, text } from "drizzle-orm/pg-core";

import { listed } from "./column-helpers.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

/** Who hosts a model a model choice names; a model key is held for one of these and no other. */
export const MODEL_PROVIDERS = ["anthropic", "mistral"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

const sealedFrame = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** Sealed and never hashed, because the key is sent: the row holds no readable part of it. */
export const modelKey = withRLS(
  "model_key",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id),
    provider: text("provider").notNull(),
    sealed: sealedFrame("sealed").notNull(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.provider] }),
    check("model_key_provider_check", sql.raw(`provider IN (${listed(MODEL_PROVIDERS)})`)),
  ],
);
