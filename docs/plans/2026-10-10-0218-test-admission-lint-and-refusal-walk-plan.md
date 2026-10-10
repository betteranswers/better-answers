---
title: The Admission Lint Watches requireAdmin, and the Refusal Walk Reads Every Union - Plan
type: test
date: 2026-10-10
topic: admission-lint-and-refusal-walk
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
origin: docs/plans/2026-10-08-2311-docs-architecture-review-before-s2-plan.md
execution: code
---

# The Admission Lint Watches requireAdmin, and the Refusal Walk Reads Every Union - Plan

## Goal Capsule

- **Objective:** Two gate holes close before S2a and S3 add reads and refusal words. An `await` before `requireAdmin` or `requireFreshSignIn` fails the lint. A refusal word that no slice declares fails the walk, whatever union it sits in, and cannot reach the operator's command line as anything but a registered word.
- **Means:** widen `action-admits-before-await` to the two calls (KTD1). Replace the walk's alias-name regex with a syntax walk over every `*Refusal` type alias in core's slices (KTD2, KTD3). Concepts and runs declare their words, erasure exports and completes its own, and the api composes all of them (KTD4). `ops`'s `refused` takes `RefusalWord | Error` (KTD5).
- **Product authority:**
  - Linear BA-79 is authoritative: its five acceptance criteria are R1 to R5.
  - `docs/plans/2026-10-08-2311-docs-architecture-review-before-s2-plan.md` (R5's WP4 row, decision 8) and the 08/10 survey's kernel walk (cards 6 and 12) are authoritative for why.
- **Stop conditions:** stop and report to the lead if any of these holds:
  - A production `requireAdmin` or `requireFreshSignIn` site fails the widened lint and cannot be fixed without changing what the action admits.
  - The walk names a word whose class no remedy in the glossary's seven fits.
  - U6 of S2a lands first and adds refusal words to a union; rebase and register them before pushing.
- **Execution profile:** one pull request, reversible. Three `ops` exit codes change (R5).
- **Who finishes:** `ce-work` builds; `/ce-code-review` reviews; `ce-commit-push-pr` opens the pull request. The lead merges.
- **Open blockers:** none.

---

## Product Contract

### Summary

The admission lint treats `requireAdmin` and `requireFreshSignIn` as admitting calls. The refusal-word test reads the string literals of every `*Refusal` type alias under `packages/core/src`, outside the store doors, and holds them against the register both ways. Every word the walk finds is declared by a slice: concepts and runs gain vocabularies, and erasure declares three more words and exports its vocabulary. The api's `REFUSALS` spreads all of them, and `ops` refuses in registered words or an `Error`, never a bare string.

### Problem Frame

ADR 0043 says every refusal word is declared once by its owning slice, registered and classed. The walk that should catch a stray word only reads unions whose text names one of five vocabulary helpers (`BUILT_FROM_A_VOCABULARY`). A union built from `RoleRefusal | "path-taken"` is skipped. Concepts answers thirteen words no slice declares, runs answers `no-such-job`, and erasure answers three more. `ops` takes `string | Error` and checks `isRefusalWord` at runtime, so `reconcile-watermark`'s `no-such-repository` exits with the generic code 1, not its class's code (survey 08/10, card 12).

The lint `action-admits-before-await` watches calls named `admit` only. About twenty actions admit through `requireAdmin` or `requireFreshSignIn`, so for them, admitting before awaiting is held by review alone (card 6).

### Requirements

**The lint**

- R1. The lint flags an `await` before `requireAdmin` or `requireFreshSignIn`, and its message names the call. Its throwaway-tree test has a failing and a passing case for each. AE1.
- R2. The 21 production `requireAdmin` sites and 2 `requireFreshSignIn` sites pass the widened lint. A local run of the widened rule over `packages/core` and `apps` flags none, so no site needs a fix.

**The walk**

- R3. `refusal-words.test.ts` reads every string literal of every `*Refusal` type alias in core's slices, in place of the regex, and a word added to a union the regex never named fails it. AE2, AE3.

**The vocabularies**

- R4. Concepts declares and exports `CONCEPT_REFUSALS`. Erasure exports `ERASURE_REFUSALS` and declares the words its unions answer. Runs declares `no-such-job`. `apps/api/src/refusal.ts`'s spread includes all three.

**The operator's command**

- R5. `ops`'s `refused` takes `RefusalWord | Error`. `ops.test.ts` asserts each exit code that changes, against `EXIT_OF_CLASS`. AE4.

### Acceptance Examples

- AE1. **Covers R1.** **Given** a function that awaits a query and then calls `requireAdmin(principal)`, **then** the lint reports it, naming `requireAdmin`. **And** the same function calling `requireAdmin` first passes. The same pair holds for `requireFreshSignIn`.
- AE2. **Covers R3.** **Given** a source holding `export type ReadThingRefusal = RoleRefusal | "invented-word";`, **when** the walk reads it, **then** it names `invented-word`, and the old regex would not have read that union.
- AE3. **Covers R3.** **Given** a union holding `({ readonly kind: "stopped" } & Shape)` and an alias `KernelRefusalOfClass<"forbidden">`, **then** the walk names neither `stopped` nor `forbidden`.
- AE4. **Covers R5.** **Given** a provisioned workspace with no bundle repository, **when** `reconcile-watermark` runs, **then** it prints `REFUSED — no-such-repository` and exits `EXIT_OF_CLASS.precondition`, where today it exits 1.

### Scope Boundaries

- **Not in this package:**
  - WP15's one refusal catalogue: the module-load register, `RefusalOwner`'s closed union and `loadEveryEntryPoint` stay.
  - WP9's conversion of the twenty `requireAdmin` sites to declared actions.
  - Building the concepts slice's unions from its vocabulary (`ConceptRefusal<…>`). The walk holds the words; the unions stay bare, so U6's files are not touched.
  - The words a union takes through a type reference, such as `CommitRefusal`'s `stale-precondition`, `malformed-path` and `malformed-message` inside `WriteConceptRefusal`. A syntax walk does not resolve references, and the regex did not either. WP15 owns that.
  - `reconcile-watermark`'s `stopped` path, which reports a replay's word inside a sentence and exits 1 as a partial run, not a refusal.
- **Coordination:** S2a's U6 (`feat/s2a-u6-boundary-mcp`) edits `answering/`, `concepts/read.ts`, `apps/api/src/mcp/entries` and `surface.ts`. This plan edits none of them. It adds `concepts/vocabulary.ts` and one export line in `concepts/index.ts`. Whichever merges second rebases, and a word U6 adds to a `*Refusal` union must be registered then.

### Assumptions

- The walk reads every `*Refusal` alias, exported or not. That is a superset of "every exported" and is needed because `unreadable-commit` sits only in the unexported `ReplayRefusal`.
- Each new word's class is chosen by the glossary's remedies (table below). Once shipped, a word never changes class, so these are the owner's to overturn now.

### The New Words

| Word | Owner | Class | Why this remedy |
| --- | --- | --- | --- |
| `path-taken` | concepts | conflict | another concept holds the path; read again |
| `merge-key-taken` | concepts | conflict | another concept holds the merge key |
| `resolution-moved` | concepts | conflict | the suggestion's target moved since it was read |
| `manifest-taken` | concepts | conflict | another bundle's manifest stands at head |
| `rename-refused` | concepts | inapplicable | the write path never moves a concept's file |
| `reclassification-refused` | concepts | inapplicable | a write never changes a concept's class |
| `unreadable-commit` | concepts | inapplicable | a commit the governed write did not make |
| `kind-forbids` | concepts | forbidden | a kind a person may not raise |
| `class-unreadable` | concepts | forbidden | the runner cannot read back the class it imports at |
| `no-such-concept` | concepts | absent | name a concept that exists |
| `no-such-suggestion` | concepts | absent | name a suggestion that exists |
| `no-such-repository` | concepts | precondition | the bundle repository is made or restored first |
| `history-diverged` | concepts | precondition | a person reconciles the rewritten history first |
| `not-seeded` | erasure | precondition | the rehearsal's phase one runs first |
| `no-address` | erasure | precondition | an address to rewrite must be known first |
| `not-an-erasure` | erasure | inapplicable | the request is not an erasure |
| `no-such-job` | runs | absent | name a job that exists |

`widening-refused`, `no-such-document`, `already-decided` and `no-such-group` already belong to sources or members; concepts borrows them, as the kernel's vocabulary comment allows.

### Sources / Research

- The 08/10 survey's kernel walk, opportunities 1 (card 12) and 2 (card 6), attached to BA-35.
- `CONCEPTS.md` § refusal for the seven classes by remedy.

---

## Planning Contract

**Product Contract preservation:** BA-79's five acceptance criteria are R1 to R5, unchanged.

### Key Technical Decisions

- KTD1. **The two calls note admission; only `admit` pairs with a declaration.** The rule's frame notes any of `admit`, `requireAdmin` and `requireFreshSignIn` as the admitting call. Only `admit`'s first argument feeds the `unadmitted` check, so a `requireAdmin(principal)` never counts `principal` as a declaration. The `late` message names the call it found. Governs R1.
- KTD2. **The walk is a devtools scan over sources, and core's test runs it.** `packages/devtools` gains `refusal-unions.ts`, taking `(file, source)` pairs and answering each word with the alias that names it. It parses through `parsedSource`, which throws on a file that does not parse rather than reading it as empty. Its own test proves the reading on fixture strings (AE2, AE3); `refusal-words.test.ts` runs it over core's slices. This follows `table-ownership-scan.ts` and `insert-scan.ts`. Governs R3.
- KTD3. **A refusal type's words are the string literals it is built from.** The walk descends union and intersection members and type arguments. It never reads an object type's property types, which hold discriminators such as `kind: "stopped"`. It never reads the arguments of a `…OfClass` type, which are classes. `store/` is skipped: a store door's word is a defect a slice maps or passes on, never a refusal (the walk's existing `no-bucket` case). Governs R3.
- KTD4. **Each slice's words register when its entry point loads.** `concepts/vocabulary.ts` and `runs/vocabulary.ts` follow `erasure/vocabulary.ts`, and `RefusalOwner` gains `concepts` and `runs`. Each slice's `index.ts` exports its vocabulary, which also loads it. Runs names its word in an exported `JobByIdRefusal`, so the walk sees it. Governs R4.
- KTD5. **`refused` takes a word or an `Error`, and an optional sentence.** A caller that explains a word in a sentence passes both: the line keeps the sentence and the exit takes the word's class. A failure in no word is an `Error` and exits 1. No word is ever sent back to 1 as prose, because the usage text promises class codes for registered words. Governs R5.

