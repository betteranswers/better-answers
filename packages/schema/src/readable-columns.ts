import { sql } from "drizzle-orm";
import { check, text } from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";
import { workspace } from "./workspace-table.ts";

export const SENSITIVITIES = ["Restricted", "Internal", "Public"] as const;

export const SENSITIVITY_DEFAULT = "Restricted" satisfies (typeof SENSITIVITIES)[number];

export const AUDIENCES = ["everyone", "groups"] as const;

export const AUDIENCE_EVERYONE = "everyone" satisfies (typeof AUDIENCES)[number];

export const AUDIENCE_GROUPS = "groups" satisfies (typeof AUDIENCES)[number];

export const AUDIENCE_CHECK = `(audience = '${AUDIENCE_EVERYONE}' AND audience_groups IS NULL) OR (audience = '${AUDIENCE_GROUPS}' AND audience_groups IS NOT NULL AND cardinality(audience_groups) > 0 AND array_position(audience_groups, NULL) IS NULL)`;

export const readableUnitColumns = () => ({
  publishedAt: stamp("published_at"),
  sensitivity: text("sensitivity").notNull().default(SENSITIVITY_DEFAULT),
  audience: text("audience").notNull().default(AUDIENCE_EVERYONE),
  audienceGroups: text("audience_groups").array(),
});

export const readableUnitChecks = (tableName: string) => [
  check(`${tableName}_sensitivity_check`, sql.raw(`sensitivity IN (${listed(SENSITIVITIES)})`)),
  check(`${tableName}_audience_check`, sql.raw(AUDIENCE_CHECK)),
];

export const readableRecordColumns = () => ({
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  ...readableUnitColumns(),
  createdAt: stamp("created_at").notNull().defaultNow(),
});
