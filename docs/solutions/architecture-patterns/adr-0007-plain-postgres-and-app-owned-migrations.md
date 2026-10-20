---
title: "Plain Postgres, with the api owning every migration and all DDL"
date: 2026-09-24
module: packages/schema
problem_type: architecture_pattern
component: stores
severity: high
applies_when:
  - "Adding or changing a table, index, partition or constraint, in public, index or the map"
  - "Letting the worker or cocoindex create, drop or alter anything in the database"
  - "Changing how a workspace's passage partition is made at provisioning"
  - "Proposing Supabase, Neon or another database host"
  - "Writing a migration that renames, takes a lock writers wait on, or writes a tenant table's rows"
tags:
  - adr-0007
  - postgres
  - migrations
  - ddl
  - passage-partition
  - provisioning
  - managed-by-user
  - lock-timeout
  - check-constraint
---

# Plain Postgres, with the api owning every migration and all DDL

## The decision

The database is one plain, self-hosted Postgres 18 with pgvector. The api owns every migration and all DDL.

- The schema is Drizzle's, in `packages/schema`, with generated SQL migrations in `packages/schema/migrations`.
- The api's DDL covers `public`, `index` and the map: tables, workspace partitions, constraints and indexes. Every cocoindex target declares `managed_by="user"`, so the engine manages rows and never tables. A test lands passages for two connected sources, drops one connected source's engine state, and proves that `index.passage`, its indexes and every row remain.
- The map's keys are unique per workspace: `(workspace_id, gen, uid)` on the nodes and edges a bundle or a record derives, and `(workspace_id, uid)` on source entities.
- The worker's connection pool is sized to one sync.
- The worker never runs a migration. It treats the schema as read-only structure and follows an api change.
- The deploy order is `migrate`, then `api`, then `worker` (`deploy/platform.compose.yaml`).
- The graph engine and the database image are ADR 0032's.

A workspace's passage partition is attached, never created as a partition.

- Provisioning makes the partition as a table of its own, `LIKE "index".passage` with what a partition inherits, revoked, its GIN index built. It then runs `ALTER TABLE "index".passage ATTACH PARTITION`. It never runs `CREATE TABLE … PARTITION OF`.
- So provisioning never holds the shared `index.passage` in a mode that a read or a write waits on, and no writer needs a lock order.
- No `lock_timeout` bounds provisioning's ATTACH wait.

A migration that takes a lock writers wait on bounds its own wait.

- A plain `CREATE INDEX` on a busy table is such a migration, and so is a rename. It runs `SET LOCAL lock_timeout = '5s'` before the lock, and sets it back to `DEFAULT` before the next migration in the batch. `0059_the-actor-index.sql` is the first.
- A timeout stops the release's `migrate` step, and the release is re-run by hand.

A migration writes a tenant table's rows in each workspace's scope.

- It sets the scope per workspace with `set_config('app.workspace_id', …, true)` inside a `DO` block, and clears it after the loop. `0048_the-retired-run-reason.sql` is the first.
- To rewrite a stored value a CHECK lists, it drops the CHECK first and adds it back after the rewrite. `0066_the-model-choice.sql` is the first.

A migration that bounds a lock or writes a tenant table's rows cites `ADR 0007` for why in a few words, and restates none of it. `0074_the-concept-search.sql` is the first to cite it. The migrations before it restate their reason.

Decided and not yet in the tree:

- Vector retrieval over `index.passage` uses pgvector's iterative scan (S8).
- Each map table has an index on `gen`.
- Every document carries the `external_access` shape, a no-op `is_public = true` term of the read predicate (ADR 0013). It gets no column until a connector reads a source-system ACL.
- A nightly test rebuilds the map for a fixed fifty-workspace fixture and asserts that the estate rebuild finishes within 60 minutes, reported as headroom. The headroom is a signal at 75 % (ADR 0025).
- One workspace's map rebuilds in two minutes or less, and the erasure report states that promise. The restore drill times the rebuild against it but does not fail when it is late.

