---
title: One Full-Text Matching Rule - Plan
type: refactor
date: 2026-10-09
topic: one-full-text-rule
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# One Full-Text Matching Rule - Plan

## Goal Capsule

- **Objective:** S2a can write the `concept_index` full-text vector, and every later search can match text, without choosing the language again, so a concept and a passage are always matched by the same rule. Today the language is written in three places, and a fourth copy would let the concept arm and the passage arm drift apart.
- **Means:** `packages/schema/src/full-text-match.ts` exports the language, the `tsvector` column type and the websearch query fragment, and every site that matches text takes them from there (KTD1 to KTD3).
- **Authority:** BA-78's acceptance criteria, then the Key Technical Decisions, then the units.
- **Stop conditions:** the stored expression of `index.passage.search` would change in any byte, or the change would need a migration. Either is not reversible, so stop and report.
- **Execution profile:** one pull request, `Fixes BA-78`. `Merge risk: reversible`, since no expression text or stored data changes.
- **Who finishes:** `ce-work` builds it, `ce-code-review` reviews it, and `ce-commit-push-pr` opens the pull request. The owner merges.

---

## Product Contract

### Summary

The full-text language, the `searchVector` column type and one renderer of the websearch query fragment move into `full-text-match.ts`. The passage table's stored expression, passage search and the erasure probe import them. A test pins the passage expression's bytes, and a scan refuses the language spelled in any other TypeScript source.

### Problem Frame

Passage search matches with `websearch_to_tsquery('english', $2)` in `packages/core/src/sources/passages.ts`. The passage table's stored vector is `to_tsvector('english', content)` in `packages/schema/src/index-tables.ts`. The erasure probe parses words with `plainto_tsquery('english', word)` in `packages/core/src/erasure/documents.ts`. Each site names the language for itself. A query parsed under one configuration and a vector stored under another match nothing, and nothing would say so.

S2a is next. It adds a stored vector to `concept_index` and ranks `find`'s concept arm over it. The architecture review before S2 (`docs/plans/2026-10-08-2311-docs-architecture-review-before-s2-plan.md`, R5's WP3 row and R6) placed this package before the S2a core unit that writes that vector, so S2a takes the rule from one module instead of writing it a fourth time.

### Requirements

**The one home**

- R1. `full-text-match.ts` exports the language, the `searchVector` custom type and one renderer of the websearch query fragment given a placeholder.
- R2. The passage table's stored expression and passage search take the language from `full-text-match.ts`.
- R3. The erasure probe keeps `plainto_tsquery` and imports the language.
- R4. No TypeScript source outside `full-text-match.ts` spells the language, and a test fails if one does.

**Nothing moves in the database**

- R5. The passage table's stored expression stays byte-identical, so no migration is generated.
- R6. `find` over seeded concepts and passages matches as it does today, and so does the erasure probe.

### Key Decisions

- **The rule's home is the existing `full-text-match.ts`.** It already holds the leakproof mark on the match, and `packages/schema/src/index.ts` already re-exports it (session-settled: user-approved — chosen over a new module or a helper in `packages/core`: the architecture review's package table names this file). Governs R1, R2.
- **The erasure probe keeps its own parser.** `plainto_tsquery` takes single words with no operators, which is what a probe over an identifier's words needs (session-settled: user-approved — chosen over sharing the websearch fragment: a different parser on purpose). Governs R3.
- **No expression changes, so no migration** (session-settled: user-approved — chosen over a tidier expression, such as a `regconfig` cast: a changed expression is a migration, and a migration is not reversible). Governs R5.

### Scope Boundaries

