---
title: "Plain Postgres, with the api owning every migration and all DDL"
date: 2026-09-24
module: packages/schema
problem_type: architecture_pattern
component: stores
severity: high
applies_when:
  - "Adding or changing a table, index, partition or constraint, in public, index or the graph"
  - "Letting the worker or cocoindex create, drop or alter anything in the database"
  - "Changing how a workspace's chunk partition is made at provisioning"
  - "Proposing Supabase, Neon or another database host"
tags:
  - adr-0007
  - postgres
  - migrations
  - ddl
  - chunk-partition
  - provisioning
  - managed-by-user
---

# Plain Postgres, with the api owning every migration and all DDL

## The decision

The database is one plain, self-hosted Postgres 18 with pgvector. The api owns every migration and all DDL.

- The schema is Drizzle's, in `packages/schema`, with generated SQL migrations in `packages/schema/migrations`.
- The api's DDL covers `public`, `index` and the graph: tables, workspace partitions, constraints and indexes. Every cocoindex target declares `managed_by="user"`, so the engine manages rows and never tables.
- The worker never runs a migration. It treats the schema as read-only structure and follows an api change.
- The deploy order is `migrate`, then `api`, then `worker` (`deploy/platform.compose.yaml`).
- The graph engine and the database image are ADR 0032's.

A workspace's chunk partition is attached, never created as a partition.

- Provisioning makes the partition as a table of its own, `LIKE "index".chunk` with what a partition inherits, revoked, its GIN index built. It then runs `ALTER TABLE "index".chunk ATTACH PARTITION`. It never runs `CREATE TABLE … PARTITION OF`.
- So provisioning holds the shared `index.chunk` in no mode a read or a write waits on, and no writer needs a lock order.
- No `lock_timeout` bounds the wait.

## Why

- The api owns every surface a caller reaches and every policy decision (ADR 0005). Eight of Supabase's ten services would idle while inviting dependence on Supabase-only features. The predecessor's 274 role-keyed RLS policies on a Supabase helper are the cautionary case.
- Two tiers writing one schema with two migration tools is the failure the data-not-code contract must prevent. The schema is the contract, so it has one author.
- With one cocoindex environment per binding, the engine's default `managed_by="system"` would let one binding's deletion drop `index.chunk` and its index under every other binding.
- `PARTITION OF` holds `index.chunk` in ACCESS EXCLUSIVE, then waits for SHARE ROW EXCLUSIVE on `source_document` to clone the parent's foreign key. A transaction holding a write on `source_document` that then touches `index.chunk` closes a cycle, and Postgres aborts one side with 40P01. Meanwhile every workspace's reads of `index.chunk` queue behind it.
- ATTACH holds `index.chunk` in SHARE UPDATE EXCLUSIVE and ACCESS SHARE, and the parent's indexes in SHARE UPDATE EXCLUSIVE. Neither conflicts with a read's ACCESS SHARE or a write's ROW EXCLUSIVE. The one mode it contends for with a writer is SHARE ROW EXCLUSIVE on `source_document`, and while it waits for that it holds nothing a chunk read or write waits on. Two provisions queue one behind the other and form no cycle. The modes were read from `pg_locks` on the pinned image, Postgres 18.6.
- A `lock_timeout` would turn the wait into a refused sign-up that nothing retries. The wait holds up other writes of documents, never a read of them or a chunk's key check.
- Nothing depends on a vendor helper, so a hosted Postgres stays a connection-string change away.

## Rejected

- Supabase self-hosted through Coolify: most of its services would idle, and it invites Supabase-only features. It would matter only if identity had gone to Supabase Auth.
- Hosted Neon or Supabase in London: residency, cost and the worker's state volume stay on one private network when self-hosted.
- The worker owning its own tables with Alembic: two pipelines and two migration stamps, the shape the predecessor ended in.
- `CREATE TABLE … PARTITION OF` for a workspace's partition: it deadlocks with document writers and queues every chunk read.

## History

The full record, with its seven amendments (tickets 38, 53, 39, 41, 73 and 74, then T-367): `docs/archive/adr/0007-plain-postgres-and-app-owned-migrations.md`.
