CREATE TABLE "finding" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"document_id" text NOT NULL,
	"category" text NOT NULL,
	"tier" text NOT NULL,
	"rule_id" text NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"score" double precision NOT NULL,
	"rule_version" text NOT NULL,
	"detector_pin" text NOT NULL,
	"review_state" text DEFAULT 'unreviewed' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"restored_at" timestamp with time zone,
	"restored_by" text,
	"restore_reason" text,
	CONSTRAINT "finding_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "finding_tier_check" CHECK (tier IN ('always', 'default-on', 'default-off')),
	CONSTRAINT "finding_review_state_check" CHECK (review_state IN ('unreviewed', 'kept-in-text', 'narrowed')),
	CONSTRAINT "finding_span_check" CHECK (char_start >= 0 AND char_end > char_start),
	CONSTRAINT "finding_score_check" CHECK (score >= 0 AND score <= 1),
	CONSTRAINT "finding_review_check" CHECK ((review_state = 'unreviewed') = (reviewed_at IS NULL)
         AND (reviewed_at IS NULL) = (reviewed_by IS NULL)
         AND (review_reason IS NULL OR reviewed_at IS NOT NULL)),
	CONSTRAINT "finding_restore_check" CHECK ((restored_at IS NULL) = (restored_by IS NULL)
         AND (restored_at IS NULL) = (restore_reason IS NULL)
         AND (restored_at IS NULL OR tier = 'always')),
	CONSTRAINT "finding_actor_check" CHECK ((reviewed_by IS NULL OR reviewed_by ~ '^(human:[0-9A-HJKMNP-TV-Z]{26}|process:better-answers-[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)$')
         AND (restored_by IS NULL OR restored_by ~ '^(human:[0-9A-HJKMNP-TV-Z]{26}|process:better-answers-[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)$'))
);
--> statement-breakpoint
ALTER TABLE "finding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."source_document"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_workspace_id_document_id_idx" ON "finding" USING btree ("workspace_id","document_id");--> statement-breakpoint
CREATE POLICY "finding_workspace_isolation" ON "finding" AS PERMISSIVE FOR ALL TO public USING ("finding"."workspace_id" = (select current_workspace_id())) WITH CHECK ("finding"."workspace_id" = (select current_workspace_id()));