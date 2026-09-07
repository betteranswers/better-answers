-- Custom migration (hand-written SQL; ADR 0032).
-- The concept write path's substrate: the five tables take the FORCE line withRLS() cannot
-- emit, the index row's key to its commit is deferred to the end of the act's transaction,
-- and the worker's role loses the DML migration 0000's default privileges granted it.

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
-- The index row names the commit it was written at, and the two are written in one
-- transaction. Deferring the check to COMMIT means the act may write them in whichever order
-- reads best without the constraint deciding it, and the pair is still whole when the
-- transaction ends. drizzle-kit has no API for this, so the constraint is created above and
-- altered here.
ALTER TABLE "concept_index"
  ALTER CONSTRAINT "concept_index_bundle_commit_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- The worker writes none of these and reads none of them yet. The bundle is written only
-- by the app, one commit per act (ADR 0012), so a worker that could write here would be a
-- second writer of the map with no commit behind it; and the job that will read the index to
-- cross-check the Python parser against the app's is not built (T-057), so the SELECT it
-- needs lands in the same migration as the job that reads it rather than standing here
-- unused.
-- Proved by "refuses the worker role on all five tables, reading and writing alike
-- (migration 0015)" in packages/schema/test/rls.test.ts, beside the served path the app's
-- role keeps.
REVOKE ALL ON "concept_identity" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL ON "concept_index" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL ON "bundle_commit" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL ON "evidence" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL ON "concept_verification" FROM worker_rt;
