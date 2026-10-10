---
title: The Operator Console's Queries Open a Read-Only Transaction - Plan
type: feat
date: 2026-10-10
topic: read-only-operator-queries
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
origin: docs/plans/2026-10-10-0123-feat-read-only-query-road-plan.md
execution: code
---

# The Operator Console's Queries Open a Read-Only Transaction - Plan

## Goal Capsule

- **Objective:** A read in the operator console cannot change anything. A write anywhere under a console query, now or added later, fails at its own statement and leaves nothing behind.
- **Means:** the console's queries resolve the operator through a read-only door, the operator resolve opened `BEGIN READ ONLY` (KTD1, KTD2).
- **Product authority:** Linear BA-109 is authoritative: its two acceptance criteria are R1 and R2.
- **Stop conditions:** stop and report to the lead if either holds:
  - A console query, or code it calls, fails with SQLSTATE `25006` in the core or api suite. That is a read that writes: a finding to report, not a test to loosen.
  - The change needs the member roads or the MCP surface edited.
- **Execution profile:** one pull request, reversible.
- **Who finishes:** `ce-work` builds; `/ce-code-review` reviews; `ce-commit-push-pr` opens the pull request. The lead merges.

---

## Product Contract

### Summary

The console's four queries resolve the operator through a new door, `withOperatorRead`. It runs the same operator resolve as `withOperator`, in a transaction opened `BEGIN READ ONLY`. The operator road splits in two: a query road on the read door and a mutation road on `withOperator`, which stays read-write for the console's two writers.

### Problem Frame

BA-108 made a member's tRPC query read-only, because tRPC sends a query over GET and GET promises no change. The operator console has the same GET reads, but all six of its procedures run under one road, `operatorProcedure`, on `withOperator`, which opens read-write for the two mutations. A console read's freedom from writes rests on review alone (origin, *Scope Boundaries*).

### Requirements

**The door and the road**

- R1. The console's `.query()` procedures run under an operator read door: the operator resolve, opened `BEGIN READ ONLY`. `withOperator` stays read-write, and the console's mutations stay on it.
- R5. `standingAsOperator`, which only reads, resolves through the read door too, as BA-108 moved every read-only caller of the member resolver to its read door.

**Proof**

- R2. A write inside a console query's transaction fails at its statement with SQLSTATE `25006`. A core test on the door shows the SQLSTATE. An api test on the road shows a writing probe on the query road failing and the same body on the mutation road landing.
- R3. Every console `.query()` is built on the operator query road, and a pin over the router fails a query built on the operator mutation road.
- R4. The core and api suites pass under the read door, and a mutation probe pins the door's opening word.

### Acceptance Examples

- AE1. **Covers R2.** **Given** a person with the operator mark, **when** work under `withOperatorRead` writes a row, **then** the door rejects with code `25006`. **And** the same work under `withOperator` lands.
- AE2. **Covers R2.** **Given** a procedure on the operator query road whose action writes, **when** a signed-in operator asks it over GET, **then** the answer is 500, the failure is logged once with the cause's code `25006`, and nothing is left. **And** the same action on the operator mutation road, asked over POST, answers 200 and the write lands.
- AE3. **Covers R1.** **Given** a person without the mark, credentials issued before the mark's revocation, or an id nobody holds, **when** they reach `withOperatorRead`, **then** it refuses `not-the-operator`, as `withOperator` does.

### Scope Boundaries

- **Not in this package:**
  - ADR 0043's base-procedures list. It names the query, mutation and own-transaction roads and never the operator road, and no other record in `docs/solutions/architecture-patterns/` describes the operator road's transaction. There is nothing to amend; the pull request says so.
  - The operator resolver's log label, `OPERATOR_RESOLVER = "withOperator"` in `apps/api/src/trpc/base.ts`. It names both operator roads, as `RESOLVER` names both member roads.
  - The test harness's callers of `withOperator` (`apps/api/tests/harness.ts`, `packages/core/test/platform.ts`). They write, or serve writers.

### Sources