### The Exit Codes That Move

| Command | Refusal | Today | After |
| --- | --- | --- | --- |
| `reconcile-watermark` | `no-such-repository` | 1 | 9, precondition |
| `import-bundle` | `not-a-member`, said as "invite them first" | 1 | 4, unauthenticated |
| `erasure-rehearsal` | `not-seeded`, said as "no synthetic subject stands" | 1 | 9, precondition |

No script, workflow or runbook step reads these three exits.

---

## Implementation Units

### U1. The lint watches requireAdmin and requireFreshSignIn

- **Goal:** an `await` before either call fails the lint.
- **Requirements:** R1, R2; AE1; KTD1.
- **Dependencies:** none.
- **Files:**
  - Modify: `packages/devtools/lint-rules/rules/action-admits-before-await.ts`
  - Test: `packages/devtools/test/action-admits-before-await.test.ts`
- **Approach:** a set of admitting call names; the declaration pairing stays on `admit` alone; the `late` message interpolates the call's name.
- **Patterns to follow:** the test's own `holding` and `oxlintOver` cases.
- **Test scenarios:**
  - Covers AE1. A step with no declaration awaits, then calls `requireAdmin`: flagged, and the output names `requireAdmin`.
  - Covers AE1. The same step calling `requireAdmin` first, then awaiting: not flagged.
  - Covers AE1. The same pair for `requireFreshSignIn`.
  - A `requireAdmin(principal)` in a file that declares an action and passes it to `admit` raises no `unadmitted` report naming `principal`.
