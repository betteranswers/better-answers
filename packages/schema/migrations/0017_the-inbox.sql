CREATE TABLE "concept_write_request" (
	"workspace_id" text NOT NULL,
	"suggestion_id" text NOT NULL,
	"merge_key" text NOT NULL,
	"path" text NOT NULL,
	"concept_kind" text NOT NULL,
	"title" text NOT NULL,
	"frontmatter" jsonb NOT NULL,
	"body" text NOT NULL,
	"base_content_hash" text,
	CONSTRAINT "concept_write_request_workspace_id_suggestion_id_pk" PRIMARY KEY("workspace_id","suggestion_id"),
	CONSTRAINT "concept_write_request_body_length_check" CHECK (char_length(body) <= 100000),
	CONSTRAINT "concept_write_request_frontmatter_length_check" CHECK (char_length(frontmatter::text) <= 128000)
);
--> statement-breakpoint
ALTER TABLE "concept_write_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suggestion" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"set_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"proposer" text NOT NULL,
	"target_iri" text,
	"decider" text,
	"reason" text,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "suggestion_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "suggestion_kind_check" CHECK (kind IN ('edit', 'candidate', 'promotion', 'repair')),
	CONSTRAINT "suggestion_status_check" CHECK (status IN ('waiting', 'accepted', 'declined', 'returned')),
	CONSTRAINT "suggestion_proposer_check" CHECK (proposer ~ '^(human:[0-9A-HJKMNP-TV-Z]{26}|process:better-answers-[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)$'),
	CONSTRAINT "suggestion_decider_check" CHECK (decider IS NULL OR decider ~ '^(human:[0-9A-HJKMNP-TV-Z]{26}|process:better-answers-[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)$'),
	CONSTRAINT "suggestion_repair_proposer_check" CHECK (kind <> 'repair' OR proposer LIKE 'process:better-answers-%'),
	CONSTRAINT "suggestion_reason_length_check" CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 2000),
	CONSTRAINT "suggestion_decision_check" CHECK ((status = 'waiting') = (decided_at IS NULL)
         AND (decided_at IS NULL) = (decider IS NULL)
         AND (target_iri IS NOT NULL) = (status = 'accepted')
         AND (reason IS NOT NULL) = (status IN ('declined', 'returned')))
);
--> statement-breakpoint
ALTER TABLE "suggestion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concept_write_request" ADD CONSTRAINT "concept_write_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_write_request" ADD CONSTRAINT "concept_write_request_suggestion_fk" FOREIGN KEY ("workspace_id","suggestion_id") REFERENCES "public"."suggestion"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_target_fk" FOREIGN KEY ("workspace_id","target_iri") REFERENCES "public"."concept_identity"("workspace_id","iri") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggestion_workspace_id_set_id_idx" ON "suggestion" USING btree ("workspace_id","set_id");--> statement-breakpoint
CREATE POLICY "concept_write_request_workspace_isolation" ON "concept_write_request" AS PERMISSIVE FOR ALL TO public USING ("concept_write_request"."workspace_id" = (select current_workspace_id())) WITH CHECK ("concept_write_request"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "suggestion_workspace_isolation" ON "suggestion" AS PERMISSIVE FOR ALL TO public USING ("suggestion"."workspace_id" = (select current_workspace_id())) WITH CHECK ("suggestion"."workspace_id" = (select current_workspace_id()));