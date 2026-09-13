-- Custom migration (hand-written SQL; ADR 0032).
-- The finding's substrate (ADR 0020): the FORCE line withRLS() cannot emit, and the one
-- privilege the worker's tier holds on this table — INSERT, and nothing else.

-- FORCE applies RLS to the table's owner too (ADR 0032); the coverage test fails on any
-- tenant table whose FORCE line is missing.
ALTER TABLE "finding" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- **The tier boundary, made a grant.** The detector runs in the worker and the review of
-- what it found is an Admin's act (the S0 spec, *The tier boundary*): the worker records a
-- span it withheld and does nothing else here. Migration 0000's default privileges would
-- have handed it SELECT, INSERT, UPDATE and DELETE on this table as on every other new
-- `public` one, so the revoke is explicit and the grant that follows is the whole of what
-- the worker holds — which is why the revoke and not only the grant is the security claim.
--
-- A worker that could SELECT would hold a workspace's map of where its personal data sits,
-- category by category, without ever reading a document. One that could UPDATE could mark a
-- special-category span reviewed and let a binding widen over it. One that could DELETE
-- could remove the record of a span it had withheld. None of the three is a road the worker
-- needs, and INSERT alone is why a compromised one cannot take any of them.
--
-- INSERT without SELECT also means the worker's statement carries no RETURNING: it writes
-- what it found and reads nothing back. Proved beside the served path by "lets the worker
-- record a finding and refuses it every road back to one" in packages/schema/test/rls.test.ts.
REVOKE ALL ON "finding" FROM worker_rt;
--> statement-breakpoint
GRANT INSERT ON "finding" TO worker_rt;
