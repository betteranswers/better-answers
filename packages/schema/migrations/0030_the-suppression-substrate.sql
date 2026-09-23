-- Custom migration (hand-written SQL; ADR 0032).

ALTER TABLE "suppression" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "suppression" FROM worker_rt;