- Linear BA-109 and its two acceptance criteria.
- The member road's plan: `docs/plans/2026-10-10-0123-feat-read-only-query-road-plan.md`, its KTD1, KTD4 and KTD5, and PR #667.
- PostgreSQL `SET TRANSACTION`: a read-only transaction refuses `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `COPY FROM` and DDL with SQLSTATE `25006`.

---

## Planning Contract

**Product Contract preservation:** BA-109's two acceptance criteria are R1 and R2; R3 and R4 carry the member road plan's pin and probe across. R5 was added on 10/10/2026 by the lead's decision on PR #670.

### Key Technical Decisions

- KTD1. **The operator resolve takes how it opens.** `withOperator`'s body moves into one private resolver whose last parameter is an `Opening`, as `resolveClaims` took one in BA-108. `withOperator` passes `BEGIN` and `withOperatorRead` passes `BEGIN READ ONLY`. One body serves both doors, so the refusal rule cannot drift between them. Governs R1.
- KTD2. **The road splits as the member road did.** One builder takes the operator door and gives `operatorQueryProcedure` on `withOperatorRead` and `operatorMutationProcedure` on `withOperator`, as `inTheResolversTransaction` gives `queryProcedure` and `mutationProcedure`. `operatorProcedure` is removed, not kept as an alias, so no new procedure can take a road that does not say which. Governs R1, R3.
- KTD3. **The road pin admits the operator query road only.** BA-108's pin in `apps/api/tests/trpc-roads.test.ts` admits `operatorProcedure`. It admits `operatorQueryProcedure` in its place, so a console query built on the mutation road fails the pin. The pin's control gains the operator pair. Governs R3.
- KTD4. **The api probe writes what the operator can land with no workspace scope.** The operator's transaction carries no workspace, so a `workspace_config` row, which the member probe writes, would be refused by its policy on the mutation road too. The probe writes a row the operator road reaches with no scope, and the superuser reads it after. The probe crosses through `crossing`, so the failure is logged once as `trpc.failed` with its cause, as the member road's probe does. Governs R2.

---

## Implementation Units

### U1. The operator read door

- **Goal:** `withOperatorRead` resolves the operator as `withOperator` does, in a read-only transaction.
- **Requirements:** R1, R2; AE1, AE3; KTD1.
- **Dependencies:** none.
- **Files:**
  - Modify: `packages/core/src/store/postgres/index.ts`
  - Test: `packages/core/test/principal.test.ts`
- **Approach:** the private resolver holds the current body, with `opening` passed to `transaction` and the refusal predicate kept. Export `withOperatorRead` beside `withOperator`, with a one-line comment in `withIdentityRead`'s shape.
- **Patterns to follow:** `withPrincipalRead` and its tests "refuses a write under resolved claims at its statement" and "builds the Principal in %s's own transaction".
- **Test scenarios:**
  - Covers AE1. An identity-set audit row written under `withOperatorRead` rejects with code `25006`. The same write under `withOperator` lands.
  - Under each door, a marked person resolves to the operator, in no workspace.
  - Covers AE3. Under each door, a person without the mark, credentials issued before the revocation, and an id nobody holds are each refused `not-the-operator`.
- **Verification:** the new tests pass and `packages/core`'s full suite passes.

### U2. The operator roads and the console

- **Goal:** the console's queries run on the operator query road and its mutations on the operator mutation road.
- **Requirements:** R1, R2, R3, R4; AE2; KTD2, KTD3, KTD4.
- **Dependencies:** U1.
- **Files:**
  - Modify: `apps/api/src/trpc/base.ts`
  - Modify: `apps/api/src/trpc/console.ts`
  - Modify: `apps/api/tests/operator.test.ts`
  - Test: `apps/api/tests/trpc-roads.test.ts`
- **Approach:**
  1. `base.ts` builds both operator roads from one builder (KTD2).
  2. `console.ts`'s four `.query()` procedures take `operatorQueryProcedure` and its two `.mutation()` procedures take `operatorMutationProcedure`.
  3. `operator.test.ts`'s context type reads the operator query road; both roads hand the action the same context.
  4. `trpc-roads.test.ts` gains the operator probe router beside the member one, signed in as a provisioned Admin given the mark.
- **Patterns to follow:** `writingRoads` and `askedAsAnAdmin` in `apps/api/tests/trpc-roads.test.ts`; `theOperatorOnTheWeb` in `apps/api/tests/operator.test.ts` for giving the mark.
- **Test scenarios:**
  - Covers AE2. A probe on the operator query road whose action writes, asked over GET as the operator, answers 500, logs one `trpc.failed` whose cause carries `25006`, and leaves nothing.
  - Covers AE2. The same action on the operator mutation road, asked over POST, answers 200 and its write lands.
  - Every query in `appRouter` starts with the middleware of `queryProcedure`, `personProcedure` or `operatorQueryProcedure`.
  - A query built on `operatorMutationProcedure` carries that road's middleware and not the operator query road's.
- **Verification:** `apps/api`'s full suite passes, the console suites included. No test fails with `25006`, which shows no console query writes.

---

## Verification Contract

| Gate | Command | Proves |
| --- | --- | --- |
| Core | `pnpm --filter @better-answers/core run check` | U1 on real Postgres |
| Api | `pnpm check:api` | U2: no console query writes; the road pin |
| Gates | `pnpm check:gates` | lint, format, jscpd, knip (the removed `operatorProcedure` leaves no reference) |
| Docs | `pnpm check:docs` | this plan uses no retired glossary word |
| Mutation | `pnpm mutant-probe` on `withOperatorRead`'s `"BEGIN READ ONLY"`, and on the door `operatorQueryProcedure` takes in `apps/api/src/trpc/base.ts`, read by `docs/agents/mutation-triage.md` with a positive and a negative control | the opening word is pinned; the road test tells the doors apart |

---

## Definition of Done

- R1 to R5 hold, each shown by the gate the Verification Contract names; R5 rests on the suites, since no test observes the opening of a transaction whose work only reads.
- `withOperatorRead`'s callers in `apps/api/src` and `packages/core/src` are the operator query road and `standingAsOperator`.
- The pull request body says ADR 0043 is unchanged and why, says the suites are the proof that no console query writes, and ends with its merge-risk line and `Fixes BA-109`.
- No abandoned attempt, debug log or unused helper is left in the diff.
