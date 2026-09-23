-- Custom migration (hand-written SQL; ADR 0032).

ALTER TABLE "group" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "group_member" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "group" FROM worker_rt;--> statement-breakpoint
REVOKE ALL ON "group_member" FROM worker_rt;
