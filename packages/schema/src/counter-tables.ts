import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const ingressCounter = pgTable(
  "ingress_counter",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.key, table.windowStart] })],
);

export const mcpCallCounter = pgTable(
  "mcp_call_counter",
  {
    workspaceId: text("workspace_id").notNull(),

    tokenId: text("token_id").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.tokenId, table.windowStart] })],
);

export const GLOBAL_TABLE_NAMES_BEYOND_IDENTITY = [
  "public.ingress_counter",
  "public.contract_stamp",
] as const;
