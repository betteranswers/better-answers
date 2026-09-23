-- Custom migration (hand-written SQL; ADR 0032).

ALTER TABLE "access_request" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "access_request" FROM worker_rt;
