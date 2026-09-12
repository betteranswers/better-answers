-- Custom migration (hand-written SQL; ADR 0032).
-- The erasure request's substrate (ADR 0020): the FORCE line withRLS() cannot emit, and the
-- revoke that leaves the worker's tier holding nothing at all on this table.

-- FORCE applies RLS to the table's owner too (ADR 0032); the coverage test fails on any
-- tenant table whose FORCE line is missing.
ALTER TABLE "erasure_request" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- **The routine's own record, and the app tier's alone.** Migration 0000's default
-- privileges would have handed `worker_rt` SELECT, INSERT, UPDATE and DELETE here as on
-- every other new `public` table, so the revoke is explicit and nothing is granted back: the
-- routine runs under the platform principal in the app tier, holding `pg_advisory_lock(41)`
-- from first step to last, and the worker takes no part in it.
--
-- The pseudonym is what this workspace's `human:<email>` became across its files, its
-- history and its author lines. A worker that could SELECT would hold the one value that
-- joins a rewritten history back to the request that caused it — the join ADR 0035 rejected
-- a shared person id to prevent. One that could INSERT could claim an erasure that never
-- ran; one that could UPDATE could stamp a completion on a routine that had touched no
-- store; one that could DELETE could make an erasure un-replayable, and the replay before
-- `api` turns healthy is the clause that makes "beyond use" honest (ADR 0022). Proved by
-- "refuses the worker every road to an erasure request" in packages/schema/test/rls.test.ts.
REVOKE ALL ON "erasure_request" FROM worker_rt;
