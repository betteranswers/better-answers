---
status: accepted
date: 2026-09-01
---

# The tier contract is six agreements in three forms, fixtured in one language-neutral `contracts/` directory both suites read — and the read predicate is not one of the six as first written

ADR 0029 named the app↔worker contract as the risk that outlives it: six cross-tier things agreed, at the time, by two independent implementations of the same prose. This ADR settles them. **Each agreement lands in exactly one of three forms** — *SQL function* (the behaviour is the database's, both tiers call it), *fixtured* (a golden vector in `contracts/` both suites read), or *generated* (produced from one source, ADR 0028's mechanism) — and **one cross-tier conformance surface exists from before the first table: a top-level `contracts/` directory whose manifest both tiers' test suites read and assert identically**. The suite is a walking skeleton today — it proves the cross-language plumbing, the part that fails silently — and each agreement's fixtures join it as `T-003`+ makes them real. `packages/contracts` (a pnpm package the Python tier cannot read) dissolves: `Result` folds into `packages/core`'s `kernel`, and the name moves to the directory that can actually serve the seam.

| Agreement | Form | What is agreed |
| --- | --- | --- |
| queue | SQL functions | claim, lease, heartbeat, reaper, attempt count, poison threshold (`[PIPE1]`); lease-expiry fixtures test the functions |
| concept-inbox | SQL function | submitting a suggestion set is a function call; what acceptance promises is fixtured (ADRs 0005, 0012) |
| credential-envelope | fixtured | golden sealed vectors both suites decrypt byte-identically (ADR 0005) |
| visibility-columns | fixtured | the worker *writes* `published_at`, `sensitivity`, `audience` on every chunk row and graph element it lands, and `binding_id` on the source-derived ones (ADR 0023 — a canonical entity carries no binding); the predicate *logic* is app-only (below) |
| llm-routing | SQL function | one route per workspace per purpose, resolved by the database, never twice in code |
| cost-ledger | generated | the `llm_call` row type from the schema (ADR 0028); golden rows fixture its meaning (ADR 0025) |

## The read predicate leaves the contract

`T-020`'s goal text said the worker "must render \[the read predicate\] identically (`[SEC2]`)". Swept against every document (2026-09-01), that reading fails: **no described worker behaviour reads under the predicate.** `[SEC2]` scopes the predicate to `packages/core` functions; the glossary's own line — "every **consumer** reads through the same predicate" — is scoped to consumers, and the worker's runs are producers by the glossary's example list. The worker's reads are a whole-tree git checkout at a commit (ADR 0024), unfiltered platform-state rows under a workspace-scoped role, and the nightly parse cross-check — which compares hash-by-hash against *every* row and would report false mismatches under any filter. The predicate applied to that read is not merely unnecessary; it is wrong.

What is genuinely cross-tier is the **column contract**: the worker writes the three visibility terms onto everything it lands — and `binding_id` on the source-derived rows and elements, which is where ADR 0023 puts it; a canonical entity carries no binding — "so the predicate has something to test everywhere it is applied" (ADR 0023). Absent or mis-carried columns make the app's predicate silently over- or under-filter — that is the failure the fixtures guard. The "one definition, N renderers, one corpus" problem stays entirely inside `packages/core/access/`, where ADR 0029 already placed it.

## SQL functions do not contradict stores-not-code

ADR 0005's contract is "data, never code" across the tiers. A SQL function is schema: authored by the app, which owns all DDL (ADR 0007), shipped in a migration, and living *in* the shared store the way a table does. Neither tier imports the other's code to call it; each speaks SQL to the store it already speaks SQL to. The precedent for the alternative — two codebases implementing the same protocol prose — is the Dust survey's `retries.ts`: 39 lines in one repo, 115 in the other. Pushing the claim/lease/heartbeat transitions into functions makes the transition *the database's act*, not two clients' agreeing interpretation of it.

## The suite: fixtures are the contract, each tier proves its own side

