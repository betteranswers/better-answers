-- Custom migration (hand-written SQL; ADR 0032).

ALTER TABLE "finding" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "finding" FROM worker_rt;--> statement-breakpoint
GRANT INSERT ON "finding" TO worker_rt;
