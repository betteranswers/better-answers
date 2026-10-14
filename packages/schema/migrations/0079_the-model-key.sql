CREATE TABLE "model_key" (
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"sealed" "bytea" NOT NULL,
	CONSTRAINT "model_key_workspace_id_provider_pk" PRIMARY KEY("workspace_id","provider"),
	CONSTRAINT "model_key_provider_check" CHECK (provider IN ('anthropic', 'mistral'))
);--> statement-breakpoint
ALTER TABLE "model_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "model_key" ADD CONSTRAINT "model_key_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "model_key_workspace_isolation" ON "model_key" AS PERMISSIVE FOR ALL TO public USING ("model_key"."workspace_id" = (select current_workspace_id())) WITH CHECK ("model_key"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
-- Hand-written from here, as each tenant table's substrate is: the policy binds the owner too.
ALTER TABLE "model_key" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The api tier alone holds the envelope key, so the worker has no use for a sealed row.
REVOKE ALL ON "model_key" FROM worker_rt;--> statement-breakpoint
-- A key is replaced in place, and nothing removes one.
REVOKE DELETE ON "model_key" FROM app_rt;
