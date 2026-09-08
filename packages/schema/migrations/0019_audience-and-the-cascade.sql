CREATE TABLE "concept_class_override" (
	"workspace_id" text NOT NULL,
	"iri" text NOT NULL,
	"sensitivity" text NOT NULL,
	"audience" text NOT NULL,
	"audience_groups" text[],
	"actor" text NOT NULL,
	"audit_event_id" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_class_override_workspace_id_iri_pk" PRIMARY KEY("workspace_id","iri"),
	CONSTRAINT "concept_class_override_sensitivity_check" CHECK (sensitivity IN ('Restricted', 'Internal', 'Public')),
	CONSTRAINT "concept_class_override_audience_check" CHECK ((audience = 'everyone' AND audience_groups IS NULL) OR (audience = 'groups' AND audience_groups IS NOT NULL AND cardinality(audience_groups) > 0 AND array_position(audience_groups, NULL) IS NULL)),
	CONSTRAINT "concept_class_override_actor_check" CHECK (actor ~ '^(human:[0-9A-HJKMNP-TV-Z]{26}|process:better-answers-[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)$')
);
--> statement-breakpoint
ALTER TABLE "concept_class_override" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "concept_evidence" (
	"workspace_id" text NOT NULL,
	"iri" text NOT NULL,
	"source_document_id" text NOT NULL,
	"locator" text NOT NULL,
	CONSTRAINT "concept_evidence_workspace_id_iri_source_document_id_locator_pk" PRIMARY KEY("workspace_id","iri","source_document_id","locator")
);
--> statement-breakpoint
ALTER TABLE "concept_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_binding" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"published_at" timestamp with time zone,
	"sensitivity" text DEFAULT 'Restricted' NOT NULL,
	"audience" text DEFAULT 'everyone' NOT NULL,
	"audience_groups" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_binding_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "source_binding_sensitivity_check" CHECK (sensitivity IN ('Restricted', 'Internal', 'Public')),
	CONSTRAINT "source_binding_audience_check" CHECK ((audience = 'everyone' AND audience_groups IS NULL) OR (audience = 'groups' AND audience_groups IS NOT NULL AND cardinality(audience_groups) > 0 AND array_position(audience_groups, NULL) IS NULL))
);
--> statement-breakpoint
ALTER TABLE "source_binding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_document" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"binding_id" text NOT NULL,
	CONSTRAINT "source_document_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "source_document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "composition" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"published_at" timestamp with time zone,
	"sensitivity" text DEFAULT 'Restricted' NOT NULL,
	"audience" text DEFAULT 'everyone' NOT NULL,
	"audience_groups" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "composition_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "composition_sensitivity_check" CHECK (sensitivity IN ('Restricted', 'Internal', 'Public')),
	CONSTRAINT "composition_audience_check" CHECK ((audience = 'everyone' AND audience_groups IS NULL) OR (audience = 'groups' AND audience_groups IS NOT NULL AND cardinality(audience_groups) > 0 AND array_position(audience_groups, NULL) IS NULL))
);
--> statement-breakpoint
ALTER TABLE "composition" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "composition_include" (
	"workspace_id" text NOT NULL,
	"composition_id" text NOT NULL,
	"id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"iri" text NOT NULL,
	CONSTRAINT "composition_include_workspace_id_composition_id_id_pk" PRIMARY KEY("workspace_id","composition_id","id"),
	CONSTRAINT "composition_include_ordinal_check" CHECK (ordinal >= 0)
);
--> statement-breakpoint
ALTER TABLE "composition_include" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concept_index" ADD COLUMN "audience_groups" text[];--> statement-breakpoint
ALTER TABLE "concept_class_override" ADD CONSTRAINT "concept_class_override_identity_fk" FOREIGN KEY ("workspace_id","iri") REFERENCES "public"."concept_identity"("workspace_id","iri") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_evidence" ADD CONSTRAINT "concept_evidence_identity_fk" FOREIGN KEY ("workspace_id","iri") REFERENCES "public"."concept_identity"("workspace_id","iri") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_evidence" ADD CONSTRAINT "concept_evidence_evidence_fk" FOREIGN KEY ("workspace_id","source_document_id","locator") REFERENCES "public"."evidence"("workspace_id","source_document_id","locator") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_binding" ADD CONSTRAINT "source_binding_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_document" ADD CONSTRAINT "source_document_binding_fk" FOREIGN KEY ("workspace_id","binding_id") REFERENCES "public"."source_binding"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition" ADD CONSTRAINT "composition_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_include" ADD CONSTRAINT "composition_include_composition_fk" FOREIGN KEY ("workspace_id","composition_id") REFERENCES "public"."composition"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_include" ADD CONSTRAINT "composition_include_identity_fk" FOREIGN KEY ("workspace_id","iri") REFERENCES "public"."concept_identity"("workspace_id","iri") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concept_evidence_workspace_id_source_document_id_idx" ON "concept_evidence" USING btree ("workspace_id","source_document_id");--> statement-breakpoint
CREATE INDEX "source_document_workspace_id_binding_id_idx" ON "source_document" USING btree ("workspace_id","binding_id");--> statement-breakpoint
CREATE INDEX "composition_include_workspace_id_iri_idx" ON "composition_include" USING btree ("workspace_id","iri");--> statement-breakpoint
ALTER TABLE "concept_index" ADD CONSTRAINT "concept_index_audience_check" CHECK ((audience = 'everyone' AND audience_groups IS NULL) OR (audience = 'groups' AND audience_groups IS NOT NULL AND cardinality(audience_groups) > 0 AND array_position(audience_groups, NULL) IS NULL));--> statement-breakpoint
CREATE POLICY "concept_class_override_workspace_isolation" ON "concept_class_override" AS PERMISSIVE FOR ALL TO public USING ("concept_class_override"."workspace_id" = (select current_workspace_id())) WITH CHECK ("concept_class_override"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "concept_evidence_workspace_isolation" ON "concept_evidence" AS PERMISSIVE FOR ALL TO public USING ("concept_evidence"."workspace_id" = (select current_workspace_id())) WITH CHECK ("concept_evidence"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "source_binding_workspace_isolation" ON "source_binding" AS PERMISSIVE FOR ALL TO public USING ("source_binding"."workspace_id" = (select current_workspace_id())) WITH CHECK ("source_binding"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "source_document_workspace_isolation" ON "source_document" AS PERMISSIVE FOR ALL TO public USING ("source_document"."workspace_id" = (select current_workspace_id())) WITH CHECK ("source_document"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "composition_workspace_isolation" ON "composition" AS PERMISSIVE FOR ALL TO public USING ("composition"."workspace_id" = (select current_workspace_id())) WITH CHECK ("composition"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "composition_include_workspace_isolation" ON "composition_include" AS PERMISSIVE FOR ALL TO public USING ("composition_include"."workspace_id" = (select current_workspace_id())) WITH CHECK ("composition_include"."workspace_id" = (select current_workspace_id()));