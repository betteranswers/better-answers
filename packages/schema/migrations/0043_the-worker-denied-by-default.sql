-- Custom migration (hand-written SQL; ADR 0032).
-- The worker's role is deny-by-default in `public` and in `index`, and what it keeps is
-- written out by name (ADR 0032, amended 2026-09-21).
--
-- Hand-written rather than generated because a default privilege is not a column:
-- `drizzle-kit generate` writes the DDL its schema file reaches and nothing about who may
-- reach a table afterwards, so every cross-tier privilege in this package is written here
-- beside the sentence that explains it — as migrations 0020, 0024, 0030, 0032, 0037, 0038,
-- 0041 and 0042 each are.
--
-- **The flip.** Migration 0000 grants `app_rt` and `worker_rt` SELECT, INSERT, UPDATE and
-- DELETE on every table any later migration creates in either schema, so every privilege
-- statement since has been a subtraction — 28 REVOKEs against `worker_rt` by this date,
-- covering 45 table names. A table whose migration forgets its REVOKE is a table the worker
-- can write, and nothing says so. From here a migration that wants the worker to reach a
-- table says so in a GRANT, and a migration that forgets grants nothing. `app_rt` keeps its
-- two defaults, because the app owns the schema (ADR 0007) — an asymmetry that used to be
-- invisible and is now a block of the generated surface with one role in it.
--
-- Default privileges live in `pg_default_acl` alone, so every existing relation's ACL is
-- byte-identical across the two ALTER statements below; what changes is what the next table
-- created in either schema hands the worker, which is nothing. The 28 REVOKEs become no-ops.
-- They stay — the journal is append-only — but they stop being what makes the surface true:
-- after this the GRANT lines are the whole statement of the worker's reach, which is what
-- lets that reach be generated from `pg_catalog` rather than declared a second time.
--
-- **The four tables the worker held by the default alone, and the fifth privilege.** Nothing
-- granted them and nothing revoked them, so the catalogue could not tell a hold that was
-- meant from one nobody noticed. Two are kept and written out by name: `job`, which the
-- loop claims and finishes through SECURITY INVOKER functions, so the UPDATE is the worker's
-- own (DELETE was revoked by 0022 and is not granted back); and `workspace`, which the queue
-- reads to walk the tenants. So is SELECT on the `"index".chunk` parent, which the worker's
-- three writes are made of — `ON CONFLICT` and every `WHERE` need SELECT on the columns they
-- read — and which has stood on migration 0000's default since 0037 named the other three.
-- Writing it here discharges the duty ADR 0032's amendment of 2026-09-19 left on the next
-- migration to touch this table's privileges.
--
-- Two are taken away: `llm_route`, on which the worker could DELETE, and `workspace_config`.
-- Neither has a reader in `apps/worker/src` — routes are resolved as `app_rt` through
-- `llm_route_for`, and the tier's own configuration is read from its environment — so this
-- is the migration's one behaviour change, taken knowingly rather than granted back to keep
-- a picture of an accident.
--
-- **The five functions PUBLIC could execute.** A null `proacl` is not "nobody": it is the
-- default, which for a function is EXECUTE to PUBLIC. So a sweep of this journal's GRANT
-- lines never found `current_workspace_id`, `llm_route_for`, `suggestion_decides_once`,
-- `graph_generation_flip_guard` or `graph_row_generation_guard`, and `llm_route_for` — which
-- is SECURITY INVOKER and reads `llm_route` under the caller's own privileges — was callable
-- by anyone who could connect. They come under this journal's own pattern, REVOKE from
-- PUBLIC then GRANT to the roles that call it, as 0022 does for the queue's four.
-- `current_workspace_id` goes to both runtime roles, because every tenant policy calls it
-- and a policy is evaluated with the querying role's privileges. `llm_route_for` goes to
-- `app_rt`, the role both of its callers run as. The three trigger functions go to nobody:
-- EXECUTE on a trigger's function is checked when the trigger is created, not when it fires.
--
-- The surface these statements leave is read back into `packages/schema/roles-surface.json`
-- and drift-checked there; the flip, the two revocations, the grants and the fired triggers
-- are proved in `packages/schema/test/roles-surface.test.ts`, and the worker's read of the
-- workspace table and its refusal on the config in `packages/schema/test/rls.test.ts`.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM worker_rt;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "index" REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM worker_rt;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "job" TO worker_rt;
--> statement-breakpoint
GRANT SELECT ON "workspace" TO worker_rt;
--> statement-breakpoint
GRANT SELECT ON "index".chunk TO worker_rt;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "llm_route" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "workspace_config" FROM worker_rt;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.current_workspace_id() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_workspace_id() TO app_rt, worker_rt;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.llm_route_for(llm_purpose) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.llm_route_for(llm_purpose) TO app_rt;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.suggestion_decides_once() FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.graph_generation_flip_guard() FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.graph_row_generation_guard() FROM PUBLIC;
