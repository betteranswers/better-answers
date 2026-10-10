---
title: One Refusal Catalogue, the Store Words It Holds, and the Import's Exits by Class - Plan
type: refactor
date: 2026-10-10
topic: one-refusal-catalogue
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
origin: docs/plans/2026-10-08-2311-docs-architecture-review-before-s2-plan.md
execution: code
---

# One Refusal Catalogue, the Store Words It Holds, and the Import's Exits by Class - Plan

## Goal Capsule

- **Objective:** Every refusal word is read from one catalogue that one module composes, and importing a module declares nothing. The three git door words a governed write passes on are declared and classed. `import-bundle` exits with its word's class when the import itself refuses in a word.
- **Means:** a vocabulary becomes plain data, and `packages/core/src/refusals/index.ts` composes the catalogue from each slice's (KTD1, KTD2). One kernel function reads a catalogue into classed words and refuses a word declared twice (KTD3). Concepts declares the git door's commit words and names them in an alias the walk reads (KTD5). `import-bundle` hands a word refusal to `refused` (KTD6).
- **Product authority:**
  - Linear BA-86, BA-117 and BA-116 are authoritative: their acceptance criteria are R1 to R9.
  - `docs/plans/2026-10-08-2311-docs-architecture-review-before-s2-plan.md` (R5's WP15 row) is authoritative for why the import-time register goes now.
  - The lead's brief sets R9's default: `reconcile-watermark`'s stopped replay keeps exit 1. The owner has not ruled on it.
- **Stop conditions:** stop and report to the lead if any of these holds:
  - The catalogue cannot sit in core without a change to `import-direction` wider than the one in KTD1.
  - A registered word's class would have to change, or a word answer on tRPC, the MCP surface or ops would differ from today's.
  - The wider `RefusalWord` forces an edit under `apps/web/src/features/knowledge/`.
- **Execution profile:** one pull request, reversible. More `ops` exits move to their class's code (R8).
- **Who finishes:** `ce-work` builds; `/ce-code-review` reviews; `ce-commit-push-pr` opens the pull request. The lead merges.
- **Open blockers:** none.

---

## Product Contract

### Summary

A slice's vocabulary is a plain record of word to class. `packages/core/src/refusals/index.ts` holds the catalogue: each owner's vocabulary under the owner's name. The kernel's `refusalsIn` reads a catalogue into words with their class and owner, and throws on a word two owners declare or one that is not lower case and hyphenated. The api reads its `REFUSALS` from the catalogue plus its transport's two words. The refusal-word test holds the catalogue against every refusal union's words, both ways. Concepts declares `stale-precondition`, `malformed-path` and `malformed-message`, and its unions name the git door's commit words through an alias the walk reads. `import-bundle` exits by class for a word the import answers.

### Problem Frame

ADR 0043 says each refusal word is declared once by its owning slice. The mechanism is a global `Map` in `packages/core/src/kernel/refusal.ts` that `declareRefusals` fills when a vocabulary module loads. A reader of the words must first import every slice: `apps/api/tests/kept-names.ts` carries twelve imports for that alone, and core's tests call `loadEveryEntryPoint`. `RefusalOwner` is a closed union the kernel restates, and `apps/api/src/refusal.ts` spreads seven vocabularies by hand (the staff check's section B, item 6).

BA-79's walk reads string literals and resolves no type reference. `WriteConceptRefusal` and `WriteManifestRefusal` include the git door's `CommitRefusal`, so `stale-precondition`, `malformed-path` and `malformed-message` reach a caller unclassed, and the walk cannot see them.

After BA-79, `refused` exits a word with its class's code. `import-bundle` still says the import's own words in a sentence and exits 1, so a wrapper reading the code cannot tell a Viewer's refusal from a fault.

### Requirements

**The catalogue (BA-86)**

- R1. One module composes the catalogue from each slice's exported vocabulary, and no refusal word is registered as a side effect of an import. AE1.
- R2. `RefusalOwner`'s closed union is removed, and the api's `REFUSALS` is read from the catalogue with no hand-written spread of slices.
- R3. A slice's word missing from the catalogue fails `typecheck` or a test, and the refusal-word walk reads the catalogue. AE2.
- R4. tRPC, the MCP surface and ops answer the same `{ word, class }` for every word as before. AE3.
- R5. ADR 0043's sentences on how words are registered are edited in the same commit as the mechanism. ADR 0029 is edited in the same commit as the import rule (KTD1).

**The store words (BA-117)**

- R6. Every word a slice's refusal union takes from a store door is declared by a slice vocabulary, and the walk sees it. AE4.
- R7. A word added to the git door's `CommitRefusal` fails `refusal-words.test.ts` until the slice declares it. AE4.

