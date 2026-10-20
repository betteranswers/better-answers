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

The map is two ordinary tenant tables in the platform Postgres, `map_node` and `map_edge`. They carry `workspace_id` and the three visibility terms as columns, under the same row-level security as every tenant table. Each tier has one map query module, and traversal is a prepared recursive-CTE template in it. The template caps depth at 4. A walk takes a set of entries in one statement and answers each reached node once, at its least depth. The nearest 1,000 nodes survive, ordered by depth then uid, so the cut is the same on every run. The statement runs under a two-second timeout set on its transaction. A walk may be narrowed to named collections, and the narrowing is in the statement, before the cap. A narrowed walk returns only concepts of the named collections and crosses no concept outside them, one in no collection included. It crosses a node that is not a concept under the reader's predicate alone, and never returns it. The map carries no collection on any node, and the promise is about concepts. There is no Apache AGE, no per-workspace role and no custom database image. There is no `neo4j` ecosystem either: no driver, no Bolt, no APOC and no `neo4j_graphrag` import, with no exception.

The tenancy rule lives here:

- Every tenant table carries the workspace id and is created `withRLS()`, under `FORCE ROW LEVEL SECURITY`. The non-owner `app_rt` reads it with `SET LOCAL app.workspace_id` set from the Principal. A table with no policy returns no rows.
- The one exemption is the identity set, Better Auth's tables, named in `IDENTITY_SET`.
- Neither runtime role, `app_rt` or `worker_rt`, owns an object, holds `rolsuper` or holds `rolbypassrls`. The roles block of `roles-surface.json` records it, and every RLS proof rests on it. The owner DSN, `MIGRATE_DATABASE_URL`, belongs to `migrate` alone.
- The store door is ergonomics over this guarantee, never a substitute for it.
- The checkable sentences are the principal rule in `packages/core/AGENTS.md` and the tenant-table, grant and definer-function rules in `packages/schema/AGENTS.md`. The `neo4j` ban is this decision's alone.

The substrate:

- One migration journal, Drizzle's, in `packages/schema`. It generates migrations for `public` and carries hand-written SQL for the `index` schema, extensions, policies, SQL functions and the map tables. A generated migration never touches the `index` schema or the map tables, and a test refuses one that does. Every hand-written migration opens with the custom-migration marker.
- One policy seam: every tenant policy calls `current_workspace_id()`, written `(SELECT current_workspace_id())`, and a test holds every policy to it. The function is `LANGUAGE sql STABLE PARALLEL SAFE` and reads an unset or empty `app.workspace_id` as NULL, so a missing scope reads zero rows and raises no error.
- `index.passage`'s vector column is `vector(N)`, fixed. Every row carries `embedding_model_choice_id`, and the table is list-partitioned by workspace. The dimension stays fixed until a workspace pins an embedding model of another one. That reopens this decision, and the answer is a column per dimension family, `halfvec` included, re-embedded by the rebuild a model choice change already runs. A btree index on `(workspace_id, connected_source_id, source_document_id, ordinal)`, declared on the parent, serves a connected source's preview of its passages.
- A `SECURITY DEFINER` function, `create_workspace_partition`, makes each workspace's `index.passage` partition with a GIN index over its full-text column, `search`, and revokes both runtime roles on it. A statement reaches a tenant's passages only through the policied parent. The HNSW index returns with the route's S8 block, when the embedding column is first written, in the same per-partition shape.
- `packages/schema/src/definer-reach.ts` names every `SECURITY DEFINER` function, with the tables it reaches and why. A test holds the catalogue's definer set equal to that roster both ways. No function the journal installs is executable by PUBLIC.
- `worker_rt` is deny-by-default. A migration that wants the worker to reach a table says so in a GRANT. It holds SELECT, INSERT, UPDATE and DELETE on the `index.passage` parent and nothing on a partition. `app_rt` keeps its default privileges, the four verbs on every new table in `public` and `index`, because the api owns the schema.
- The worker's sync pool sets a session `app.workspace_id` on every connection it opens. Row-level security bounds the worker's statements, but not a compromised worker, which could set any workspace's scope. What the grant bounds is the reach.
- The roles' surface, `packages/schema/roles-surface.json`, and the worker's schema view are generated from the catalogue after migrating. Both are committed and drift-checked. The generator runs the journal against a throwaway Postgres and emits the Python schema module the worker imports, with the last migration id as the worker's schema stamp. The check fails both on a stale committed view and on a table the journal does not declare.
- `migrate` connects as a superuser. On every run, after the journal, it marks `pg_catalog.ts_match_vq` LEAKPROOF (`packages/schema/src/full-text-match.ts`), the only function it marks. `find`'s full-text match then reaches the GIN index beneath the policy. If `migrate` cannot set the mark, it exits non-zero and `api` does not start. Both restore scripts run `migrate` after `pg_restore`, and a restore by any other route must be followed by a redeploy. The test harness sets the mark after the journal, and a plan test as the api proves that `find` uses the GIN index.

