---
title: A Member's tRPC Query Opens a Read-Only Transaction - Plan
type: feat
date: 2026-10-10
topic: read-only-query-road
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
origin: docs/plans/2026-10-10-0000-fix-settled-tx-refuses-plan.md
execution: code
---

# A Member's tRPC Query Opens a Read-Only Transaction - Plan

## Goal Capsule

- **Objective:** A tRPC query on the member road cannot change anything a workspace holds. A write anywhere under such a query, now or added later, fails at its own statement and leaves nothing behind.
- **Means:** `queryProcedure` resolves its member through a read-only door, the unheld resolve opened `BEGIN READ ONLY` (KTD1, KTD2).
- **Product authority:**
  - Linear BA-108 is authoritative: its five acceptance criteria are R1 to R5.
  - The owner adopted the staff review's option 2 on 10/10/2026 (BA-108's *Decision*). This plan does not reopen it.
- **Stop conditions:** stop and report to the lead if any of these holds:
  - A query procedure, a moved resolve-only caller (KTD3), or code either calls fails with SQLSTATE `25006` in the core or api suite. That is a read that writes: a finding to report, not a test to loosen.
  - The change needs `withPrincipal` renamed, the MCP surface edited, or the own-transaction road changed.
- **Execution profile:** one pull request, reversible.
- **Who finishes:** `ce-work` builds; `/ce-code-review` reviews; `ce-commit-push-pr` opens the pull request. The lead merges.

---

## Product Contract

### Summary

`queryProcedure` resolves its member through a new door, `withPrincipalRead`. It runs the same unheld resolve as `withPrincipal`, in a transaction opened `BEGIN READ ONLY`. `withPrincipal` and `withHeldPrincipal` stay read-write for their writers. The callers that only resolve a Principal move to the read door too, so the remaining read-write callers of `withPrincipal` are the ones that write, plus the own-transaction road.

### Problem Frame

tRPC sends every `.query()` over GET, and RFC 9110 §9.2.1 says a safe method's freedom from side effects is the server's job. Today that rests on review alone: `queryProcedure` runs under `withPrincipal`, which opens a read-write transaction because the MCP gate and the erasure rehearsal write inside it. BA-83's query-road probe found that no query procedure writes, so the query road can get a door of its own (origin, *Query-Road Probe*).

### Requirements

**The door and the road**

- R1. `queryProcedure` runs under a read-only door: the unheld member resolve, opened `BEGIN READ ONLY`. `withPrincipal` and `withHeldPrincipal` stay read-write. The MCP surface and the own-transaction road are unchanged.
- R2. A write inside a query procedure's transaction fails at its statement with SQLSTATE `25006`. A core test on the door shows the SQLSTATE. An api test on the road shows a writing query-road probe failing and the same body on `mutationProcedure` landing.
- R3. Every `.query()` on the member road in `apps/api/src/trpc` is built from `queryProcedure`, so none sits on a read-write resolver.

**Proof and record**

- R4. The core and api suites pass under the read door, and a mutation probe scoped to `packages/core/src/store/postgres/index.ts` pins the opening word.
- R5. ADR 0043's base-procedures sentence says a query's transaction is read-only. It is edited in the same commit as the code and named in the pull request body.

### Acceptance Examples

- AE1. **Covers R2.** **Given** an Admin's claims, **when** work under `withPrincipalRead` writes a `workspace_config` row, **then** the door rejects with code `25006`. **And** the same work under `withPrincipal` answers `{ ok: true, value: "landed" }`.
- AE2. **Covers R2.** **Given** a procedure on `queryProcedure` whose action writes, **when** a signed-in Admin asks it over GET, **then** the answer is 500, the failure is logged once with the cause's code `25006`, and no row is left. **And** the same action on `mutationProcedure`, asked over POST, answers 200 and leaves the row.
- AE3. **Covers R1.** **Given** claims a non-member holds, credentials issued before a revocation, a role the member row does not hold, or a malformed user id, **when** they reach `withPrincipalRead`, **then** it refuses with the same word `withPrincipal` gives.

### Scope Boundaries

