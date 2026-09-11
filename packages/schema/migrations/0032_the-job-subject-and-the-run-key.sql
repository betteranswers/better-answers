ALTER TABLE "job" DROP CONSTRAINT "job_kind_check";--> statement-breakpoint
ALTER TABLE "job" DROP CONSTRAINT "job_reason_check";--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "subject_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "job_queued_subject_key" ON "job" USING btree ("workspace_id","kind","subject_id") WHERE status = 'queued';--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_subject_check" CHECK ((subject_id IS NOT NULL) = (kind IN ('index')));--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_kind_check" CHECK (kind IN ('nightly-audit', 'full-rebuild', 'index'));--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_reason_check" CHECK ((reason IS NOT NULL) = (kind IN ('full-rebuild', 'index'))
         AND (reason IS NULL OR (kind, reason) IN (('full-rebuild', 'first-sync'), ('full-rebuild', 'route-change'), ('full-rebuild', 'reconciler'), ('full-rebuild', 'erasure'), ('full-rebuild', 'upgrade'), ('full-rebuild', 'drill'), ('index', 'bound'), ('index', 'restored'), ('index', 'rule-change'), ('index', 'wiped'), ('index', 'narrowed'))));