**The operator's command (BA-116)**

- R8. `import-bundle` passes a word refusal to `refused` with its sentence, and exits with the word's class code. `ops.test.ts`'s Viewer case and its not-an-Admin case assert `EXIT_OF_CLASS.forbidden`. AE5.
- R9. `reconcile-watermark`'s stopped replay keeps exit 1, and the usage text states the rule that keeps it there.

### Acceptance Examples

- AE1. **Covers R1.** **Given** a process that imports `@better-answers/core/kernel` and nothing else, **when** it reads `REFUSAL_CATALOGUE` from `@better-answers/core/refusals`, **then** every slice's words are there, with no entry point loaded first.
- AE2. **Covers R3.** **Given** a vocabulary left out of the catalogue while a union still names one of its words, **then** `refusal-words.test.ts` fails, naming the word.
- AE3. **Covers R4.** **Given** the test's hand-kept table of every word with its class and owner, **then** the catalogue equals it once the three new words are added, and no existing row changes.
- AE4. **Covers R6, R7.** **Given** `CommitRefusal` with a fifth word the concepts vocabulary does not declare, **then** `refusal-words.test.ts` fails to typecheck.
- AE5. **Covers R8.** **Given** a Viewer's email passed as `--as`, **when** `import-bundle` runs, **then** it prints its sentence unchanged and exits `EXIT_OF_CLASS.forbidden`, where today it exits 1.

### Scope Boundaries

- **Not in this package:**
  - Any change to a registered word's class or owner.
  - Mapping the git door's words to slice words. They are declared as they stand, so no core answer changes.
  - The words an inline `Result<_, "word">` names outside a `*Refusal` alias, which BA-79's report lists as the walk's known limit.
  - `provision-workspace`, `add-member` and the other commands whose sentences already lead with their word and exit 1. BA-116 names `import-bundle` alone.
  - `loadEveryEntryPoint`, which the audit and stored-names tests still use for their own registers.
- **Coordination:** S2a's U12 edits `apps/web/src/features/knowledge/refusal-words.ts`. This plan edits nothing under `apps/web/src/`: the web's word maps are `Partial<Record<RefusalWord, …>>`, so three more words need no entry. Whichever pull request merges second rebases.

### Assumptions

- The catalogue sits in core, not in the api, because core's own test must read it and core cannot import the api.
- The transport's two words (`no-session`, `no-active-workspace`) stay declared in `apps/api/src/refusal.ts`. The api reads them through the same kernel function, beside the catalogue's vocabularies.
- `reconcile-watermark`'s stopped replay keeps exit 1. This is the lead's default and the owner may overturn it.
- Each new word's class is chosen by the glossary's remedies (table below). Once shipped, a word never changes class, so these are the owner's to overturn now.

### The New Words

| Word | Owner | Class | Why this remedy |
| --- | --- | --- | --- |
| `stale-precondition` | concepts | conflict | the bundle's head moved since the caller read it; read again and decide again |
| `malformed-path` | concepts | malformed | the path sent is not one the bundle can hold; fix what was sent |
| `malformed-message` | concepts | malformed | the commit message or its trailers are not well formed; fix what was sent |

`no-such-repository`, the fourth word of `CommitRefusal`, is already declared by concepts as a precondition and does not move.

### Sources / Research

- BA-79's plan and build report (`docs/plans/2026-10-10-0218-test-admission-lint-and-refusal-walk-plan.md`), for the walk and for what it left to this package.
- `CONCEPTS.md` § refusal, for the seven classes by remedy.
- `packages/devtools/lint-rules/rules/import-direction.ts`, whose `erasure` clause decides where the catalogue can sit.

---

## Planning Contract

**Product Contract preservation:** the three issues' acceptance criteria are R1 to R9, unchanged. BA-116's second criterion asks for the owner's decision; R9 records the lead's default and the report names it as open.

### Key Technical Decisions

