CREATE TABLE "erasure_request" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"subject_request_id" text NOT NULL,
	"pseudonym" text NOT NULL,
	"locked_at" timestamp with time zone NOT NULL,
	"actions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"anchored_at" timestamp with time zone NOT NULL,
	"beyond_use_hourly_at" timestamp with time zone NOT NULL,
	"beyond_use_daily_at" timestamp with time zone NOT NULL,
	"beyond_use_weekly_at" timestamp with time zone NOT NULL,
	"beyond_use_monthly_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"report" text,
	CONSTRAINT "erasure_request_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "erasure_request_actions_check" CHECK (jsonb_typeof(actions) = 'object'),
	CONSTRAINT "erasure_request_beyond_use_check" CHECK (beyond_use_hourly_at > anchored_at
         AND beyond_use_daily_at > beyond_use_hourly_at
         AND beyond_use_weekly_at > beyond_use_daily_at
         AND beyond_use_monthly_at > beyond_use_weekly_at),
	CONSTRAINT "erasure_request_completion_check" CHECK ((completed_at IS NULL) = (report IS NULL))
);
--> statement-breakpoint
ALTER TABLE "erasure_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "erasure_request" ADD CONSTRAINT "erasure_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_request" ADD CONSTRAINT "erasure_request_subject_request_fk" FOREIGN KEY ("workspace_id","subject_request_id") REFERENCES "public"."subject_request"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "erasure_request_subject_request_uidx" ON "erasure_request" USING btree ("workspace_id","subject_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "erasure_request_pseudonym_uidx" ON "erasure_request" USING btree ("workspace_id","pseudonym");--> statement-breakpoint
CREATE POLICY "erasure_request_workspace_isolation" ON "erasure_request" AS PERMISSIVE FOR ALL TO public USING ("erasure_request"."workspace_id" = (select current_workspace_id())) WITH CHECK ("erasure_request"."workspace_id" = (select current_workspace_id()));