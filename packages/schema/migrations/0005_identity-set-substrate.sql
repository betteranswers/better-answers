-- Custom migration (hand-written SQL; ADR 0032).
-- The identity set's substrate (ADR 0009, 2026-09-01 amendment): `workspace` leaves
-- row-level security because it is Better Auth's organisation model, read by key before
-- any scope exists; `workspace_config` takes the FORCE line withRLS() cannot emit; and
-- the two UNLOGGED rate-limit counters land with their DDL hand-written, because
-- drizzle-kit cannot emit UNLOGGED (they mirror src/counter-tables.ts column for column —
-- the worker-view drift test holds them equal).

-- 0004 already dropped the policy and disabled RLS; FORCE is the one flag drizzle-kit
-- never touches. The RLS coverage test names this table in its exemption list.
ALTER TABLE "workspace" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- FORCE applies RLS to the table's owner too (`[DESIGN4]`); the coverage test fails on
-- any tenant table whose FORCE line is missing.
ALTER TABLE "workspace_config" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The pre-authentication counter: per-IP in front of /oauth2/*, the three pages and
-- /mcp's 401s, and per-email on the sign-in page (T-004; research 80 F8). Global — no
-- workspace exists before authentication — so it is named in the exemption list too.
-- UNLOGGED is the write ceiling: never WAL-logged, so the limiter cannot become the
-- load it exists to shed, and a crash empties it, which loses nothing worth keeping.
CREATE UNLOGGED TABLE "ingress_counter" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "ingress_counter_pk" PRIMARY KEY ("scope", "key", "window_start")
);
--> statement-breakpoint
-- The per-token counter on the MCP surface (ADR 0018): one row per (token, window),
-- upserted with count + 1 inside the tool call's own transaction, under the same
-- workspace-isolation policy as every tenant table.
CREATE UNLOGGED TABLE "mcp_call_counter" (
	"workspace_id" text NOT NULL,
	"token_id" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "mcp_call_counter_pk" PRIMARY KEY ("workspace_id", "token_id", "window_start")
);
--> statement-breakpoint
ALTER TABLE "mcp_call_counter" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "mcp_call_counter_workspace_isolation" ON "mcp_call_counter" AS PERMISSIVE FOR ALL TO public
  USING ("workspace_id" = (select current_workspace_id()))
  WITH CHECK ("workspace_id" = (select current_workspace_id()));
--> statement-breakpoint
ALTER TABLE "mcp_call_counter" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The worker never touches the identity set or the counters, but migration 0000's
-- default privileges grant worker_rt DML on every new public table — and these hold
-- secrets, sessions, signing keys and memberships. Revoked here; `[SEC3]`'s refusal is
-- the test "refuses the worker role on every identity-set table and the counters"
-- (packages/schema/test/rls.test.ts). The worker keeps SELECT on `workspace` and
-- `workspace_config` (the tenant's own row and thresholds) and nothing else.
REVOKE ALL ON "user", "session", "account", "verification", "jwks", "member", "invitation",
  "oauth_client", "oauth_resource", "oauth_client_resource", "oauth_refresh_token",
  "oauth_access_token", "oauth_consent", "oauth_client_assertion", "rate_limit",
  "ingress_counter", "mcp_call_counter" FROM worker_rt;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "workspace", "workspace_config" FROM worker_rt;