- KTD1. **The catalogue is a module of its own in core, above every slice.** `packages/core/src/refusals/index.ts`, exported as `@better-answers/core/refusals`, imports each slice's face and names its vocabulary under its owner. It must import `erasure`, which `import-direction` lets only a test reach. The rule gains one zone, the catalogue: it imports the kernel and every slice's face, `erasure` included, and nothing in core but a test imports it, so the slice graph stays acyclic. ADR 0029 and `docs/architecture/c4-components-core.md` say so in the same commit. The api was the alternative home, and is rejected because core's walk test must read the catalogue. Governs R1, R5.
- KTD2. **A vocabulary is plain data.** Each `vocabulary.ts` declares its record with `as const satisfies Vocabulary`. `declareRefusals`, the `Map` and `refusalRegister` go. A vocabulary keeps its shape, word to class, so `keyof typeof WORKSPACE_REFUSALS` and `RefusalWordFor` read as they do today. The owner is the catalogue's key and no longer an argument, so `RefusalOwner` goes. Governs R1, R2.
- KTD3. **One kernel function reads a catalogue.** `refusalsIn(catalogue)` answers every word with its class and owner, in the order declared. It throws on a word two owners declare and on a word that is not lower case and hyphenated: the two checks `declareRefusals` made, now made where the words are read. `classesIn(catalogue)` answers the word-to-class record a transport indexes, typed from the catalogue. The api's boot reads it, so a duplicate still stops the api from starting. Governs R2, R3.
- KTD4. **The api reads the catalogue and adds its own.** `apps/api/src/refusal.ts` calls `classesIn` over the catalogue's vocabularies and `transport`. `RefusalWord` stays `keyof typeof REFUSALS`. It exports the word list for `kept-names.ts`, whose twelve imports go. Governs R2, R4.
- KTD5. **Concepts declares the git door's commit words and names them where the walk reads.** `concepts/vocabulary.ts` gains the three words and an alias, built from the vocabulary, that lists the four words a governed write passes on. `WriteConceptRefusal` and `WriteManifestRefusal` take that alias in place of `CommitRefusal`. A word the door adds then fails typecheck where concepts returns the door's answer, and `refusal-words.test.ts` asserts the door's union extends the write's and the catalogue's words. Following type references in the syntax walk was the alternative, and is rejected: it resolves names without imports, so two aliases of one name would be read as one. Governs R6, R7.
- KTD6. **A word from the import exits by class; a run that names where it stopped exits 1.** `importBundleCommand` hands a string refusal to `refused` with `importReason`'s sentence. The `unsound` and `stopped` objects and an `Error` keep exit 1, and so does `reconcile-watermark`'s stopped replay: each names a file or a commit and what landed before it, which no one class's remedy covers. The usage text's line for exit 1 says this. Governs R8, R9.

### The Exit Codes That Move

| Command | Refusal | Today | After |
| --- | --- | --- | --- |
| `import-bundle` | `role-forbids`, said as "is a Viewer of this workspace" | 1 | 5, forbidden |
| `import-bundle` | `class-unreadable`, said as "is not an Admin of this workspace" | 1 | 5, forbidden |
| `import-bundle` | `manifest-taken` | 1 | 8, conflict |
| `import-bundle` | `no-such-repository` | 1 | 9, precondition |
| `import-bundle` | a principal word from the import's own resolve (`not-a-member` and its four siblings) | 1 | 4, unauthenticated |

The first two and `no-such-repository` are asserted. `ce-work` confirms that no script, workflow or runbook step reads these exits before the pull request says so.

---

## Implementation Units

### U1. The catalogue replaces the register (BA-86)

- **Goal:** one module composes the words, one function reads them, and no import registers anything.
- **Requirements:** R1, R2, R3, R4, R5; AE1, AE2, AE3; KTD1, KTD2, KTD3, KTD4.
- **Dependencies:** none.
- **Files:**
  - Create: `packages/core/src/refusals/index.ts`
  - Modify: `packages/core/package.json` (the `./refusals` export), `packages/core/src/kernel/refusal.ts`, `packages/core/src/kernel/index.ts`, `packages/core/src/kernel/vocabulary.ts`, and the `vocabulary.ts` of `concepts`, `erasure`, `members`, `runs`, `sources` and `workspaces`
  - Modify: `packages/devtools/lint-rules/rules/import-direction.ts`
  - Modify: `apps/api/src/refusal.ts`, `apps/api/tests/kept-names.ts`
  - Modify: `docs/solutions/architecture-patterns/adr-0043-what-an-act-is.md`, `docs/solutions/architecture-patterns/adr-0029-apps-over-packages-capability-slices.md`, `docs/architecture/c4-components-core.md`
  - Test: `packages/core/test/refusal-words.test.ts`, `packages/core/test/admission.test.ts`, `packages/core/test/import-direction.test.ts`
