---
title: An MCP Entry's Transaction Opens as Its Read-Only Hint Declares - Plan
type: feat
date: 2026-10-10
topic: mcp-entry-read-only-door
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
origin: docs/plans/2026-10-10-0123-feat-read-only-query-road-plan.md
execution: code
---

# An MCP Entry's Transaction Opens as Its Read-Only Hint Declares - Plan

## Goal Capsule

- **Objective:** An MCP entry that tells the assistant it only reads runs in a transaction that cannot change anything. A write on that transaction, now or added later, fails at its own statement and leaves nothing behind.
- **Means:** the MCP surface opens each entry's transaction through the door its `readOnlyHint` names: the read-only member resolve where the entry declares the hint, the read-write one otherwise (KTD1, KTD2).
- **Product authority:** Linear BA-110 is authoritative. The owner ruled on 10/10/2026, in the issue's comment, that the MCP road changes. That ruling is the decision that decision 14 of `docs/plans/2026-10-08-2311-docs-architecture-review-before-s2-plan.md` asks for.
- **Stop conditions:** stop and report to the lead if either holds:
  - One of the four entries, or code it calls, fails with SQLSTATE `25006` in the api suite. That is a read that writes: a finding to report, not a test to loosen.
  - The change needs `packages/core`, the tRPC roads or the surface's no-bearer rate check edited.
- **Execution profile:** one pull request, reversible.
- **Who finishes:** `ce-work` builds; `/ce-code-review` reviews; `ce-commit-push-pr` opens the pull request. The lead merges.

---

## Product Contract

### Summary

The MCP surface runs each entry in a transaction of its own. That transaction now opens through `withPrincipalRead` when the entry's annotations declare `readOnlyHint: true`, and through `withPrincipal` when they do not. `find`, `ask` and `open` declare the hint; `give_feedback` declares it false. The gate that counts a call before any entry runs keeps its own read-write transaction, because the count is a write. The rule covers the entry's transaction and nothing wider: a write the surface makes in a transaction of its own, which today is the gate's count alone, sits outside it.

### Problem Frame

An entry's `readOnlyHint` is a promise to the assistant's host, which splits read tools from write tools on it and may run a read tool without asking the person. Three of the four entries make that promise, and every entry runs under `withPrincipal`, read-write. So the promise rests on review alone. BA-108 closed the same gap for a member's tRPC query and BA-109 for the operator console's (origin, *Scope Boundaries*); the staff review behind BA-108 named the MCP surface as the third.

### Requirements

**The door**

- R1. Each entry's transaction opens as its `readOnlyHint` declares: read-only where the entry declares the hint, read-write where it does not. The gate's transaction, which counts the call, stays read-write.

**Proof**

- R2. A write inside the transaction of an entry that declares the hint fails at its statement with SQLSTATE `25006`, shown through the surface itself. The same body under an entry that declares the hint false lands.
- R3. A test pins every entry's hint to its door. It walks the entries the surface is composed with, so an entry added later is walked too, and an entry that declares the hint and writes fails.
- R4. The api suite passes with the three reading entries on the read door, and a mutation probe pins the choice of door.

**The record**

- R5. The decision is recorded in `docs/solutions/architecture-patterns/` in the same commit as the change, and the pull request names each record it edits.

### Acceptance Examples

- AE1. **Covers R2.** **Given** an entry that declares `readOnlyHint: true` and whose action writes a row, **when** an assistant holding a member's token calls it, **then** the call answers a tool error, the failure is logged once as `mcp.failed` with the cause's code `25006`, and no row is left. **And** the same action under an entry that declares `readOnlyHint: false` answers its result and the row lands.
- AE2. **Covers R3.** **Given** the four entries the server composes, each with a writing action put in place of its own, **when** each is called, **then** `find`, `ask` and `open` fail with `25006` and `give_feedback` lands.
- AE3. **Covers R1.** **Given** a member's token, **when** it calls `find`, `ask`, `open` and `give_feedback` as they are, **then** each answers as it did before this change.

### Scope Boundaries

- **Not in this package:**
  - Holding the member's rows under a writing entry. A tRPC mutation reads the member `FOR SHARE`; a writing entry's door stays `withPrincipal`, which reads the member and does not hold it. Whether an MCP write should hold the rows is its own decision, named for the owner in the pull request's report.
  - Where S2b's `ask` records an answer or reserves spend. `ask` declares the hint and reads only today. When S2b gives it a write, that write opens a transaction of its own or `ask` stops declaring the hint. BA-111 carries the tRPC half of that note, and the build adds the MCP half to it (Definition of Done).
  - A rename of `withPrincipal`, and any change to `packages/core`. Both doors exist.
  - The surface's no-bearer rate check, which BA-113 may edit.
  - `docs/architecture/c4-dynamic-ask.md`'s transport line, which names the MCP surface's `withPrincipal` for `ask`. This change makes that false for an entry that declares the hint. `/c4-architecture` redraws it, as the origin left the same line, and the pull request's report names it.