"One conformance suite both CIs run" is **one fixture set, two thin runners**: `packages/core`'s vitest and the worker's pytest each read `contracts/` and assert the same expectations, so a failure lands on the side that diverged. (Today one workflow, `check.yml`, runs both tiers; the property that matters is both suites reading one directory, and it survives the CIs splitting.) A single boot-both-tiers runner was rejected: it cannot name the guilty side, couples the toolchains, and its job is done better by the ordinary integration tests that arrive with `T-003`. The fixture directory is `contracts/` at the repository root — deployed by nothing, imported by nothing, readable by anything. The word is already used with qualifiers elsewhere (**answer contract**; ADR 0007's "the schema is the contract"); the unqualified word is reserved for this seam (ADR 0029), and the directory is that seam made checkable.

## The stamp check stays strict; the redeploy window is the accepted cost

`[WRK1]` has the worker refuse to claim jobs when its schema stamp does not match `__drizzle_migrations`, and no expand/contract discipline exists anywhere in the rules — `[OPS1]` says only "migrations are forward-only". Reconciliation: **keep the strict stamp**. Deploy order is already `migrate` → `app` → `worker` (ADR 0007), the worker's data layer is generated from the app's schema and checked in CI against it, so every schema change already implies a worker image; the "outage" is the minutes of the deploy that was happening anyway, and ingestion is queued work — delayed, never lost. The narrower check (a manifest of what the worker reads, diffed per migration) buys machinery no one needs while both deploys are ours. **Reopening condition, named:** the customer-hosted worker (v1.0), whose redeploy we do not control.

## The full graph rebuild is the worker's

ADR 0023's amendment moved the incremental delta into the app's commit transaction and left the full rebuild unassigned. It is the worker's: bulk derive is the worker's listed work, and the rebuild doubles as the parse audit the worker already owns. Still not a predicate read (above).

## Considered options

- **Keep a pnpm package named `contracts`** — the worker is Python; a package it cannot read is a contract in name only, and ADR 0029 had already sentenced it.
- **A dedicated third workspace running one boot-both-tiers suite** — cannot attribute a failure to a side; a third toolchain; rejected in favour of two thin runners over one fixture set.
- **The predicate as a cross-tier renderer contract with a shared corpus** — `T-020`'s own acceptance text, rejected on the sweep above: it would conformance-test behaviour the worker does not have and, in the parse auditor's case, must not have.
- **Narrow the stamp check / adopt expand-contract migrations** — both add a mechanism or a rule to avoid a cost (a deploy-window pause of queued work) that is currently near zero; deferred behind the named reopening condition.
- **A more specific directory name (`tier-contract/`, `conformance/`)** — avoids the word's fourth use, but surrenders the reservation ADR 0029 makes; the qualified uses are qualified precisely because the bare word means this seam.

## Consequences

- Top-level `contracts/` exists: a manifest naming the six agreements and their forms, and a fixture inventory the manifest must match. `packages/core/test/tier-contract.test.ts` and `apps/worker/tests/test_tier_contract.py` assert the same expectations against it from this PR on; fixtures (envelope vectors, lease-expiry cases, golden `llm_call` rows) join as `T-003`+ lands each piece, and the SQL functions land in migrations then too.
- `packages/contracts` is deleted. `Result` (`ok`, `err`, `attempt`, `normalizeError`) moves to `packages/core/src/kernel/`, the slot its doc comment reserved; `apps/api` imports `@better-answers/core/kernel`; `apps/web` loses a dependency it never imported.
- ADR 0005's 2026-08-25 amendment (the golden vector "in `packages/contracts`") is amended here-and-there: pointer added at the stale claim; the vector's home is `contracts/envelope/`.
- ADR 0029's consequences gain skimmer pointers: the rename it ordered is enacted, and its six-item list overstates the predicate.
- ADR 0012 gains the enrichment-ordering amendment (same day, separate text): enrichment jobs read committed concepts; a run may enrich its own candidates before submitting its suggestion set.
- `CONTEXT.md` gains **lease** — the glossary already used the word undefined. `slice`-style architecture words (`agreement`, `fixture`, `conformance`) stay out (`[GLOSSARY1]`).
- `T-020`'s acceptance criteria are amended to match: the predicate line becomes the column contract; the SQL functions' landing moves to the tickets that bring their tables.