## Why

- The api owns every endpoint a caller reaches and every policy decision (ADR 0005). Eight of Supabase's ten services would idle, and Supabase would invite dependence on Supabase-only features. The predecessor's 274 role-keyed RLS policies on a Supabase helper are the cautionary case.
- Two tiers writing one schema with two migration tools is the failure the data-not-code contract must prevent. The schema is the contract, so it has one author.
- With one cocoindex environment per connected source, the engine's default `managed_by="system"` would let one connected source's deletion drop `index.passage` and its index under every other connected source.
- `PARTITION OF` holds `index.passage` in ACCESS EXCLUSIVE, then waits for SHARE ROW EXCLUSIVE on `source_document` to clone the parent's foreign key. A transaction holding a write on `source_document` that then touches `index.passage` closes a cycle, and Postgres aborts one side with 40P01. Meanwhile every workspace's reads of `index.passage` queue behind it.
- ATTACH holds `index.passage` in SHARE UPDATE EXCLUSIVE and ACCESS SHARE, and the parent's indexes in SHARE UPDATE EXCLUSIVE. Neither conflicts with a read's ACCESS SHARE or a write's ROW EXCLUSIVE. The one mode it contends for with a writer is SHARE ROW EXCLUSIVE on `source_document`, and while it waits for that it holds nothing a passage read or write waits on. Two provisions queue one behind the other and form no cycle. The modes were read from `pg_locks` on the pinned image, Postgres 18.6.
- A `lock_timeout` would turn the wait into a refused sign-up that nothing retries. The wait holds up other writes of documents, never a read of them or a passage's key check.
- A plain `CREATE INDEX` that waits for its lock queues every later write to the table behind it. A migration has someone to retry it, so a bounded wait costs a re-run release, not a refused person.
- A rename takes ACCESS EXCLUSIVE, which queues every read of the table behind it as well as every write. Five seconds bounds that wait.
- Drizzle runs every pending migration in one transaction, so a `SET LOCAL` in one would still bind the migrations after it. The reset ends the bound with its own migration.
- The CHECK lists the old values, so it refuses the new one until it is dropped.
- Row-level security is forced on every tenant table and a migration runs as the table's owner, so a bare `UPDATE` reaches no row.
- `ADD CONSTRAINT` validates every row standing, so the CHECK's return proves no old value survived the rewrite.
- Nothing depends on a vendor helper, so a hosted Postgres stays a connection-string change away.

## Rejected

- Supabase self-hosted through Coolify: most of its services would idle, and it invites Supabase-only features. It would matter only if identity had gone to Supabase Auth.
- Hosted Neon or Supabase in London: residency, cost and the worker's state volume stay on one private network when self-hosted.
- The worker owning its own tables with Alembic: two pipelines and two migration stamps, the shape the predecessor ended in.
- `CREATE TABLE … PARTITION OF` for a workspace's partition: it deadlocks with document writers and queues every passage read.
- One unpartitioned passage table with one shared HNSW index: a large workspace would degrade a small one's recall, and workspaces pin different embedding models and dimensions.

## History

The full record, with its seven amendments (tickets 38, 53, 39, 41, 73 and 74, then T-367): `docs/archive/adr/0007-plain-postgres-and-app-owned-migrations.md`.

Later decisions overturned these rules of the record:

- Isolation was enforced in the api's code on every query, with row-level security as a second lock, and the data layer threw on a missing scope. ADR 0032 makes row-level security the guarantee. A missing scope is an empty setting, which reads zero rows.
- The worker had one role per workspace. ADR 0032 keeps one worker role.
- The vector column was untyped. ADR 0032 fixes its dimension.
- `statement_timeout` was set on the map's role. ADR 0023's amendment of 10/09/2026 sets the walk's timeout per statement.

The engine-drop test, the map's unique keys, the worker's pool, and what is not yet built were missing from this doc until 20/10/2026 (BA-215).
