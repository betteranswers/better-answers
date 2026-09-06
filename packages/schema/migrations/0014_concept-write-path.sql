CREATE TABLE "bundle_commit" (
	"workspace_id" text NOT NULL,
	"sha" text NOT NULL,
	"parent_sha" text,
	"audit_event_id" text NOT NULL,
	"actor" text NOT NULL,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bundle_commit_workspace_id_sha_pk" PRIMARY KEY("workspace_id","sha")
);
--> statement-breakpoint
ALTER TABLE "bundle_commit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "concept_identity" (
	"workspace_id" text NOT NULL,
	"iri" text NOT NULL,
	"merge_key" text NOT NULL,
	"minted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_identity_workspace_id_iri_pk" PRIMARY KEY("workspace_id","iri")
);
--> statement-breakpoint
ALTER TABLE "concept_identity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "concept_index" (
	"workspace_id" text NOT NULL,
	"iri" text NOT NULL,
	"path" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"frontmatter" jsonb NOT NULL,
	"body" text NOT NULL,
	"content_hash" text NOT NULL,
	"commit_sha" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"sensitivity" text DEFAULT 'Restricted' NOT NULL,
	"audience" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_index_workspace_id_iri_pk" PRIMARY KEY("workspace_id","iri"),
	CONSTRAINT "concept_index_status_check" CHECK (status IN ('draft', 'stable', 'deprecated', 'removed')),
	CONSTRAINT "concept_index_sensitivity_check" CHECK (sensitivity IN ('Restricted', 'Internal', 'Public'))
);
--> statement-breakpoint
ALTER TABLE "concept_index" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "concept_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"iri" text NOT NULL,
	"actor" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text,
	"origin" text DEFAULT 'platform' NOT NULL,
	CONSTRAINT "concept_verification_origin_check" CHECK (origin IN ('platform', 'imported', 'erasure-rewrite', 'repair')),
	CONSTRAINT "concept_verification_imported_check" CHECK (origin <> 'imported' OR content_hash IS NULL)
);
--> statement-breakpoint
ALTER TABLE "concept_verification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence" (
	"workspace_id" text NOT NULL,
	"source_document_id" text NOT NULL,
	"locator" text NOT NULL,
	"resource" text NOT NULL,
	"content_version" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_workspace_id_source_document_id_locator_pk" PRIMARY KEY("workspace_id","source_document_id","locator")
);
--> statement-breakpoint
ALTER TABLE "evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bundle_commit" ADD CONSTRAINT "bundle_commit_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_identity" ADD CONSTRAINT "concept_identity_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_index" ADD CONSTRAINT "concept_index_identity_fk" FOREIGN KEY ("workspace_id","iri") REFERENCES "public"."concept_identity"("workspace_id","iri") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_verification" ADD CONSTRAINT "concept_verification_identity_fk" FOREIGN KEY ("workspace_id","iri") REFERENCES "public"."concept_identity"("workspace_id","iri") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bundle_commit_audit_event_uidx" ON "bundle_commit" USING btree ("workspace_id","audit_event_id");--> statement-breakpoint
CREATE INDEX "bundle_commit_workspace_id_committed_at_idx" ON "bundle_commit" USING btree ("workspace_id","committed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_identity_merge_key_uidx" ON "concept_identity" USING btree ("workspace_id","merge_key");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_index_workspace_id_path_uidx" ON "concept_index" USING btree ("workspace_id","path");--> statement-breakpoint
CREATE INDEX "concept_verification_workspace_id_iri_checked_at_idx" ON "concept_verification" USING btree ("workspace_id","iri","checked_at");--> statement-breakpoint
CREATE POLICY "bundle_commit_workspace_isolation" ON "bundle_commit" AS PERMISSIVE FOR ALL TO public USING ("bundle_commit"."workspace_id" = (select current_workspace_id())) WITH CHECK ("bundle_commit"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "concept_identity_workspace_isolation" ON "concept_identity" AS PERMISSIVE FOR ALL TO public USING ("concept_identity"."workspace_id" = (select current_workspace_id())) WITH CHECK ("concept_identity"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "concept_index_workspace_isolation" ON "concept_index" AS PERMISSIVE FOR ALL TO public USING ("concept_index"."workspace_id" = (select current_workspace_id())) WITH CHECK ("concept_index"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "concept_verification_workspace_isolation" ON "concept_verification" AS PERMISSIVE FOR ALL TO public USING ("concept_verification"."workspace_id" = (select current_workspace_id())) WITH CHECK ("concept_verification"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "evidence_workspace_isolation" ON "evidence" AS PERMISSIVE FOR ALL TO public USING ("evidence"."workspace_id" = (select current_workspace_id())) WITH CHECK ("evidence"."workspace_id" = (select current_workspace_id()));