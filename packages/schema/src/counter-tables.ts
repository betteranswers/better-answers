import { integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

import { stamp } from "./column-helpers.ts";

export const INGRESS_SCOPES = ["ip", "email", "person"] as const;

export const ingressCounter = pgTable(
  "ingress_counter",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    windowStart: stamp("window_start").notNull(),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.key, table.windowStart] })],
);

export const mcpCallCounter = pgTable(
  "mcp_call_counter",
  {
    workspaceId: text("workspace_id").notNull(),

    tokenId: text("token_id").notNull(),
    windowStart: stamp("window_start").notNull(),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.tokenId, table.windowStart] })],
);

export const GLOBAL_TABLE_NAMES_BEYOND_IDENTITY = [
  "public.ingress_counter",
  "public.contract_stamp",
  "public.sweep_pass",
  "public.identity_audit_event",
] as const;
