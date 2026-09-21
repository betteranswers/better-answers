# Coding rules

These rules apply to every workspace; a workspace's own rules live in `apps/api/CODING_RULES.md`, `apps/web/CODING_RULES.md` and `apps/worker/CODING_RULES.md`.

Each rule names what holds it — the test, lint rule, scan or CI step that runs it, or the reviewer who reads it off the diff — because a rule nothing runs is a convention, and a rule that claims a check it has not got is worse than a convention. What a rule records rather than requires belongs in the ADR that decided it, not here: `[UX2]`'s latency numbers went to ADR 0037, the tenancy rule to ADR 0032, the `llm_call` columns to ADR 0025 (the audit of 05/09/2026, T-078), the `neo4j` ban back to ADR 0032 (T-183), and forward-only migrations to ADR 0022, the credential classes to ADR 0041 and the accessibility statement to ADR 0042 (the audit of 21/09/2026, T-184).

## DESIGN

### [DESIGN1] Deep modules at clean seams

A module is anything with an interface and an implementation. Its **interface** is everything a caller must know — types, invariants, ordering, error modes, configuration, performance. Design for a small interface over a large implementation. The deletion test: remove the module; if complexity vanishes it was a pass-through, if it reappears across callers it earned its place. Nothing can measure a module's depth, so this one is read off the diff — which is why the ADRs that turn on it (0028, 0029, 0040) argue the shape rather than cite a gate.

### [DESIGN2] The interface is the test surface

Tests cross the same seam callers do. Wanting to test past the interface means the module is the wrong shape — reshape it. Held for `packages/core` by `better-answers/import-direction` (`packages/devtools/lint-rules/rules/import-direction.ts`), which places both ends of an import against the `exports` map and refuses a test that reaches past a face; proved by `packages/core/test/import-direction.test.ts`.

### [DESIGN3] One adapter is a hypothetical seam; two is a real one

Introduce a seam only where something already varies across it (a second store, a second provider). Accept dependencies as parameters; return results instead of producing side effects. Nothing checks it: a reviewer reads the second caller off the diff, and its absence is the finding.

### [DESIGN4] One guard per condition, at the boundary

A value is refused once, where it enters — by the type at the seam, by the boundary schema, by the one check the door makes — and a value the boundary refused is not refused again inside. A second refusal is not defence in depth: it can never fire, so a fault in the first stays green under the suite, and it teaches the next reader that the boundary is not to be trusted. The fix is the unreachable guard removed, or the type corrected so the boundary's refusal reaches the site, never the lint disabled there.

The worked example is the Postgres door's Principal resolver, which refused an unknown role twice: `refuse` answered `role-unknown` from the member row, and `resolveScoped` checked `isRole` again on the row that refusal passed, because the narrowing did not cross the callback. T-087's probe replaced the first refusal with `return "" as never` and the suite stayed green — the second check caught what the first no longer did, and a real fault there would hide the same way. T-103 (2026-09-08) landed the reshape: `refuse` now returns the narrowed row itself (`Result<MembershipRow & { role: Role }, PrincipalRefusal>`), so `resolveScoped` and both callers read the role off that value instead of the raw row, and the second `isRole` is gone — the type is the one guard.

Two detectors, one per half. `typescript/no-unnecessary-condition` (`.oxlintrc.json`, type-aware) is the mechanical half: it refuses the guard the *type* excludes — a null check on a value that cannot be null, a literal compared with itself, a default behind a value that is never missing. The guard a sibling *runtime* check masks is invisible to any type, and the scheduled mutation report (`[TEST6]`, T-090) is its detector: a mutant that survives inside a guard is a guard something else already made.

## TEST

### [TEST1] Functional tests through the interface

Tests exercise a module through its interface — for `apps/api`, the endpoint (`app.request()`); for `apps/worker`, the job or module entry point; for `packages/core`, an entry point named in its `exports` map. Unit tests of internals are neither required nor desired.

