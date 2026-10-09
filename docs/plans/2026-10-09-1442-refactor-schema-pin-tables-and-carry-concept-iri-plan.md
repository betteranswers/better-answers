---
title: Pin Every Table's Types and Carry the ConceptIri Brand - Plan
type: refactor
date: 2026-10-09
topic: schema-pins-and-concept-iri-brand
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Pin Every Table's Types and Carry the ConceptIri Brand - Plan

## Goal Capsule

- **Objective:** S2a's schema and concept units can add `concept_index`'s second `customType` column and the concept reads knowing that a retyped column in any table, or a plain string passed where a concept IRI belongs, fails `typecheck` before it reaches a pull request.
- **Means:** a mapped type over `boundarySchemas` that pins every table's select shape (KTD1), an additive `ids` module (KTD2), the `ConceptIri` brand at the mint and the concept reads (KTD3, KTD4), and the sources slice's cross-owner reads declared (KTD6).
- **Product authority:**
  - Linear BA-77's acceptance list is authoritative for what this plan delivers.
  - `docs/plans/2026-10-08-2311-docs-architecture-review-before-s2-plan.md` (R5, WP2's row; R6; R10) places it on S2a's critical path, before S2a's schema unit.
  - S2a's plan (`docs/plans/2026-10-09-1344-feat-s2a-search-and-concept-page-plan.md`, U2 and U6) owns moving `IRI`, `conceptIriOf` and `CitedSource` into `@better-answers/schema/concept-file`, and parsing the IRI at the MCP entries and the concept page's route, where a malformed IRI becomes a refusal. This plan does neither. It changes nothing an MCP entry accepts or answers. The one entry that hands `open` a string narrows it to the brand in a way that keeps today's answer (KTD5), and S2a's U6 replaces that step.
- **Stop conditions:** stop and report to the owner in any of these cases:
  - Carrying the brand into `open`, `find` or `walkFrom` turns into a migration of more than about forty call sites outside tests.
  - `generate` prints a migration.
  - A pin shows that a table's select shape is not what its refinements say, which is a defect, not a pin to write around.
- **Execution profile:** one pull request. Reversible: no migration, no stored data, no `contracts/` change.
- **Who finishes:** `ce-work` builds it, `/ce-code-review` reviews it, `ce-commit-push-pr` opens the pull request. The owner arms the merge.
- **Open blockers:** none.

---

## Product Contract

### Summary

Package WP2 of the architecture review before S2. It makes the schema package's registries hold both ways before S2a adds to them. Every table's select shape is pinned at compile time, the branded ids get a module of their own, the concept IRI's brand reaches the functions S2a builds on, and the sources slice's two reads of tables it does not own are declared.

### Problem Frame

ADR 0028 says each boundary schema's inferred type is pinned with `Expect<Equal<…>>`. The test pins 16 tables of 57, and none of the concept tables, so a retyped column in an unpinned table passes every gate (survey of 08/10/2026, opportunity 1). The per-shape `customType` tests cover `passage.embedding` only, and `passage.search` has none. S2a's U3 adds the same kind of column to `concept_index`.

The branded ids have no module. Callers reach a parser through `boundarySchemas.<table>.select.shape.id`, about a hundred times, and the kernel and the sources slice derive their own aliases. The `ConceptIri` brand never leaves the schema package: `conceptIriOf` returns `string`, and `walkFrom`, `open` and `find` take or return plain strings. S2a is built around that id.

`CROSS_OWNER_TABLE_ACCESS` does not record two reads the sources slice makes: passage search's exclusion clause reads `concept_evidence`, and `FIRST_OUTCOME` reads `audit_event`. BA-82's gate will scan each slice's SQL against the map and would fail on both.

### Requirements

- R1. One mapped type in `packages/schema/test/boundary-schemas.test.ts` pins the select shape of every table in `boundarySchemas`, replacing the 16 hand-written pins. A table added to the registry with no pin fails `typecheck`.
- R2. A per-shape `customType` test covers `passage.search`.
- R3. An `ids` module exports the branded ids, `ConceptIri` and `WriteUpId` among them. Every existing `select.shape.id` site still resolves, unchanged.
- R4. `conceptIriOf` returns `ConceptIri`. `walkFrom` and `open` take it in their signatures, and `find` returns it on each concept match.
- R5. `CROSS_OWNER_TABLE_ACCESS` gains two `by: "sources"` read entries: passage search's read of `concept_evidence` (`packages/core/src/sources/passages.ts`) and `FIRST_OUTCOME`'s read of `audit_event` (`packages/core/src/sources/connected-source.ts`). The same exclusion clause also joins `concept_index`, which the map does not record for `sources` either, so it gains a third entry.
- R6. No migration is generated.
- R7. If cheap: named exports of `boundary-schemas.ts` that nothing imports stop being exported (survey card 29).

### Key Decisions

- **This pull request delivers BA-77 only.** Governs R1 to R7. (session-settled: user-directed — chosen over folding in S2a's U2, which moves `IRI`, `conceptIriOf` and `CitedSource` into `@better-answers/schema/concept-file`: that move is S2a's unit. The brand is shaped so U2 can move it with them.)
- **Parsing a concept IRI where it enters, at the MCP entries and the concept page's route, is S2a's.** Governs R4. (session-settled: user-directed — chosen over parsing at the entries now: BA-77 says so, and S2a's U6 changes what a malformed IRI answers.)
- **No migration.** Governs R6. (session-settled: user-directed — chosen over a schema change: the work is types, tests and one constant.)
- **Any full-text rule a test needs is imported from `packages/schema/src/full-text-match.ts`; the language literal is never written.** Governs R2. (session-settled: user-directed — chosen over an inline literal: one module holds the rule since #635.)

### Scope Boundaries

- Foreign-key brands (`passage.connectedSourceId`, the `auditEventId` columns) are WP2's optional second step and are not built here.
- The `UserId` rename to *person id* waits for P1's naming pass (decision 12).
- Migrating the hundred `select.shape.id` sites to the `ids` module is not done here.
- `walkTo` keeps its `string` start: BA-77 names `walkFrom` only, and a walk into a node may start at any uid the map holds.
- Insert and update shapes are not pinned. BA-77 asks for select, and the survey left the other two open.
- Card 29's fuller shape, a `refined()` helper beside `plain()`, is not built.

### Sources / Research

- Linear BA-77, and BA-35's attachments.
- `.scratch/architecture-survey-2026-10-08/walks/schema.md`, opportunities 1, 2 and the unimported-exports card (machine-local).
- `docs/solutions/architecture-patterns/adr-0028-boundary-schemas-generated-from-tables.md`.
- `CODING_STANDARDS.md`: "Never assert a type with `as`", "Parse every boundary with zod", "Refuse a value once, where it enters".

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The pin is one record type with an entry per registry key, and two compile-time checks over it.**
  - `SelectShapes` is a type literal with one entry per `boundarySchemas` key, each the expected select shape written out.
  - `Expect<Equal<keyof typeof boundarySchemas, keyof SelectShapes>>` is what makes a table with no pin fail `typecheck`, and a stale pin for a removed table fail as well.
  - A mapped type over `keyof typeof boundarySchemas` yields the keys whose `z.infer` of `select` is not `Equal` to the pinned shape, and `Expect<Equal<that, never>>` holds it empty, so a failure names the table.
  - The shapes use the `ids` module's types for branded columns, so the pin also proves the `ids` module and the registry carry the same brands.
  - `packages/schema/tsconfig.json` includes `test/`, so `tsc --noEmit` sees the file.
- KTD2. **`packages/schema/src/ids.ts` names each branded id's schema once, taken from the registry, with its inferred type, and the package root exports it.**
  - Ids: `workspaceId`, `userId`, `groupId`, `connectedSourceId`, `writeUpId`, `auditEventId`, `accessRequestId` and `conceptIri`, each the registry's own column schema (`boundarySchemas.<table>.select.shape.<column>`), with the types `WorkspaceId`, `UserId`, `GroupId`, `ConnectedSourceId`, `WriteUpId`, `AuditEventId`, `AccessRequestId` and `ConceptIri`.
  - Taking them from the registry keeps one definition per id. The table refinements stay callbacks over the generated column schema, as ADR 0028 requires, and no second schema exists to drift from them.
  - The module imports the registry, so it reaches drizzle. It gets no subpath of its own: S2a's `concept-file` module is the drizzle-free home the web will import.
  - The kernel's id aliases in `packages/core/src/kernel/principal.ts` and the sources slice's `ConnectedSourceId` become re-exports of the `ids` types. The types are identical, so nothing else moves.
- KTD3. **The schema `conceptIriOf` parses through sits beside `IRI` in `concept-tables.ts`.** `concept-tables.ts` cannot import the registry, which imports it. So the mint has its own schema with the same pattern and brand, and KTD1's pin holds the registry's `iri` columns to the same `ConceptIri` type. Placing it next to the pattern lets S2a's U2 move `IRI`, this schema and `conceptIriOf` together into `concept-file.ts`.
- KTD4. **`conceptIriOf` parses rather than asserts.** The standards refuse `as`. It parses the composed IRI through the `ConceptIri` schema. Its argument is a freshly minted ULID, so a throw there is a broken invariant, not input to refuse.
- KTD5. **The brand reaches readers through the reads that produce the IRI, and the one entry that would stop compiling keeps today's behaviour.**
  - The concepts slice parses `iri` where it maps a `concept_index` row into `OpenedConcept`, so `find`'s concept matches and `open`'s concept view carry `ConceptIri` without new parse sites downstream.
  - `OpenInput`'s `iri` and `walkFrom`'s start become `ConceptIri`.
  - The MCP `open` entry (`apps/api/src/mcp/entries/index.ts`) hands `open` an `iri` its schema typed as a string. It safe-parses that string. A string that is not an IRI answers `{ found: false, iri }` without calling `open`. That is what it answers today, because no row's IRI can fail the pattern, and `open` is a read that writes nothing, so no client sees a change. S2a's U6 replaces this with the input schema's refusal. Conflict call-out: this narrows a value at an entry, which sits close to the work the second Key Decision gives to S2a. It is the smallest change that keeps the entry compiling without an assertion, and it changes no behaviour, which is the line the second Key Decision draws. The pull request names it for the owner.
  - `renderFind` and `renderOpen` read a concept's `iri` as text, and the MCP entries feed them the wire shape, whose `iri` is a string. Their parameters take `iri` as `string`, so rendering needs no parse and the output schemas stay as they are.
  - `walkFrom`'s callers start every walk at a concept, so its start takes the brand. `walkTo` stays wider (Scope Boundaries).
- KTD6. **The three cross-owner entries are `access: "read"`, and each reason says what its SQL reads and why.** BA-82 will gate SQL against these entries, so a reason that does not match its query would mislead that gate.
- KTD7. **The `search` column's per-shape test reads the shapes as they are generated.** The `drizzle-zod` wrapper decides whether a generated column is absent from insert and update or present as optional. The test asserts what the wrapper produces, and asserts that select accepts a row with and without the column. It needs no `tsvector` literal. If it ever does, the value comes from `full-text-match.ts`.

### Assumptions

- `find`'s input carries no IRI, so "`find` takes it in its signature" is read as its result: each concept match's `iri` is `ConceptIri`.
- Tests that pass a malformed IRI on purpose, such as `answering.test.ts`'s `https://better-answers.com/c/01A`, mark it with `@ts-expect-error` and keep their assertion, as the standards ask of a test that feeds a value its type forbids.
- Card 29 is cheap if dropping `export` from the unimported `xSelect`/`xInsert`/`xUpdate` constants needs nothing else. If any is imported across the monorepo, or knip or the lint objects, that one stays exported. If the change grows past a short mechanical edit, it is left for a follow-up issue.

### Risks

- The pinned shapes are about 57 literals. A shape copied from the compiler's output instead of from the refinements could pin a defect. Each branded or enum column is checked against its refinement while it is written.
- Concepts tests take `written.iri` from `writeConcept`'s result. If that result stays `string`, `open` call sites in tests fail to compile. The fix is to brand the result at its source, not to parse at each call site.

---

## Implementation Units

### U1. The `ids` module and the brand at its mint

- **Goal:** each branded id has one schema and one type, and a minted concept IRI is a `ConceptIri`.
- **Requirements:** R3, R4 (`conceptIriOf`); KTD2, KTD3, KTD4.
- **Dependencies:** none.
- **Files:**
  - Create: `packages/schema/src/ids.ts`, `packages/schema/test/ids.test.ts`.
  - Modify: `packages/schema/src/concept-tables.ts`, `packages/schema/src/index.ts`, `packages/core/src/kernel/principal.ts`, `packages/core/src/sources/admin-connected-source.ts`.
- **Approach:**
  1. Add the mint's schema beside `IRI`, and make `conceptIriOf` parse through it (KTD3, KTD4).
  2. Write `ids.ts` from the registry's columns (KTD2), and export it from the root.
  3. Re-point the kernel's and the sources slice's aliases.
- **Test scenarios:**
  - Each `ids` entry is its table's registry column: `ids.workspaceId` is `boundarySchemas.workspace.select.shape.id`, and so on for the eight.
  - `conceptIriOf(ulid())` parses through `ids.conceptIri`, and `conceptIriOf("not-a-ulid")` throws.
- **Verification:** schema and core `check` pass, and every `select.shape.id` site compiles unchanged.

### U2. Every table's select shape pinned, and the `search` column per shape

- **Goal:** a retyped column in any table, or a table with no pin, fails `typecheck`.
- **Requirements:** R1, R2; KTD1, KTD7.
- **Dependencies:** U1.
- **Files:**
  - Modify: `packages/schema/test/boundary-schemas.test.ts`.
- **Approach:**
  1. Replace the "5 — the inferred type is pinned" block with `SelectShapes`, the key-set check and the mapped mismatch check.
  2. Move the 16 existing shapes in and write the other 41, using the `ids` types.
  3. Add the `search` cases to "the customType exception, per shape".
- **Execution note:** after the pins pass, delete one pin and retype one column in a scratch edit, confirm each fails `typecheck` and names its table, then revert both.
- **Test scenarios:**
  - The pin holds when `typecheck` runs: every key of `boundarySchemas` has a shape, and every shape equals its inferred select type.
  - A select row for `passage` parses with `search` given as a string and with `search` absent.
  - Insert and update for `passage` produce what the wrapper generates for a generated column, either no `search` key or an optional one, and the test asserts which.
- **Verification:** schema `typecheck` and `test` pass, and the scratch edits in the execution note fail as expected.

### U3. The brand carried to `open`, `find` and `walkFrom`

- **Goal:** the functions S2a builds on take or return `ConceptIri`.
- **Requirements:** R4; KTD5.
- **Dependencies:** U1.
- **Files:**
  - Modify: `packages/core/src/concepts/index.ts` (the row read into `OpenedConcept`, and `writeConcept`'s result if its `iri` is a string), `packages/core/src/answering/index.ts` (`ConceptMatch`, `ConceptView`, `OpenInput`, and the parameters of `renderFind` and `renderOpen`), `packages/core/src/store/map/index.ts` (`walkFrom`), `apps/api/src/mcp/entries/index.ts` (the `open` entry's safe-parse, and `foundInCore` and `openedInCore` returning the render shapes).
  - Test: `packages/core/test/answering.test.ts`, `packages/core/test/concepts.test.ts`, `packages/core/test/invisibility.test.ts`, `packages/core/test/map-budget.test.ts`, `packages/core/test/visibility.test.ts`, `packages/core/test/erasure-routine.test.ts`, `packages/core/test/import-bundle.test.ts`, `packages/core/test/suggestions.test.ts`, `apps/api/tests/ops.test.ts`, and others `typecheck` names.
- **Approach:**
  1. Parse `iri` once where the concept row becomes `OpenedConcept`.
  2. Type `ConceptMatch.iri`, `ConceptView.iri`, `OpenInput.iri` and `walkFrom`'s start as `ConceptIri`.
  3. Add the MCP entry's safe-parse, and let the render functions take `iri` as text (KTD5).
  4. Fix test call sites from their sources: minted IRIs through `conceptIriOf`, read IRIs through the branded results. Mark a deliberately malformed IRI with `@ts-expect-error`.
- **Patterns to follow:** `boundarySchemas.<table>.select.shape.id.parse(row.id)` in `packages/core/src/members/requests.ts` for parsing a read id.
- **Test scenarios:**
  - MCP `open` with a string that is not a concept IRI still answers `found: false` with that string, and `open` is not called.
  - MCP `open` with an absent well-formed IRI still answers `found: false`, as today.
  - The existing `open`, `find` and `walkFrom` suites pass unchanged in what they assert.
- **Verification:** core and api `check` pass.

### U4. The sources slice's cross-owner reads declared

- **Goal:** the ownership map names every table the sources slice reads but does not own.
- **Requirements:** R5; KTD6.
- **Dependencies:** none.
- **Files:**
  - Modify: `packages/schema/src/table-ownership.ts`.
- **Approach:** add three entries beside the existing `by: "sources"` entry. Passage search's exclusion of passages a readable concept already cites reads `public.concept_evidence`, and joins `public.concept_index` to apply the reader's predicate to each citing concept. `FIRST_OUTCOME` reads `public.audit_event` for its join to the audit event that recorded a document's first outcome. Confirm each reason against the SQL.
- **Test scenarios:**
  - The table-ownership suite still holds: each entry has a reason and a declared table, and neither names its table's owner.
- **Verification:** schema `check` passes.

### U5. Unimported boundary exports (optional)

- **Goal:** `boundary-schemas.ts` exports what something imports.
- **Requirements:** R7.
- **Dependencies:** U2, because the test file's imports decide what stays.
- **Files:**
  - Modify: `packages/schema/src/boundary-schemas.ts`.
- **Approach:** list the named exports with no importer across the monorepo, drop `export` from those, and keep the rest. Skip the unit if it is not a short mechanical edit (Assumptions).
- **Test expectation:** none, because the registry tests stand unchanged and the gates prove nothing broke.
- **Verification:** the root `check:gates` and every workspace `check` pass.

---

## Verification Contract

| Command | Proves | Units |
| --- | --- | --- |
| `pnpm --filter @better-answers/schema run check` | the pins, the `ids` pairing, the `search` per-shape test, the ownership entries | U1, U2, U4, U5 |
| `pnpm --filter @better-answers/core run check` | the brand through `open`, `find` and `walkFrom` | U1, U3 |
| `pnpm --filter @better-answers/api run check` | the MCP `open` entry | U3 |
| `pnpm --filter @better-answers/schema run generate` | prints no changes; `migrations/`, `roles-surface.json` and the worker schema view are absent from the diff | R6 |
| `pnpm check:gates` | lint, knip and the repository gates | all |

## Definition of Done

- Every R-ID is met, or R7 is recorded as left with its reason in the pull request.
- The pull request body ends `Merge risk: reversible, no migration` then `Fixes BA-77`.
- No assertion with `as` is added.
- No scratch edits from U2's execution note remain in the diff.
