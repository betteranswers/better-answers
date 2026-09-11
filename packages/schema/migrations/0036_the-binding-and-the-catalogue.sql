ALTER TABLE "source_binding" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "source_binding" ADD COLUMN "connector" text NOT NULL;--> statement-breakpoint
ALTER TABLE "source_binding" ADD COLUMN "destination" text[] DEFAULT '{"chunk-index","bundle"}' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_binding" ADD COLUMN "retention_class" text DEFAULT 'keep' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_binding" ADD COLUMN "state" text DEFAULT 'landed' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "source_system_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "title" text NOT NULL;--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "media_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "byte_size" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "original_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "normalised_key" text;--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "redaction_version" text;--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "first_seen" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "last_seen" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "last_modified" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "gone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "sensitivity" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_source_document_fk" FOREIGN KEY ("workspace_id","source_document_id") REFERENCES "public"."source_document"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_event_workspace_id_id_uidx" ON "audit_event" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_document_workspace_id_binding_id_source_system_id_uidx" ON "source_document" USING btree ("workspace_id","binding_id","source_system_id");--> statement-breakpoint
ALTER TABLE "source_binding" ADD CONSTRAINT "source_binding_connector_check" CHECK (connector IN ('upload'));--> statement-breakpoint
ALTER TABLE "source_binding" ADD CONSTRAINT "source_binding_destination_check" CHECK (cardinality(destination) > 0
         AND array_position(destination, NULL) IS NULL
         AND destination <@ ARRAY['chunk-index', 'bundle', 'graph']::text[]);--> statement-breakpoint
ALTER TABLE "source_binding" ADD CONSTRAINT "source_binding_retention_class_check" CHECK (retention_class IN ('mirror', 'keep', 'transient'));--> statement-breakpoint
ALTER TABLE "source_binding" ADD CONSTRAINT "source_binding_state_check" CHECK (state IN ('landed', 'indexing', 'indexed', 'published'));--> statement-breakpoint
ALTER TABLE "source_document" ADD CONSTRAINT "source_document_outcome_check" CHECK (outcome IS NULL OR outcome IN ('converted', 'quarantined'));--> statement-breakpoint
ALTER TABLE "source_document" ADD CONSTRAINT "source_document_sensitivity_check" CHECK (sensitivity IS NULL OR sensitivity IN ('Restricted', 'Internal', 'Public'));--> statement-breakpoint
ALTER TABLE "source_document" ADD CONSTRAINT "source_document_byte_size_check" CHECK (byte_size >= 0);