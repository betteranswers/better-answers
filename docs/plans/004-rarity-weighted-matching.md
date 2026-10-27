---
title: Rarity-Weighted Matching and the Concept Description - Plan
type: feat
date: 2026-10-14
topic: rarity-weighted-matching
artifact_contract: ce-unified-plan/v1
product_contract_source: linear:BA-168
execution: code
---

# Rarity-Weighted Matching and the Concept Description - Plan

## Goal Capsule

- **Objective:** A person who asks `find`, Search or `ask` a question reaches the concepts that hold its rarer words ahead of those that share only its common ones, and a concept is found by the one-sentence `description` its author wrote for it.
- **Means:** The concept search vector takes the frontmatter `description` at weight B, and the one any-word rule ranks a match by a BM25F weight computed in plain SQL over the reader's readable rows (KTD1, KTD2).
- **Authority:** Linear BA-168 and the owner's ruling in its comment of 14/10/2026; `docs/okf-v02.md` for the `description` key; `CODING_STANDARDS.md`.
- **Stop conditions:** Stop and report if rarity can only be had through a Postgres extension, if another open pull request adds a migration, or if the change lowers recall on the recall sets by more than the figures in *Measured recall* record.
- **Execution profile:** One pull request with one migration, so it runs alone. Three units.
- **Who finishes:** This session plans, builds and opens the pull request; the orchestrator arms the merge.
- **Open blockers:** None.

## Product Contract

### Summary

`concept_index.search` gains the frontmatter `description` at weight B, beside the tags and the *Also known as* line. The any-word rule keeps its match and its strong/weak split, and orders the rows within each run by a BM25F weight in place of the count of distinct words held. `find`'s cursor carries that weight. This overrides the S2b plan's boundary that ruled BM25 out, and the route's S2a and S2b matching-rule lines, which this pull request edits.

### Problem Frame

The vector leaves out the `description`, which every one of the 243 concepts in the first customer's bundle carries as a one-sentence summary. The rule ranks by how many distinct query words a row holds, then by `ts_rank_cd`, and neither knows how rare a word is in the workspace. The 13/10 staff review gave this as the mechanism of AE2's miss: row 45's `lms` and `website` `Answer`s compete with every weak holder of *audit* or *information*. The owner ruled on 14/10/2026 that both gaps close before the 70 % gate is re-read through `ask`, so that reading measures the ranking that ships.

### Requirements

**The vector**

- R1. A concept's frontmatter `description`, when it is a string, is searched at weight B. A concept with no `description` indexes as it did.

**The ranking**

- R2. A match ranks by a weight that adds, over the distinct query words a row holds, each word's rarity among the rows the reader may read, scaled by how often and where the row holds it (KTD1). Ties fall to cover density, then the key, as before.
- R3. Strong and weak stay as ruled on 09/10/2026: a strong concept match holds at least half the query's distinct words. Only the order within a run moves.
- R4. Concepts and passages keep one rule: the passage run ranks by the same weight over the readable passages.
- R5. A row's weight depends on nothing the reader may not read (KTD2).

**Paging**

- R6. `find`'s cursor carries the weight in place of the word count, and the corpus counts its first page weighed by, so it pages without skipping or repeating a row even when the corpus changes between pages. A cursor handed out before this change is refused as one `find` did not hand out.

### Key Decisions

- **Both gaps close together, before the gate's re-read** (owner, 14/10/2026). Governs R1, R2.
- **The S2b plan's boundary against BM25 is lifted** (owner, 14/10/2026). Its line now names this plan. Governs R2.

### Measured recall

Read with `packages/core/test/recall.test.ts` on 14/10/2026, before and after, on the same corpus of 240 synthetic `Answer`s. The synthetic set carries no `description`, so these figures measure the ranking alone; the description's effect is shown by a test (U1), and on the customer's rows by the fixed list once BA-152 maps it.