- **Verification:** the devtools suite passes; `pnpm check:gates` passes over the whole tree, so every production site already admits first.

### U2. The walk reads every refusal union

- **Goal:** the walk sees every literal of every `*Refusal` alias in core's slices.
- **Requirements:** R3; AE2, AE3; KTD2, KTD3.
- **Dependencies:** U3, for the core test to pass.
- **Files:**
  - Create: `packages/devtools/src/refusal-unions.ts`
  - Modify: `packages/devtools/package.json` (export)
  - Test: `packages/devtools/test/refusal-unions.test.ts`
  - Modify: `packages/core/test/refusal-words.test.ts`
- **Approach:** the scan answers word to the alias naming it first. The core test filters `coreSourceFiles()` to non-store files, drops `ALIAS`, `BUILT_FROM_A_VOCABULARY` and `QUOTED`, and keeps the both-ways check and the instrumented-tree skip. `REGISTER` gains the seventeen words.
- **Test scenarios:**
  - Covers AE2. A union built from `RoleRefusal | "invented-word"` names `invented-word`.
  - A word inside a vocabulary helper's argument, `MemberRefusal<"last-admin">`, and inside `RefusedItems<…>`, is named.
  - Covers AE3. An object property's literal and a `KernelRefusalOfClass` argument are not named.
  - An alias whose name does not end in `Refusal` is not read; an unexported `*Refusal` alias is.
  - A source that does not parse throws, naming its file.
  - Core: the register and the walked words match both ways, over the real tree.
