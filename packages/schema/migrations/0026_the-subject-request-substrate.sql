-- Custom migration (hand-written SQL; ADR 0032).

ALTER TABLE "subject_request" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "subject_request" FROM worker_rt;
