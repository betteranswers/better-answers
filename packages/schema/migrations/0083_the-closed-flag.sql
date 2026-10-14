-- Hand-written around drizzle-kit's statements: bounded wait for the lock the check's scan takes (ADR 0007).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "question_feedback" ADD COLUMN "closed_as" text;--> statement-breakpoint
ALTER TABLE "question_feedback" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "question_feedback" ADD CONSTRAINT "question_feedback_closed_check" CHECK ((closed_as IS NULL) = (closed_at IS NULL)
         AND (closed_as IS NULL OR closed_as IN ('fixed-in-the-knowledge', 'no-fault-in-the-knowledge'))
         AND (closed_as IS NULL OR verdict = 'flag'));--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
