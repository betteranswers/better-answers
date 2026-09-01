# Coding rules

These rules apply to every workspace; tier rules live in `apps/api/CODING_RULES.md` and `apps/worker/CODING_RULES.md`.

## DESIGN

### [DESIGN1] Deep modules at clean seams

A module is anything with an interface and an implementation. Its **interface** is everything a caller must know — types, invariants, ordering, error modes, configuration, performance. Design for a small interface over a large implementation. The deletion test: remove the module; if complexity vanishes it was a pass-through, if it reappears across callers it earned its place.

### [DESIGN2] The interface is the test surface

Tests cross the same seam callers do. Wanting to test past the interface means the module is the wrong shape — reshape it.

### [DESIGN3] One adapter is a hypothetical seam; two is a real one

Introduce a seam only where something already varies across it (a second store, a second provider). Accept dependencies as parameters; return results instead of producing side effects.

### [DESIGN4] Workspace on every row, and RLS is the guarantee

Every table carries the workspace id. Every query reaches its store through a **store door** in `packages/core/store/`. Every function that touches tenant data takes a `Principal` first (`[SEC2]`). Every document carries the `external_access` shape and its binding's sensitivity.

**RLS is the guarantee, and it is default-deny.** Every tenant table is created `withRLS()`, so a table with no policy returns no rows to anyone, under `FORCE ROW LEVEL SECURITY`, read by the non-owner `app_rt`, with `SET LOCAL app.workspace_id` set from the `Principal`. One zero-rows test per tenant table is the proof. The store door is ergonomics over that guarantee and never a substitute for it: drizzle-orm exposes no query lifecycle hook, so there is no interception layer to trust.

**The graph tables are tenant tables like any other** (ADR 0032): `graph_node` and `graph_edge` carry `workspace_id` and the three visibility terms as columns under the same RLS; traversal is a prepared recursive-CTE template in the one graph query module per tier, depth capped at 4 by the template; no LLM-authored SQL runs against a shared store; no `neo4j` driver, no Bolt, no APOC, no `neo4j_graphrag` import, with no exception.