- The `concept_index` vector, its expression and its index are S2a's. This change adds no column and no table.
- BA-77 (WP2, branded ids) touches `packages/schema` and `passages.ts` next. Nothing of it is started here (session-settled: user-directed — chosen over doing both in one pull request: the lane takes them in order).
- No helper renders a stored vector expression. S2a's concept vector weights several fields, so its shape is S2a's to choose, from the language this change exports.
- The SQL in test files is left as written. A test that pins the expression must spell what it expects, or it proves nothing (KTD4).

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The language constant holds the configuration as SQL writes it, quotes included: `'english'`.** Each site interpolates it as it stands, so no site writes the quoting rule. A bare `english` would leave three sites each adding quotes. A `::regconfig` cast would change the stored expression's bytes. Governs R1, R2, R3.
- KTD2. **The stored expression goes into Drizzle as raw SQL.** Drizzle's `sql` tag turns an interpolated string into a bound parameter. The generated column's text must be literal, so the language reaches it through `sql.raw`, and the rendered SQL stays `to_tsvector('english', content)` with no parameters. Governs R2, R5.
- KTD3. **The renderer takes the placeholder and returns the fragment.** For passage search it is `websearch_to_tsquery('english', $2)`. Passage search keeps its `CROSS JOIN … AS q` and its `ts_rank` over `q`. Only the fragment is shared, because S2a's concept arm needs the same parse and not passage search's joins. The name is the implementer's, in the glossary's words. Governs R1, R2.
- KTD4. **Two tests hold the rule.** A unit test renders `passage.search`'s generated expression through Drizzle's Postgres dialect and expects the literal `to_tsvector('english', content)` with no parameters, spelled out in the test. That covers R5 without a database. A scan of the `.ts` and `.tsx` files under `apps/*/src` and `packages/*/src` covers every file but `full-text-match.ts` and names each file it refuses. It refuses `english` between matching quotes in any letter case. It also refuses a call of `to_tsvector`, `to_tsquery`, `plainto_tsquery`, `phraseto_tsquery` or `websearch_to_tsquery` whose first argument is not the exported constant, so a one-argument call that falls back to the server's default configuration, or another configuration's name, fails too. The scan reads source only, so test SQL stays literal. Governs R4, R5.

### Assumptions

- "TypeScript source" in BA-78's acceptance means `src/`, not tests. The test files that write `'english'` (`packages/schema/test/passage-columns.test.ts`, `packages/schema/test/probes.ts`) build DDL and probes the database must answer, and the DDL check is an oracle that stays literal.
- The `index` schema is outside drizzle-kit's `schemaFilter` (`packages/schema/drizzle.config.ts` filters `public`), and the passage column's DDL lives in the hand-written migration `0037_the-chunk-substrate.sql`. So `generate` cannot produce a migration for this column either way. KTD4's rendering test is what proves the Drizzle definition unchanged, and `generate` is run to show nothing else moved.

### Risks

| Risk | Mitigation |
|---|---|
| `apps/worker/tests/factories.py` reads `index-tables.ts` as text and expects exactly one `export const EMBEDDING_DIMENSIONS = <n>;` line | U1 moves `searchVector` and leaves that line as it is. The worker's suite runs in `check` |
| Interpolating the constant through the `sql` tag binds it as a parameter, and the generated column then renders `$1` | KTD2, and KTD4's rendering test fails on any parameter |

---

## Implementation Units

### U1. Gather the rule in `full-text-match.ts`

- **Goal:** the language, the `tsvector` column type and the websearch fragment live in one module, and the passage table and passage search use them.
- **Requirements:** R1, R2, R5; KTD1, KTD2, KTD3.
- **Dependencies:** none.
- **Files:**
  - `packages/schema/src/full-text-match.ts`: the language, `searchVector` and the renderer, each with a doc block.
  - `packages/schema/src/index-tables.ts`: drops its private `searchVector`, and builds the stored expression from the language.
  - `packages/core/src/sources/passages.ts`: `MATCHING_ROWS` takes its fragment from the renderer.
  - `packages/schema/test/full-text-match.test.ts`: the rendering test.
- **Approach:**
  1. Move `searchVector` from `index-tables.ts` to `full-text-match.ts` and export it. `index-tables.ts` imports it. `full-text-match.ts` imports `customType` from `drizzle-orm/pg-core`.
  2. Export the language per KTD1, and the renderer per KTD3.
  3. In `index-tables.ts`, write the generated expression from the language per KTD2.
  4. In `passages.ts`, import the renderer from `@better-answers/schema` and put its fragment for `$2` in `MATCHING_ROWS`.
- **Patterns to follow:** `MARK_THE_MATCH_LEAKPROOF` in the same module, a SQL string exported from schema and run by its callers. `passages.ts` already imports `SENSITIVITIES` from `@better-answers/schema`.
- **Test scenarios:**
  - `passage.search`'s generated expression, rendered by Drizzle's Postgres dialect, is `to_tsvector('english', content)` with no parameters. This is R5's pin.
  - The renderer given `$2` returns `websearch_to_tsquery('english', $2)`.
  - The passage search suite (`packages/core/test/passages.test.ts`, "the passages a search finds") and `packages/core/test/passage-plans.test.ts` pass unchanged. This is R6 for passages.
  - `packages/core/test/answering.test.ts` passes unchanged. This is R6 for `find`.
  - `packages/schema/test/passage-columns.test.ts` ("the full-text column") passes unchanged.
