CREATE TABLE "concept_owner" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"collection" text,
	"iri" text,
	"person_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_owner_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "concept_owner_one_subject_check" CHECK ((collection IS NULL) <> (iri IS NULL)),
	CONSTRAINT "concept_owner_collection_check" CHECK (collection IS NULL OR collection ~ '^(?!\.{1,2}$)[^/\s]+$')
);--> statement-breakpoint
ALTER TABLE "concept_owner" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concept_owner" ADD CONSTRAINT "concept_owner_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_owner" ADD CONSTRAINT "concept_owner_identity_fk" FOREIGN KEY ("workspace_id","iri") REFERENCES "public"."concept_identity"("workspace_id","iri") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_owner" ADD CONSTRAINT "concept_owner_member_fk" FOREIGN KEY ("workspace_id","person_id") REFERENCES "public"."member"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "concept_owner_workspace_id_collection_uidx" ON "concept_owner" USING btree ("workspace_id","collection") WHERE collection IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "concept_owner_workspace_id_iri_uidx" ON "concept_owner" USING btree ("workspace_id","iri") WHERE iri IS NOT NULL;--> statement-breakpoint
CREATE INDEX "concept_owner_workspace_id_person_id_idx" ON "concept_owner" USING btree ("workspace_id","person_id");--> statement-breakpoint
CREATE POLICY "concept_owner_workspace_isolation" ON "concept_owner" AS PERMISSIVE FOR ALL TO public USING ("concept_owner"."workspace_id" = (select current_workspace_id())) WITH CHECK ("concept_owner"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
-- Hand-written from here, as each tenant table's substrate is: the policy binds the owner too.
ALTER TABLE "concept_owner" FORCE ROW LEVEL SECURITY;
