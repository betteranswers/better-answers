# Coding rules

These rules apply to every workspace; tier rules live in `app/CODING_RULES.md` and `worker/CODING_RULES.md`.

## DESIGN

### [DESIGN1] Deep modules at clean seams

A module is anything with an interface and an implementation. Its **interface** is everything a caller must know — types, invariants, ordering, error modes, configuration, performance. Design for a small interface over a large implementation. The deletion test: remove the module; if complexity vanishes it was a pass-through, if it reappears across callers it earned its place.

### [DESIGN2] The interface is the test surface

Tests cross the same seam callers do. Wanting to test past the interface means the module is the wrong shape — reshape it.

### [DESIGN3] One adapter is a hypothetical seam; two is a real one

Introduce a seam only where something already varies across it (a second store, a second provider). Accept dependencies as parameters; return results instead of producing side effects.

### [DESIGN4] Workspace on every row

Every table carries the workspace id; every query is scoped through the workspace-aware data layer, which throws in every environment (the Dust `WorkspaceAwareModel` contract it follows only logs in production). Every document carries the `external_access` shape and its binding's sensitivity. The rule reaches the graph: every node and edge carries the workspace id, every query names the graph from the session principal and never from a tool argument, and no LLM-authored Cypher or SQL runs against a shared store.

In the graph — Apache AGE inside the platform Postgres, one graph per workspace, written as ordinary application data (ADR 0023 and its *the graph is application data* amendment):

- **One `Concept` label; `kind` is a property.** The bundle-and-record partition uses a closed label set the app's migrations own — `Concept`, `Section`, `Source`, `Actor`, `Composition`, `Evidence`, `CanonicalEntity` — and a concept's kind is an indexed **property**, never a label. Source-entity labels keep their own closed, prefixed set. No DDL enters the write path and no runtime role holds `CREATE` on a label.
- **Uniqueness is a Postgres unique index on each label table**, in the app's migrations — `(gen, uid)` on the bundle-and-record partition, `(uid)` on source entities — with a `gen` range index per label; presence is the writer's guarantee, proved by its test and a nightly audit.
- **`workspace_id` is a property on every node and edge** in both partitions, and a term of the builder's `WHERE` on every element of every path — beside the read predicate, never instead of it. A wrong graph name returns **zero rows**, not another tenant's knowledge.
- **The three visibility terms are properties too** — `published_at`, `sensitivity` and `audience` on every node and edge — and the read predicate rides in `WHERE` on every node and edge of a **bounded variable-length pattern**, because AGE cannot carry it inside a path pattern. Depth is capped at 4 by the template, never by the caller, and the pattern is emitted only through the query module's builder.
- **The graph name is derived from the Principal through one allowlisted function** that regex-checks `^ws_[0-9a-z]{26}$` — the only place string-building is permitted. A lint rule refuses `cypher(` outside the graph query module's builder.
- **Writes are split `MERGE`s** (node, then edge — the AGE way); every statement is `cypher()`-in-SQL over `agtype`; the app reads through `pg` with an `agtype` parser, the worker through `psycopg` — one graph query module per tier. The bundle-and-record delta joins the app's commit transaction; generations survive for full rebuilds only.
- **The app runs as the non-owner `app_rt`** under `FORCE ROW LEVEL SECURITY`; the owner DSN reaches `migrate` and the two runtime-DDL paths only. One worker **login** role holds no table privileges at all and `SET LOCAL ROLE`s into the workspace's role, so a forgotten `SET ROLE` fails with *permission denied*.
- No graph-side vector or full-text index is a retrieval route; no `neo4j` driver, no Bolt, no APOC and no `neo4j_graphrag` import in either tier — the ban has no exception (ADR 0026 abolished typed-relation prediction, so the matcher lift has no consumer).

### [DESIGN5] The identity provider stays behind its seam

No Better Auth type crosses into `app/lib`. Transports verify a bearer and build a `Principal`; nothing behind that seam knows which library minted the token, and no `better-auth` or `@better-auth/*` import appears outside the auth module — lint-enforced. Reason: Better Auth is a stay with three written leave-triggers (ADR 0009), and the seam is what makes the Keycloak fallback two to three weeks rather than a rewrite.

## TEST

### [TEST1] Functional tests through the interface

Tests exercise a module through its interface — for `app/`, the endpoint (`app.request()`); for `worker/`, the job or module entry point. Unit tests of internals are neither required nor desired.

### [TEST2] Real Postgres, always

Every test that touches data runs against a real Postgres (Testcontainers or the compose database). The database is never mocked.

### [TEST3] Our own code is never mocked

Module mocking (`vi.mock`, `jest.mock`, `monkeypatch` of our modules) is banned and lint-enforced (`anti-slop/no-module-mocking`). External services — LLMs, SaaS APIs — are replaced behind their adapter with an in-memory implementation.

