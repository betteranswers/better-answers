import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The two platform rate-limit counters (ADR 0018, research 80 F8; T-004). Declared here,
 * outside `drizzle.config.ts`'s `schema` path, because both are created `UNLOGGED` and
 * drizzle-kit cannot emit that: the DDL is hand-written in the journal
 * (`0005_identity-set-substrate.sql`) and mirrors these declarations column for column —
 * the worker-view drift test holds them equal. `UNLOGGED` is the ticket's write ceiling:
 * a counter that is not WAL-logged cannot become the load it exists to shed, and a crash
 * loses nothing worth keeping.
 */

/**
 * Global (in `GLOBAL_TABLES`, not `IDENTITY_SET`): the pre-authentication per-IP counter
 * in front of `/oauth2/*`, the three pages and `/mcp`'s 401s, and the per-email send
 * throttle on the sign-in page. No workspace exists before authentication, so there is
 * nothing to scope it by.
 */
export const ingressCounter = pgTable(
  "ingress_counter",
  {
    // What is being limited — "ip" or "email" — so one table serves both keys.
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.key, table.windowStart] })],
);

/**
 * Tenant: one row per `(token, window)`, upserted with `count + 1` inside the tool call's
 * own transaction — the same one that resolved the Principal. Under the same
 * workspace-isolation policy as every tenant table (the policy is hand-written beside
 * the DDL).
 */
export const mcpCallCounter = pgTable(
  "mcp_call_counter",
  {
    workspaceId: text("workspace_id").notNull(),
    // The access token's `jti`; never the token itself (`[SEC1]`, `[LOG1]`).
    tokenId: text("token_id").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.tokenId, table.windowStart] })],
);

/**
 * The global tables beyond the identity set: the pre-authentication counter. Joined with
 * `IDENTITY_SET` in `RLS_EXEMPTIONS` (`rls-exemptions.ts`), the one exemption list, where
 * this name carries its reason.
 */
export const GLOBAL_TABLE_NAMES_BEYOND_IDENTITY = ["public.ingress_counter"] as const;
