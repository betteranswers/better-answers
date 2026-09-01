---
status: accepted
date: 2026-08-25
---

# Own TypeScript app plus one Python knowledge worker; third-party parts lifted by contract as pinned snapshots

The platform is built as our own application, not a fork of Onyx or Dust, in two runtime tiers: a **TypeScript app** that owns everything a user or agent touches and every policy decision (workspaces and roles, guides and Q&A records, retrieval and cited answers, the MCP server, per-workspace LLM routing, approvals, bundle read/validate/write) and a **Python knowledge worker** — one image, one container in v0.1 — that owns everything that turns sources into indexed, governed knowledge (connector runs, conversion and extraction, cocoindex indexing, derive-and-sync to the graph, enrichment, ontology plan/apply). The two tiers share a contract of data, never code: one Postgres schema and one S3-compatible object store, with no app↔worker HTTP beyond a start/stop/heartbeat control plane. Third-party code is taken as **pinned snapshots lifted by contract** — each under one directory with a `LIFT.md` (upstream, commit, licence, what was cut, which tests we own), never tracked as a fork or submodule — **the file is named `THIRD_PARTY_NOTICES.md`; see the 2026-08-29 amendment**. We chose this because no candidate works as a whole base (Onyx gates permission sync, tenancy and groups behind an Enterprise licence and needs 11 containers; Dust is a SaaS-entangled 1.1M-line codebase with no source-permission inheritance), both move at 500–1,400 commits a month so a fork diverges within weeks, and Python is unavoidable (cocoindex has no TypeScript SDK; docling, `neo4j-graphrag`, Google's OKF reference agent and semantica are Python-only) while the app framework, MCP SDK, tRPC and the Dust-derived contracts are TypeScript.

## Considered options

- **Fork Onyx or Dust** — the largest head start, but EE gates or SaaS entanglement on exactly the parts we need, and an operational floor (torch model servers, Temporal, Rust core, Cloudflare/GCP assumptions) far above a two-VPS deployment.
- **Several Python services from day one** — right only when jobs need different scaling, security boundaries or release cadence; for one client it multiplies deploy units. Module seams are laid so this becomes a compose-file change later; the enrichment agent is the first seam.
- **Minimise Python (rewrite extraction, enrichment, graph sync in TypeScript)** — rewrites Python-only libraries for no v0.1 gain and still leaves two runtimes.
- **Track upstream (submodules, long-lived fork branches)** — rejected on velocity evidence; a refresh must be a deliberate, tested act.

## Consequences

- We own the glue and every snapshot's upkeep; `LIFT.md` (now `THIRD_PARTY_NOTICES.md` — 2026-08-29 amendment) plus our own contract tests make refreshes safe.
- Onyx's gateways are replaced, not lifted: `onyx.db` → our schema; `file_store` → a bucket behind a <100-line shim; Celery + Redis → a ~1–2k-line Postgres `SKIP LOCKED` scheduler that keeps the `ConnectorRunner.run(checkpoint)` contract so Celery or Temporal can replace the caller later; EE ACL population → the MIT `external_access` shape carried on every document from day one, filled `is_public` in v0.1; EE credential encryption → our own secret store behind `CredentialsProviderInterface`.
- Rust and Go are consumed as compiled dependencies (cocoindex core, open-ontologies, pinchtab) and never written.
- Workspace id on every table, the ACL shape, two credential classes (ingestion vs acting), the per-workspace route record and the database-shaped tier contract are laid now because each is cheap now and expensive after v0.1.

## Amendment — 2026-08-25, architecture review pass 1 (ticket 38)

The contract has **four** shared stores, not two: the Postgres schema, the object store, a **git host with one repository per workspace** (the app commits; the worker checks out at a commit, read-only), and the **graph, derived** from bundle and records (the worker writes it, the app reads it by IRI). Three consequences follow.

- **Concept inbox.** The only OKF writer is TypeScript (`apps/api/lifts/okf`) and the tiers share no code, so a worker-produced concept reaches the bundle through a `concept_write_request` row: the worker proposes (target path, frontmatter, body, actor, evidence), the app validates, checks `type` against the vocabulary, resolves or mints the `iri`, commits, and writes back the commit or the error. The worker holds no git credential.
- **The control plane is rows.** `worker_instance` (heartbeat, image digest, schema version) and cancel flags on runs, with `LISTEN/NOTIFY` for latency; there is no app↔worker HTTP at all. A worker can run on another network with nothing but a database connection string — the shape a customer-hosted worker (v1.0) needs.
- **Credentials are injected per run.** The encryption envelope is a versioned *format* contract with a golden test vector in `packages/contracts` **(now `contracts/envelope/` — the 2026-09-01 amendment below, ADR 0031)** that both tiers' suites decrypt; the app decrypts and hands a run its credentials through the control plane, so the worker never holds the master key. This is what makes the enrichment agent's credential scope a boundary rather than a naming convention. The worker connects to Postgres with a workspace-scoped role per job and to the object store under a per-workspace prefix.

## Amendment — 2026-08-26, Q&A pairs are concepts (ticket 47, ADR 0011)

The app's ownership list above says "guides and Q&A records"; read it as "guides and their compositions". Q&A pairs are `Answer` concepts in the bundle (ADR 0004 amendment), which the app reaches through the bundle read/validate/write it already owns; the records attached to them (usage, outcomes) stay app-owned. Nothing else in this ADR changes.

## Amendment — 2026-08-27, the concept write path (ticket 15, ADR 0012)

The concept inbox above says the app "validates, checks `type`, resolves or mints the `iri`, commits". Between validation and commit there is now a human: a worker-produced `concept_write_request` is the payload of a **suggestion** that waits in Control Centre until an Admin accepts it (in bulk or per item); the app commits on acceptance, never on validation alone. The worker still holds no git credential, and the tier contract is otherwise unchanged.

## Amendment — 2026-08-27, the share agent and worker state (ticket 53)

Two additions to the contract, neither a third tier.

- **A third deployable that is a client of the public API.** A client with no cloud suite runs a **share agent** inside its own network: a small separate program (a container or a Windows service) that watches a file share and sends changed documents *out* over HTTPS to a dedicated `/agent/v1` route family under a binding-scoped agent token (ADR 0008 amendment). It shares no code with either tier, holds no store connection, no workspace role and no LMDB — it stands to the platform as a browser or a Claude connector does. The customer-hosted *worker* (the rows-only control plane's purpose) remains the v1.0 shape.
- **Worker state is a store the contract names.** Each binding's cocoindex environment (one LMDB per binding) holds memoised extraction output, which is personal data. It is never backed up, is wiped and reprocessed on erasure, and is listed in the DPIA input; it is disposable by design (`[PIPE1]`).

## Amendment — 2026-08-28, the fourth store named (ticket 39, ADR 0021)

**Superseded — read the 2026-08-28 (ticket 73, ADR 0023) amendment below: the graph is Apache AGE inside the platform Postgres.** The derived graph is Neo4j Community on one shared instance in VPC 1. The worker writes it — the bundle-and-record partition by our own derive over the Python driver, the source-entity partition by cocoindex's Neo4j target — and the app is its only reader, through one graph query module that is the seam for the read predicate. `neo4j-graphrag` is not a runtime dependency of either tier; its three matchers are a lift under `apps/worker/lifts/` with a `LIFT.md`. Everything else stands.

## Amendment — 2026-08-28, the deploy unit and the object store (ticket 41, ADR 0022)

The two tiers ship as one image each, deployed by digest into a `platform` compose stack (`migrate` → `app` → `worker`) beside a `stores` stack and a Coolify Postgres resource on VPC 1. The "S3-compatible object store" is **Garage** (AGPL-3.0, run unmodified over S3; MinIO is end-of-life). `backup_run` joins `worker_instance` as a row the System screen reads; the scheduler's tick is the dead-man ping. Nothing else changes: the contract is still the four stores and no cross-tier code.

## Amendment — 2026-08-28, the fourth store lives inside the first (ticket 73, ADR 0023)

"The derived graph is Neo4j Community on one shared instance" no longer holds: the graph is Apache AGE inside the platform Postgres, one graph per workspace. The contract is unchanged in kind — the graph is still a store the tiers share and never code — but the worker writes it over `psycopg` (the bundle-and-record partition by our own derive; the source-entity partition by a derive step over cocoindex's Postgres target, as cocoindex has no AGE target), the app reads it over `pg`, and the workspace-scoped worker role's grants now bound the graph too. No Bolt, no `neo4j` driver in either tier. Everything else stands.

## Amendment — 2026-08-28, the git store is a bare repository, and the estate is two 4 GB boxes (ticket 74, ADR 0024)

The "git host with one repository per workspace" is a bare repository per workspace under `/data/git`, written by the app through the git binary (consumed, never written — the Rust/Go rule applies to C too) and mounted read-only by the worker at a commit; no forge service. The contract is unchanged: the app commits, the worker checks out, no cross-tier code. The first estate is two 4 GB boxes with no embedding host; the worker is capped at 1.5 GB and one run at a time. Nothing else changes.

## Amendment — 2026-08-29, the tree is open and the lift label is `THIRD_PARTY_NOTICES.md` (ticket 62, ADR 0027)

The whole tree — both tiers, every lift, the deploy unit — is public under Apache-2.0; the hosted service is the product. The `LIFT.md` at the root of each `<tier>/lifts/<name>/` snapshot is named **`THIRD_PARTY_NOTICES.md`** (same contents; the name other engineers recognise), and `[LIFT3]` fixes which licences may be lifted or depended on at all: MIT, BSD, ISC, Apache-2.0, PostgreSQL; GPL/AGPL run-only as a separate unmodified process; nothing from an `ee/` directory, ever.

## Amendment — 2026-08-30, no vocabulary to check, and the matcher lift is cut (ticket 79, the pre-build gate; applied by T-001)

Three sweeps from later decisions, written here because a builder reading this ADR alone would otherwise build the superseded design.

- **There is no vocabulary file to check `type` against** (ADR 0026, superseding ADR 0001). The concept-inbox consequence above reads: the worker proposes, the app validates, **folds `type` for case and plural**, resolves or mints the `iri`, and commits on acceptance. The type vocabulary is derived from the concept index; a new kind arrives with the concepts that carry it and is accepted by the same suggestion gate. No closed-world check, no plan diff, no `vocabulary_term` row.
- **The `neo4j-graphrag` matcher lift is cut.** The 2026-08-28 amendment above lifted its three matchers under `apps/worker/lifts/`. ADR 0026 abolished typed-relation prediction, so the matchers' only consumer is gone; the lift is removed and `[DESIGN4]`'s ban on `neo4j_graphrag` stands **with no exception** (ADR 0023's *graph is application data* amendment). One Python dependency fewer and the last Neo4j-shaped thing out of the worker.
- **The Python-only list in the body is trimmed.** `neo4j-graphrag` and semantica are dependencies of nothing (ADRs 0023, 0026); cocoindex, docling and Google's OKF reference agent are what still make Python unavoidable. The two-tier decision is unchanged.

Everything else in this ADR and its amendments stands. Note also that every `LIFT.md` in the body and the earlier amendments reads **`THIRD_PARTY_NOTICES.md`** (ADR 0027, recorded in the 2026-08-29 amendment above).

## Amendment — 2026-09-01, the contract is settled in form, and its fixtures leave the pnpm tree (T-020, ADR 0031)

The 2026-08-25 amendment placed the envelope's golden test vector "in `packages/contracts`" — a pnpm package the Python tier cannot read, so a contract in name only. ADR 0031 settles the whole tier contract: six agreements, each *SQL function*, *fixtured* or *generated*, with the fixtures in a top-level **`contracts/`** directory both tiers' suites read and one conformance skeleton running in CI from before the first table. The envelope's vector home is `contracts/envelope/` — **deferred**: the vector and both tiers' decryption assertions land with the envelope's implementation (`T-003`+), and until then the directory does not exist and the suite is the manifest skeleton alone; `packages/contracts` is deleted and its `Result` module lives in `packages/core`'s kernel. The contract of data, never code is unchanged — a SQL function is schema the app authors (ADR 0007) and both tiers call, not shared code. Everything else stands.