- **Approach:** write the catalogue and the kernel function first and run core's check, to confirm `import-direction` is the only gate the new module trips before changing the rule. The test's hand-kept table stays word for word, as the proof that no class or owner moved. Its type `EveryRegisteredWord` is read from the catalogue's type, so a union word the catalogue lacks fails typecheck as well as the walk.
- **Patterns to follow:** `EXIT_OF_CLASS` in `apps/api/src/ops/index.ts` for `as const satisfies`; `ZONES` in the rule for a zone's `reaches` and clause.
- **Test scenarios:**
  - Covers AE3. The catalogue, read as word to class and owner, equals the hand-kept table.
  - Covers AE1. The table test passes with no `loadEveryEntryPoint` call before it.
  - Covers AE2. The catalogue and every refusal union's words match both ways over the real tree.
  - `refusalsIn` throws on a word two owners declare, naming the word.
  - `refusalsIn` throws on a word that is not lower case and hyphenated.
  - The rule lets the catalogue import a slice's face and `erasure`'s, and a test import the catalogue.
  - The rule refuses a slice importing the catalogue, and the catalogue importing a slice's internal file or a door.
  - The rule still refuses a slice importing `erasure`.
- **Verification:** core's check and the devtools check pass; `pnpm check:api` passes with `RefusalWord` unchanged but for U2's three words; a search for `declareRefusals`, `refusalRegister` and `RefusalOwner` comes back empty.

### U2. Concepts declares the git door's commit words (BA-117)

- **Goal:** the three words are classed, and the walk and the type checker both hold them.
- **Requirements:** R6, R7; AE4; KTD5.
- **Dependencies:** U1.
- **Files:**
  - Modify: `packages/core/src/concepts/vocabulary.ts`, `packages/core/src/concepts/index.ts`, `packages/core/src/concepts/manifest.ts`
  - Test: `packages/core/test/refusal-words.test.ts`
- **Approach:** the classes in *The New Words*. Run the web's typecheck as soon as the words exist, since they widen the `RefusalWord` the web infers.
- **Test scenarios:**
  - Covers AE4. The git door's `CommitRefusal` extends `WriteConceptRefusal` and the catalogue's words, asserted as types in `refusal-words.test.ts`.
  - The hand-kept table holds the three words with their classes, by concepts.
  - `WriteConceptRefusal`, `AcceptSuggestionRefusal` and the string part of `ImportBundleRefusal`, the unions the concepts face exports, extend the catalogue's words.
- **Verification:** core's check passes; with the three words removed from the vocabulary, typecheck fails at the alias and the walk names them.

### U3. import-bundle exits by class for the import's own words (BA-116)

- **Goal:** a word the import answers exits with its class's code, and the usage text says which runs stay at 1.
- **Requirements:** R8, R9; AE5; KTD6.
- **Dependencies:** U1.
- **Files:**
  - Modify: `apps/api/src/ops/index.ts`
  - Modify: `docs/solutions/architecture-patterns/adr-0043-what-an-act-is.md` (the `pnpm ops` bullet)
  - Test: `apps/api/tests/ops.test.ts`
- **Approach:** read `docs/agents/mutation-triage.md` first, since a mutation report names `ops/index.ts`. The sentence each word prints does not change.
- **Test scenarios:**
  - Covers AE5. `import-bundle --as` a Viewer exits `EXIT_OF_CLASS.forbidden`, its line unchanged.
  - `import-bundle --as` an Editor landing a Restricted bundle exits `EXIT_OF_CLASS.forbidden`, its line unchanged.
  - `import-bundle` into a workspace with no bundle repository exits `EXIT_OF_CLASS.precondition`.
  - `import-bundle` over a tree with no manifest exits 1, with its unsound line.
  - The usage text names `import-bundle` and `reconcile-watermark` on its line for exit 1.
- **Verification:** `pnpm check:api` passes.

---

## Verification Contract

| Gate | Command | Proves |
| --- | --- | --- |
| Core | `pnpm --filter @better-answers/core run check` | the catalogue equals the table and matches the walk both ways; the rule's new cases |
| Api | `pnpm check:api` | the api reads the catalogue; U3's exits |
| Devtools | `pnpm --filter @better-answers/devtools run check` | the rule and the walk's own suites |
| Gates | `pnpm check:gates` | the rule over the whole tree; knip sees every export used |
| Docs | `pnpm check:docs` | the plan and the two decision docs use no retired glossary word |
| Web | `pnpm --filter @better-answers/web run typecheck` | three more refusal words need no entry in a word map |

---

## Definition of Done

- The catalogue is composed in one module, and importing any module registers no word.
- `RefusalOwner`, `declareRefusals`, `refusalRegister` and the api's spread of slices are gone.
- The catalogue equals the hand-kept table, with the three new words and no other change.
- A word the git door adds fails `refusal-words.test.ts`.
- `import-bundle` exits by class for a word the import answers, and the usage text says which runs keep exit 1.
- The pull request body ends with a `Merge risk:` line naming the moved exits and what reads them, then `Fixes BA-86`, `Fixes BA-117` and `Fixes BA-116`.
