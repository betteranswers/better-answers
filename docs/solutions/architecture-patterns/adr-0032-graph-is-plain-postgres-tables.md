---
title: "The map is plain Postgres tables, and row-level security is the tenancy guarantee"
date: 2026-09-23
module: packages/schema
problem_type: architecture_pattern
component: map
severity: high
applies_when:
  - "Adding a tenant table, a grant, a policy or a definer function"
  - "Writing a map traversal, or proposing a graph engine or database"
  - "Writing a migration, or changing what worker_rt may reach"
  - "Changing how find matches full text on index.passage"
tags:
  - adr-0032
  - map
  - rls
  - tenancy
  - migrations
  - worker-rt
  - definer-function
---

# The map is plain Postgres tables, and row-level security is the tenancy guarantee

## The decision

The map is two ordinary tenant tables in the platform Postgres, `map_node` and `map_edge`. They carry `workspace_id` and the three visibility terms as columns, under the same row-level security as every tenant table. Traversal is a prepared recursive-CTE template in the one map query module per tier, with depth capped at 4 by the template. There is no Apache AGE, no per-workspace role and no custom database image. There is no `neo4j` ecosystem either: no driver, no Bolt, no APOC and no `neo4j_graphrag` import, with no exception.

The tenancy rule lives here:

- Every tenant table carries the workspace id and is created `withRLS()`, under `FORCE ROW LEVEL SECURITY`. The non-owner `app_rt` reads it with `SET LOCAL app.workspace_id` set from the Principal. A table with no policy returns no rows.
- The one exemption is the identity set, Better Auth's tables, named in `IDENTITY_SET`.
- The store door is ergonomics over this guarantee, never a substitute for it.
- The checkable sentences are two rules in `CODING_STANDARDS.md`: *Take a `Principal` as the first parameter*, and *Ship a tenant table, a grant or a definer function with the test of what it refuses*. The `neo4j` ban is this decision's alone.

The substrate:

- One migration journal, Drizzle's, in `packages/schema`. It generates migrations for `public` and carries hand-written SQL for the `index` schema, extensions, policies, SQL functions and the map tables.
- One policy seam: every tenant policy calls `current_workspace_id()`, written `(SELECT current_workspace_id())`.
- `index.passage`'s vector column is `vector(N)`, fixed, with `embedding_model_choice_id` on every row and list partitioning by workspace.
- A `SECURITY DEFINER` function, `create_workspace_partition`, makes each workspace's `index.passage` partition with a GIN index over its full-text column, `search`. The HNSW index returns with the route's S8 block, when the embedding column is first written, in the same per-partition shape.
- `worker_rt` is deny-by-default. A migration that wants the worker to reach a table says so in a GRANT. It holds SELECT, INSERT, UPDATE and DELETE on the `index.passage` parent and nothing on a partition.
- The roles' surface, `packages/schema/roles-surface.json`, and the worker's schema view are generated from the catalogue after migrating, committed and drift-checked.
- `migrate` connects as a superuser and, after the journal on every run, marks `pg_catalog.ts_match_vq` LEAKPROOF (`packages/schema/src/full-text-match.ts`). `find`'s full-text match then reaches the GIN index beneath the policy.

## Why

- AGE stored each workspace's map as its own schema. Row-level security guards rows, not schemas, so fifty maps needed fifty roles. The roles were AGE's cost, not a decision of their own.
- The design had already removed what a graph engine is for: entry by key only, five named edge types, prepared templates, depth 4 at most, maps of tens of megabytes. Hand-written SQL is cheap there.
- drizzle-orm has no query lifecycle hook, so there is no interception layer to trust. A default-deny policy is the stronger guarantee.
- A second journal would blind the worker's schema stamp to the schema the worker writes.
- pgvector's HNSW refuses a column with no dimension. The HNSW index was over a column nothing writes until S8, so every workspace paid to build it for no query.
- Under deny-by-default, a table that forgets its REVOKE no longer hands the worker a write. The generated roles surface states each role's reach once.
- Without LEAKPROOF, Postgres will not evaluate `search @@ q` beneath the policy, and every `find` scanned its workspace's whole partition. A bare count took 209 ms at a million rows, and 4.2 ms with the mark. The mark changes only the order conditions run in; the policy still filters every row. A logical restore or a major upgrade drops it, so a numbered migration cannot hold it.

## Rejected

- Keeping AGE and spiking first: the spike defends a convenience whose induced cost is larger whatever it measures.
- Keeping AGE and building as first cut: builds the machine the spike might delete.
- An edges table with per-workspace roles kept: catalogue sprawl, and `pg_dump` does not carry roles.
- Two journals: a worker schema stamp blind to what the worker writes.
- Python (Alembic) or neutral-runner schema ownership: it forfeits Drizzle's and Better Auth's generators.
- A hand-written role declaration swept against the catalogue: a second statement of one fact.
- A `SECURITY DEFINER` search function, a view without row-level security, accepting the scan, or a leakproof wrapper with its own operator class.

## History

The full record, which replaced ADR 0023's engine and kept its write model, with its amendments (T-078, T-183, T-166, T-273, T-324, T-283, T-240): `docs/archive/adr/0032-graph-is-plain-postgres-tables.md`.
