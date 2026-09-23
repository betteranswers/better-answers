-- Custom migration (hand-written SQL; ADR 0032).

ALTER TABLE "workspace" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_config" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNLOGGED TABLE "ingress_counter" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "ingress_counter_pk" PRIMARY KEY ("scope", "key", "window_start")
);--> statement-breakpoint
CREATE UNLOGGED TABLE "mcp_call_counter" (
	"workspace_id" text NOT NULL,
	"token_id" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "mcp_call_counter_pk" PRIMARY KEY ("workspace_id", "token_id", "window_start")
);--> statement-breakpoint
ALTER TABLE "mcp_call_counter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "mcp_call_counter_workspace_isolation" ON "mcp_call_counter" AS PERMISSIVE FOR ALL TO public
  USING ("workspace_id" = (select current_workspace_id()))
  WITH CHECK ("workspace_id" = (select current_workspace_id()));--> statement-breakpoint
ALTER TABLE "mcp_call_counter" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "user", "session", "account", "verification", "jwks", "member", "invitation",
  "oauth_client", "oauth_resource", "oauth_client_resource", "oauth_refresh_token",
  "oauth_access_token", "oauth_consent", "oauth_client_assertion", "rate_limit",
  "ingress_counter", "mcp_call_counter" FROM worker_rt;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "workspace", "workspace_config" FROM worker_rt;
