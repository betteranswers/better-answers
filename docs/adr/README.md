# The decision record, one line each

The **live conclusion** of every ADR — the state after its amendments, not its opening claim. Read this before trusting any single ADR's body: the convention is chronological (a change is a new ADR or an amendment, never a rewrite), so a body can be superseded by text further down its own file or in a later number. This index exists because that convention has twice cost a session a stale conclusion.

**Maintenance rule: a PR that adds an ADR, or an amendment that changes a conclusion, updates the matching line here in the same commit.**

| ADR | Live conclusion |
| --- | --- |
| 0001 | ~~Type vocabulary authoritative in the bundle~~ — **superseded by 0026**: no vocabulary file; kinds are read off the concepts |
| 0002 | Concept identity is a platform-minted opaque IRI; bundle identity lives in the manifest |
| 0003 | One tenant bundle of atom concepts in v0.1; domains are future bundle boundaries |
| 0004 | Guides and compositions are platform records citing concepts, never restating them |
| 0005 | Own app, two runtime tiers (TS app, Python worker) sharing **four stores and never code**; no app↔worker HTTP — the control plane is rows; third-party parts lifted as pinned snapshots under `THIRD_PARTY_NOTICES.md` |
| 0006 | Hono long-running Node server + Vite SPA, not Next.js |
| 0007 | Plain Postgres; the app owns every migration and all DDL; deploy order `migrate` → `app` → `worker` |
| 0008 | tRPC inside; generated OpenAPI, MCP and `/agent/v1` outside |
| 0009 | Better Auth in-process — the app is its own authorization server; its tables are the identity set, isolated by key not by scope, and its organisation model is the `workspace` table (2026-09-01) |
| 0010 | ~~Typed relations on concepts~~ — **rejected**; a link is the relation (0026) |
| 0011 | Three knowledge layers (sources → bundles → graph) and the minting rule decide where a unit lives |
| 0012 | The bundle is written only by the app, one commit per act; platform-prepared changes wait as suggestions; enrichment jobs read committed concepts, a run may enrich its own candidates before submitting (2026-09-01); the forge consequence is superseded — bare repositories (0024) |
| 0013 | Sources bound by origin, reach and destination; publish · sensitivity · audience are the three permission fields, applied as one server-side predicate on every read |
| 0014 | Records attach by IRI, versioned where edited, audited in one ledger |
| 0015 | A composition cites its concept by a footnote labelled by the include |
| 0016 | An answer asserts concepts only, found by traversal, served as one contract — verdict first |
| 0017 | Every answer is a retained, correctable record; an `Answer` is minted only at a gate a person runs |
| 0018 | One MCP surface, the Principal from the token grown by scope — **four entries, not the title's five** (A26, ticket 79; `describe_estate` dropped) |
| 0019 | Trust is derived from the file, told in fixed words, moved only by a check; verifier ≠ generator |
| 0020 | Personal data is withheld at the seam before any store and erased from every copy by routine |
| 0021 | ~~Graph on Neo4j Community~~ — **superseded by 0023** |
| 0022 | Two stacks deployed by digest; every irreplaceable byte encrypted off-host; erasures replayed on restore |
| 0023 | ~~Apache AGE, one graph per workspace~~ — **engine superseded by 0032** (plain tables under RLS); its write model stands: the read predicate lives once, in the app's graph query module; the incremental delta joins the app's commit transaction (2026-08-29 amendment) |
| 0024 | The forge is bare git repositories the app writes; the estate is two 4 GB boxes |
| 0025 | A signal is a query over rows the platform already keeps; every model call writes one `llm_call` row |
| 0026 | Kinds emerge from the concepts — no vocabulary file; a link is the relation |
| 0027 | Open core under Apache-2.0; the hosted service is the product; copyleft is run-only |
| 0028 | A boundary schema is generated from its table; a refinement only narrows; a parity test proves it; a `customType`'s plain schema is constructed and tested per shape (2026-09-01) |
| 0029 | The tree is `apps/` over `packages/`; business logic is `packages/core` — capability slices over four store doors; import direction is a lint rule (its contracts-rename and six-item-risk consequences are enacted and corrected by 0031) |
| 0030 | The MCP surface stays MCP SDK v2 in the TypeScript tier behind one fetch-shaped seam |
| 0031 | The tier contract is six agreements in three forms (SQL function / fixtured / generated) in top-level `contracts/`, conformance-tested by both tiers' suites; the read predicate's logic is app-only — the cross-tier piece is the visibility columns the worker writes |
| 0032 | The graph is plain Postgres tables under RLS (no AGE, no per-workspace roles, no custom image); one migration journal, one `current_workspace_id()` policy seam, one SECURITY DEFINER lifecycle function, `vector(N)` fixed, the worker's schema view generated and drift-checked both ways |
