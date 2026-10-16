---
title: "Changing a generated column: drizzle-kit drops its index, so the migration is a hand-written SET EXPRESSION"
date: 2026-10-14
category: best-practices
module: packages/schema
problem_type: best_practice
component: stores
severity: high
applies_when:
  - "A change edits the expression of a generatedAlwaysAs column in packages/schema/src/ and needs a migration"
  - "The generated column carries an index, such as a GIN index on a stored tsvector"
symptoms:
  - "pnpm --filter @better-answers/schema run generate writes ALTER TABLE ... drop column followed by ADD COLUMN ... GENERATED ALWAYS AS"
  - "The generated SQL has no CREATE INDEX, though the table definition still declares the column's index"
root_cause: missing_tooling
resolution_type: migration
retire_when: "drizzle-kit emits ALTER COLUMN ... SET EXPRESSION, or re-creates the column's indexes, for a changed generated expression. Check by changing an expression in a scratch branch and reading the SQL generate writes"
tags: [drizzle-kit, migration, generated-column, set-expression, gin-index, tsvector, custom-migration, concept-index]
---

# Changing a generated column: drizzle-kit drops its index, so the migration is a hand-written SET EXPRESSION

## Context

BA-168 added the frontmatter `description` to `concept_index.search`, the stored `tsvector` that full-text search reads. The column is a `generatedAlwaysAs` expression (`CONCEPT_SEARCH` in `packages/schema/src/concept-tables.ts`), and the table declares `index("concept_index_search_gin").using("gin", table.search)` on it.

drizzle-kit 0.31.11, asked to generate the migration, wrote two statements:

```sql
ALTER TABLE "concept_index" drop column "search";
ALTER TABLE "concept_index" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (...) STORED NOT NULL;
```

Dropping the column drops `concept_index_search_gin` with it. The index's entry in the snapshot did not change, so the diff has no index to create, and the generated SQL never re-creates it. The migration would have applied cleanly and every test that only reads matches would still pass. Search would then run without its GIN index until someone read a query plan.

## Guidance

Run `generate` as usual, so the snapshot and the journal are drizzle-kit's own. Then replace the SQL it wrote with a hand-written custom migration that changes the expression in place:

```sql
-- Custom migration (hand-written SQL; ADR 0032).
-- drizzle-kit drops and re-adds a generated column, which drops its GIN index with it. SET EXPRESSION
-- rewrites the table and rebuilds the index in place.
-- Bounded wait for the lock the expression's table rewrite takes (ADR 0007).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "concept_index" ALTER COLUMN "search" SET EXPRESSION AS (...);--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
```

- `ALTER COLUMN ... SET EXPRESSION` needs Postgres 17 or later. It rewrites every row and rebuilds the column's indexes, so the index survives without being named.
- The first line must be the custom marker exactly: `packages/schema/test/migration-ownership.test.ts` refuses a first line that claims a custom migration in any other spelling, though it cannot see a hand-written file that makes no claim.
- Copy the expression from the generated `ADD COLUMN`, so it matches the snapshot byte for byte.
- Prove the index, not just the matches. `packages/schema/test/full-text-match.test.ts` (*is valid, ready and over the column*) reads `pg_index` for `concept_index_search_gin` after every migration has run.

## Why This Matters

A dropped index fails silently. Nothing errors, results stay correct, and only a plan or a latency budget shows it. The rewrite also holds `ACCESS EXCLUSIVE` on the table either way, so `SET EXPRESSION` costs nothing over the drop-and-add, and it keeps the index without a second statement.

## When to Apply

Any migration that changes a stored generated column's expression, on any table, whether or not you know of an index on it. Read the SQL `generate` writes before committing it: a `drop column` on a column you only edited is the sign.

## Examples

`packages/schema/migrations/0080_the-concept-description.sql` is the first use (BA-168, PR #736). Migration 0074 created the column and its index in one hand-written file, so the trap first showed when the expression changed.

Related: `docs/solutions/best-practices/renaming-a-table-drizzle-kit-will-not-generate-so-the-migration-and-snapshot-are-written-by-hand.md`, the other case where drizzle-kit's diff cannot be trusted and the SQL is written by hand.