The shape behind these four lines is **ADR 0029** for the store doors and **ADR 0032** (restating ADR 0023's *the graph is application data* amendment as columns) for the write model. Read those before changing the data layer; a design specification wearing a rule identifier drifts from the code the day the code exists, which is why it lives there and the checkable statement lives here.

### [DESIGN5] The identity provider stays behind its seam

No Better Auth type crosses into `packages/core`. Transports verify a bearer and build a `Principal`; nothing behind that seam knows which library minted the token, and no `better-auth` or `@better-auth/*` import appears outside the auth module.

## TEST

### [TEST1] Functional tests through the interface

Tests exercise a module through its interface — for `apps/api`, the endpoint (`app.request()`); for `apps/worker`, the job or module entry point; for `packages/core`, an entry point named in its `exports` map. Unit tests of internals are neither required nor desired.

`packages/core` is where most behaviour lives (ADR 0029), so its `exports` map is the surface this rule points at. A slice's internals — its `*.store.ts`, its helpers — are reached through that entry point, never imported by a test.

### [TEST2] Real Postgres, always

Every test that touches data runs against a real Postgres (Testcontainers or the compose database). The database is never mocked.

### [TEST3] Our own code is never mocked

Module mocking (`vi.mock`, `jest.mock`, `monkeypatch` of our modules) is banned and lint-enforced (`anti-slop/no-module-mocking`). External services — LLMs, SaaS APIs — are replaced behind their adapter with an in-memory implementation.

### [TEST4] Setup through factories

Test state is built by factories that return domain objects, never by raw inserts.

### [TEST5] Titles state behaviour

A test title says what the system does for whom, not which function it calls.

### [TEST6] Mutation testing runs on a schedule

Stryker (`apps/api`, `apps/web`) and mutmut (`apps/worker`) run on a schedule — weekly on hosted runners (a nightly run is most of the free minutes), nightly once a self-hosted runner exists; a falling mutation score is a task.

### [TEST7] A pair is checked in both directions

Where a list names members (the migration journal and its directory), a generated artefact mirrors a source (the worker's schema view and the migrated tables), or a registry names them (the boundary-schema registry and the exported tables), the test asserts membership both ways: every entry has its member, and every member has its entry. One direction finds the missing; only the other finds the orphan. `T-003` (ADR 0032, PR 5) wrote the journal check one way — an orphan `.sql` file would have passed — after the worker-view check in the same PR had been written both ways; the Cubic review flagged it.

## COMMENT

### [COMMENT1] Comments explain why

A comment carries the reason a reader cannot infer from the code: a constraint, a trade-off, a gotcha. What the code does is said by the code; what happened to it is said by git and ADRs.

### [COMMENT2] A stated invariant names its check

A comment or a test title that states an invariant — *FORCE on every tenant table*, *created in the caller's transaction*, *`drizzle-zod` is imported nowhere else* — names the check that holds it: a test by title, a lint rule by name, a constraint by name. A claim with no named check is a memory. `T-003` (ADR 0032, PR 5) shipped those three as comments and a test title before review turned the first two into tests and the third into a lint rule.

## GLOSSARY

### [GLOSSARY1] `CONTEXT.md` is a glossary and nothing else

Domain terms, one definition each, no implementation detail. Code uses the glossary's word; a missing word is settled in `CONTEXT.md` first.

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

Every `packages/core` function that reads or writes tenant data takes a `Principal` (`workspaceId`, `userId`, `role`) as its first parameter; transports build it, business logic checks the role, the role's action threshold and the **read predicate** (published · sensitivity · audience) beside the data access. The predicate is tested against **columns on the readable unit** — `concept_index`, `composition` and every `index.chunk` row carry `published_at`, `sensitivity` and `audience` whatever the unit's kind — never against three fields of a source binding, because a concept and a composition have no binding (ADR 0023).

A `Principal` has **two kinds** and both are real (`CONTEXT.md`): a **deferred principal** carries a named person's authority into work that outlives their session — a background job, a scheduled run, a replay — and expires with the authority it borrowed; a **platform principal** is the platform acting as itself, with its own actor id and no person behind it. Work that outlives a session runs under one of the two, never under a live user session.

### [SEC3] A grant or a definer function ships with the test of what it refuses

Every privilege a migration installs — a `GRANT`, a default privilege, a `SECURITY DEFINER` function — lands with a functional test of the path it must **refuse**, beside the test of the path it serves: the wrong role calling, a scope naming another tenant, a partition reached directly rather than through its parent. A definer function meets four checks a reviewer reads off the SQL: its arguments are guarded against the transaction's scope before any DDL, its `search_path` is pinned, every object it names is schema-qualified, and `EXECUTE` is revoked from `PUBLIC` and granted to the one role that calls it. A partition child is a table of its own — parent policies do not reach a query aimed at the child, and default privileges do — so the child's denial is asserted directly (`packages/schema/test/rls.test.ts`, "denies a direct query against a partition, whatever the scope"), never inferred from the parent's. A PR that touches `packages/schema/migrations` or any RLS policy gets an adversarial security pass before merge: the Standards and Spec axes review against documents; this one attacks the change. `T-003` (ADR 0032, PR 5) shipped a direct-partition read that bypassed RLS; two document-driven reviews passed it, and a review that read the code rather than the documents found it.

## OKF

### [OKF1] The bundle-alone test

This restates ticket 34's decision (ADR 0004) — the bundle holds concepts only, nothing product-UI-shaped; guides are platform records and UI — as a test that is applied, never re-agreed. A key, a value or a writing convention goes into a concept file only if a company with no platform and no guides would still want it there. Evidence, trust, lifecycle, identity, the company's own language and its links pass (a typed relation is derived in the graph, never a key — `[OKF2]`); anything that exists so a guide, a section, an audience or a screen can find or phrase a concept fails and is a platform record instead. Every new key on a concept file cites this test in its ADR, and every extraction or enrichment prompt is written for the file, never for the surface that will read it.

### [OKF2] Spec-pure concept files

A concept file carries what OKF v0.2 defines plus exactly two platform keys — `iri` (identity, ADR 0002) and `sources[].locator` (evidence, ticket 46). The spec's silences — supersession, conflicting claims, context, typed relations, entity equivalence, access — are met in the graph and in records (`docs/okf-v02.md`); a feature that needs another key in the file is re-evaluated before it proceeds (Liam, 26/08/2026). A new key needs an ADR that passes `[OKF1]` and states why neither the graph nor a record can carry it.

## UX

### [UX1] Show what is needed first, then more, then the action

Every reader-facing surface follows the Linear/Spotify default: the first view shows only what the reader needs to judge — a claim with its trust words, a section with its coverage — one disclosure reveals more (verifier, date, evidence passage, history), and the action sits beside it with its consequence stated before the click. Two levels of disclosure for a Viewer; never a third pane, modal or tooltip where a second level would do. Trust and status are text tags, never colour alone; dates are UK long form.

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

### [DEPS2] A pinned value is one exported constant

Every value `[DEPS1]` reads — an image reference with its digest, a model's dimension, a version no package manifest holds — is one exported constant in the package that owns the decision, and every consumer imports it; a copy is a second pin that ages alone. `packages/schema/src/postgres-image.ts` holds the database image and `EMBEDDING_DIMENSIONS` the vector width; the Python tier reads the constant's source file and refuses more than one match. `T-003` (ADR 0032, PR 5) left `apps/api`'s test harness with its own image string and the vector width as a bare literal in three files.

## OPS

### [OPS1] State on disk, jobs that prove themselves, staging that holds nothing

Nothing runs as root to own a volume; every stateful service is a bind mount under `/data/<service>` owned by its uid. Every scheduled job verifies its upload against the bucket, writes a `backup_run` row, and only then pings the dead-man check — with an outcome word and sizes, never a path, key, workspace or error string. Staging holds synthetic data outside a restore drill and is wiped when the drill ends. Migrations are forward-only; a rollback is the previous image digest. Images are deployed by digest; a compose file refuses to start without one (ADR 0022). A signal is a query over existing rows with a threshold held as a config row; an alert is recorded once as a `platform_event` and closed by a *cleared* event — no metrics store, no scrape (ADR 0025).