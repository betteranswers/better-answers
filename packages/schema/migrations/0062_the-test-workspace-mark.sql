-- The foreign key waits behind any open transaction on workspace; five seconds bounds that wait, and a failed release is re-run by hand.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "test_workspace_mark" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"testing_domain" text NOT NULL
);--> statement-breakpoint
ALTER TABLE "test_workspace_mark" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-written, as each tenant table's substrate is: the policy binds the owner too, and the worker never reads it.
ALTER TABLE "test_workspace_mark" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "test_workspace_mark" FROM worker_rt;--> statement-breakpoint
ALTER TABLE "test_workspace_mark" ADD CONSTRAINT "test_workspace_mark_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "test_workspace_mark_workspace_isolation" ON "test_workspace_mark" AS PERMISSIVE FOR ALL TO public USING ("test_workspace_mark"."workspace_id" = (select current_workspace_id())) WITH CHECK ("test_workspace_mark"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
-- Every pending migration runs in one transaction, so the bound ends with this one.
SET LOCAL lock_timeout = DEFAULT;