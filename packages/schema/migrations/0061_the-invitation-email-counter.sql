-- Custom migration (hand-written SQL; ADR 0032).
-- Unlogged, as the other counters are: a crash costs at most the hour's counts.
CREATE UNLOGGED TABLE "invitation_email_counter" (
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "invitation_email_counter_pk" PRIMARY KEY ("workspace_id", "key", "window_start")
);--> statement-breakpoint
ALTER TABLE "invitation_email_counter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "invitation_email_counter_workspace_isolation" ON "invitation_email_counter" AS PERMISSIVE FOR ALL TO public
  USING ("workspace_id" = (select current_workspace_id()))
  WITH CHECK ("workspace_id" = (select current_workspace_id()));--> statement-breakpoint
ALTER TABLE "invitation_email_counter" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "invitation_email_counter" FROM worker_rt;
