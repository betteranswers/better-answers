ALTER TABLE "question_feedback" DROP CONSTRAINT "question_feedback_flag_check";--> statement-breakpoint
ALTER TABLE "question_feedback" ADD CONSTRAINT "question_feedback_flag_check" CHECK ((verdict = 'flag') = (reason IS NOT NULL)
         AND (note IS NULL OR verdict = 'flag')
         AND (disputed_concept IS NULL OR verdict = 'flag')
         AND (disputed_sentence IS NULL OR disputed_concept IS NOT NULL));