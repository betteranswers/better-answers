-- Custom migration (hand-written SQL; ADR 0032).

ALTER TABLE "concept_identity" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concept_index" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bundle_commit" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concept_verification" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concept_index"
  ALTER CONSTRAINT "concept_index_bundle_commit_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
REVOKE ALL ON "concept_identity" FROM worker_rt;--> statement-breakpoint
REVOKE ALL ON "concept_index" FROM worker_rt;--> statement-breakpoint
REVOKE ALL ON "bundle_commit" FROM worker_rt;--> statement-breakpoint
REVOKE ALL ON "evidence" FROM worker_rt;--> statement-breakpoint
REVOKE ALL ON "concept_verification" FROM worker_rt;