- **Verification:** both suites pass; with U3 reverted, the core test names the seventeen words.

### U3. Concepts, erasure and runs declare their words

- **Goal:** every word the walk finds is registered and classed.
- **Requirements:** R4; KTD4.
- **Dependencies:** none.
- **Files:**
  - Create: `packages/core/src/concepts/vocabulary.ts`, `packages/core/src/runs/vocabulary.ts`
  - Modify: `packages/core/src/concepts/index.ts`, `packages/core/src/erasure/vocabulary.ts`, `packages/core/src/erasure/index.ts`, `packages/core/src/runs/index.ts`, `packages/core/src/kernel/refusal.ts`, `apps/api/src/refusal.ts`
- **Approach:** the classes in *The New Words*. A comment states a word's remedy only where its class is not plain from the word.
- **Test expectation:** covered by U2's core test, which holds the register to `REGISTER`.
- **Verification:** `refusal-words.test.ts` passes; the api typechecks with the wider `RefusalWord`.

### U4. ops refuses in registered words

- **Goal:** `refused` takes `RefusalWord | Error`, and the moved exit codes are asserted.
- **Requirements:** R5; AE4; KTD5.
- **Dependencies:** U3.
- **Files:**
  - Modify: `apps/api/src/ops/index.ts`
  - Test: `apps/api/tests/ops.test.ts`
- **Approach:** narrow `refused`'s reason and add its optional sentence. `import-bundle` passes `not-a-member` with its sentence; `rehearsalReason` gives way to the sentence for `not-seeded`.
- **Test scenarios:**
  - Covers AE4. `reconcile-watermark` with no repository exits `EXIT_OF_CLASS.precondition`, its line unchanged.
  - `import-bundle` for a non-member's email exits `EXIT_OF_CLASS.unauthenticated`, its line unchanged.
  - `erasure-rehearsal --run` where phase one never ran exits `EXIT_OF_CLASS.precondition`, in its own test and in the drill's table.
- **Verification:** `pnpm check:api` passes.

---

## Verification Contract

| Gate | Command | Proves |
| --- | --- | --- |
| Devtools | `pnpm --filter @better-answers/devtools run check` | U1's lint cases, U2's scan |
| Core | `pnpm --filter @better-answers/core run check` | the register matches the walk both ways |
| Api | `pnpm check:api` | U4's exits; the api composes every vocabulary |
| Gates | `pnpm check:gates` | the widened lint over every production site; knip sees the new export used |
| Docs | `pnpm check:docs` | this plan uses no retired glossary word |

---

## Definition of Done

- The lint flags an `await` before either call, and no production site.
- The walk names every literal of every `*Refusal` alias in core's slices, and the register matches it both ways.
- `ops` refuses in registered words or an `Error`; the three moved exits are asserted.
- The pull request body ends with `Merge risk: reversible, three ops exit codes change` and `Fixes BA-79`.
