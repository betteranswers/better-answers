-- Custom migration (hand-written SQL; ADR 0032).
-- The two group tables' substrate (ADR 0038): each takes the FORCE line withRLS() cannot
-- emit, and the worker's role loses the DML migration 0000's default privileges granted it.

-- FORCE applies RLS to the table's owner too (ADR 0032); the coverage test fails on any
-- tenant table whose FORCE line is missing. Referential integrity is exempt from RLS by
-- Postgres's own rule, which is what lets a member's removal cascade its group rows out
-- of every scope — and is exactly why `group_member`'s key to `group` names the workspace
-- as well as the id, so a foreign-key check can never confirm another tenant's group.
ALTER TABLE "group" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "group_member" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The worker holds no people data (ADR 0038): who is in which group is a visibility fact
-- the app applies at read time, and the worker never applies it — it indexes and enriches
-- under a binding's own settings. A compromised worker therefore cannot read a workspace's
-- group membership, nor write itself into one. Proved beside the served path by
-- "refuses the worker role on both group tables" (packages/schema/test/rls.test.ts).
REVOKE ALL ON "group" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL ON "group_member" FROM worker_rt;
