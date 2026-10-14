---
title: Clear an Erased Person's Disputed Sentence - Plan
type: fix
date: 2026-10-14
topic: erasure-clear-disputed-sentence
artifact_contract: ce-unified-plan/v1
product_contract_source: linear:BA-167
execution: code
---

# Clear an Erased Person's Disputed Sentence - Plan

## Goal Capsule

- **Objective:** Once a person is erased, none of the free text their assistant sent with a flag is left on the record. The flag keeps its reason and the concept its disputed sentence rested on.
- **Means:** The erasure's feedback rewrite also sets `disputed_sentence` to null, and migration 0081 relaxes `question_feedback_flag_check` so a flag may keep its concept with no sentence (KTD1, KTD2).
- **Authority:** Linear BA-167 and the owner's rulings of 14/10/2026 in its description and comments: clear the sentence, keep the reason and the concept, and use a migration rather than an empty string.
- **Stop conditions:** Stop and report if another open pull request adds a migration.
- **Execution profile:** One pull request with one migration, so it runs alone. One unit.
- **Who finishes:** This session plans, builds and opens the pull request; the orchestrator arms the merge.
- **Open blockers:** None.

## Product Contract

### Requirements

- R1. An erasure clears the disputed sentence on every flag the person gave, in the same statement that rewrites who gave it and clears its note.
- R2. The flag keeps its verdict, its reason and the concept the sentence rested on.
- R3. The database still refuses a disputed sentence with no concept, and a concept or sentence on feedback that is not a flag.
- R4. ADR 0017 and the S2b plan's KTD8 say the sentence is cleared, in the same commit.

### Scope Boundaries

- No backfill. No erasure has run in production (owner, 14/10/2026), so no erased person's flag holds a sentence.
- The api's input is unchanged: a flag sent over MCP still names a disputed sentence and its concept together, or neither.
- #734 changes the erasure modules too. This change stays inside `REWRITE_THE_FEEDBACK` in `packages/core/src/erasure/questions.ts`, so whichever lands second rebases with no overlap in the statement.

## Key Technical Decisions

- KTD1. **The check reads as two implications.** A concept stands only on a flag, and a sentence stands only with a concept: `(disputed_concept IS NULL OR verdict = 'flag') AND (disputed_sentence IS NULL OR disputed_concept IS NOT NULL)`. A sentence with no concept, and either field on helpful feedback, stay refused. A concept with no sentence is admitted, which is the erased shape.
- KTD2. **The migration is generated, not written by hand.** The constraint lives in `packages/schema/src/question-tables.ts`, so drizzle drops and re-adds it.

## Implementation Units

### U1. Erasure clears the disputed sentence

- **Requirements:** R1 to R4.
- **Files:**
  - Modify: `packages/schema/src/question-tables.ts`, `packages/schema/src/table-ownership.ts`, `packages/core/src/erasure/questions.ts`
  - Create: `packages/schema/migrations/0081_the-erased-flags-sentence.sql` (generated), with its snapshot and journal entry, and the regenerated worker view
  - Test: `packages/schema/test/question-tables.test.ts`, `packages/core/test/erasure-routine.test.ts`, `packages/core/test/question-rows.ts`
  - Docs: `docs/solutions/architecture-patterns/adr-0017-answers-are-retained-correctable-records.md`, `docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`
- **Test scenarios:**
  - An erased person's flag keeps its reason and concept, and loses its note and disputed sentence.
  - The table admits a flag's concept with no sentence, and still refuses a concept on helpful feedback and a sentence with no concept.
</content>
</invoke>