| Set | Read through | Counted by | Before | After |
| --- | --- | --- | --- | --- |
| Paraphrases | `find`, first ten | `Answer` named | 249 of 340, 73.2 % | 247 of 340, 72.6 % |
| Paraphrases | `ask`, first 20 entry points | `Answer` named | 265 of 340, 77.9 % | 266 of 340, 78.2 % |
| Paraphrases | the same, collection named | `Answer` named | 276 of 340, 81.2 % | 276 of 340, 81.2 % |
| Buyer-worded | `find`, first ten | `Answer` named | 78 of 154, 50.6 % | 86 of 154, 55.8 % |
| Buyer-worded | `find`, first ten | every `Answer` named | 43 of 86, 50.0 % | 45 of 86, 52.3 % |
| Buyer-worded | `find`, first ten | at least one | 60 of 86, 69.8 % | 60 of 86, 69.8 % |
| Buyer-worded | `ask`, first 20 entry points | `Answer` named | 92 of 154, 59.7 % | 92 of 154, 59.7 % |
| Buyer-worded | `ask`, first 20 entry points | every `Answer` named | 50 of 86, 58.1 % | 49 of 86, 57.0 % |
| Buyer-worded | `ask`, first 20 entry points | at least one | 63 of 86, 73.3 % | 64 of 86, 74.4 % |
| Buyer-worded, 72 rows with a collection | `ask`, none named | `Answer` named | 56 of 87, 64.4 % | 56 of 87, 64.4 % |
| Buyer-worded, 72 rows with a collection | `ask`, theirs named | `Answer` named | 61 of 87, 70.1 % | 61 of 87, 70.1 % |

The gain is modest, as the owner expected: the buyer-worded set at ten rises 5.2 points, and the rest move by one or two. The remaining gap is vocabulary, which S8's vectors or decision routing address, not order.

**The one figure that falls**, the paraphrases at ten, loses two. The set's shape explains it: six modules carry the same features, so a module word such as *payroll*, in the title and tag of each of its module's twelve `Answer`s, is held by more rows than a feature word such as *edit*. Asked *does payroll track edits*, every module's *Bulk Edit* `Answer` holds the rarer word and climbs over *Payroll Change History*, which holds only *payroll*. That is the rule doing what it is for; the miss is that *Change History* holds neither *track* nor *edit*.

**Variants measured and set aside** (by `Answer` named; paraphrases at 10 and 20, buyer-worded at 10 and 20):

| Variant | Paraphrases 10 / 20 | Buyer-worded 10 / 20 |
| --- | --- | --- |
| Before: distinct words, then `ts_rank_cd` | 249 / 265 | 78 / 92 |
| Rarity summed, no place or count | 240 / 260 | 80 / 91 |
| Distinct words first, then rarity | 240 / 260 | 80 / 91 |
| Rarity times the best place's weight | 240 / 265 | 86 / 93 |
| **Chosen: BM25F, no length normalisation** | **247 / 266** | **86 / 92** |
| BM25F with length normalisation (b = 0.75) | 240 / 266 | 87 / 90 |

## Planning Contract

### Key Technical Decisions

