ALTER TABLE "source_document" ADD COLUMN "quarantine_error" text;--> statement-breakpoint
ALTER TABLE "source_document" ADD CONSTRAINT "source_document_quarantine_error_check" CHECK (quarantine_error IS NULL OR outcome IS NOT DISTINCT FROM 'quarantined');
