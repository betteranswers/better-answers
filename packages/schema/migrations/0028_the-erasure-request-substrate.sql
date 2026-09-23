-- Custom migration (hand-written SQL; ADR 0032).

ALTER TABLE "erasure_request" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "erasure_request" FROM worker_rt;
