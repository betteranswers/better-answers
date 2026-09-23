-- Custom migration (hand-written SQL; ADR 0032).

ALTER TABLE "audit_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "audit_event" FROM app_rt;--> statement-breakpoint
REVOKE ALL ON "audit_event" FROM worker_rt;