## Why

- AGE stored each workspace's map as its own schema. Row-level security guards rows, not schemas, so fifty maps needed fifty roles. The roles were AGE's cost, not a decision of their own.
- The design had already removed what a graph engine is for: entry by key only, five named edge types, prepared templates, depth 4 at most, maps of tens of megabytes. Hand-written SQL is cheap there.
- drizzle-orm has no query lifecycle hook, so there is no interception layer to trust. A default-deny policy is the stronger guarantee.
- A second journal would blind the worker's schema stamp to the schema the worker writes.
- pgvector's HNSW refuses a column with no dimension. The HNSW index was over a column nothing writes until S8, so every workspace paid to build it for no query.
- Under deny-by-default, a table that forgets its REVOKE no longer hands the worker a write. The generated roles surface states each role's reach once.
- The worker runs two statements against `index.passage`, the engine's upsert and its delete by key, and both need SELECT. `ON CONFLICT … DO UPDATE` reads every column it sets from `EXCLUDED`, and the delete's `WHERE` reads the key columns.
- Without LEAKPROOF, Postgres will not evaluate `search @@ q` beneath the policy, and every `find` scanned its workspace's whole partition. A bare count took 209 ms at a million rows, and 4.2 ms with the mark. The mark changes only the order conditions run in; the policy still filters every row. A logical restore or a major upgrade drops it, so a numbered migration cannot hold it.

## Rejected

- Keeping AGE and spiking first: the spike defends a convenience whose induced cost is larger whatever the spike measures.
- Keeping AGE and building as first cut: builds the machine the spike might delete.
- An edges table with per-workspace roles kept: catalogue sprawl, and `pg_dump` does not carry roles.
- Two journals: a worker schema stamp blind to what the worker writes.
- Python (Alembic) or neutral-runner schema ownership: it forfeits Drizzle's and Better Auth's generators.
- A hand-written role declaration swept against the catalogue: a second statement of one fact.
- A `SECURITY DEFINER` search function, a view without row-level security, accepting the scan, or a leakproof wrapper with its own operator class.
- Column-level grants on `index.passage` that keep `worker_rt` off `search` and the embedding columns: a second copy of the column list in SQL, and a standing duty on every column added later.

## History

The full record, which replaced ADR 0023's engine and kept its write model, with its amendments (T-078, T-183, T-166, T-273, T-324, T-283, T-240): `docs/archive/adr/0032-graph-is-plain-postgres-tables.md`.

Amended 13/10/2026 by the S2b ask plan (`docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, KTD4). A walk was one row per acyclic path from one entry, cut by a limit inside the statement before any order. It is now one row per reached node from a set of entries, ordered before the cap. A row per path could not be ordered first: forty entries took 4.7 s at the median, against 80 ms for a row per node. What is given up is the path, which a step no longer carries, and the early stop the inner limit gave. The timeout is now what bounds a walk, and its plan is fast only on tables Postgres has analysed.

Amended 13/10/2026 by the same plan (KTD4, with the review of its first four units). A walk had no collections, so a caller could only narrow what the cap had already cut. A hub with more than 1,000 neighbours in other collections then filled the cap before the named collection's own, and a path could leave the collection and come back. The narrowing is now in the statement. A node that is not a concept may be passed through, because it has no collection to be outside of.

Corrected 13/10/2026 on the owner's ruling of that day. The reason given for crossing a node that is not a concept was that such a node has no collection. That is wrong for a `Source` node, whose connected source has one. The reason is that the map carries no collection on any node, and the promise is about concepts: a narrowed walk returns only concepts of the named collections, crosses no concept outside them, and crosses any other node under the reader's predicate alone, never returning it. No rule moved, and the walk as built is ratified.

Later decisions overturned two rules of the record. The tier contract's visibility columns were to land on map rows, until ADR 0031 retired `visibility-columns`. `CROSS_OWNER_TABLE_ACCESS` was a reviewer's aid no test held, until ADR 0029's table-ownership scan held it. The missing scope, the runtime roles' limits, the owner DSN, the migration guard, the generator, the dimension's reopening, the preview index, the partition's revoke, the definer roster, PUBLIC's execute, `app_rt`'s defaults, the worker's session scope, the LEAKPROOF mark's failure and restore rules, and the worker's two statements were missing from this doc until 20/10/2026 (BA-215).
