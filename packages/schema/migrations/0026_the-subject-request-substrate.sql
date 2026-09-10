-- Custom migration (hand-written SQL; ADR 0032).
-- The subject request's substrate (ADR 0020): the FORCE line withRLS() cannot emit, and the
-- revoke that leaves the worker's tier holding nothing at all on this table.

-- FORCE applies RLS to the table's owner too (ADR 0032); the coverage test fails on any
-- tenant table whose FORCE line is missing.
ALTER TABLE "subject_request" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- **An Admin-only record, and the revoke is the whole claim.** Migration 0000's default
-- privileges would have handed `worker_rt` SELECT, INSERT, UPDATE and DELETE on this table
-- as on every other new `public` one, so a substrate that granted nothing but forgot to
-- revoke would be a silent grant of all four. Nothing is granted back: unlike `finding`,
-- which the worker writes because the detector runs there, a subject request is recorded,
-- clocked and answered entirely in the app tier.
--
-- The identifier set is restricted personal data — the names, addresses and references a
-- subject gave, in a workspace's own words. A worker that could SELECT would hold the
-- platform's list of who has asked to be erased and what they are called, without ever
-- reading a document. One that could INSERT could start a clock nobody set; one that could
-- UPDATE could stamp an answer on a request nobody answered; one that could DELETE could
-- take away the record of a deadline. Proved by "refuses the worker every road to a subject
-- request" in packages/schema/test/rls.test.ts, one refusal per road.
REVOKE ALL ON "subject_request" FROM worker_rt;
