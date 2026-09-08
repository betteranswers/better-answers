CREATE TABLE "job" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"outcome" jsonb,
	CONSTRAINT "job_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "job_kind_check" CHECK (kind IN ('nightly-audit', 'full-rebuild')),
	CONSTRAINT "job_status_check" CHECK (status IN ('queued', 'claimed', 'done', 'failed', 'poisoned')),
	CONSTRAINT "job_reason_check" CHECK ((reason IS NOT NULL) = (kind = 'full-rebuild')
         AND (reason IS NULL OR reason IN ('first-sync', 'route-change', 'reconciler', 'erasure', 'upgrade', 'drill'))),
	CONSTRAINT "job_attempts_check" CHECK (attempts >= 0 AND max_attempts >= 1 AND attempts <= max_attempts),
	CONSTRAINT "job_claim_check" CHECK ((claimed_by IS NULL) = (claimed_at IS NULL)
         AND (status <> 'claimed'
              OR (claimed_by IS NOT NULL AND claimed_at IS NOT NULL
                  AND lease_expires_at IS NOT NULL AND heartbeat_at IS NOT NULL))),
	CONSTRAINT "job_finished_check" CHECK ((finished_at IS NOT NULL) = (status IN ('done', 'failed', 'poisoned'))),
	CONSTRAINT "job_outcome_check" CHECK ((outcome IS NOT NULL) = (status IN ('done', 'failed')))
);
--> statement-breakpoint
ALTER TABLE "job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_workspace_id_status_enqueued_at_idx" ON "job" USING btree ("workspace_id","status","enqueued_at");--> statement-breakpoint
CREATE POLICY "job_workspace_isolation" ON "job" AS PERMISSIVE FOR ALL TO public USING ("job"."workspace_id" = (select current_workspace_id())) WITH CHECK ("job"."workspace_id" = (select current_workspace_id()));