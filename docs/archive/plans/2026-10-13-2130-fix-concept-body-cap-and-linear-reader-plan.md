---
title: Concept Body Cap and Linear Reader, with the Index Retry - Plan
type: fix
date: 2026-10-13
topic: concept-body-cap-and-linear-reader
artifact_contract: ce-unified-plan/v1
product_contract_source: linear:BA-92+BA-55
execution: code
---

# Concept Body Cap and Linear Reader, with the Index Retry - Plan

## Goal Capsule

- **Objective:** A concept body that would break the row or the reader is refused before its write commits to git; the reader that walks a body is linear in both tiers whatever the body holds; and a failed index job runs again without anyone touching the source, naming the document that failed it.
- **Means:** Cap the body at the write's boundary plus a CHECK (the owner's ruling of 10/10/2026), replace the four regular expressions both tiers read a body with (and the map store's per-link sentence flattening) with hand-written linear scanners held to `contracts/links`, and make `fail_job` requeue a job until its bound instead of ending it.
- **Authority:** Linear BA-92 and BA-55 with their comments; the timing measured 11/10/2026 (machine-local `/tmp/ba92-regex-bench`, carried in full in the BA-92 comment); `CODING_STANDARDS.md`; ADR 0031 (the tier contract).
- **Stop conditions:** Stop and report if a scanner cannot reproduce a `contracts/links` case byte for byte, if the cap would refuse a concept in production's bundle (the longest is about 9,000 bytes), or if a retry could run a wipe over a store that a later sync already indexed.
- **Execution profile:** One pull request carrying both migrations and the `contracts/queue` change, so it runs alone until it merges. Four units.
- **Who finishes:** This session plans and builds; `ce-commit-push-pr` or its hand-written equivalent opens the pull request, and the merge queue merges it.
- **Open blockers:** None.

## Product Contract

### Summary

A bundle import or a direct `writeConcept` caller can land a body of any length today. Postgres refuses a `tsvector` over 1 MB, and `writeConcept` commits to git before it lands the row, so an over-long body leaves a commit with no row and stalls the reconciler. Separately, the reader that walks a body — the `LINK`, `LINK_DEFINITION` and `FENCED_BLOCK` expressions, and the map store's per-link sentence flattening — is quadratic or worse on shapes a tenant can write: 138 ms at 9,000 characters of `[` for `LINK` alone, 6.6 s in Node and 21.9 s in Python at 5,000 characters on the sentence path. A failed index job ends the job (`fail_job` is terminal), so one document that fails every time holds its whole binding at the last good state until a person intervenes, and the failure's outcome names no document.

### Requirements

- **R1 (BA-92, ruled 10/10/2026).** A concept body is capped in the write's boundary schema, plus a CHECK on `concept_index.body`, so an over-long body is refused as `malformed` before `writeConcept` commits to git. Indexing `left(body, N)` is not taken. The cap does not exceed the suggestion path's `SUGGESTION_BODY_MAX` (100,000), and no concept in production's bundle is refused.
- **R2 (BA-92, from the timing of 11/10/2026).** The reader is linear in both tiers on every shape, including the map store's per-link sentence path. Both tiers stay byte-identical under `contracts/links`, which gains cases for the pathological shapes.
- **R3 (BA-55, criteria 1 and 2).** An index job that fails is run again without a new upload, bind, wipe or rule change; a job that fails the same way every time stops at its bound with its outcome recorded; the binding keeps its last good chunks; and a failed job's outcome names the `source_document_id` that failed it, read from the handler's `ctx.stable_path`, beside the exception type it records today.
- **R4 (BA-55, comment of 08/10/2026).** A `wiped` or `rule-change` job whose store removal failed is retried like any other, so the next sync does not index over a store that may hold text redacted under a replaced rule.
- **R5.** Criterion 3 of BA-55 (the mutation callbacks) is already done in #617 and is not rebuilt.

### Key Technical Decisions

- **KTD1 — the cap's number is 100,000 characters.** The ruling ties it to the suggestion path's cap; because the reader becomes linear (R2), no smaller number is needed for time, and a body at the cap stays far under the 1 MB `tsvector` limit for any text a person or a file can hold at that length. `char_length` counts characters, not bytes, in both the boundary and the CHECK, so both read alike.
- **KTD2 — the scanners are hand-written, per tier, not an RE2 binding.** A binding adds a dependency per tier and both must still agree on the fixture; a scanner adds none and is held by the same `contracts/links` cases. Each scanner reproduces its expression's matches exactly — leftmost, in the alternation's order, non-overlapping — including the sequential-pass semantics of the map store's flattening.
- **KTD3 — `fail_job` requeues rather than ends.** While `attempts < max_attempts` the job returns to `queued` with its claim state cleared; at the bound it ends as `failed` with its outcome, exactly as today. `poisoned` keeps its meaning: a lease that lapsed at the bound is poisoned at claim time. Every reader of job status stays correct by construction: a requeued job is not ended (`JOB_IS_OVER` unchanged), and `whatTheSyncMoved` already distrusts a sync that is not a done first attempt.
- **KTD4 — the failure names its document through the raised error.** The pipeline's exception handler wraps the engine's error with the document id read from `ctx.stable_path`; the loop's failure path writes it into the outcome beside the exception type. The loop stays generic: it names a document only when the failure carries one.

### Scope Boundaries

- The web is untouched apart from what `linksAndMarksOf`'s unchanged behaviour already gives it. The wording plan (BA-157) is rewording the web's text in parallel; this change branches from `origin/main` and touches no sentence.
- `contracts/links` gains cases and changes no existing one; `contracts/queue` changes `fail_job`'s expected behaviour. Both move both tiers' generated digest constants, regenerated by their own commands.
- Nothing rewrites the reconciler, the suggestion path, or the `poisoned` arm of `claim_job`.

### Sources / Research

- BA-92's Linear comments: the owner's ruling (09/10), the reference implementation's RE2 routes (10/10), and the measured timings with sites and callers (13/10, this session).
- BA-55's Linear comments: criterion 3 done in #617; the wipe-retry case from #626; the grouping and contract constraints (13/10, this session).
- `.scratch/reports/s2a-u3-report.md` (the tsvector limit and the commit-with-no-row stall) and `.scratch/reports/s2a-u2-report.md` (the quadratic `LINK`), machine-local in the main checkout.
- Session `11c2fe4e`'s PR B notes: `/tmp/compound-engineering-501/pr-b-notes.md`, machine-local.

## Planning Contract

### High-Level Technical Design

**The cap (R1).** `CONCEPT_BODY_MAX = 100_000` sits in `concept-tables.ts` beside `CONCEPT_FRONTMATTER_MAX`, with `concept_index` gaining `check("concept_index_body_length_check", char_length(body) <= CONCEPT_BODY_MAX)` and the write parsing the body through a boundary string schema in `commitConcept`, before `hashedFileOf` and the repository lock: an over-long body is `malformed`, and no commit is made. A migration lands the CHECK. The api sets no request body limit today; the boundary and the CHECK are the two doors the ruling names, and the cap's constant is one number both read.

**The reader (R2).** In `packages/schema/src/concept-file.ts`, `FENCED_BLOCK`, `LINK_DEFINITION` and `LINK` become scanners; `proseOf` keeps its shape (fenced blocks and code spans blanked, newlines kept) and `linksAndMarksOf` keeps its reading. In `packages/core/src/store/map/index.ts` and `apps/worker/src/better_answers_worker/links.py`, the per-link sentence flattening becomes a scanner that reproduces the four sequential passes. Each scanner is one forward walk with precomputed next-index tables where a failed attempt must not rescan — the shape that made the expressions quadratic. Both tiers produce the same strings, offsets and ordinals on every `contracts/links` case, old and new.

**The retry (R3, R4).** A migration replaces `fail_job` with the requeue-and-bound body of KTD3, keeping its grants and `SECURITY INVOKER`. `contracts/queue/cases.json` moves its `fail_job` expectations: a failure after one claim requeues; a failure at the bound ends `failed` with its outcome; a new case holds each. In `apps/worker`, `_fail_the_sync` raises `DocumentFailed` carrying the document id parsed from `ctx.stable_path`, and the loop writes it into the outcome. The worker's own contract stamp and the schema's regenerate by their commands.

### Sequencing

U1 (the cap) and U2/U3 (the readers) touch disjoint files and could parallelise; U4 (the retry) is independent of both. The plan builds them in order in one worktree — U1 first, because a body landed before the CHECK exists is the one shape the cap exists to refuse; the readers follow; the retry last. Both migrations take their numbers at commit time (0077 and 0078 were next when this plan was written).

### Risks

- **A scanner that drifts from its expression** is the whole risk of R2. It is met by the contract cases, by new cases for the pathological shapes, and by a one-off differential run in the build session: the old expressions and the new scanners over every case body and every bench corpus shape, compared byte for byte, before the expressions are deleted.
- **`fail_job`'s change reads as a behaviour change to every queue consumer.** It is met by KTD3's construction: `JOB_IS_OVER`, `latestIndexOutcomeIn`, `endedSyncs` and `whatTheSyncMoved` each stay correct with a queued job that is not ended, and the contract cases hold the two outcomes a caller can now see.
- **Merge contention.** The S2b build and the wording plan are merging to `main` in parallel. This change's files are theirs nowhere (S2b's remaining units hold `answering`, the api and the MCP entry; the wording plan holds the web's text), but the branch is rebased on `origin/main` before its pull request opens.

### System-Wide Impact

- Two migrations (0077, 0078) and one `contracts/` edit (queue) — the pull request runs alone, and its merge is **not reversible**.
- The worker's schema view and both tiers' contract stamps regenerate.
- `concept-body.tsx`, `read.ts` and `rebuild.py` change only by what the unchanged-behaviour scanners give them: nothing.

## Implementation Units

### U1. The body cap, refused before the commit

- **Goal:** A body over the cap is `malformed` before any git commit, and no row can hold one.
- **Requirements:** R1. **Dependencies:** none.
- **Files:** `packages/schema/src/concept-tables.ts`, `packages/schema/src/boundary-schemas.ts`, `packages/core/src/concepts/index.ts`, a migration, and the schema's and core's tests.
- **Approach:** `CONCEPT_BODY_MAX` beside the frontmatter's; the CHECK on `concept_index.body`; the boundary's body string schema with `.max()`; `commitConcept` parses the body first and refuses `malformed`; `pnpm --filter @better-answers/schema run generate` cuts the migration, and the worker view regenerates.
- **Test scenarios:** A write whose body is one character over the cap is refused `malformed` and the repository's head is unchanged. A write at the cap commits and lands. A direct SQL insert over the cap is refused by the CHECK. A suggestion's accepted body at the suggestion cap still writes. A concept file in production's bundle's shape (9,000 bytes) writes.

### U2. The linear reader, TypeScript

- **Goal:** Every body walks in time linear in its length, in the api's tier, with the same reading on every case.
- **Requirements:** R2. **Dependencies:** none.
- **Files:** `packages/schema/src/concept-file.ts`, `packages/core/src/store/map/index.ts`, `contracts/links/cases.json`, and the suites that read them.
- **Approach:** Fenced-block, definition and link scanners in `concept-file.ts`; the sentence flattening as a scanner reproducing the four passes in `map/index.ts`; new contract cases for a run of `[`, an unterminated fence, a last line of backticks, and a `[a](b)`-run flattened by the sentence path; the differential run against the old expressions before they are deleted.
- **Test scenarios:** Every `contracts/links` case, old and new, reads the same links, marks, ordinals and edges. A 100,000-character run of `[` is read in well under a second, in the reader and in the sentence path. The bench corpus shapes answer identically to the old expressions.

### U3. The linear reader, Python

- **Goal:** The worker's tier reads the same body in the same time.
- **Requirements:** R2. **Dependencies:** U2 (the cases land with the scanners they hold).
- **Files:** `apps/worker/src/better_answers_worker/links.py`, the worker's tests, `contracts/links/cases.json` (shared).
- **Approach:** The same scanners in `links.py`, ported from U2; the differential run against its old expressions; the same new cases.
- **Test scenarios:** As U2, run by the worker's suite. The full rebuild over a pathological body finishes in the time a linear reader takes.

### U4. The retry and the naming

- **Goal:** A failed index job runs again, stops at its bound with its outcome, and the outcome names the document that failed it.
- **Requirements:** R3, R4. **Dependencies:** none.
- **Files:** a migration, `contracts/queue/cases.json`, `packages/core/test/queue.contract.test.ts`, `apps/worker/tests/test_tier_contract.py`, `apps/worker/src/better_answers_worker/pipeline/landed.py`, `apps/worker/src/better_answers_worker/loop.py`.
- **Approach:** `CREATE OR REPLACE FUNCTION fail_job` with the KTD3 body; the contract's `fail_job` expectations move and gain the at-the-bound case; `DocumentFailed` in the pipeline carrying the id from `ctx.stable_path`; the loop's outcome names it; both stamps regenerate.
- **Test scenarios:** A job failed after one claim is queued again and claimed by the next tick, without a new upload or bind. A job failed at its bound ends `failed` with its outcome, and the binding's last good chunks stand. A failed `wiped` job's removal is retried. A document's unexpected failure names its `source_document_id` in the outcome beside the exception type. A failure outside a document's component names no document. Both tiers' contract suites pass over the moved cases.

## Documentation / Operational Notes

- The pull request's body states the cap's number and its reason, the scanners' equivalence method, and `fail_job`'s new behaviour in a sentence each. `Merge risk: not reversible` — two migrations and a `contracts/` change.
- BA-92 and BA-55 close by the pull request (`Fixes BA-92`, `Fixes BA-55`).

## Verification Contract

- `pnpm check` at the root: gates, every workspace, the worker's `uv run --frozen check`.
- The differential run of U2 and U3, kept in the build session's notes.
- The mutation probe (`pnpm mutation`) over the changed packages, read per `docs/agents/mutation-triage.md` before any `src` file a report names is touched.

## Definition of Done

- The four units are built, both migrations are in the journal, both stamps match, the root `check` is green, and the pull request is open, alone in the queue, with its body in the repository's form.
