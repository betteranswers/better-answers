-- Custom migration (hand-written SQL; ADR 0032).
-- The concept write path's substrate (ADR 0012): the five tables take the FORCE line
-- withRLS() cannot emit, and the worker's role loses the DML migration 0000's default
-- privileges granted it.

-- FORCE applies RLS to the table's owner too (ADR 0032); the coverage test fails on any
-- tenant table whose FORCE line is missing.
ALTER TABLE "concept_identity" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "concept_index" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bundle_commit" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidence" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "concept_verification" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The worker writes none of these and reads none of them yet. The bundle is written only
-- by the app, one commit per act (ADR 0012), so a worker that could write here would be a
-- second writer of the map with no commit behind it; and the derive-and-sync that will
-- read the index to cross-check its own parse is not built (T-057), so the SELECT it needs
-- lands in the same migration as the job that reads it rather than standing here unused.
-- Proved by "refuses the worker role on the concept write path's tables"
-- (packages/schema/test/rls.test.ts), beside the served path the app's role keeps.
REVOKE ALL ON "concept_identity" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL ON "concept_index" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL ON "bundle_commit" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL ON "evidence" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL ON "concept_verification" FROM worker_rt;