- KTD1. **The weight is BM25F with no length normalisation, in plain SQL.** For each distinct query word a row holds: its inverse document frequency, `ln(1 + (N - df + 0.5) / (df + 0.5))`, times a saturated count, `tf × 2.2 / (1.2 + tf)`. `tf` counts each place the row holds the word by its weight class, at `ts_rank`'s own defaults: A 1.0, B 0.4, C 0.2, D 0.1. Length normalisation was measured and lost seven paraphrases at ten, so it is left out. No extension is needed: `N` and every word's `df` come from one pass over the readable rows (`corpusCounts`: `count(*)` plus one `count(*) FILTER (WHERE search @@ word)` per word), and the match operator is already LEAKPROOF under the policy.
- KTD2. **Rarity is counted over the rows the reader may read.** `corpusCountsOf` takes the `SELECT` of the readable rows' vectors from its caller. For concepts that is the workspace's concepts under `readableClause`; for passages, the workspace's readable passages. A workspace-wide count would let a reader's ordering shift with a Restricted concept's words. The cost is that the weight moves when a reader's audience moves, as `ts_rank_cd` already moves with content.
- KTD3. **The cursor carries the weight and freezes the counts.** `MatchBound` becomes `{ weight, rank, key }`, and a position carries `counts: { size, frequencies }`, integers, as its run's first page counted them. A continuation page binds those counts instead of counting again, so a write between pages cannot move a row's weight across the bound; without that, one readable concept landing between pages skipped a whole tie group. The rarities are computed from the integers on every page, and the weight is summed `ORDER BY` the word, so the same row gives the same bits on every page. `find` counts each corpus at most once a request and shares it across the strong and weak runs; `ask`'s entry step does the same. The cursor schema refuses a count that is not a non-negative integer, a word held by more rows than were counted, and a pre-change cursor (`matched`, or no `counts`).
- KTD4. **The migration is hand-written as `SET EXPRESSION`.** drizzle-kit's diff drops and re-adds the generated column, which drops `concept_index_search_gin` with it. `ALTER COLUMN search SET EXPRESSION` (Postgres 17 and later) rewrites the table and rebuilds the index, under a five-second lock wait, as 0074 bounded its rewrite. The snapshot comes from `generate`; only the SQL is replaced.
- KTD5. **The description is read as the tags are,** through `jsonb_path_query_array(frontmatter, '$.description')`, so a non-string value indexes no words and needs no `coalesce`.

### Scope Boundaries

- The strong/weak split, the runs' order (strong concepts, passages, weak concepts), the entry cap and the walk are unchanged.
- A per-workspace statistics table, which would spare the per-query counts, is not built: it needs a write path and another migration. BA-169 holds it, in Triage.
- The recall fixtures gain no `description`; adding one written to match its paraphrases would measure the fixture.

### Docs this changes

