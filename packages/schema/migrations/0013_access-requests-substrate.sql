-- Custom migration (hand-written SQL; ADR 0032).
-- The access-request queue's substrate (ADR 0038): `access_request` takes the FORCE line
-- withRLS() cannot emit, and the worker's role loses the DML migration 0000's default
-- privileges granted it — a compromised worker can neither read who asked to join a
-- workspace nor forge a decision.

-- FORCE applies RLS to the table's owner too (ADR 0032); the coverage test fails on any
-- tenant table whose FORCE line is missing.
ALTER TABLE "access_request" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The worker never reads or writes the queue: deciding who joins a workspace is an Admin
-- act on the app's side of the tiers, and a request row carries a person's own words about
-- why they want in. Proved by "refuses the worker role on the access-request queue"
-- (packages/schema/test/rls.test.ts), beside the served path the app's role keeps.
REVOKE ALL ON "access_request" FROM worker_rt;
