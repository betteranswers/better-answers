---
status: accepted
date: 2026-08-25
---

# One plain Postgres + pgvector, self-hosted, with the app as the only migration owner

The platform's database is a single plain Postgres 18 with pgvector (17 when first written; corrected by the amendment below), run as a Coolify-managed container beside a MinIO object store, and the TypeScript app is the *only* tier that migrates its schema (Drizzle: schema in `packages/schema`, generated SQL migrations applied by the app); the Python worker reads and writes the same tables through reflected definitions and never runs migrations. We chose plain Postgres over Supabase — the predecessor's home, available self-hosted through Coolify — because under ADR 0005 the app owns the API and every policy decision, so eight of Supabase's ten services (PostgREST, Realtime, Edge Runtime, Envoy, Storage, Studio, postgres-meta, Supavisor) would idle while inviting dependence on Supabase-only features; the predecessor's 274 role-keyed RLS policies on a Supabase helper are the cautionary case. Isolation is enforced in app code on every query (the Dust workspace-aware contract), with Postgres RLS a second lock the app writes itself. One migration owner exists because two tiers writing one schema with two migration tools (Drizzle and Alembic) is the failure mode ADR 0005's data-not-code contract must prevent: the schema is the contract, so it has one author, and the worker treats it as read-only structure.

## Considered options

- **Supabase self-hosted via Coolify** — right only if the identity decision picks Supabase Auth; then it becomes a one-click template swap that changes nothing in the schema, which is why it remains the fallback rather than the plan.
- **Hosted Neon or Supabase (London)** — a connection-string change away, kept reachable by never depending on vendor helpers; not chosen now because residency, cost and the worker's state volume stay on one private network self-hosted.
- **Worker owns its own tables with Alembic** — the "two pipelines, two migration stamps" shape the predecessor ended in; rejected.

## Consequences

- Every table carries a workspace id and every document carries the `external_access` shape from the first migration.
- The worker's data layer is generated or reflected from the app's schema and checked in CI against it; a schema change is an app PR that the worker follows.
- Postgres and MinIO are backed up by Coolify's scheduler; nothing in the app assumes a Supabase or Neon feature.

## Amendment — 2026-08-25, architecture review pass 1 (ticket 38)

- **Postgres 18**, not 17 — 18.6 is current and `pgvector/pgvector:pg18-trixie` ships (checked via Context7 on the day). Versions are pinned from the source at build time, never from memory (`[DEPS1]`).
- **One migration owner per schema.** cocoindex creates and drops its own tables and indexes, so it owns a second schema, `index`; Drizzle owns `public` and never migrates `index`; the app reads `index` through generated read-only types, and a CI contract test asserts the Python and TypeScript views agree.
- **Chunks partition by workspace.** `index.chunk` is list-partitioned by workspace, with an untyped vector column and `embedding_route_id` on every row; the app runs one recorded per-workspace index step at onboarding — the only runtime DDL — and retrieval uses pgvector's iterative scan. Reason: workspaces pin different embedding models and dimensions, and one shared HNSW index lets a large tenant degrade a small one's recall.
- **Row-level security is a real design.** Non-owner runtime roles (`app_rt`, `worker_<workspace>`), `FORCE ROW LEVEL SECURITY`, the workspace bound with `SET LOCAL` inside a transaction; the app's data layer throws in every environment (the Dust contract it cites only logs in production); a functional test proves a missing scope returns zero rows, never another tenant's.
- **Deploy order and schema stamp.** `migrate` (one-shot) → `app` → `worker`; the worker's reflection carries the migration id it was generated from and refuses to claim jobs on mismatch.
- **Backups per store, recovery order stated.** Postgres dump, object-store mirror, `git bundle` plus a mirror push, and Coolify's own database all go to an off-host S3; the graph and pipeline state are rebuildable and not backed up; a scripted restore drill runs monthly into staging. Recovery order: Postgres → reconcile the bundle commit watermark → resync the graph from git and records → reconcile pipeline state → object-store orphans.

## Amendment — 2026-08-27, DDL ownership in `index` and the graph (ticket 53, research 55)

"cocoindex creates and drops its own tables and indexes, so it owns a second schema, `index`" no longer holds. With one cocoindex environment per binding, the engine's default `managed_by="system"` lets a binding deletion drop `index.chunk` and its HNSW index under every other binding (research 54 §3–4). So: **the app owns all DDL in `index` and in the graph** — tables, workspace partitions, constraints, vector indexes, labels — through its migrations and the recorded per-workspace onboarding step; every cocoindex target declares `managed_by="user"` and the engine manages rows and nodes only; a functional test with two environments proves a `drop` on one removes only its rows and leaves the table and its vector index. The graph stays "not backed up, rebuild time budgeted" because a graph-only binding keeps its normalised document (retention *transient*) and is rebuilt by reprocessing, never by re-fetching.

## Amendment — 2026-08-28, the graph's DDL and its rebuild budget (ticket 39, ADR 0021)

The DDL the app owns in the graph is listed: composite uniqueness constraints per label — `(workspace_id, gen, uid)` on the bundle-and-record partition, `(workspace_id, uid)` on source entities — and a range index on `gen` per label; the Neo4j memory, transaction and timeout keys are part of the deploy unit. "Rebuild time budgeted" is a **60-minute estate headroom** measured nightly on a fifty-workspace fixture, ≤ 2 minutes per workspace on the erasure report; the monthly drill rebuilds one workspace on the restore target and diffs counts per label. Everything else stands.

## Amendment — 2026-08-28, the backup tiers, two buckets, the replay and the drill (ticket 41, ADR 0022)

"Postgres and MinIO are backed up by Coolify's scheduler" is replaced. Postgres is a Coolify database resource whose **tiered dump — hourly 48 h · daily 30 d · weekly 8 w · monthly 6 m — is taken by the platform's own `backup` service**, client-side encrypted with `age`, to an off-host bucket under **governance-mode object lock** (Coolify's daily backup of the resource is the second writer, never the only one). The object store — Garage, not MinIO — is mirrored nightly with `rclone sync` to a second, versioned, **unlocked** bucket so erasure deletions propagate. The recovery order gains a step after the first: **replay every erasure completed after the dump** before `app` turns healthy. The monthly drill restores into staging on VPC 2 from host cron, records RTO and RPO, and wipes staging afterwards. Everything else stands.

## Amendment — 2026-08-28, the graph is inside Postgres (ticket 73, ADR 0023)

The image is our own `deploy/postgres.Dockerfile` — `apache/age:release_PG18_1.8.0` with pgvector 0.8.6 compiled in — pushed to `ghcr.io` and deployed by digest; still a Coolify database resource. The DDL the app owns in the graph is now Postgres DDL: `CREATE EXTENSION age`, one graph per workspace created at onboarding beside the chunk partition (the two runtime DDL steps), unique indexes on the label tables and the `gen` range index, `statement_timeout` on the graph role. The Neo4j memory, transaction and timeout keys are gone from the deploy unit. "The graph and pipeline state are rebuildable and not backed up" is halved: the graph rides every dump; pipeline state is still not. Everything else stands.

## Amendment — 2026-08-28, no Forgejo schema; `shared_buffers` on a 4 GB box (ticket 74, ADR 0024)

Forgejo's schema and role leave the database and every dump — the bundle's history is the bare repository's, bundled nightly. On the 4 GB production box `shared_buffers` is 512 MB and the worker's connection pool is sized to one run; the numbers are ticket 42's to revise on measurement. Everything else stands.
