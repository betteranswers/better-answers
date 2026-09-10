-- Custom migration (hand-written SQL; ADR 0032).
-- The suppression's substrate (ADR 0020): the FORCE line withRLS() cannot emit, and the
-- revoke that leaves the worker's tier holding nothing at all on this table.

-- FORCE applies RLS to the table's owner too (ADR 0032); the coverage test fails on any
-- tenant table whose FORCE line is missing.
ALTER TABLE "suppression" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- **Restricted personal data, Admin-only read, and no road for the worker.** Migration
-- 0000's default privileges would have handed `worker_rt` SELECT, INSERT, UPDATE and DELETE
-- here as on every other new `public` table, so the revoke is explicit and nothing is
-- granted back. A suppression is a list of what an erased person is called; a worker that
-- could SELECT would hold that list for every erasure a workspace has run, which is the same
-- data the subject request's identifier set holds and refused for the same reason.
--
-- The reprocess is the reason the table exists, and it still needs no grant: S1's worker is
-- handed what to keep out on the job it claims, by the app that read this table (ADR 0005's
-- control plane of rows). One that could INSERT could suppress a document nobody asked
-- about; one that could UPDATE could empty a set, which is an erasure quietly undone at the
-- next conversion; one that could DELETE could put a person's data back into every derived
-- store the next time the document is converted. Proved by "refuses the worker every road to
-- a suppression" in packages/schema/test/rls.test.ts, one refusal per road.
REVOKE ALL ON "suppression" FROM worker_rt;
