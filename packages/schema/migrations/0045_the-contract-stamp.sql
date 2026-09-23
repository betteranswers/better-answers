-- Custom migration (hand-written SQL; ADR 0032).
-- The key can only be true, so a deploy rewrites the row rather than adding to a history.
CREATE TABLE "contract_stamp" (
	"only_row" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"digest" text NOT NULL,
	"stamped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_stamp_only_row_check" CHECK (only_row)
);--> statement-breakpoint
-- SELECT and no more: a worker that could write this row could tell itself the api had moved.
GRANT SELECT ON "contract_stamp" TO worker_rt;
