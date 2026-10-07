---
title: "Renaming a table: drizzle-kit will not generate it, so the migration and its snapshot are written by hand"
date: 2026-10-05
last_updated: 2026-10-07
category: best-practices
module: packages/schema
problem_type: best_practice
component: stores
severity: medium
applies_when:
  - "A BA-29 sweep (U10, U11, U12, U15, U17) renames a table, column, constraint, function or stored value"
  - "Any change renames a table or column in packages/schema/src/ and needs a migration"
  - "A migration rewrites a stored value that a CHECK constraint lists, on a table that forces row-level security"
  - "A migration loops over objects or rows that exist only once a workspace does, such as its partitions"
symptoms:
  - "pnpm --filter @better-answers/schema run generate fails with: Interactive prompts require a TTY terminal (process.stdin.isTTY or process.stdout.isTTY is false)"
  - "generate --custom writes an empty SQL file and a snapshot that still carries the old table name"
root_cause: missing_tooling
resolution_type: migration
retire_when: "drizzle-kit can resolve a rename without a terminal. Check with: pnpm --filter @better-answers/schema exec drizzle-kit generate --help, looking for a flag that answers the rename prompt"
tags: [drizzle-kit, migration, snapshot, rename, custom-migration, rls, contract-stamp, glossary-sweep, partition, replay-test]
---

# Renaming a table: drizzle-kit will not generate it, so the migration and its snapshot are written by hand

## Context

Migration 0066 (BA-29 U9) was the first table rename the glossary plan made (its KTD10): `llm_route` became `model_choice`. The plan asked to prove first that drizzle-kit's generate step runs without a prompt once the table is renamed in `packages/schema/src/`. It does not. drizzle-kit 0.31.11 sees a dropped table and a new one, and asks whether the second is a rename. With no terminal, as for an agent or CI, it fails:

```
Error: Interactive prompts require a TTY terminal (process.stdin.isTTY or process.stdout.isTTY is false).
    at promptNamedWithSchemasConflict (drizzle-kit/bin.cjs)
    at tablesResolver (drizzle-kit/bin.cjs)
```

`generate --custom --name=<tag>` does not diff. It writes an empty SQL file and a snapshot that copies the previous one, old names included, with drizzle's own key order. A second plain `generate` then sees the schema source and the snapshot disagree, and prompts again.

## Guidance

1. Rename in `packages/schema/src/` first: the table name, its index and check names, and the symbol. The rename runner (`pnpm --filter @better-answers/devtools rename --map <map>`) does this from the committed map.
2. Run `pnpm --filter @better-answers/schema run generate --custom --name=<tag>`. It adds the journal entry, an empty `NNNN_<tag>.sql` and `meta/NNNN_snapshot.json`.
3. Write the SQL by hand. Its first line is exactly `-- Custom migration (hand-written SQL; ADR 0032).` (`packages/schema/test/migration-ownership.test.ts:22` checks that marker wherever a migration claims to be hand-written). In it:
   - bound the locks with `SET LOCAL lock_timeout = '5s'` and reset it to `DEFAULT` at the end, as migration 0059 does;
   - list every name to rename from a migrated database's catalogue, never from the snapshot: `pg_constraint`, `pg_indexes`, `pg_policies` and `pg_trigger` for the table. A table ADR 0032 keeps out of drizzle's schema has no snapshot entry at all (the map tables, `index.passage`), and the snapshot never records NOT NULL constraints or triggers. U10 printed them from a throwaway test over `startMigratedPostgres()` and deleted it after;
   - rename the table, then every name Postgres derived from it, including the ones drizzle never declared: `<table>_pkey`, the foreign key, checks, indexes, and the policy (`ALTER POLICY … RENAME TO`);
   - rename the NOT NULL constraints too. PostgreSQL 18 stores each one as a named constraint, `<table>_<column>_not_null`, and a table rename leaves those names behind. 0066 missed them, and 0067 renamed the five `llm_route_*_not_null` constraints it left on `model_choice`. List them with `select conname from pg_constraint where conrelid = '<table>'::regclass and contype = 'n'`, and rename each with `ALTER TABLE … RENAME CONSTRAINT`. drizzle's snapshot does not record them, so the snapshot needs no edit for them;
   - rename each trigger with `ALTER TRIGGER … ON <table> RENAME TO`. A trigger's name is written by hand, so a table rename leaves it behind; 0067 renamed three;
   - rename a function with `ALTER FUNCTION … RENAME TO`, which keeps its grants, then `CREATE OR REPLACE` it, because its body still names the old table. A function created afresh is executable by PUBLIC;
   - for a stored value a CHECK lists, drop the CHECK, update inside each workspace's scope, then add the CHECK back. Migration 0048 has the same shape, with a delete where 0066 updates. `job` forces row-level security, so a bare `UPDATE` by the migration owner reaches no row. Re-adding the CHECK validates every row, which is the proof the rewrite was complete.
