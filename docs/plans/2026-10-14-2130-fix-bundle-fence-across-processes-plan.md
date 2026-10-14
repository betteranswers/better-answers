---
title: Fence the Bundle Across Processes - Plan
type: fix
date: 2026-10-14
topic: bundle-fence-across-processes
artifact_contract: ce-unified-plan/v1
product_contract_source: linear:BA-175
execution: code
---

# Fence the Bundle Across Processes - Plan

## Goal Capsule

- **Objective:** A history rewrite and the writes beside it cannot interleave in any process. A reconciler tick or another member's commit no longer straddles an erasure's `filter-repo` pass, so none of them leaves a row naming a pruned commit or the erased person, and no write is lost to the rewrite.
- **Means:** A Postgres advisory lock per workspace, taken after the in-process queue and before any transaction. Every git write and the reconciler take it shared, and erasure's rewrite takes it exclusive (KTD1 to KTD4).
- **Authority:** Linear BA-175 and the owner's ruling of 14/10/2026 in its comments: option B with a cap per process, the reconciler skipping, the lock order, and the key.
- **Stop conditions:** Stop and report if the design needs a migration or a `contracts/` change.
- **Execution profile:** One pull request, cut from BA-176's branch (#743), with no migration.
- **Who finishes:** This session builds and opens the pull request, and the orchestrator reviews and arms it.
- **Open blockers:** The ADR 0012 wording is the owner's proposal to rule on (U2).

## Product Contract

### Requirements

- R1. A member's concept write, manifest write and suggestion acceptance wait while a history rewrite in another process holds the workspace's bundle.
- R2. A history rewrite waits for every write and reconciler pass under way on that workspace, in any process.
- R3. A reconciler tick answers `held` at once while a rewrite holds the bundle, and the next tick catches up.
- R4. One process never holds more fence locks at once than a cap below its pool size, so the pool is never exhausted and nothing deadlocks.
- R5. The order everywhere is fence, then transaction, then row. A waiter on the fence holds no row.

### Scope Boundaries

- A suggestion's decline makes no git write, so it keeps the in-process lock alone.
- The api's reconciler tick logs a `held` workspace among its refusals, at warn. A quieter line is a follow-up if it proves noisy.

## Key Technical Decisions

- KTD1. **Session advisory lock, two-integer key.** `hashtext('bundle'), hashtext(<workspace id>)`, on its own connection, released when the work settles. A write spans more than one transaction, so a transaction-scoped lock cannot cover it. The two-integer form cannot collide with the single-integer keys 41 and 42.
- KTD2. **The cap is three holders per pool.** A holder pins its fence connection and opens one more for its work, so three holders use six of the api's ten (`POSTGRES_POOL_MAX`) and leave four for every other query, the sweep's session lock included. Without a cap, as many holders as the pool has connections would each wait for their second connection for ever (the cap test shows this). The assumption: fenced work holds one transaction at a time.
- KTD3. **The cap waits before any connection is taken**, so a waiter holds nothing.
- KTD4. **The fence lives in the concepts slice (`concepts/fence.ts`)**, because ADR 0029 lets a store import only the kernel. The Postgres store owns the lock and the cap, and the git store owns the in-process queue.

## Implementation Units

### U1. The fence

- **Requirements:** R1 to R5.
- **Files:**
  - Modify: `packages/core/src/store/postgres/index.ts`, `packages/core/src/concepts/index.ts`, `packages/core/src/concepts/manifest.ts`, `packages/core/src/concepts/reconciler.ts`, `packages/core/src/concepts/vocabulary.ts`, `packages/core/src/erasure/routine.ts`
  - Create: `packages/core/src/concepts/fence.ts`
  - Test: `packages/core/test/bundle-fence.test.ts`, `packages/core/test/bundle-fence.ts`, `packages/core/test/erasure-routine.test.ts`, `packages/core/test/reconciler.test.ts`, `packages/core/test/refusal-words.test.ts`
- **Test scenarios:**
  - A rewrite waits for another process's write, then both land, and the reconciler finds nothing to replay. Before the fence, the rewrite's `filter-repo` failed against the write.
  - A member's write waits while another process rewrites the bundle.
  - A reconciler tick skips a bundle another process is rewriting.
  - Twelve concurrent fence holders on a pool of four never exceed three at once, and none deadlocks. Without the cap, the test times out.

### U2. Decision doc (owner's proposal)

- **Requirements:** R1 to R4.
- **Files:** `docs/solutions/architecture-patterns/adr-0012-the-concept-write-path.md`, a new bullet after line 29 that says what the lock is, who holds it and how, and the cap. The wording is a proposal for the owner.
