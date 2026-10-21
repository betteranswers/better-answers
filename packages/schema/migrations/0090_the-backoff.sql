DROP INDEX "job_queued_subject_key";--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "backoff_ends_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "job_queued_subject_key" ON "job" USING btree ("workspace_id","kind","subject_id") WHERE status = 'queued' AND attempts = 0;