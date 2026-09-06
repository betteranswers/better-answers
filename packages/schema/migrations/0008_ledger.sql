CREATE TABLE "audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"act" text NOT NULL,
	"family" text GENERATED ALWAYS AS (split_part(act, '.', 1)) STORED NOT NULL,
	"actor" text NOT NULL,
	"subject_kind" text GENERATED ALWAYS AS (split_part(act, '.', 2)) STORED NOT NULL,
	"subject_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"detail" jsonb NOT NULL,
	"batch_id" text,
	CONSTRAINT "audit_event_act_check" CHECK (act ~ '^(people|knowledge|sources|platform)\.[a-z][a-z_]*\.[a-z][a-z_]*$'),
	CONSTRAINT "audit_event_family_check" CHECK (family IN ('people', 'knowledge', 'sources', 'platform'))
);
--> statement-breakpoint
ALTER TABLE "audit_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_workspace_id_idx" ON "audit_event" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "audit_event_subject_idx" ON "audit_event" USING btree ("workspace_id","subject_kind","subject_id");--> statement-breakpoint
CREATE POLICY "audit_event_workspace_isolation" ON "audit_event" AS PERMISSIVE FOR ALL TO public USING ("audit_event"."workspace_id" = (select current_workspace_id())) WITH CHECK ("audit_event"."workspace_id" = (select current_workspace_id()));