### [TEST4] Setup through factories

Test state is built by factories that return domain objects, never by raw inserts.

### [TEST5] Titles state behaviour

A test title says what the system does for whom, not which function it calls.

### [TEST6] Mutation testing runs on a schedule

Stryker (`app/`, `web/`) and mutmut (`worker/`) run on a schedule — weekly on hosted runners (a nightly run is most of the free minutes), nightly once a self-hosted runner exists; a falling mutation score is a task.

## COMMENT

### [COMMENT1] Comments explain why

A comment carries the reason a reader cannot infer from the code: a constraint, a trade-off, a gotcha. What the code does is said by the code; what happened to it is said by git and ADRs.

## GLOSSARY

### [GLOSSARY1] `CONTEXT.md` is a glossary and nothing else

Domain terms, one definition each, no implementation detail. Code uses the glossary's word; a missing word is settled in `CONTEXT.md` first.

## LIFT

### [LIFT1] One directory, one `THIRD_PARTY_NOTICES.md`

Third-party code taken by contract lives under `<tier>/lifts/<name>/` as a pinned snapshot with a `THIRD_PARTY_NOTICES.md` at its root (the label every engineer recognises; earlier ADRs call it `LIFT.md`): upstream repository, commit, `sha256` of the snapshot, licence and notice, what was cut, who audited it and when, and the boundary contract tests a refresh must pass. Never a fork branch or a submodule.

### [LIFT2] Refresh is a deliberate act

An upstream refresh is a task with its own PR: re-snapshot, re-apply cuts, run the owned tests, update `THIRD_PARTY_NOTICES.md`.

### [LIFT3] Permissive only; copyleft runs, never links

Code is lifted or depended on only under MIT, BSD, ISC, Apache-2.0 or the PostgreSQL licence. GPL/AGPL software runs as an unmodified separate process reached over a network protocol — never linked, vendored or copied. Nothing under an `ee/` or enterprise-licensed directory is ever read from, not even for its shape: the design is reimplemented clean-room. `check` fails on any dependency whose licence is off the list and writes the root `THIRD_PARTY_NOTICES.md` aggregate. Ordinary pnpm and uv dependencies carry no per-lift file; only copied code does (ADR 0027).

## TYPES (TypeScript)

- `strict` and `noUncheckedIndexedAccess` on; zod v4 at every boundary (input, env, tool schemas).
- Types over enums; no unsafe `as`; no parameter mutation; exhaustive `switch` + `assertNever`.
- Errors are returned as `Result<>`; `catch` only around external libraries, via `normalizeError`.
- Unit suffixes on money and time (`timeoutMs`, `priceCents`); static imports; environment through the typed config module, never `process.env`.

## TYPES (Python)

- Python 3.13, uv workspace, `uv.lock` committed; ruff for lint and format; mypy strict.
- Every public function typed; `Any` is a review question.

## LOG

### [LOG1] One structured logger per tier

pino in TypeScript, structlog in Python, JSON to stdout; the OpenTelemetry exporter is one config key (`OTEL_EXPORTER_OTLP_ENDPOINT`), empty until something receives it (ADR 0025). `console.*` and `print` are banned outside scripts. Prompt and completion content never enter the logger, the exporter or the `llm_call` row — every model call writes one (`workspace_id`, purpose, route, model, tokens, seconds, priced cost, outcome, the run or answer served); the answer audit is its own table with a workspace id and a retention period.

## SEC

### [SEC1] Secrets only through the credentials provider