For `apps/web`, the interface is the **served build driven by a browser** (Playwright against the served build on the loopback port the api's test harness listens on, over a Testcontainers Postgres) — or a **rendered component through Testing Library** where a component's own behaviour is the thing under test. A screen is never asserted against its source.

`packages/core` is where most behaviour lives (ADR 0029), so its `exports` map is the surface this rule points at. A slice's internals — its store modules, its helpers — are reached through that entry point, never imported by a test.

`better-answers/import-direction` holds the `packages/core` half — the `exports` map is the face list, and a test importing past it is refused — and `apps/web`'s half is read in review off the spec that drives it, there being no rule that can tell a served-build spec from an assertion against source.

A package may also need to hand a sibling workspace shared test infrastructure — a harness, a factory, a fixture that lives under its own `test/` — and it does that only through an entry under the `./testing` name in its `exports` map: either `./testing` itself, a single barrel over the whole surface, or a `./testing/*` subpath named for what that one entry hands over — never through a bare path into the rest of its tree. `packages/core` and `packages/schema` are both `private: true` and never published, and every consumer of such an entry is a test file or a `vitest.config.ts`: the entry exists so a sibling workspace reaches one face, not a way into another package's internals.

### [TEST2] Real Postgres, always

Every test that touches data runs against a real Postgres (Testcontainers or the compose database). The database is never mocked. In TypeScript `anti-slop/no-module-mocking` refuses the mock whatever its target, so the rule rides `[TEST3]`'s gate; in Python the conftest guard scopes to modules under `better_answers_worker` and so does **not** refuse a patched driver — `apps/worker/tests/pg_harness.py` is the factory every suite builds on, and a reviewer reads a departure from it off the diff.

### [TEST3] Our own code is never mocked

Module mocking (`vi.mock`, `jest.mock`, `monkeypatch` of our modules) is banned, and enforced in both tiers: in TypeScript by lint (`anti-slop/no-module-mocking`), in Python by a conftest guard that refuses a `monkeypatch` whose target is a module under `better_answers_worker`, and by a lint ban on `unittest.mock`, which is the way round it. External services — LLMs, SaaS APIs — are replaced behind their adapter with an in-memory implementation, and a third-party attribute stays patchable.

### [TEST4] Setup through factories

Test state is built by factories that return domain objects, never by raw inserts. Nothing checks it — a reviewer reads the raw `INSERT` off the diff. `apps/worker/tests/test_work_loop.py` shows what that costs: two of its raw inserts name this rule and say why they are raw, and the others say nothing — including a second insert inside one of those same two tests, just past the reach of its comment. That is the drift a gate would have caught and a reviewer did not.

### [TEST5] Titles state behaviour

A test title says what the system does for whom, not which function it calls. Nothing reads a title but a person: this one is the reviewer's, on every diff that adds a test.

### [TEST6] Mutation testing runs on a schedule

Stryker runs on a schedule over `apps/api` and `packages/core` — nightly, on hosted runners; the cadence is a choice, not a budget (the repository is public, so hosted runners carry no minute cap), and nightly became the choice once the run's summary named what newly survived since the previous run (T-090, T-106): a reader triages from the summary, not from the score, so a run a night is a list a morning. The incremental file rides actions/cache between runs, and a nightly run reads its entry every night, so the cache's seven-day eviction of an unread entry is no longer the risk it was under a weekly schedule. A falling mutation score is a task, never a failed build. A report row is a verdict only when a test ran against it: a `Survived` row with `testsCompleted: 0` is a runner fault to fix where the runner failed, never a survivor to triage and never a mutant to skip (`ignoreStatic` stays off in both configs, because a static mutant is killed by the test files that import what it mutated, run whole; and the vitest runner is patched — `patches/`, applied by pnpm — so a test file that failed to load counts as the kill it is, never as no test run). A workspace joins the schedule when the suite that would kill its mutants is one the runner can execute and the source it would mutate is behaviour this repository wrote: `apps/web` is out because its interface is a browser driving a served build (`[TEST1]`) and Stryker's Vitest runner cannot drive it, and `apps/worker` is out until `T-006`, its mutatable source being configuration and a generated schema view.

### [TEST7] A pair is checked in both directions

Where a list names members (the migration journal and its directory), a generated artefact mirrors a source (the worker's schema view and the migrated tables), or a registry names them (the boundary-schema registry and the exported tables), the test asserts membership both ways: every entry has its member, and every member has its entry. One direction finds the missing; only the other finds the orphan. Each pair is held where it lives rather than by one gate over all of them — `apps/api/tests/check-scripts.test.ts` and `coding-rules-tags.test.ts` are the two a rules change touches — and the reviewer's question on a new pair is which of the two directions it left out.

### [TEST8] A test that provokes a failure inside a transaction asserts the transaction's outcome

Postgres aborts the transaction whatever the work does with the caught rejection, so a test that swallows a statement failure and asserts only a returned value can pin a rolled-back transaction as success. The store's openers refuse to report a `COMMIT` Postgres answered with `ROLLBACK` (`packages/core/src/store/postgres/index.ts`), which is the half the code holds — a swallowed abort cannot reach a test as a success. What a test then asserts, and in what order, nothing but a reviewer can see: the test that provokes the abort asserts that rejection — or the rows — before any value, and `packages/core/test/suite-postgres.ts` is where the openers a suite uses say so.

### [TEST9] A test writes its expected value down

The expected value is a literal, a worked example or the spec's own figure, never the code under test called a second time: an oracle that derives its expectation from the subject agrees with every implementation, including a wrong one, and a mutation report shows it as a survivor the test could never have caught. Two kills from the T-009 wave are the shape. `NOT_ANSWERED`'s refusal sentence was pinned by a test that interpolated the constant into its own expectation, so blanking the constant changed both sides at once; it died against the hardcoded sentence. The content hash's suites asserted against a second call to `canonicalFrontmatter` and the hash function, so `UNHASHED_KEYS`, the canonical form and the digest could all drift together — and the hash is a cross-tier contract, so the Python tier could drift with them; they died against literal frontmatter and literal hashes computed out-of-band. A constant the test needs is spelled in the test; a value too long to spell is a fixture read from a file, never a call. No gate can tell an oracle from an expectation, so this rule is the reviewer's on the way in and the nightly mutation report's (`[TEST6]`) after the fact — which is how the T-009 wave was found, a survivor at a time.

## CHECK

### [CHECK1] Every gate is run, not remembered

A lint rule, a tool in `check` and a hook command each land with a functional test that runs the tool over a throwaway tree and asserts both where it fires and where it stays silent. The tree, the run and the reading of the report are `@better-answers/devtools/throwaway-tree`'s: only the tool's own "found something" exit is tolerated, any other exit is re-thrown with what the tool wrote, and a smoke case proves the reporter before a silence may be read as a rule staying quiet.

A repository lint rule carries its rule line — a tag or an ADR — in the message it prints, so a reader who hits it reaches the rule without asking, and it lands with a functional test through that runner. The functional test is the checked half; the rule line in the message is practice that nothing yet reads, so a reviewer reads it off the diff that adds the rule. Every rule in `packages/devtools/lint-rules/rules/` carries one today.

Every tool named in `check` is a gate and never a report, so a finding from one is a rule citation and not a matter of taste: oxlint refuses the patterns its plugins name; knip refuses a file no code reaches, an export nothing imports, and a dependency either declared and unused or used and undeclared; and jscpd refuses a block of code copied between two files at five lines or fifty tokens, with no threshold to tune (`jscpd.config.mjs` names each exclusion with its reason, and a deliberate copy is fenced where it stands).

### [CHECK2] A suite that can run nothing fails

A test script never passes for having found no tests, and a browser spec left focused fails under CI (Playwright's `forbidOnly`). pytest refuses a marker it does not know and an expected failure that passed. Every pnpm workspace carries a `check` script or is named, with the reason it has nothing to run, in `apps/api/tests/check-scripts.test.ts`, which holds the pair both ways (`[TEST7]`): a named workspace that gains `check`, and a workspace off the list that lacks one, each fail.

### [CHECK3] One run of `check` names every failure

A workspace's `check` runs every step it has — lint, types, tests, and the browser suite where there is one — even when an earlier step fails, and reports the failures together. `&&` between steps is banned: it names the first problem and hides the rest, so a session fixes one thing per run. Each tier has one runner, and a manifest's steps are named in that manifest and nowhere else; the root `check` is the same shape over its own steps, so a gate is added by naming it. `apps/api/tests/check-scripts.test.ts` reads each manifest for this, and the runner is proved by a test that runs it over a throwaway manifest.

### [CHECK9] A branch narrows its tests, never its gates

A branch may run only the suites it touches — four worktrees consolidating cannot each run every Postgres suite, and a test that cannot be affected by an edit proves nothing about it. The gates that need no Postgres are never narrowed: they are the root `check` line's own steps, the ones named ahead of `check:workspaces` in the root `package.json` — read there, not restated here, so this rule cannot drift from the script — and each touched workspace's `typecheck`. Every one runs on the branch before its report is written, whatever else was skipped; the copy gate in particular is global and zero-threshold, and skipping the root `check` is what skipped it in the T-009 wave. The root `check` runs once, in full, before a PR is opened. `apps/api/tests/check-scripts.test.ts` holds the reading: the steps ahead of `check:workspaces` are tools over the whole tree, and the two tier steps come after them.

## COMMENT

### [COMMENT1] Comment only the why

A comment gives a reason the code cannot: a constraint, a trade-off, a gotcha. It never says what the code does, what it used to do, or which ticket, decision or rule asked for it. A file opens with code, not an essay.
Reviewer: if a comment restates the code, narrates history or cites a ticket or decision, ask for it to be removed.

A directive or pragma, a licence or lift notice, and a copy-detection fence are comments this rule leaves alone. The two conditions a scan can read — a block of 25 words at most, and no ticket id, date, rule tag or ADR number in it — are held by `pnpm comment-gate:ts` and `pnpm comment-gate:python`, and the ratio of comment lines to code lines by `pnpm comment-density`: 0.10 in a workspace's source, 0.05 in its tests. All three run in `check`.

### [COMMENT2] A rule tag is written in a rules file, a review finding or a gate's failure message

Those three places and nowhere else. A tag in source, a test, a document, a deploy file, a Dockerfile, a CI workflow or a workspace's config is a pointer a reader cannot follow and a citation nothing keeps true: write the rule in words instead, or delete the sentence. `apps/api/tests/coding-rules-tags.test.ts` holds it — tags are defined only in rules files and are well-formed, a tag in a gate's message is defined, and a tag anywhere else fails. The ADR and spec files that existed when that test was written are a frozen list it does not walk; the list only ever shrinks, and a file created after it fails like any other.

## GLOSSARY

### [GLOSSARY1] `CONTEXT.md` is a glossary and nothing else

Domain terms, one definition each, no implementation detail. Code uses the glossary's word; a missing word is settled in `CONTEXT.md` first. Nothing checks either half — no scan can tell a definition from an implementation detail, and none can tell whether a new identifier took its word from the glossary — so both are read off the diff — which is why a word is settled here before code names it, and a reviewer's question on a diff that adds a domain word is whether the glossary already had it.

## TYPES (TypeScript)

- `strict` and `noUncheckedIndexedAccess` on; zod v4 at every boundary (input, env, tool schemas).
- Types over enums; no unsafe `as`; no parameter mutation.
- Errors are returned as `Result<>`; `catch` only around external libraries, via `normalizeError`. No `catch` is empty: a swallowed error carries the comment saying why it is safe to lose, and lint holds it.
- Unit suffixes on money and time (`timeoutMs`, `priceCents`); static imports; environment through the typed config module, never `process.env`.

Checked, all four in `tsconfig.base.json` or `.oxlintrc.json`: the two compiler flags; types over enums, by `erasableSyntaxOnly`, which refuses an `enum` outright; unsafe `as`, by `anti-slop/no-chained-type-assertions` and `no-widen-then-assert` over source, both off in every test glob; its third sibling, `require-safety-comment-for-type-assertion`, is `"warn"` and so fails nothing, which makes the comment it asks for a reviewer's; and the empty `catch`, by `no-empty` with `allowEmptyCatch: false`, which is what "lint holds it" above names. zod's version is pinned by three manifests but not its reach: ADR 0028's parity test holds the generated boundary and a reviewer the rest.

Read off the diff: no parameter mutation, `Result<>` over a thrown error, `catch` only around an external library via `normalizeError`, the unit suffixes, static imports, and `process.env` read nowhere but the tier's config module. These stay rules rather than moving to an ADR because each is cheap to get wrong and cheap to spot; what stops them being lint is that the pinned oxlint ships no `no-restricted-syntax` to express them, the same absence ADR 0040's clock scan works around.

## TYPES (Python)

- Python 3.13, uv workspace, `uv.lock` committed; ruff for lint and format; mypy strict.
- Every public function typed; `Any` is a review question.

Both lines are held by `apps/worker/pyproject.toml` and run on every `check`: `requires-python`, the uv build backend, `[tool.mypy] strict = true` over `src` and `tests`, and ruff's `ANN` rules for the untyped signature. `Any` names review as its holder already.

## LOG

### [LOG1] One structured logger per tier

pino in TypeScript, structlog in Python, JSON to stdout; the OpenTelemetry exporter is one config key (`OTEL_EXPORTER_OTLP_ENDPOINT`), empty until something receives it (ADR 0025). `console.*` and `print` are banned outside scripts. Prompt and completion content never enter the logger, the exporter or any row — the `llm_call` row every model call writes and the answer audit's own table are ADR 0025's shape, not restated here.

The two bans are checked — `no-console` in `.oxlintrc.json`, ruff's `T20` in `apps/worker/pyproject.toml` with `check.py` its one exemption. The exporter key is checked by the config module that reads it (`[SEC1]`'s seam). One logger per tier and no prompt or completion in it are read off the diff. `apps/api/src/logger.ts` and `apps/worker/src/better_answers_worker/log.py` are the two, and each says in its own head that it is the tier's one logger; only `logger.ts` also says prompt and completion content never reach it. No scan can tell what a logged value holds, so that half is the reviewer's on both tiers.

## SEC

### [SEC1] Secrets reach code through one seam per tier

Every secret belongs to one of **seven credential classes**, and which they are is ADR 0041's, not restated here. The **bootstrap class** — what the deploy unit must give the process before it can reach anything — is read once by the typed config module (`apps/api/src/config.ts`, `apps/worker/src/better_answers_worker/config.py`) and nowhere else: never from env at the call site, never logged. The other six are rows under the envelope, reached through a credentials provider no task has built; until it exists no code reads one, and the first slice that needs one builds it to ADR 0041's shape. Classes are never mixed in one scope.

Nothing checks any of it, and the seam is the half that could be: no lint rule or scan holds `process.env` to the two config modules, so a second reader is caught in review, against each tier's own rule for the module that owns it. *Never logged* is read the same way and has plenty to be read against: the bootstrap class is built, and a diff that logged one of its values is exactly what this catches. *Classes are never mixed in one scope* is read the same way and has nothing yet to be read against, no credential class but the bootstrap one being built.

### [SEC2] A Principal on every call

Every `packages/core` function that reads or writes tenant data takes a `Principal` (`workspaceId`, `userId`, `role`) as its first parameter; transports build it, business logic checks the role, the role's action threshold and the **read predicate** (published · sensitivity · audience) beside the data access. The predicate is tested against **columns on the readable unit**, never against three fields of a source binding, because a concept and a composition have no binding (ADR 0023 names the columns and the units that carry them).

A `Principal` has **three kinds** (`CONTEXT.md`; ADR 0009, 2026-09-04): a **user principal**, a signed-in person in one workspace; a **platform principal**, the platform acting as itself with its own actor id and no person behind it; and the **operator**, the platform's administrator over every workspace, resolved from its own credential and audited under their own id (T-028 builds it). A **deferred principal** — a named person's authority carried into work that outlives their session, expiring with the authority it borrowed — is a glossary word with no type yet. Work that outlives a session runs under a deferred or a platform principal, never under a live user session.

The predicate is held by `packages/core/test/invisibility.test.ts` — its audience arm, the Restricted-sourced concept invisible from either end of the graph walk and through a guide's footnotes, and the narrowed document's chunk rows. The Principal first is held by the door, not by the type: a tenant-scoped transaction is only obtainable from `withPrincipal` (`packages/core/src/store/postgres/index.ts`), so a function that touches tenant data cannot get at it without one having been built. What no gate holds is the *first parameter* — the ordering is `packages/core/src/kernel/principal.ts`'s convention, and a signature that takes the Principal second is the reviewer's to catch. The last sentence — work that outlives a session runs under a deferred or a platform principal — is `[AUDIT4]`'s to hold, where the second door's type refuses a user principal at compile time.

### [SEC3] A tenant table, a grant or a definer function ships with the test of what it refuses

Every tenant table is created `withRLS()` and ships with its zero-rows test — the proof that, under `FORCE ROW LEVEL SECURITY` and the non-owner runtime role, a table with no policy returns no rows to anyone (ADR 0032; the identity set is the one exemption, named in `IDENTITY_SET` and checked both ways by the RLS coverage test). The graph tables are tenant tables under the same guarantee: no LLM-authored SQL runs against a shared store. Every privilege a migration installs — a `GRANT`, a default privilege, a `SECURITY DEFINER` function — lands with a functional test of the path it must **refuse**, beside the test of the path it serves: the wrong role calling, a scope naming another tenant, a partition reached directly rather than through its parent. A definer function meets four checks a reviewer reads off the SQL: its arguments are guarded against the transaction's scope before any DDL, its `search_path` is pinned, every object it names is schema-qualified, and `EXECUTE` is revoked from `PUBLIC` and granted to the one role that calls it. A partition child is a table of its own — parent policies do not reach a query aimed at the child, and default privileges do — so the child's denial is asserted directly (`packages/schema/test/rls.test.ts`, "denies a direct query against a partition, whatever the scope"), never inferred from the parent's.

That one suite holds every checkable sentence above — RLS and `FORCE ROW LEVEL SECURITY` in the catalogue, exactly one policy per table calling the one seam function, `IDENTITY_SET` both ways, and the worker role refused on every table it must not reach beside the path it serves. Two sentences are not the suite's and say so where they stand: the definer function's four checks, which the rule sends to the reviewer's reading of the SQL, and the ban on LLM-authored SQL, which nothing can scan for.

A PR that touches `packages/schema/migrations` or any RLS policy gets an adversarial security pass before merge: the Standards and Spec axes review against documents; this one attacks the change. It is a person's pass and no CI step, which is why it is named here rather than assumed.

## AUDIT

The one append-only *ledger* (`audit_event`) and the audit slice that writes it. These are the checkable sentences; the shape — the columns, the two doors, the typed vocabulary — stays in ADR 0014, ADR 0035 and the T-048 and T-063 specs (`docs/specs/`), and is not restated here.

### [AUDIT1] An act and its audit event land in one transaction

Every Admin act, every governed write and every platform act writes its *audit event* through the audit slice inside the same database transaction as the rows it describes, so the two land or fail together — an act whose event cannot be written does not happen (ADR 0014 rule 4; T-048 spec). A slice that declares an act (`[AUDIT2]`) writes the event on every path that performs it. One row per act and target: a bulk act is N rows sharing one batch id, never one row hiding N. The transaction is the test: an act's test asserts its rows and its event together, and one test per slice proves they fail together. The doors are called bare — no `attempt(` wraps `record(` or `recordFor(` under `packages/core/src`, held by a test beside the declared-acts walk: a wrapped door hands the abort back as a value the act might not read, and the act would commit without its event.

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

The bundle holds concepts only, nothing product-UI-shaped; guides are platform records and UI (ADR 0004). A key, a value or a writing convention goes into a concept file only if a company with no platform and no guides would still want it there. Evidence, trust, lifecycle, identity, the company's own language and its links pass (a typed relation is derived in the graph, never a key — `[OKF2]`); anything that exists so a guide, a section, an audience or a screen can find or phrase a concept fails and is a platform record instead. Every new key on a concept file cites this test in its ADR, and every extraction or enrichment prompt is written for the file, never for the surface that will read it. Nothing checks it: the test is a judgement about a company that does not exist, and it is applied where a key is argued for — in the ADR, before the key.

### [OKF2] Spec-pure concept files

A concept file carries what OKF v0.2 defines plus exactly two platform keys — `iri` (identity, ADR 0002) and `sources[].locator` (evidence, ticket 46). The spec's silences — supersession, conflicting claims, context, typed relations, entity equivalence, access — are met in the graph and in records (`docs/okf-v02.md`); a feature that needs another key in the file is re-evaluated before it proceeds. A new key needs an ADR that passes `[OKF1]` and states why neither the graph nor a record can carry it.

The key set is read off the diff, and deliberately so: `conceptFrontmatter` (`packages/schema/src/boundary-schemas.ts`) is **open** — every key preserved verbatim, because a file this platform did not write must round-trip (ADR 0019) — so no schema can refuse a key, and the `concept-file` contract pins the canonical text and content hash rather than the names. Two keys is the count a reviewer holds the diff to.

## UX

### [UX1] Show what is needed first, then more, then the action

Every reader-facing surface follows the Linear/Spotify default: the first view shows only what the reader needs to judge — a claim with its trust words, a section with its coverage — one disclosure reveals more (verifier, date, evidence passage, history), and the action sits beside it with its consequence stated before the click. Two levels of disclosure for a Viewer; never a third pane, modal or tooltip where a second level would do. Trust and status are text tags, never colour alone; dates are UK long form (`ukLongDate`). Nothing checks any of it — axe's contrast check is a different property, and no spec counts a screen's disclosure levels — so the rule is written into the surfaces it governs and read there: `apps/web/src/features/routes/routes-card.tsx` and `packages/design-system/tokens/colors.css` each carry the sentence they answer to.

### [UX2] Every common action has a keystroke

Every common action has a keystroke, `?` lists them, and bulk work is select-then-command. Read off the diff for now: no spec drives a `?` list or a bulk select, and nothing will until a screen has either. The latency budget — lists under a second, actions under 100 ms optimistically, answers streamed — is ADR 0037's; a screen that misses it is a bug, not a backlog item, and the browser suite asserts it per screen (`apps/web/e2e/routes.spec.ts` is the first).

## A11Y

### [A11Y1] WCAG 2.2 AA, tested with a keyboard and a screen reader

Every UI ticket carries the acceptance line "WCAG 2.2 AA, tested with keyboard and a screen reader"; every interactive element is a native control or has a role, name and focus order; outcomes are announced to assistive technology; components follow GOV.UK Design System semantics (tag, details, notification banner, warning text, summary list) without the GOV.UK brand. The buyers are UK public bodies for whom this is law, and the first client states it of its own products. That the product also ships an **accessibility statement** is ADR 0042's, which cites that reason rather than taking it.

The WCAG pass is checked on every browser spec: `apps/web/e2e/browser.ts` runs `AxeBuilder` over `WCAG_TAGS` as a fixture that fires whether a spec asks for it or not, and `apps/web/e2e/accessibility-gate.spec.ts` proves it fires. Read off the diff: the acceptance line on a ticket, which is an ordna ref no scan walks; the native control or the role, name and focus order on an interactive element; the announced outcome; and the GOV.UK semantics without the brand.

## PIPE

### [PIPE1] Never rebuild what cocoindex provides; never rely on what it does not

cocoindex types never cross a module seam. Every cocoindex target is `managed_by="user"` and the app owns all DDL (ADR 0007); the line between what the worker composes and what it writes itself is ADR 0036. The seam is checked: `apps/worker/pyproject.toml` bans the `cocoindex` import tier-wide and lifts the ban for `pipeline/` alone, and `apps/worker/tests/test_cocoindex_ban.py` refuses a second exemption or a widened glob. `managed_by="user"` is read off the diff — nothing walks the targets — and the diff that adds one is the whole of its evidence. The app owning all DDL is ADR 0007's and held by the migration journal being the app's; the line between composing and writing is ADR 0036's, and neither sentence is this rule's to check.

## DEPS

### [DEPS1] Versions come from the source, never from memory

Every dependency, image, extension or tool version is pinned from Context7 (`mcp__context7__*`) or the vendor's own release page at the time of the change, and the PR names where it was read. A Renovate PR is a source when it names the release page it read. Reason: the stack lock carried Postgres 17 from memory while 18 was current. Nothing checks it — there is no PR template and no CI step that reads one — so both sentences, the pin's source and Renovate's, are the reviewer's on every PR that moves a version; the thirty-odd records that cite this rule are ADRs and specs naming where a version was read, which is what a reviewer reads against — a pin in source cites no tag, `[COMMENT2]` forbidding it, so the citations are the argument and never the pin.

### [DEPS2] A pinned value is one exported constant

Every value `[DEPS1]` reads — an image reference with its digest, a model's dimension, a version no package manifest holds — is one exported constant in the package that owns the decision; every TypeScript consumer imports it, and a tier that cannot import reads the constant's source file and refuses more than one match (`apps/worker/tests/pg_harness.py` does this for `POSTGRES_IMAGE`); a copy is a second pin that ages alone. `packages/schema/src/postgres-image.ts` holds the database image and `packages/schema/src/index-tables.ts` exports `EMBEDDING_DIMENSIONS`, the vector width.

## OPS

### [OPS1] State on disk, jobs that prove themselves, staging that holds nothing

Nothing runs as root to own a volume; every stateful service is a bind mount under `/data/<service>` owned by its uid. Every scheduled job verifies its upload against the bucket, writes a `backup_run` row, and only then pings the dead-man check — with an outcome word and sizes, never a path, key, workspace or error string. Staging holds synthetic data outside a restore drill and is wiped when the drill ends. Images are deployed by digest; a compose file refuses to start without one (ADR 0022). No metrics store and no scrape: a signal and an alert are rows, in the shape ADR 0025 sets.

What holds each sentence, and how far. **The digest is fully checked**: `${API_IMAGE_DIGEST:?}` and its siblings in both compose files refuse to start without one, `apps/api/tests/deploy-tree.test.ts` asserts it, and `release.yml` matches every digest against `^sha256:[0-9a-f]{64}$` before a promotion. **Staging is fully checked**, both ways, by `deploy-tree.test.ts`: the production script carries no wipe, the staging one no special case, over `deploy/seed-synthetic.sh` and `restore-drill.sh`'s `wipe_staging`.

**Two sentences are only partly held, and the rest of each is the reviewer's.** *Nothing as root* is held for the worker alone — `apps/worker/tests/test_image.py` asserts the container's uid is the one that owns its volumes — and *a bind mount under `/data/<service>`* for the git store alone, `deploy-tree.test.ts` asserting `/data/git` on `api` and not on `migrate`; no test walks every stateful service, so `deploy/stores.compose.yaml`'s "never `user: \"0:0\"`" is a note a reviewer reads. The **backup job** is the weaker one: `apps/api/tests/backup-image.test.ts` proves the image carries the script executable, resolves every tool it runs, and schedules exactly the jobs it answers to — it does **not** read `deploy/backup.sh`'s order, so *verify, then the `backup_run` row, then the ping*, and *never a path, key, workspace or error string*, are read off `backup.sh` by a person. A test over that order would be cheap and is not written.

The last sentence is ADR 0025's shape with only its ban left here — no metrics store and no scrape — which a reviewer reads off the diff that would add one.

**Forward-only migrations and the digest rollback have left this rule**: nothing checked either half and neither is legible in a diff, so both are ADR 0022's own decision (its 2026-09-21 amendment, T-184).