- **Not in this package:**
  - Renaming `withPrincipal` so both modes carry their names (the owner rejected it for now, BA-108 *Decision*).
  - The person road and the operator road. `personProcedure` hands its queries the doors, so a person query stays read-only only through the core door it calls (today `withIdentityRead`). `operatorProcedure` resolves through `withOperator`, read-write (BA-109). R3's pin admits both roads; it does not make them read-only.
  - The tRPC resolver's log label, `RESOLVER = "withPrincipal"` in `apps/api/src/trpc/base.ts`. It already names the query and the mutation road alike, and `apps/api/tests/crossing.test.ts` pins it.
  - `docs/architecture/c4-dynamic-ask.md`'s transport line. `/c4-architecture` redraws it.
- **Deferred to Follow-Up Work** (filed, not built here):
  - BA-109: a read door for the operator console's four queries, which run under `withOperator`, read-write.
  - BA-110: the MCP per-tool door follows each entry's `readOnlyHint` (decision 14).
  - BA-111: a note to S2b's brainstorm on `doors: undefined` and the spend reservation.

### Sources

- Linear BA-108, its *Decision* and the staff review comment.
- The staff review: `.scratch/agents/ba-108-review.md` (machine-local), *If we build it*.
- The origin plan's *Query-Road Probe* and KTD5: `docs/plans/2026-10-10-0000-fix-settled-tx-refuses-plan.md`.
- PostgreSQL `SET TRANSACTION`: a read-only transaction refuses `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `COPY FROM` and DDL, and allows `set_config`. `SELECT … FOR SHARE` is refused, because a locking clause asks for `UPDATE` permission. The SQLSTATE is `25006`.

---

## Planning Contract

**Product Contract preservation:** BA-108's five acceptance criteria are R1 to R5, unchanged.

### Key Technical Decisions

- KTD1. **`resolveClaims` takes how it opens, as `withMemberQuery` already does.** It gains an `Opening` as its last parameter. `withPrincipal` and `withHeldPrincipal` pass `BEGIN`, and `withPrincipalRead` passes `BEGIN READ ONLY`. The read door shares `MEMBER_QUERY` with `withPrincipal`, so read-only is its own parameter, not implied by the query (origin KTD5). Governs R1.
- KTD2. **The read door is the unheld one.** `withHeldPrincipal`'s `FOR SHARE` needs a read-write transaction, so held implies read-write. The name `withPrincipalRead` follows the identity pair's `withIdentityRead`. Governs R1.
- KTD3. **The resolve-only callers move to the read door.** `workspaceNameOf`, `holds` and `/me` in `apps/api/src/auth/routes.ts`, `principalOf` in `packages/core/src/erasure/rehearsal.ts`, and `principalOfMember` in `packages/core/src/workspaces/index.ts` only resolve or read. After the move, `withPrincipal`'s callers are the writers (the MCP gate, the MCP per-entry run, the rehearsal's record) and the own-transaction road's resolve, which changes only under its own decision. The read/write split is then visible in the call graph without a rename. Governs R1.
- KTD4. **The road pin reads tRPC's own definitions, not the source text.** A procedure built on a road carries that road's middleware function in `_def.middlewares`, so a test walks `appRouter._def.procedures` and checks every query starts with the middleware of `queryProcedure`, `personProcedure` or `operatorProcedure`. A control shows a query built on `mutationProcedure` carries the mutation road's middleware, not the query road's. Governs R3.
- KTD5. **The api probe crosses as a real procedure does.** The probe's action runs through `crossing`, so a failure is logged once as `trpc.failed` with its cause, and the test reads `25006` off the logged cause. The wire answers 500 with the action's name and no code. Governs R2.

---

## Implementation Units

### U1. The read door

- **Goal:** `withPrincipalRead` resolves claims as `withPrincipal` does, in a read-only transaction.
- **Requirements:** R1, R2; AE1, AE3; KTD1, KTD2.
- **Dependencies:** none.
- **Files:**
  - Modify: `packages/core/src/store/postgres/index.ts`
  - Test: `packages/core/test/principal.test.ts`
- **Approach:** thread `opening` through `resolveClaims` into `resolveScoped`. Add the export beside `withPrincipal`, with a one-line comment in `withIdentityRead`'s shape.
- **Patterns to follow:** `withMemberUnheld` and its test "refuses a member's write at its statement".
- **Test scenarios:**
  - Covers AE1. `configProbeWritten` under `withPrincipalRead` rejects with code `25006`. The same write under `withPrincipal` lands.
  - The read door builds the Principal, groups and workspace scope included, as `withPrincipal` does.
  - Covers AE3. Each of the four refusals answers its word under the read door.
  - The read door is kept out of `DOORS` and `TOLD_APART`: their scenarios write, and a read-only member would fail them with `25006` instead.
- **Verification:** the new tests pass and `packages/core`'s full suite passes.

### U2. The query road and the resolve-only callers

- **Goal:** `queryProcedure` runs under `withPrincipalRead`, and the five resolve-only callers do too.
- **Requirements:** R1, R2, R3, R4; AE2; KTD3, KTD4, KTD5.
- **Dependencies:** U1.
- **Files:**
  - Modify: `apps/api/src/trpc/base.ts`
  - Modify: `apps/api/src/auth/routes.ts`
  - Modify: `packages/core/src/erasure/rehearsal.ts`
  - Modify: `packages/core/src/workspaces/index.ts`
  - Test: `apps/api/tests/trpc-roads.test.ts`
- **Approach:**
  1. `queryProcedure` takes `withPrincipalRead`. `inTheResolversTransaction`'s parameter type stays `typeof withPrincipal`, since the two doors share a signature.
  2. Each resolve-only caller swaps its door. `rehearsal.ts` keeps `withPrincipal` for `recordSubjectRequest`, which writes.
  3. `trpc-roads.test.ts` starts one TestApp for its new tests and shares a context builder with its database-free ones.
- **Patterns to follow:** `apps/api/tests/pending-set.test.ts` and `operator.test.ts` for reading `appRouter._def.procedures`; the file's own `refusalCrossing` for asking a probe router through `fetchRequestHandler`.
- **Test scenarios:**
  - Covers AE2. A probe on `queryProcedure` whose action writes, asked over GET as a provisioned workspace's Admin, answers 500, logs one `trpc.failed` whose cause carries `25006`, and leaves no row.
  - Covers AE2. The same action on `mutationProcedure`, asked over POST, answers 200 and leaves one row.
  - Every query in `appRouter` starts with the middleware of `queryProcedure`, `personProcedure` or `operatorProcedure`.
  - A query built on `mutationProcedure` carries the mutation road's middleware and not the query road's, so the pin can tell roads apart.
- **Verification:** `apps/api`'s full suite passes. No test anywhere fails with `25006`, which shows no query procedure and no moved caller writes.

### U3. The decision record

- **Goal:** ADR 0043 says a query's transaction is read-only.
- **Requirements:** R5.
- **Dependencies:** U2, in the same commit.
- **Files:**
  - Modify: `docs/solutions/architecture-patterns/adr-0043-what-an-act-is.md`
- **Approach:** the base procedures' query line says the member is resolved unlocked in a read-only transaction, why (GET promises no change), and why the member is read and never held. The History section gains a line naming this plan.
- **Test expectation:** none -- a decision record; the words gate reads it.
- **Verification:** `pnpm check:docs` passes.

---

## Verification Contract

| Gate | Command | Proves |
| --- | --- | --- |
| Core | `pnpm --filter @better-answers/core run check` | U1 on real Postgres; no core caller of the moved doors writes |
| Api | `pnpm check:api` | U2: no query procedure writes; the road pin |
| Gates | `pnpm check:gates` | lint, format, insert-scan, table ownership, jscpd, knip |
| Docs | `pnpm check:docs` | this plan and the ADR use no retired glossary word |
| Mutation | `pnpm mutant-probe` on the read door's `"BEGIN READ ONLY"` (R4), read by `docs/agents/mutation-triage.md`, with a positive and a negative control. A second probe on the door `queryProcedure` takes in `apps/api/src/trpc/base.ts` checks U2's road test | the opening word is pinned; the road test can tell the doors apart |

---

## Definition of Done

- R1 to R5 hold, each shown by the gate the Verification Contract names.
- `withPrincipal`'s callers in `apps/api/src` and `packages/core/src` are the MCP surface, the rehearsal's record and the own-transaction road, and nothing else.
- The pull request body names the ADR 0043 edit, says the suites are the proof that no query procedure writes, and ends with its merge-risk line and `Fixes BA-108`.
- No abandoned attempt, debug log or unused helper is left in the diff.
