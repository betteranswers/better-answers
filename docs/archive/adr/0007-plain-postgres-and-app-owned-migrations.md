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

- **Postgres 18**, not 17 — 18.6 is current and `pgvector/pgvector:pg18-trixie` ships (checked via Context7 on the day). Versions are pinned from the source at build time, never from memory.
- **One migration owner per schema.** cocoindex creates and drops its own tables and indexes, so it owns a second schema, `index`; Drizzle owns `public` and never migrates `index`; the app reads `index` through generated read-only types, and a CI contract test asserts the Python and TypeScript views agree.
- **Chunks partition by workspace.** *(The untyped column is superseded by ADR 0032: pgvector's HNSW refuses a dimensionless column, so the column is `vector(N)`; the partitioning, `embedding_route_id` and per-partition index stand.)* `index.chunk` is list-partitioned by workspace, with an untyped vector column and `embedding_route_id` on every row; the app runs one recorded per-workspace index step at onboarding — the only runtime DDL — and retrieval uses pgvector's iterative scan. Reason: workspaces pin different embedding models and dimensions, and one shared HNSW index lets a large tenant degrade a small one's recall.
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

*(Superseded by ADR 0032: no AGE, no custom image — the official pgvector image pinned by digest; the graph is plain tables; runtime DDL is one SECURITY DEFINER function and the owner DSN reaches `migrate` only.)*

The image is our own `deploy/postgres.Dockerfile` — `apache/age:release_PG18_1.8.0` with pgvector 0.8.6 compiled in — pushed to `ghcr.io` and deployed by digest; still a Coolify database resource. The DDL the app owns in the graph is now Postgres DDL: `CREATE EXTENSION age`, one graph per workspace created at onboarding beside the chunk partition (the two runtime DDL steps), unique indexes on the label tables and the `gen` range index, `statement_timeout` on the graph role. The Neo4j memory, transaction and timeout keys are gone from the deploy unit. "The graph and pipeline state are rebuildable and not backed up" is halved: the graph rides every dump; pipeline state is still not. Everything else stands.

## Amendment — 2026-08-28, no Forgejo schema; `shared_buffers` on a 4 GB box (ticket 74, ADR 0024)

Forgejo's schema and role leave the database and every dump — the bundle's history is the bare repository's, bundled nightly. On the 4 GB production box `shared_buffers` is 512 MB and the worker's connection pool is sized to one run; the numbers are ticket 42's to revise on measurement. Everything else stands.

## Amendment — 2026-09-24, a workspace's partition is attached, so provisioning needs no lock order (T-367)

The onboarding step makes the partition as a table of its own — `LIKE "index".chunk` with what a partition inherits and nothing more, revoked, its GIN index built — and then runs `ALTER TABLE "index".chunk ATTACH PARTITION`. It never runs `CREATE TABLE … PARTITION OF` (migration 0054). The modes are read from `pg_locks` during a provision on the pinned image, Postgres 18.6. `PARTITION OF` holds `index.chunk` in ACCESS EXCLUSIVE and then waits for SHARE ROW EXCLUSIVE on `source_document`, which cloning the parent's foreign key takes. Any transaction holding a write on `source_document` that then touches `index.chunk` closes a cycle with it, and Postgres aborts one side with 40P01. While it waits, every tenant's reads of `index.chunk` queue behind it. ATTACH holds `index.chunk` in SHARE UPDATE EXCLUSIVE and ACCESS SHARE, and the parent's three indexes in SHARE UPDATE EXCLUSIVE. Neither mode conflicts with the ACCESS SHARE a read takes or the ROW EXCLUSIVE a write takes. On `source_document` it still holds SHARE ROW EXCLUSIVE, beside ROW SHARE and ACCESS SHARE: every foreign key a partition gains takes that mode. The partition an attach makes has the same columns, constraints, indexes and triggers as one `PARTITION OF` makes, each inherited rather than local.

**No lock order binds a writer.** The one lock a provision contends for with a writer is SHARE ROW EXCLUSIVE on `source_document`. While it waits for that, it holds nothing on `index.chunk` or its indexes that a read or a write waits on. A transaction that writes documents and chunks can wait on a provision, whichever table it takes first, but never closes a cycle with it. Two provisions queue one behind the other on SHARE UPDATE EXCLUSIVE, which conflicts with itself, and form no cycle either.

**No bound is set on the wait.** A provision waiting for its locks holds up no read or write of `index.chunk`. Its SHARE ROW EXCLUSIVE on `source_document` does hold up other writes of documents, though not reads of them or a chunk's key check. The hold lasts while the provision waits for the writer ahead of it, then until the provisioning transaction commits. After the partition, that transaction writes at most the first membership and a config row. The writers of documents are the sources acts and the worker's catalogue. Each act is one short transaction; an upload streams its bytes before its transaction opens. The catalogue's transaction updates a binding's documents one by one, so it lasts longer the larger the binding. A `lock_timeout` would turn the wait into a refused sign-up that nothing retries.