- `docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, the *Scope Boundaries* line that rules BM25 out: it now says the owner lifted it on 14/10/2026 and names this plan.
- `docs/specs/v01-route.md`: S2a's line *A search matches on any of its words*, and S2b's owner's lines naming *S2a's matching rule*, each say the ranking is BA-168's; a new paragraph in S2b records the rule and the figures above.
- `docs/solutions/architecture-patterns/adr-0018.md`, the bullet *The two arms share no score*: each arm now ranks first by the rarity weight, then by full-text rank. Its strong-before-passages rule is unchanged.

### Risks

- **Cost.** `find`'s budget test (`packages/core/test/find-budget.test.ts`) read 4.6 one-row reads at the median before, and between 8.6 and 17.7 over three readings after, against a budget of 60; the recall figures above are unchanged by freezing the counts. EXPLAIN ANALYZE of the counts for a 104-word query over the 240 synthetic `Answer`s: one `Bitmap Heap Scan on concept_index d (actual rows=240.00 loops=1)`, 1.6 ms; in the match, the rarities are an InitPlan that runs `loops=1`. The passage run reads every readable passage once a request, so its cost grows with the passage table (BA-169).
- **Cursor length.** The cap was 512 characters. The three longest buyer-worded rows (431 to 477 characters, 26 to 31 words) gave cursors of 312 to 323 over the synthetic `Answer`s; the same counts scaled to 10^5 passages give at most 404. A 500-character query of 64 distinct words held widely gave 602 characters at 240 rows and 776 at 10^5, so its next page was refused as a cursor `find` did not hand out. The owner raised the cap to 1,024 on 14/10/2026, and a test pages a 500-character query of 120 common words to its second page. A query of about 120 words each held by 1,000 rows or more can still pass 1,024.
- **A lexeme with no positions** (past position 16,383, or a stripped vector) counts toward strength but adds nothing to the weight. The body cap of 100,000 characters keeps a concept short of that; a passage is a chunk.

## Implementation Units

### U1. The description in the concept vector

- **Goal:** R1.
- **Requirements:** R1.
- **Files:** `packages/schema/src/knowledge/concept-tables.ts`, `packages/schema/migrations/0080_the-concept-description.sql` with its snapshot and journal, `apps/worker/src/better_answers_worker/schema_view.py` (generated), `packages/core/test/concept-search.test.ts`.
- **Approach:** KTD4, KTD5. Generate with `pnpm --filter @better-answers/schema run generate --name the-concept-description`, replace the SQL with the hand-written statement under the custom marker, then run `generate:worker-view`, `generate:roles-surface` and `generate:contract-stamp`.
- **Test scenarios:**
  - A concept written with a `description` holds its words at weight B, beside its title's A, its tag's B and its body's C.
  - The existing cases of a concept with no `description` read as before.
- **Verification:** `packages/core/test/concept-search.test.ts` and `packages/schema/test/migrations/migration-ownership.test.ts` pass.

### U2. The rule's weight

- **Goal:** R2 to R5.
- **Requirements:** R2, R3, R4, R5.
- **Dependencies:** none; U1 changes only the vector.
- **Files:** `packages/schema/src/knowledge/full-text-match.ts`, `packages/core/src/concepts/index.ts`, `packages/core/src/sources/passages.ts`, `packages/core/src/answering/plan.ts`, `packages/schema/test/knowledge/full-text-match.test.ts`.
- **Approach:** KTD1, KTD2, KTD3. `QUERY_WORDS` and `corpusCounts` count the readable rows in one pass; `anyWordMatch` binds the counts, its `asked` lateral turns them into rarities once per query, and the `ranked` lateral computes the weight. `strength` keeps reading the distinct count.
- **Test scenarios:**
  - Asked *audit retention* over three titles holding *audit* and one holding *retention*, the rarer word's row ranks first.
  - Asked *audit*, a title holding the word ranks above a body holding it.
  - A body repeating a word six times stays below a title holding every query word, with the weights the formula gives.
  - Paging after a bound moves past rows by weight, then density, then key, and two rows tied on weight and density part on the key.
  - Strong and weak hold half the words, rounded up, as before.
  - The counts read the corpus and each word in one pass, and the weight follows the counts it is given, not the rows.
  - The concept search column's GIN index is valid, ready and over the column after 0080.
- **Verification:** `packages/schema/test/knowledge/full-text-match.test.ts` passes; `packages/core/test/visibility.test.ts` and `packages/core/test/find-matching.test.ts` (*pages past a withheld concept as past an absent one*) pass.

### U3. The cursor and the docs

- **Goal:** R6, and the docs this overrides.
- **Requirements:** R6.
- **Files:** `packages/core/src/answering/cursor.ts`, `packages/core/src/answering/index.ts`, `packages/core/test/find-matching.test.ts`, `packages/core/test/answering.test.ts`, `packages/core/test/concept-plans.test.ts`, `packages/core/test/passage-plans.test.ts`, `docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, `docs/specs/v01-route.md`, `docs/solutions/architecture-patterns/adr-0018.md`.
- **Approach:** KTD3. Re-encode the base64 cursors the tests hold.
- **Test scenarios:**
  - A page's cursor names the run, the row's weight (`ln 2.4` for the case built), its density and its key.
  - A cursor carrying `matched`, no counts, a negative weight, a weight that is no number, a fractional size, or a word held by more rows than were counted is refused.
  - A 500-character query of 120 words held by every concept pages to its second page, its cursor longer than the old cap of 512.
  - A tie group paged one row at a time, with a readable concept holding no query word landing between pages, gives the unpaged list.
  - A Viewer's concepts, and a Viewer's passages, page and order as before a Restricted row holding a query word lands.
  - The largest and smallest bounds read without error.
  - Pages over three runs continue each run and end with no cursor.
- **Verification:** `packages/core/test/find-matching.test.ts` and `packages/core/test/answering.test.ts` pass; the recall measure reports the figures above.

## Verification Contract

- `pnpm --filter @better-answers/schema run check` and `pnpm --filter @better-answers/core run check`.
- `pnpm run check:worker`, for the regenerated schema view.
- The root `pnpm run check:gates`.
- `packages/core/test/recall.test.ts` prints the figures; it asserts none.

## Definition of Done

- R1 to R6 hold, and every test named above passes.
- Migration 0080 is the only migration in flight; `contracts/` is untouched.
- The S2b plan's line and the route's lines name this plan.
- The probe used to read the variants is gone from the tree.
