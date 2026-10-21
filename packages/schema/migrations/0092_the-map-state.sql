-- Hand-written around drizzle-kit's statements: bounded wait for the lock the check's scan takes (ADR 0007).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "question_asked" ADD COLUMN "map_state" jsonb;--> statement-breakpoint
ALTER TABLE "question_asked" ADD CONSTRAINT "question_asked_map_state_check" CHECK (map_state IS NULL
         OR (completed_at IS NOT NULL
             AND (map_state = jsonb_build_object('state', 'live')
                  OR (map_state = jsonb_build_object(
                        'state', 'unavailable_since', 'since', map_state->'since')
                      AND jsonb_typeof(map_state->'since') = 'string'))));--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