Credentials are read through `CredentialsProviderInterface`; never from env at the call site, never logged. Credential classes: ingestion, acting, agent (a share agent's binding-scoped token), LLM provider, repository, object store, and bootstrap (read once by the typed config module) — never mixed in one scope. Tokens are stored hashed with a lookup prefix, expire, and are revocable; every class has a rotation path; access decisions are audit-logged.

### [SEC2] A Principal on every call

Every `app/lib` function that reads or writes tenant data takes a `Principal` (`workspaceId`, `userId`, `role`) as its first parameter; transports build it, business logic checks the role, the role's action threshold and the **read predicate** (published · sensitivity · audience) beside the data access. The predicate is tested against **columns on the readable unit** — `concept_index`, `composition` and every `index.chunk` row carry `published_at`, `sensitivity` and `audience` whatever the unit's kind — never against three fields of a source binding, because a concept and a composition have no binding (ADR 0023). One functional test per capability runs **through every mounted transport**: tRPC, MCP and `/agent/v1` today, OpenAPI the day it mounts (ADR 0008's amendment leaves the generated document unmounted in v0.1).

A `Principal` has **two kinds** and both are real (`CONTEXT.md`): a **deferred principal** carries a named person's authority into work that outlives their session — a background job, a scheduled run, a replay — and expires with the authority it borrowed; a **platform principal** is the platform acting as itself, with its own actor id and no person behind it. Work that outlives a session runs under one of the two, never under a live user session.

## OKF

### [OKF1] The bundle-alone test

This restates ticket 34's decision (ADR 0004) — the bundle holds concepts only, nothing product-UI-shaped; guides are platform records and UI — as a test that is applied, never re-agreed. A key, a value or a writing convention goes into a concept file only if a company with no platform and no guides would still want it there. Evidence, trust, lifecycle, identity, the company's own language and its links pass (a typed relation is derived in the graph, never a key — `[OKF2]`); anything that exists so a guide, a section, an audience or a screen can find or phrase a concept fails and is a platform record instead. Every new key on a concept file cites this test in its ADR, and every extraction or enrichment prompt is written for the file, never for the surface that will read it.

### [OKF2] Spec-pure concept files

A concept file carries what OKF v0.2 defines plus exactly two platform keys — `iri` (identity, ADR 0002) and `sources[].locator` (evidence, ticket 46). The spec's silences — supersession, conflicting claims, context, typed relations, entity equivalence, access — are met in the graph and in records (`docs/okf-v02.md`); a feature that needs another key in the file is re-evaluated before it proceeds (Liam, 26/08/2026). A new key needs an ADR that passes `[OKF1]` and states why neither the graph nor a record can carry it.

## UX

### [UX1] Show what is needed first, then more, then the action

Every reader-facing surface follows the Linear/Spotify default (Liam, 26/08/2026): the first view shows only what the reader needs to judge — a claim with its trust words, a section with its coverage — one disclosure reveals more (verifier, date, evidence passage, history), and the action sits beside it with its consequence stated before the click. Two levels of disclosure for a Viewer; never a third pane, modal or tooltip where a second level would do. Trust and status are text tags, never colour alone; dates are UK long form.

### [UX2] Latency and keyboard budget

Lists and search hits render under one second; actions apply under 100 ms optimistically and reconcile after; answers stream. Every common action has a keystroke, `?` lists them, and bulk work is select-then-command. A screen that misses the budget is a bug, not a backlog item.

## A11Y

### [A11Y1] WCAG 2.2 AA, tested with a keyboard and a screen reader

Every UI ticket carries the acceptance line "WCAG 2.2 AA, tested with keyboard and a screen reader"; every interactive element is a native control or has a role, name and focus order; outcomes are announced to assistive technology; components follow GOV.UK Design System semantics (tag, details, notification banner, warning text, summary list) without the GOV.UK brand; the product ships an accessibility statement. The buyers are UK public bodies for whom this is law, and the first client states it of its own products.

## PIPE

### [PIPE1] Never rebuild what cocoindex provides; never rely on what it does not

The worker composes cocoindex's documented building blocks — per-component commit, memoisation with keys and states, stable ids, target sync with deletes, `mount_each` isolation, cooperative timeouts, exception handlers, `stats_group`/`watch()`, one `Environment` per binding — and writes only what the engine has no block for: the run key, claim/lease/heartbeat/reaper, attempt count and poison threshold, the source-document catalogue, retention membership, priced-vs-actual, outcome rows, the object-store landing, one run per binding, supervision (the ours/shared/theirs table on ticket 53). Undocumented API (`use_state`) is never relied on; `use_mount` never fans documents onto the critical path. The exit stays cheap: cocoindex types never cross a module seam, the catalogue and run rows are the durable truth, and every LMDB is disposable. Every cocoindex target is `managed_by="user"`; the app owns all DDL (ADR 0007).

## DEPS

### [DEPS1] Versions come from the source, never from memory

Every dependency, image, extension or tool version is pinned from Context7 (`mcp__context7__*`) or the vendor's own release page at the time of the change, and the PR names where it was read. A Renovate PR is a source when it names the release page it read. Reason: the stack lock carried Postgres 17 from memory while 18 was current.

## OPS

### [OPS1] State on disk, jobs that prove themselves, staging that holds nothing

Nothing runs as root to own a volume; every stateful service is a bind mount under `/data/<service>` owned by its uid. Every scheduled job verifies its upload against the bucket, writes a `backup_run` row, and only then pings the dead-man check — with an outcome word and sizes, never a path, key, workspace or error string. Staging holds synthetic data outside a restore drill and is wiped when the drill ends. Migrations are forward-only; a rollback is the previous image digest. Images are deployed by digest; a compose file refuses to start without one (ADR 0022). A signal is a query over existing rows with a threshold held as a config row; an alert is recorded once as a `platform_event` and closed by a *cleared* event — no metrics store, no scrape (ADR 0025).