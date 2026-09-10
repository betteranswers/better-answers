CREATE TABLE "suppression" (
	"workspace_id" text NOT NULL,
	"erasure_request_id" text NOT NULL,
	"document_id" text NOT NULL,
	"identifiers" jsonb NOT NULL,
	CONSTRAINT "suppression_workspace_id_erasure_request_id_document_id_pk" PRIMARY KEY("workspace_id","erasure_request_id","document_id"),
	CONSTRAINT "suppression_identifiers_check" CHECK (jsonb_typeof(identifiers) = 'object'
         AND jsonb_typeof(identifiers -> 'emails') IS NOT DISTINCT FROM 'array'
         AND jsonb_typeof(identifiers -> 'names') IS NOT DISTINCT FROM 'array'
         AND jsonb_typeof(identifiers -> 'other') IS NOT DISTINCT FROM 'array'
         AND jsonb_array_length(identifiers -> 'emails') + jsonb_array_length(identifiers -> 'names') + jsonb_array_length(identifiers -> 'other') > 0)
);
--> statement-breakpoint
ALTER TABLE "suppression" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppression" ADD CONSTRAINT "suppression_erasure_request_fk" FOREIGN KEY ("workspace_id","erasure_request_id") REFERENCES "public"."erasure_request"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression" ADD CONSTRAINT "suppression_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."source_document"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suppression_workspace_id_document_id_idx" ON "suppression" USING btree ("workspace_id","document_id");--> statement-breakpoint
CREATE POLICY "suppression_workspace_isolation" ON "suppression" AS PERMISSIVE FOR ALL TO public USING ("suppression"."workspace_id" = (select current_workspace_id())) WITH CHECK ("suppression"."workspace_id" = (select current_workspace_id()));