- **Verification:** the schema and core suites pass, and the schema package's `generate` writes no migration.

### U2. Point the erasure probe at the language

- **Goal:** the erasure probe parses with `plainto_tsquery` under the shared language.
- **Requirements:** R3, R6; KTD1.
- **Dependencies:** U1.
- **Files:** `packages/core/src/erasure/documents.ts`.
- **Approach:** `PROBE` takes the language from `@better-answers/schema`, and keeps `plainto_tsquery` and the rest of its text as they are.
- **Test scenarios:**
  - The erasure suites (`packages/core/test/erasure.test.ts`, `erasure-routine.test.ts`, `erasure-rehearsal.test.ts`, `erasure-match.contract.test.ts`) pass unchanged. This is R6 for the probe.
- **Verification:** the core suite passes.

### U3. Refuse the language spelled anywhere else

- **Goal:** S2a, or any later change, fails a test if it writes the language outside `full-text-match.ts`.
- **Requirements:** R4; KTD4.
- **Dependencies:** none. The scan is written first, before U1 and U2, once the constant's name is chosen.
- **Files:** `packages/schema/test/full-text-match.test.ts`.
- **Approach:**
  1. A test with no database walks the `.ts` and `.tsx` files under `apps/*/src` and `packages/*/src` from the repository root, skipping `node_modules`.
  2. It applies KTD4's two refusals to every file but `full-text-match.ts`, and expects the list of refused files to be empty. The failure lists them. The refusal is a function over one file's text, so the planted cases below test it without writing a file.
  3. It also expects the walk to have read `packages/schema/src/full-text-match.ts` and `packages/core/src/sources/passages.ts`, and fails naming either one it missed, so a walk that reads nothing cannot pass.
- **Patterns to follow:** `apps/worker/tests/factories.py` reads a schema source file from the repository root. `scripts/insert-scan.mjs` refuses a walk that read no file.
- **Execution note:** run the scan on the current tree first and watch it name `index-tables.ts`, `passages.ts` and `documents.ts`. It passes once U1 and U2 land.
- **Test scenarios:**
  - On the tree after U1 and U2, the scan refuses no file.
  - On the tree before U1 and U2, it names the three files above.
  - A planted source line `websearch_to_tsquery($2)`, with no configuration, is refused.
  - A planted source line `to_tsvector('simple', body)` is refused.
  - A planted `'English'` between quotes is refused.
  - `English` in a comment with no quotes, such as `packages/core/src/store/git/index.ts`'s, is not refused.
- **Verification:** the schema suite passes, and the planted cases are refused.

---

## Verification Contract

| Check | Proves | Applies to |
|---|---|---|
| `pnpm --filter @better-answers/schema run check` | R1, R4, R5: the rendering pin, the scan, types and the schema suites | U1, U3 |
| `pnpm --filter @better-answers/core run check` | R2, R3, R6: passage search, `find` and the erasure probe match as before | U1, U2 |
| `pnpm --filter @better-answers/schema run generate` writes no migration file and changes no snapshot | nothing in the `public` schema moved. It cannot see the passage column, whose R5 pin is the rendering test | U1 |
| `pnpm check:gates` | lint, doc blocks and the comment gates over the edited `.ts` files | U1 to U3 |
| `pnpm check` | the whole tree, the worker's suites included, which read `index-tables.ts` | all |

---

## Definition of Done

- `full-text-match.ts` exports the language, `searchVector` and the websearch renderer.
- `index-tables.ts`, `passages.ts` and `documents.ts` spell no language, and the scan holds that.
- `passage.search` renders `to_tsvector('english', content)` with no parameters, and `generate` writes nothing.
- Passage search, `find` and the erasure probe pass their suites unchanged.
- No abandoned attempt or experimental edit is left in the diff.

---

## Appendix

### Sources

- Linear BA-78, and BA-35 for the survey board and the staff check.
- `docs/plans/2026-10-08-2311-docs-architecture-review-before-s2-plan.md`: R5's WP3 row, R6, the Key Decision that S2a's plan does not wait for WP3.
- `docs/specs/v01-route.md`: S2a's "BA-35's lines".
- `packages/schema/migrations/0037_the-chunk-substrate.sql`: the stored expression as it was first written, on the table `0069_the-passage.sql` later renamed.
