# Coding rules

These rules apply to every workspace; tier rules live in `apps/api/CODING_RULES.md` and `apps/worker/CODING_RULES.md`.

## DESIGN

### [DESIGN1] Deep modules at clean seams

A module is anything with an interface and an implementation. Its **interface** is everything a caller must know — types, invariants, ordering, error modes, configuration, performance. Design for a small interface over a large implementation. The deletion test: remove the module; if complexity vanishes it was a pass-through, if it reappears across callers it earned its place.

### [DESIGN2] The interface is the test surface

Tests cross the same seam callers do. Wanting to test past the interface means the module is the wrong shape — reshape it.

### [DESIGN3] One adapter is a hypothetical seam; two is a real one

Introduce a seam only where something already varies across it (a second store, a second provider). Accept dependencies as parameters; return results instead of producing side effects.

## TEST

### [TEST1] Functional tests through the interface

Tests exercise a module through its interface — for `apps/api`, the endpoint (`app.request()`); for `apps/worker`, the job or module entry point; for `packages/core`, an entry point named in its `exports` map. Unit tests of internals are neither required nor desired.

For `apps/web`, the interface is the **served build driven by a browser** (Playwright against the served build on the loopback port the api's test harness listens on, over a Testcontainers Postgres) — or a **rendered component through Testing Library** where a component's own behaviour is the thing under test. A screen is never asserted against its source.

`packages/core` is where most behaviour lives (ADR 0029), so its `exports` map is the surface this rule points at. A slice's internals — its store modules, its helpers — are reached through that entry point, never imported by a test.

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

Where a list names members (the migration journal and its directory), a generated artefact mirrors a source (the worker's schema view and the migrated tables), or a registry names them (the boundary-schema registry and the exported tables), the test asserts membership both ways: every entry has its member, and every member has its entry. One direction finds the missing; only the other finds the orphan.

## COMMENT

### [COMMENT1] Comments explain why

A comment carries the reason a reader cannot infer from the code: a constraint, a trade-off, a gotcha. What the code does is said by the code; what happened to it is said by git and ADRs.

### [COMMENT2] A rule tag is cited where rules are made, kept, reviewed or proved

A tag such as `[SEC2]` appears in the rules files, an ADR, a spec or a ticket, `cubic.yaml`, a lint rule's line or message, a test — and in a document a reader follows to the rule: the glossary, a note under `docs/` or `apps/docs-site/`, a package readme, a notices file. It never appears in source, a deploy file, a Dockerfile, a CI workflow or a workspace's config: a comment there carries the constraint, the trade-off or the gotcha in words (`[COMMENT1]`) or is deleted, and is never replaced tag-for-sentence. `apps/api/tests/coding-rules-tags.test.ts` holds this both ways (`[TEST7]`): every tag cited in the tree is defined in a rules file and sits in one of those places, and every defined tag is cited outside its own file or is named in the test with the reason it is not. A tag struck in an ADR's body (`~~…~~`, the index's convention for a superseded sentence) is history, not a citation.

## GLOSSARY

### [GLOSSARY1] `CONTEXT.md` is a glossary and nothing else

Domain terms, one definition each, no implementation detail. Code uses the glossary's word; a missing word is settled in `CONTEXT.md` first.

## TYPES (TypeScript)

- `strict` and `noUncheckedIndexedAccess` on; zod v4 at every boundary (input, env, tool schemas).
- Types over enums; no unsafe `as`; no parameter mutation.
- Errors are returned as `Result<>`; `catch` only around external libraries, via `normalizeError`.
- Unit suffixes on money and time (`timeoutMs`, `priceCents`); static imports; environment through the typed config module, never `process.env`.

## TYPES (Python)

- Python 3.13, uv workspace, `uv.lock` committed; ruff for lint and format; mypy strict.
- Every public function typed; `Any` is a review question.

## LOG

### [LOG1] One structured logger per tier

pino in TypeScript, structlog in Python, JSON to stdout; the OpenTelemetry exporter is one config key (`OTEL_EXPORTER_OTLP_ENDPOINT`), empty until something receives it (ADR 0025). `console.*` and `print` are banned outside scripts. Prompt and completion content never enter the logger, the exporter or any row — the `llm_call` row every model call writes and the answer audit's own table are ADR 0025's shape, not restated here.

## SEC

### [SEC1] Secrets reach code through one seam per tier

The **bootstrap class** — what the deploy unit must give the process before it can reach anything — is read once by the typed config module (`apps/api/src/config.ts`, `apps/worker/src/better_answers_worker/config.py`) and nowhere else: never from env at the call site, never logged. The other six classes — ingestion, acting, agent (a share agent's binding-scoped token), LLM provider, repository, object store — are rows under the envelope, read through a **credentials provider** that no task has built yet; until it exists no code reads one, and the first slice that needs one builds it — tokens stored hashed behind a lookup prefix, expiring and revocable, one rotation path per class, every access decision audited. Classes are never mixed in one scope.

### [SEC2] A Principal on every call

Every `packages/core` function that reads or writes tenant data takes a `Principal` (`workspaceId`, `userId`, `role`) as its first parameter; transports build it, business logic checks the role, the role's action threshold and the **read predicate** (published · sensitivity · audience) beside the data access. The predicate is tested against **columns on the readable unit**, never against three fields of a source binding, because a concept and a composition have no binding (ADR 0023 names the columns and the units that carry them).

A `Principal` has **three kinds** (`CONTEXT.md`; ADR 0009, 2026-09-04): a **user principal**, a signed-in person in one workspace; a **platform principal**, the platform acting as itself with its own actor id and no person behind it; and the **operator**, the platform's administrator over every workspace, resolved from its own credential and audited under their own id (T-028 builds it). A **deferred principal** — a named person's authority carried into work that outlives their session, expiring with the authority it borrowed — is a glossary word with no type yet. Work that outlives a session runs under a deferred or a platform principal, never under a live user session.

### [SEC3] A tenant table, a grant or a definer function ships with the test of what it refuses

Every tenant table is created `withRLS()` and ships with its zero-rows test — the proof that, under `FORCE ROW LEVEL SECURITY` and the non-owner runtime role, a table with no policy returns no rows to anyone (ADR 0032; the identity set is the one exemption, named in `IDENTITY_SET` and checked both ways by the RLS coverage test). The graph tables are tenant tables under the same guarantee: no LLM-authored SQL runs against a shared store, and no `neo4j` driver, no Bolt, no APOC and no `neo4j_graphrag` import appears in either tier, with no exception. Every privilege a migration installs — a `GRANT`, a default privilege, a `SECURITY DEFINER` function — lands with a functional test of the path it must **refuse**, beside the test of the path it serves: the wrong role calling, a scope naming another tenant, a partition reached directly rather than through its parent. A definer function meets four checks a reviewer reads off the SQL: its arguments are guarded against the transaction's scope before any DDL, its `search_path` is pinned, every object it names is schema-qualified, and `EXECUTE` is revoked from `PUBLIC` and granted to the one role that calls it. A partition child is a table of its own — parent policies do not reach a query aimed at the child, and default privileges do — so the child's denial is asserted directly (`packages/schema/test/rls.test.ts`, "denies a direct query against a partition, whatever the scope"), never inferred from the parent's. A PR that touches `packages/schema/migrations` or any RLS policy gets an adversarial security pass before merge: the Standards and Spec axes review against documents; this one attacks the change.

## AUDIT

The one append-only *ledger* (`audit_event`) and the audit slice that writes it. These are the checkable sentences; the shape — the columns, the two doors, the typed vocabulary — stays in ADR 0014, ADR 0035 and the T-048 and T-063 specs (`apps/docs-site/specs/`), and is not restated here.

### [AUDIT1] An act and its audit event land in one transaction

Every Admin act, every governed write and every platform act writes its *audit event* through the audit slice inside the same database transaction as the rows it describes, so the two land or fail together — an act whose event cannot be written does not happen (ADR 0014 rule 4; T-048 spec). A slice that declares an act (`[AUDIT2]`) writes the event on every path that performs it. One row per act and target: a bulk act is N rows sharing one batch id, never one row hiding N. The transaction is the test: an act's test asserts its rows and its event together, and one test per slice proves they fail together.

### [AUDIT2] An act is named `family.subject.verb`, declared, never a free string

The four families — **people**, **knowledge**, **sources**, **platform** — are the only closed list; each slice declares its own acts against the template type the audit slice exports, and the doors accept a declared act and nothing else (T-063 spec). The subject is what was acted on and the verb what happened, spelled as the spec's four examples are — `people.member.role_changed`, `knowledge.suggestion.accepted`, `sources.binding.published`, `platform.reconciler.replayed`. Held by the type at compile time and by one test that walks every slice's declared acts and checks the family prefix both ways (`[TEST7]`).

### [AUDIT3] The actor is an `ActorId`

The row's actor is the kernel's `ActorId` — `human:<person id>`, `process:better-answers-<purpose>`, or an agent's id as ADR 0019 shapes it — derived from the Principal by the kernel's one function, never composed by hand, and never an email, a display name or a session (ADR 0035; T-063 spec). Concept files keep `human:<email>` in `generated.by` and `verified[].by` (ADR 0019): the file's form and the ledger's form differ by decision, which is why the erasure routine rewrites files and never the ledger (T-048 spec; T-063 spec). Held by the type and its test — a bare string is not an `ActorId`.

### [AUDIT4] A platform or deferred act is audited under its own actor

Work that outlives a session runs under a deferred or a platform principal (`[SEC2]`), and its row names the actor the kernel derives from that principal (`[AUDIT3]`) — for the platform, its own *actor id* — never a live person's session. The audit slice has two doors and no third: one derives the actor from the caller's Principal; the other takes the platform principal and an explicit actor, typed so a user principal cannot reach it, and the *access request* — made by a signed-in person who holds no membership — is its one caller (T-048 spec; T-063 spec). Held by the second door's type, which refuses a user principal at compile time, and by the access-request test that the row's actor is the requester.

### [AUDIT5] The detail carries ids and role words

The structured detail names records by id and roles by their word — Admin, Editor, Viewer — and carries an act's confirmations as typed fields (the publish act's LIA, privacy-notice and DPIA confirmations — ADR 0014, ADR 0020). It never carries an email, a display name, a prompt or a completion (`[LOG1]`): a ledger that held one would need rewriting on erasure, and the ledger is never rewritten (T-048 spec). Held by each declared act's detail type, which names every field it carries; a field that could hold a person's name or contact is a finding under this tag.

### [AUDIT6] The ledger is append-only by the database

The migration that creates `audit_event` revokes `UPDATE` and `DELETE` from the app's role and grants the worker's role nothing on the table, and each refusal is tested beside the served path per `[SEC3]` (ADR 0014; T-048 spec) — so nothing in the worker writes the ledger, and nothing in the app edits a row.

### [AUDIT7] The id is caller-minted

The writer mints the row's id through the kernel minter — a ULID (T-063 spec) — before it writes, and the column has no database default, so a governed write mints its id before its git commit and the commit carries it: a ledger row and a commit join on one id (ADR 0014 rule 4; T-048 spec). Held by the slice test that a supplied id is stored verbatim and by the id column's boundary refinement to the ULID shape.

### [AUDIT8] What stays out of the ledger is named

A read writes no row; the one view an ADR names as an act — an Admin opening a document's withheld original bytes (ADR 0020) — is audited as one. An event with no workspace — a sign-in, a token issued or refused — is a log line, because the ledger is a tenant table and no ledger over the identity set exists. Runs, the *answer audit* (ADR 0017), signals, alerts and spend (ADR 0025), backup runs and health checks (`[OPS1]`) are their own records and never audit events (T-063 spec). Held by the declared-acts walk (`[AUDIT2]`), which refuses an act whose subject names one of these records.

## OKF

### [OKF1] The bundle-alone test

The bundle holds concepts only, nothing product-UI-shaped; guides are platform records and UI (ADR 0004). A key, a value or a writing convention goes into a concept file only if a company with no platform and no guides would still want it there. Evidence, trust, lifecycle, identity, the company's own language and its links pass (a typed relation is derived in the graph, never a key — `[OKF2]`); anything that exists so a guide, a section, an audience or a screen can find or phrase a concept fails and is a platform record instead. Every new key on a concept file cites this test in its ADR, and every extraction or enrichment prompt is written for the file, never for the surface that will read it.

### [OKF2] Spec-pure concept files

A concept file carries what OKF v0.2 defines plus exactly two platform keys — `iri` (identity, ADR 0002) and `sources[].locator` (evidence, ticket 46). The spec's silences — supersession, conflicting claims, context, typed relations, entity equivalence, access — are met in the graph and in records (`docs/okf-v02.md`); a feature that needs another key in the file is re-evaluated before it proceeds. A new key needs an ADR that passes `[OKF1]` and states why neither the graph nor a record can carry it.

## UX

### [UX1] Show what is needed first, then more, then the action

Every reader-facing surface follows the Linear/Spotify default: the first view shows only what the reader needs to judge — a claim with its trust words, a section with its coverage — one disclosure reveals more (verifier, date, evidence passage, history), and the action sits beside it with its consequence stated before the click. Two levels of disclosure for a Viewer; never a third pane, modal or tooltip where a second level would do. Trust and status are text tags, never colour alone; dates are UK long form.

### [UX2] Every common action has a keystroke

Every common action has a keystroke, `?` lists them, and bulk work is select-then-command. The latency budget — lists under a second, actions under 100 ms optimistically, answers streamed — is ADR 0037's; a screen that misses it is a bug, not a backlog item.

## A11Y

### [A11Y1] WCAG 2.2 AA, tested with a keyboard and a screen reader

Every UI ticket carries the acceptance line "WCAG 2.2 AA, tested with keyboard and a screen reader"; every interactive element is a native control or has a role, name and focus order; outcomes are announced to assistive technology; components follow GOV.UK Design System semantics (tag, details, notification banner, warning text, summary list) without the GOV.UK brand; the product ships an accessibility statement. The buyers are UK public bodies for whom this is law, and the first client states it of its own products.

## PIPE

### [PIPE1] Never rebuild what cocoindex provides; never rely on what it does not

cocoindex types never cross a module seam. Every cocoindex target is `managed_by="user"` and the app owns all DDL (ADR 0007); the line between what the worker composes and what it writes itself is ADR 0036.

## DEPS

### [DEPS1] Versions come from the source, never from memory

Every dependency, image, extension or tool version is pinned from Context7 (`mcp__context7__*`) or the vendor's own release page at the time of the change, and the PR names where it was read. A Renovate PR is a source when it names the release page it read. Reason: the stack lock carried Postgres 17 from memory while 18 was current.

### [DEPS2] A pinned value is one exported constant

Every value `[DEPS1]` reads — an image reference with its digest, a model's dimension, a version no package manifest holds — is one exported constant in the package that owns the decision; every TypeScript consumer imports it, and a tier that cannot import reads the constant's source file and refuses more than one match (`apps/worker/tests/pg_harness.py` does this for `POSTGRES_IMAGE`); a copy is a second pin that ages alone. `packages/schema/src/postgres-image.ts` holds the database image and `packages/schema/src/index-tables.ts` exports `EMBEDDING_DIMENSIONS`, the vector width.

## OPS

### [OPS1] State on disk, jobs that prove themselves, staging that holds nothing

Nothing runs as root to own a volume; every stateful service is a bind mount under `/data/<service>` owned by its uid. Every scheduled job verifies its upload against the bucket, writes a `backup_run` row, and only then pings the dead-man check — with an outcome word and sizes, never a path, key, workspace or error string. Staging holds synthetic data outside a restore drill and is wiped when the drill ends. Migrations are forward-only; a rollback is the previous image digest. Images are deployed by digest; a compose file refuses to start without one (ADR 0022). No metrics store and no scrape: a signal and an alert are rows, in the shape ADR 0025 sets.