### Sources

- Linear BA-110, its acceptance criteria and the owner's ruling of 10/10/2026.
- The staff review behind BA-108, *Effect on the MCP surface* and option 3 of its table (machine-local).
- The member road's plan (origin), its KTD1, KTD4 and KTD5, and PR #667; the operator road's plan, `docs/plans/2026-10-10-0227-feat-read-only-operator-queries-plan.md`, and PR #670.
- The MCP specification, tool annotations: `readOnlyHint` defaults to false when absent.
- PostgreSQL `SET TRANSACTION`: a read-only transaction refuses `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `COPY FROM` and DDL with SQLSTATE `25006`.

---

## Planning Contract

**Product Contract preservation:** BA-110's second acceptance criterion is R1, R2 and R3. Its first, the owner's decision, was met by the ruling and is recorded by R5. R4 carries the member road plan's suite and probe across.

### Key Technical Decisions

- KTD1. **The door is derived from the hint, never declared beside it.** One exported function in `apps/api/src/mcp/surface.ts` answers the door an entry's transaction opens through, read from the entry's annotations. A `door` field on the entry would be a second statement of the same fact, and a pin over it would only check that two hand-written values agree. Governs R1, R3.
- KTD2. **Only a declared `true` opens read-only.** The MCP specification reads an absent `readOnlyHint` as false, so the host treats such a tool as a writer and the surface gives it the read-write door. The lint rule `mcp-entry-annotations` already refuses an entry with no `readOnlyHint`, so the absent case is not reachable from `apps/api/src/mcp/entries`. Governs R1.
- KTD3. **The entries are a dependency of the surface, composed in `apps/api/src/server.ts`.** `createMcpSurface` builds its entries inside itself today, so no test can put a writing entry through it, and none of the four real entries writes. `McpSurfaceDependencies` gains a required `entries`, and the server passes `entriesAt(dependencies.publicUrl)`. The server then names what the surface mounts, as it names the surface's door, verifier and clock. Governs R2, R3.
- KTD4. **The proof runs through the surface, with the bearer check stubbed and everything behind it real.** The test builds `createMcpSurface` over the suite's own Postgres door with a verifier that answers a provisioned Admin's claims. The gate's count, the member resolve, the SDK's handler, the crossing and the entry's transaction are the production ones. The probe's action writes a `workspace_config` row through `configProbeWritten`, as the member road's probe does, and the superuser reads it after. Governs R2, R3.
- KTD5. **The pin swaps each real entry's action for the writing one and keeps its name, scopes and annotations.** No real entry writes, so its own action cannot tell the doors apart. With the writing action in its place, the entry's own hint decides the outcome. The swap replaces the entry's input, output, action and rendering together, because the SDK checks a call's arguments against the input schema before the action runs and its answer against the output schema after: the input becomes an empty object and the output the writing action's own answer. The walk is checked against a literal table of the four names and outcomes, so it cannot pass over an empty set, and a fifth entry fails the table until its row is written down. Governs R3.
- KTD6. **Two records move.** `adr-0030-mcp-surface-stays-mcp-sdk-v2.md` is the record of how the surface runs an entry, so the rule lands in its decision. `adr-0043-what-an-act-is.md` lists what each transport's transaction is, and its history says an MCP entry's resolver stays read-write, which this change makes false; its transports list gains the MCP sentence and its history a dated line. `docs/archive/` is not edited. Governs R5.

### Assumptions

- The gate's transaction stays as it is: `consumeCall` upserts the call counter, so it cannot open read-only.
- An entry is handed a Principal, a transaction, its arguments and the time, and no door, and `entriesAt` is handed the origin alone. So no entry holds a door to open a second transaction through, and the door the surface picks is the only one an entry's statements reach. A type test in U1 holds both facts, so a door handed to an entry fails it.

---

## Implementation Units

### U1. The surface opens each entry through its hint's door

- **Goal:** an entry that declares `readOnlyHint: true` runs under `withPrincipalRead`, any other under `withPrincipal`, and a test can compose the surface with entries of its own.
- **Requirements:** R1, R2, R3; AE1, AE2, AE3; KTD1 to KTD5.
- **Dependencies:** none.
- **Files:**
  - Modify: `apps/api/src/mcp/surface.ts`
  - Modify: `apps/api/src/server.ts`
  - Test: `apps/api/tests/mcp-doors.test.ts` (new)
- **Approach:**
  1. `surface.ts` exports the derivation (KTD1, KTD2), typed as `typeof withPrincipal`, the way `inTheResolversTransaction` in `apps/api/src/trpc/base.ts` types the resolver it is given. The tool handler opens the entry's transaction through it. The gate keeps `withPrincipal`.
  2. `McpSurfaceDependencies` gains `entries`; `createMcpSurface` reads it; `server.ts` passes `entriesAt(dependencies.publicUrl)` (KTD3).
  3. The edits in `surface.ts` stay in the dependencies type, the tool handler and the one line that builds the entries. The no-bearer rate check is not touched.
  4. The new test file holds the surface probe and the pin (KTD4, KTD5). It is a file of its own because `apps/api/tests/mcp-surface.test.ts` is long and its helpers would be cloned.
- **Patterns to follow:** `writingRoads` and `askedAsAnAdmin` in `apps/api/tests/trpc-roads.test.ts` for the probe's shape and its `failedLine` reading of the log; `callMcp` in `apps/api/tests/mcp-call.ts` for the call; `bearerOf` in `apps/api/src/auth/verify.ts` for what the stub verifier's `extra` must hold (`tokenId`, and `claims` whose `issuedAt` is a `Date`). The SDK's `verifyBearerToken` also wants the stub's answer to carry both MCP scopes, so `give_feedback` is registered, and an `expiresAt` in future seconds.
- **Test scenarios:**
  - Covers AE1. A probe entry that declares `readOnlyHint: true` and writes, called through the surface as a workspace's Admin, answers a tool error reading `probe failed.`, logs one `mcp.failed` whose cause carries `25006`, and leaves no row.
  - Covers AE1. The same action under a probe entry that declares `readOnlyHint: false` answers `landed` and leaves one row.
  - Covers AE2. Each of the server's entries, its action swapped for the writing one, answers by its own hint: `find`, `ask` and `open` fail with `25006` and leave nothing; `give_feedback` lands. The names and outcomes are a literal table.
  - The derivation answers `withPrincipalRead` for a declared `true`, and `withPrincipal` for a declared `false` and for annotations with no hint.
  - A type test, in the form of "keeps every door from a procedure inside the resolver's transaction" in `apps/api/tests/trpc-roads.test.ts`: an entry's action takes a Principal, a transaction, its arguments and the time, and `entriesAt` takes the origin alone.
- **Verification:** the new tests pass, and `apps/api`'s full suite passes with `find`, `ask` and `open` on the read door (AE3). No existing test fails with `25006`, which shows none of the three writes.

### U2. The decision's records

- **Goal:** the two records say an entry's transaction opens as its hint declares.
- **Requirements:** R5; KTD6.
- **Dependencies:** U1, in the same commit.
- **Files:**
  - Modify: `docs/solutions/architecture-patterns/adr-0030-mcp-surface-stays-mcp-sdk-v2.md`
  - Modify: `docs/solutions/architecture-patterns/adr-0043-what-an-act-is.md`
- **Approach:** ADR 0030's seam bullet gains the rule and its history a dated line naming the owner's ruling, BA-110 and this plan. ADR 0043's list under *A transport never nests a transaction* gains the MCP entry's sentence, and its history gains a dated line that says which part of the 10/10/2026 amendment no longer holds.
- **Test expectation:** none; prose only. `pnpm check:docs` reads both files.
- **Verification:** `pnpm check:docs` passes.

---

## Verification Contract

| Gate | Command | Proves |
| --- | --- | --- |
| Core | `pnpm --filter @better-answers/core run check` | the two doors, unchanged, on real Postgres |
| Api | `pnpm check:api` | U1: the probe, the pin, and no reading entry writes |
| Gates | `pnpm check:gates` | lint, format, jscpd, knip |
| Docs | `pnpm check:docs` | this plan and the two records use no retired glossary word |
| Mutation | `pnpm mutant-probe`, read by `docs/agents/mutation-triage.md`: the derivation answering `withPrincipal` always, the same line answering `withPrincipalRead` always, and the tool handler opening through `withPrincipal` directly; the three are each other's positive controls, each killed by a test in `apps/api/tests/mcp-doors.test.ts` that is named before its verdict is written; the negative control rewords the `mcp request` log message in the same file, which no test reads, and survives the whole api suite | the choice of door is pinned both ways, and the handler cannot bypass it |

---

## Definition of Done

- R1 to R5 hold, each shown by the gate the Verification Contract names.
- `withPrincipal`'s callers in `apps/api/src/mcp` are the gate and the derivation.
- The pull request body names both records it edits, says the suite is the proof that no reading entry writes, and ends with its merge-risk line and `Fixes BA-110`.
- BA-111 carries a comment with the MCP half of its note: after BA-110 `ask`'s transaction on the MCP surface is read-only, so its line that `withPrincipal` stays read-write for `ask` no longer holds there, and S2b states where the record step's and the spend reservation's transaction opens on MCP, or has `ask` stop declaring the hint.
- The report to the lead names two things for the owner: whether a writing entry should hold the member's rows, and the `c4-dynamic-ask.md` line `/c4-architecture` is to redraw.
- No abandoned attempt, debug log or unused helper is left in the diff.