4. Edit the new snapshot in place. In the table's entry, change the key `public.<old>` and every name derived from it: `name`, the index, the foreign key's name and `tableFrom`, the policy's name and its `using` and `withCheck` expressions, and the check. Also change any stored value inside another table's CHECK (U9 changed `job_reason_check`). A table outside drizzle's schema has no entry, so for 0067 the two CHECK values were the whole edit. Keep the key order drizzle wrote, and leave the file with no trailing newline, as drizzle writes none.
5. Run `generate` again. It must print `No schema changes, nothing to migrate`. That is the plan's proof that the snapshot is in step, and it replaces the TTY prompt you could not answer.
6. Regenerate everything derived from the migrated database, and check that each changes only in names:
   - `pnpm --filter @better-answers/schema run generate:roles-surface`
   - `pnpm --filter @better-answers/schema run generate:worker-view`
   - `pnpm --filter @better-answers/schema run generate:contract-stamp`, when `contracts/` changed
   - the worker's own stamp: `uv run --directory apps/worker --frozen generate-contract-stamp`. The two `CONTRACT_DIGEST` values must match, or the worker claims nothing after the release.

Test the value rewrite the way `packages/schema/test/job-kinds.test.ts` ("the migration that named the model choice") does. Seed old-value rows under the previous migration's CHECK, in two workspaces, then replay only the new migration's statements on `job` as a non-superuser owner. The test database already ran the whole migration, so replaying its renames would fail on a table that no longer has the old name. To see the test fail, swap the `UPDATE`'s new value for `reason = reason` and run it. A CHECK declared inside a `CREATE TABLE` has no statement of its own to replay: read its old text from the previous migration's snapshot, as "the migration that named the map" does for `source_binding_destination_check`. A test that reads an older migration's text, such as `migration-ownership.test.ts` on the audience substrate, must keep the old table names, and the rename runner rewrites them unless the map gives them a sense.

A loop over objects that exist only once a workspace does never runs in CI. Migration 0069 renames each workspace's partition of `index.chunk` by walking `pg_inherits`. `create_workspace_partition` makes a partition only when a workspace is created, so the freshly migrated test database has none, and the loop ran zero times in every suite. Production had three. Test it the way `packages/schema/test/passage-columns.test.ts` ("migration 0069 over a partition made before it") does. Inside a rolled-back transaction, put back the names and the partition function from before the migration (`packages/schema/test/before-the-passage.ts`), create a workspace and its partition the old way, and replay the migration's statements. Then assert that no old word is left among the schema's constraints, relations and policies, and that the partition's own names are the new ones.

## Why This Matters

A snapshot left with the old name passes every test, because the migrations alone build the test database. Then the next sweep's `generate` diffs against the stale snapshot and proposes a drop and a create, which loses the table's rows if anyone accepts it. A function rebuilt with `DROP` and `CREATE` instead of a rename loses its `app_rt` grant and becomes callable by PUBLIC. A value rewrite without per-workspace scope reports success and changes nothing, and the CHECK added afterwards then refuses to validate on production.

## When to Apply

Every BA-29 sweep that renames stored names: U10 (the map tables, done in 0067), U11, U12 (`index.chunk`, its partitions, `create_workspace_partition`, `embedding_route_id`, done in 0069), U15 (`submit_suggestion_set`, `suggestion_repair_proposer_check`) and U17. Also any later change that renames a column: drizzle-kit resolves a column that disappears beside a new one through the same kind of prompt (`promptColumnsConflicts`).

## Examples

Migration 0066, `packages/schema/migrations/0066_the-model-choice.sql`:

```sql
-- Custom migration (hand-written SQL; ADR 0032).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "llm_route" RENAME TO "model_choice";--> statement-breakpoint
ALTER TABLE "model_choice" RENAME CONSTRAINT "llm_route_pkey" TO "model_choice_pkey";--> statement-breakpoint
ALTER POLICY "llm_route_workspace_isolation" ON "model_choice" RENAME TO "model_choice_workspace_isolation";--> statement-breakpoint
ALTER FUNCTION public.llm_route_for(llm_purpose) RENAME TO model_choice_for;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.model_choice_for(p_purpose llm_purpose) RETURNS SETOF public.model_choice …
ALTER TABLE "job" DROP CONSTRAINT "job_reason_check";--> statement-breakpoint
DO $$ … PERFORM set_config('app.workspace_id', scope, true); UPDATE public.job SET reason = 'model-choice-change' … $$;
ALTER TABLE "job" ADD CONSTRAINT "job_reason_check" CHECK (…);--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
```

Its snapshot `packages/schema/migrations/meta/0066_snapshot.json` differs from 0065's only in drizzle's key order and in those names. The RUNBOOK page 6 bullet for 0066 records that no digest rollback crosses it, in the style of 0053.

## Related

- `docs/solutions/architecture-patterns/adr-0032-graph-is-plain-postgres-tables.md`: hand-written SQL in the journal, and the generated, drift-checked `roles-surface.json` and worker schema view.
- `docs/solutions/architecture-patterns/adr-0007-plain-postgres-and-app-owned-migrations.md`: the api owns every migration.
- `docs/solutions/best-practices/what-a-rename-sweeps-runner-and-prose-pass-get-wrong-and-the-checks-that-catch-it.md` and `docs/solutions/best-practices/how-a-rename-sweep-lands-a-word-in-the-words-test.md`: the code and words side of the same sweeps.
