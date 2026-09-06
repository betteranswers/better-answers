-- Custom migration (hand-written SQL; ADR 0032).
-- The ledger's substrate (ADR 0014 rule 4; ADR 0038): `audit_event` takes the FORCE line
-- withRLS() cannot emit, and append-only becomes the database's guarantee rather than a
-- convention in code — the app's role may read and insert and nothing else, the worker's
-- role may do nothing at all.

-- FORCE applies RLS to the table's owner too (ADR 0032); the coverage test fails on any
-- tenant table whose FORCE line is missing.
ALTER TABLE "audit_event" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Migration 0000's default privileges granted app_rt UPDATE and DELETE on every new public
-- table. On the ledger both are revoked: a row, once written, is never edited and never
-- removed, and an erasure rewrites files and never the ledger (ADR 0035) — which is why no
-- row may carry an email or a name in the first place. The refusal is proved beside the
-- served path by "the ledger under app_rt" (packages/schema/test/rls.test.ts).
REVOKE UPDATE, DELETE ON "audit_event" FROM app_rt;
--> statement-breakpoint
-- The worker never writes the ledger and never reads it: its own runs are their own
-- records (ADR 0025), and nothing it does is an Admin act. Proved by "refuses the worker
-- role on the ledger" in the same suite.
REVOKE ALL ON "audit_event" FROM worker_rt;
