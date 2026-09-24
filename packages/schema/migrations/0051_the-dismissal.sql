ALTER TABLE "finding" DROP CONSTRAINT "finding_review_state_check";--> statement-breakpoint
ALTER TABLE "job" DROP CONSTRAINT "job_reason_check";--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "narrowed_to" text;--> statement-breakpoint
ALTER TABLE "source_document" ADD CONSTRAINT "source_document_narrowed_to_check" CHECK (narrowed_to IS NULL
         OR (sensitivity IS NOT NULL
             AND narrowed_to IN ('Restricted', 'Internal', 'Public')
             AND public.narrower_class(sensitivity, narrowed_to) = sensitivity));--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_review_state_check" CHECK (review_state IN ('unreviewed', 'kept-in-text', 'narrowed', 'dismissed'));--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_reason_check" CHECK ((reason IS NOT NULL) = (kind IN ('full-rebuild', 'index'))
         AND (reason IS NULL OR (kind, reason) IN (('full-rebuild', 'first-sync'), ('full-rebuild', 'route-change'), ('full-rebuild', 'reconciler'), ('full-rebuild', 'erasure'), ('full-rebuild', 'upgrade'), ('full-rebuild', 'drill'), ('index', 'bound'), ('index', 'restored'), ('index', 'dismissed'), ('index', 'rule-change'), ('index', 'wiped'))));