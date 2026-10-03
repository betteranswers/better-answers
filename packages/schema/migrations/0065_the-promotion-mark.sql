-- Altering user waits behind any open transaction on it; five seconds bounds that wait, and a failed release is re-run by hand.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "promoted_at" timestamp with time zone;--> statement-breakpoint
-- Every pending migration runs in one transaction, so the bound ends with this one.
SET LOCAL lock_timeout = DEFAULT;
