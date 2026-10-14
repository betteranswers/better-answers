-- Hand-written around drizzle-kit's statements: bounded wait for the locks the indexes and the check's scan take (ADR 0007).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "question_feedback" ADD COLUMN "closed_as" text;--> statement-breakpoint
ALTER TABLE "question_feedback" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "question_asked_workspace_id_asked_at_id_idx" ON "question_asked" USING btree ("workspace_id","asked_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "question_feedback_open_flag_idx" ON "question_feedback" USING btree ("workspace_id","record_id") WHERE verdict = 'flag' AND closed_at IS NULL;--> statement-breakpoint
ALTER TABLE "question_feedback" ADD CONSTRAINT "question_feedback_closed_check" CHECK ((closed_as IS NULL) = (closed_at IS NULL)
         AND (closed_as IS NULL OR closed_as IN ('fixed-in-the-knowledge', 'no-fault-in-the-knowledge'))
         AND (closed_as IS NULL OR verdict = 'flag'));--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
