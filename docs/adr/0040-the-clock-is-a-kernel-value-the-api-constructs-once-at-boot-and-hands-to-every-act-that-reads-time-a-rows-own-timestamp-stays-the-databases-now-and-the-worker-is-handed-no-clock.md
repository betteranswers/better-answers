---
status: accepted
date: 2026-09-08
---

# The Clock is a kernel value the api constructs once at boot and hands to every act that reads time; a row's own timestamp stays the database's `now()`, and the worker is handed no Clock

**Where this came from.** T-009's mutation retro (candidate 6) found two of `open`'s shelf-life
mutants surviving in `packages/core/src/answering/index.ts` for the same reason: the boundary
comparison read `new Date()` from inside the function under test, so no test could hold the
instant still at either side of it. A sweep of the app tier for `new Date()` and `Date.now()`
found six more ambient reads beside it: the concept index row's `publishedAt`, an invitation's
expiry, the git door's commit instant, and two defaulted `now: Date = new Date()` parameters on
the Postgres door's rate-limit counters. Every one is the same shape — a function reaching
for the wall clock itself rather than being handed the instant — and this record closes all of
them the same way.

**The shape.** One `Clock` — `{ readonly now: () => Date }` — lives in the kernel
(`packages/core/src/kernel/clock.ts`), because every slice may import the kernel and a clock is
vocabulary every slice needs, exactly as `Result` and the branded ids are (ADR 0029 rule 1). Its
one real constructor, `systemClock()`, is also the one place either tier's `src` may write
`new Date()` or `Date.now()` with nothing handed to it — the ambient read is not abolished, it
is moved to a single, named, ADR-cited spot the gate below can see. The api builds one
`systemClock()` per process, in `apps/api/src/main.ts` (the long-running server) and again in
`apps/api/src/ops.ts` (the one-shot restore/drill process, which cannot share the server's), and
that single value is threaded down through `ServerDependencies`, `ReconcilerDependencies` and
the ops commands' `OpsIo` to everything that reads time under them.

**Not a fifth door.** ADR 0029's doors are the four shared stores a workspace's data lives in;
a clock holds no data and is not one of them, so it is a plain kernel value with its own file,
never exported from `@better-answers/core/store` and never threaded through `store/`'s own
argument shape.

**Not a defaulted parameter, either.** `now: Date = new Date()` still reads the ambient clock —
from inside the function it defaults on — the moment a caller forgets to pass one; a default is
an ambient read wearing a signature, which is exactly what this record refuses. Every site named
below now takes its time explicitly and without a default.

**The six sites, and the two shapes.** `[DESIGN1]`'s question — design for the small interface —
answers each site itself, using the rule an act that reads an instant once may take the `Date`
a caller already read, while an act that hands the reading on to more than one call of its own
takes the `Clock` and reads it itself:

- `answering/index.ts`'s `open` and `find` each take a trailing `now: Date`: one instant, read
  once by the caller, spent on one call to `trustOf` (or, for `find`, the same instant shared
  across a batch of hits — a read the code already made once before this record and keeps
  making once).
- `members/requests.ts`'s `approveRequest` takes a trailing `now: Date` for the invitation's
  `expiresAt`, the same shape.
- `store/git/index.ts`'s `CommitRequest.at` becomes a required `Date` (no longer `at?: Date`):
  a plain field on a plain request, so `Date` and not `Clock` is the only sensible shape.
- `store/postgres/index.ts`'s `consumeIngress` and `consumeCall` lose their `now: Date = new
  Date()` defaults; both already took `now` as a plain `Date`, and only the default was the
  ambient read.
- `concepts/index.ts`'s `writeConcept` and `concepts/reconciler.ts`'s `reconcileEveryWorkspace`
  / `reconcile` / `replayCommit` take `clock: Clock` inside the `{ git, postgres }` dependencies
  object every one of them already takes, alongside the two doors. `writeConcept` reads
  `doors.clock.now()` once and hands the same `Date` to both the row's `indexRowOf` and the
  commit's `at`, so a concept's first `published_at` and its commit's author/committer dates
  never disagree about when the act happened. The reconciler's replay reads `doors.clock.now()`
  once **per replayed commit**, inside `replayCommit`'s own transaction — a batch replaying
  several missed commits in one tick recovers each at its own landing instant, matching the
  ambient behaviour it replaces (a fresh `new Date()` per `indexRowOf` call) rather than
  collapsing a whole tick onto one shared guess.

**Scope: only what the app tier decides in code.** The Clock is read at exactly the four
call-sites above that already existed before this record — `open`'s trust reading, a newly
published concept's `published_at`, an invitation's `expiresAt`, and the git door's commit
instant — plus the two Postgres counters' window arithmetic, which read time but decide
nothing a person is shown. **A row's own timestamp is never the Clock's.** The audit ledger's
`audit_event` rows, `bundle_commit`'s rows, and the worker's job queue (`job.claimed_at`,
`job.heartbeat_at`, the finish columns `schema_view.py` names) all keep the database's own
`now()`, because a row is a fact about when the store committed it, not about when the api
asked — moving them onto the api's Clock would let a store's own transaction time and the
process's wall clock disagree about the same row, which is a bug this record is not trading for
a symmetry nobody asked for. `revokeCredentials` (`packages/core/src/workspaces/index.ts`)
already took its `at: Date` explicitly before this ticket, for the same reason `open` now does;
this record generalises a pattern the codebase had already found once, not invents it.

**The worker reads no wall clock and is handed no Clock.** `apps/worker` (Python) has exactly
one clock-shaped read, the ULID minter's (`packages/schema/src/ulid.ts`, re-exported through
the kernel as `ulid` — ADR 0035), and that read orders an id; it decides nothing the way
`open`'s shelf-life comparison or an invitation's expiry does. Handing the worker a Clock would
invite exactly the ambient time-based decision this record closes off in the app tier, in the
one tier that has no test harness built to pin one (`[TEST1]`'s worker seam is the job or module
entry point, not a dependency-injected clock). The worker stays outside this record entirely.

**How a test pins it.** A site typed `now: Date` is pinned with a literal `Date` — no kernel
export, no object, a value the test writes down (`[TEST9]`): `open(principal, tx, { iri }, new
Date("2026-03-02T00:00:00.000Z"))`. A site typed `clock: Clock` is pinned with a literal object
a test writes inline, `{ now: () => new Date("...") }`, never a second kernel export — a fixed
clock is a fixture, not vocabulary every caller needs, so it does not belong beside
`systemClock` in `kernel/clock.ts`. Two tests in `packages/core/test/concepts.test.ts` pin the
exact boundary each of the two shelf-life comparisons makes — the calendar-date form's
`midnight + ONE_DAY_MS <= now` and the offset-datetime form's `instant < now` — a millisecond
either side of the instant that decides them, which a real clock can only ever be on one side of
by accident.

**The gate.** `packages/core/src` and `apps/api/src` carry no `new Date()` or `Date.now()`
outside `kernel/clock.ts`. The natural rule — an oxlint `no-restricted-syntax` override on
`NewExpression[callee.name="Date"][arguments.length=0]` and
`CallExpression[callee.object.name="Date"][callee.property.name="now"]` — is not this
repository's, because oxlint 1.80.0, the version pinned here, ships no `no-restricted-syntax`
rule at all (absent from `node_modules/oxlint/configuration_schema.json`, checked
2026-09-08). `apps/api/tests/no-ambient-clock.test.ts` is the named fallback: a scan over both
patterns with its own positive and negative cases, proved on the scanner itself before it is
trusted over the real tree, then run over every `.ts` file under both directories except the
kernel's own constructor.

We decided this because a value every slice may already import is where the kernel's own rule
says shared vocabulary goes (ADR 0029 rule 1), and a clock is exactly that; because the
smallest-interface question has a different answer at different sites and forcing one shape
everywhere would make four of the six sites carry a `Clock` they call `.now()` on exactly once,
which is the larger interface `[DESIGN1]` asks us not to prefer; because a row's timestamp is a
store fact and conflating it with the api's own clock is the bug ADR 0012's transaction-scoped
writes were built to avoid, not a feature; and because the worker's one time-shaped read already
has a name and a reason — the minter orders an id — that a second, decision-shaped reading would
blur.

## Considered options

- **A defaulted `now: Date = new Date()` everywhere**, kept rather than removed. Rejected: a
  default still reads the clock, from inside the function it defaults on, the moment a caller
  omits the argument — the exact ambient read this record exists to close off, wearing a
  signature that makes it look explicit.
- **A fifth door, `store/clock/`.** Rejected: ADR 0029's doors are the four stores a
  workspace's data lives in; a clock holds no tenant data and answers to no `Principal`, so
  filing it beside `postgres/`, `git/`, `graph/` and `objects/` would teach the next reader that
  a door is "a thing every act takes" rather than what the tree says it is.
- **One process-wide mutable clock, monkey-patched in tests.** Rejected twice over: `[TEST3]`
  bans mocking our own code, and a shared mutable global is the same ambient state this record
  refuses in `new Date()`, moved rather than removed.
- **`Clock` at every one of the six sites, none of them a bare `Date`.** Rejected by
  `[DESIGN1]`: `open`, `find`, `approveRequest` and `CommitRequest.at` each read one instant and
  spend it once or hand it to one sub-call; a `Clock` there is a bigger interface a caller has
  to construct or fake for no reading it would not otherwise have handed over directly.
- **Handing the worker a Clock, for symmetry with the app tier.** Rejected: the worker's one
  clock-shaped read already has a job — the minter orders an id, a job neither `open`'s trust
  reading nor an invitation's expiry is doing — and a Clock the worker could reach for would
  invite the ambient time-based decision this record is closing off in the tier that has one.

## Consequences

- `packages/core/src/kernel/clock.ts` is new, exporting `Clock` and `systemClock`; re-exported
  from `kernel/index.ts` in the docblock's own style, dated to this ticket.
- `open`, `find`, `approveRequest` gain a trailing `now: Date`; `CommitRequest.at` is required;
  `consumeIngress` and `consumeCall` lose their defaults; `writeConcept`,
  `reconcileEveryWorkspace`, `reconcile` and `replayCommit`'s `doors` gain `readonly clock:
  Clock`. Every direct and test caller of the eight was updated in the same commit as the
  signatures, found exhaustively by `tsc`'s own "expected N arguments" and "property missing"
  errors rather than by search.
- `apps/api/src/server.ts`'s `ServerDependencies`, `apps/api/src/reconciler.ts`'s
  `ReconcilerDependencies`, `apps/api/src/ops/index.ts`'s `OpsIo`, `apps/api/src/mcp/surface.ts`'s
  `McpSurfaceDependencies`, `apps/api/src/auth/routes.ts`'s `AuthRoutesDependencies` and
  `apps/api/src/trpc/mount.ts`'s `TrpcRoutesDependencies` each gain a `clock: Clock` field,
  threaded from the one `systemClock()` `main.ts` or `ops.ts` constructs; `ingress/limits.ts`'s
  `limitByIp` and `auth/routes.ts`'s `limitCodesByEmail` take a `Clock` and read it inside the
  request handler they return, not at the point they are mounted. The MCP surface's `Entry`
  type (`mcp/entries/define.ts`) gains a trailing `now: Date` on `run`, read once per call by
  `mcp/surface.ts` and handed to the two entries (`find`, `open`) that use it; the other two
  entries' `run` implementations do not name the parameter, which TypeScript's own structural
  typing allows.
- `apps/api/tests/harness.ts`'s `TestAppOptions` gains an optional `clock`, defaulting to
  `systemClock()`; a test that needs to pin the api's own clock through the HTTP surface passes
  its own.
- `apps/api/tests/no-ambient-clock.test.ts` is the gate this record's own text depends on
  staying true; it is not an oxlint rule, for the reason given above, and is read as this
  ADR's evidence that no site was missed.
- `CONTEXT.md` gains nothing: *Clock* is an architecture word for the same reason ADR 0029
  found *kernel*, *access* and *slice* were — a reader of the product never sees the word, only
  the words it produces (*shelf life*, *Checked by … · date*, *map as of now*), and every one of
  those entries stands unedited.
- Cites ADR 0029 (the kernel's import rule, the doors this is not a fifth of) and ADR 0019 (the
  shelf-life comparison the gate now lets a test hold still); reopens nothing in ADRs 0001–0039.
