---
title: The Admitted Principal's Type, and Every Face Admitting - Plan
type: fix
date: 2026-10-10
topic: admission-types-and-face-admission
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
origin: docs/plans/2026-10-10-1434-refactor-one-admission-declaration-plan.md
execution: code
---

# The Admitted Principal's Type, and Every Face Admitting - Plan

## Goal Capsule

- **Objective:** Whoever writes S3's concept actions cannot ship a face that admits nobody, and cannot be handed an Admin by the type checker where the action admitted a lower role.
- **Means:** The kernel types an admitted person by the lowest role its declaration can name (KTD1). Every face that takes a person declares what it admits, and a check over each face names one that does not (KTD3, KTD5).
- **Issues:** BA-141 and BA-142, landed as one pull request. Both follow BA-84 (#691).
- **Authority:** The two issues' acceptance criteria, then `docs/solutions/architecture-patterns/adr-0043-what-an-act-is.md`, then the root `CODING_STANDARDS.md`. This plan decides how.
- **Execution profile:** One branch, `liam/ba-141-admission-typing-and-lint`, in its own worktree. The units land in order, and each leaves the tree compiling.
- **Stop conditions:** Stop and report if a face test has to change a run-time expectation, if a `refuses` list needs a word the catalogue lacks, or if declaring `ask` needs any change beyond its declaration, its admission and its refusal type.
- **Who ships:** The implementing agent opens the pull request. The lead queues the merge.

---

## Product Contract

### Summary

Two gaps were left by the change that made `admit` the only way to judge a role. The first is in the types: a declaration whose role is not one literal is read as admitting an Admin, so the type checker would let such an action hand its principal to a step that only an Admin may run. The second is that nothing holds a new face to admit at all. This plan closes both. The kernel reads a union of roles as its lowest member, and eight faces that admitted every role by their parameter type now declare that level and pass it to `admit`. A check over each face then names any function that takes a person and admits nobody.

### Problem Frame

`AdmittedOf` reads a declaration's role through `Reaching` in `packages/core/src/kernel/admission.ts`. `Reaching` walks the role list from the highest and answers at the first role that extends the named one. A union of roles, or the plain `Role` type, is extended by `"Admin"`, so the walk stops there. `enqueueJobAction` in `packages/core/src/runs/index.ts` is the live case: its level comes from the job kind's descriptor, typed `Role`. Run-time admission is right. Since #691, `admit`'s result is the only source of an `AdminUserPrincipal`, and about forty steps take one and judge nothing, so a wrong type here is the one way a lower role could reach them unseen.

The lint `action-admits-before-await` holds the order of admission, and holds that a declaration is passed to `admit`. It says nothing about a face with no declaration. `ask`, `giveFeedback`, `submitSuggestionSet`, `suggestionSetSummary`, `conceptByIri`, `footnotesOf`, `readMember` and `listModelChoices` take a `UserPrincipal` and call no `admit`. Each is right today, because every role may ask for it. A new face written the same way by mistake would pass every gate. Decision 5 of the architecture review declared `find`, `open` and Search as Viewer-level actions for this reason.

### Requirements

**The admitted type (BA-141)**

- R1. `AdmittedOf` of a declaration whose role is a union, or the plain `Role`, is a person at the lowest role the union allows or above. It is never an Admin alone.
- R2. `packages/core/test/admission.test.ts` holds R1 with a type assertion on `enqueueJobAction`, beside the one for `writeConceptAction`, and with one on a declaration whose computed role is a union of two.
- R3. The comment on `writeConceptAction` no longer warns against one object with a computed role. It says what still holds.

**Every face admits (BA-142)**

- R4. A face that every role may ask for declares `{ role: "Viewer", purposes: [] }` and passes the declaration to `admit` before its first `await`.
- R5. Each newly declared face answers every person of the three roles what it answered before.
- R6. A check names each function that a slice's or a layer's face exports, that takes a person, and that passes no declaration to `admit`. A step is exempt by an allow-list that gives its reason. A new directory under `packages/core/src` is checked without being named.
- R7. The allow-list and the list of directories left out are each held both ways: an entry the check no longer finds, or a directory the tree no longer has, fails it.
- R8. `suggestionSetSummary`'s check that a person who is not an Admin reads only their own set is a refusal inside its declared action.
- R9. `ask` changes by its declaration, its admission and its refusal type, and by nothing else.

**Refusal words**

- R10. Every word in a new `refuses` list is already in `REFUSAL_CATALOGUE`. No word is added, removed or reclassed.

**Records**

- R11. `adr-0043-what-an-act-is.md` says which faces declare and what holds it, in the commit that adds the check, with a History entry. The root `CODING_STANDARDS.md` says the same in its admission rule.

### Acceptance Examples

- AE1. **Covers R1, R2.** Given `enqueueJobAction`, whose role is typed `Role`, the person in `AdmittedOf<typeof enqueueJobAction>` has the role `Role`, and a Viewer is assignable to it. The same assertion reads `"Admin"` before the change.
- AE2. **Covers R1, R2.** Given a declaration whose `admits` returns one object with the role `"Editor" | "Viewer"`, the admitted person's role is `Role`. Given one with `"Admin" | "Editor"`, it is `"Admin" | "Editor"`.
- AE3. **Covers R4, R5.** Given an Admin, an Editor and a Viewer, when each calls a newly declared face, each gets the answer it got before. A role outside the three is refused `role-forbids` by `admit` itself, which the kernel's own case in `packages/core/test/admission.test.ts` holds for every level, as it does for `find` and `open`.
- AE4. **Covers R6.** Given a face file that exports a function taking a `UserPrincipal` and calling no `admit`, the check names the function and its file. When the function passes a declaration to `admit`, the check is silent.
- AE5. **Covers R6, R7.** Over the committed tree, the functions the check finds are exactly the allow-list's entries.
- AE6. **Covers R8.** Given a set holding another person's suggestion, a Viewer and an Editor read `role-forbids` and an Admin reads the set, as before.

### Scope Boundaries

- A function whose principal is annotated `AdminUserPrincipal`, `PlatformPrincipal`, `OperatorPrincipal` or a platform principal typed by its purpose is outside the check. Only `admit` makes the first, and the others hold no role.
- The kernel, `access`, the store doors and the refusal catalogue are outside the check, by name. None of them holds an action.
- No step leaves a face. `eventsAsked` and `eventsNamed` stay exported from members' face, and are allow-listed.
- No real zod schema is written for an input no entry parses in core. `ask` and `giveFeedback` are parsed by the MCP entry's own schema in `apps/api`.
- `enqueueJob` keeps admitting inside `enqueueJobIn`.
- No mutation report is edited.

#### Deferred to Follow-Up Work

- Holding that no transport imports an allow-listed step. Today a step's entry says which action calls it, and nothing checks that. No file under `apps/api/src` reaches one today. The build report names this for the lead to group.
- Reading a principal behind a type alias or inside an object parameter. The check reads a parameter's own annotation.
- Holding that a face uses the principal `admit` handed back. The check and the lint both count any call to `admit`.

### Assumptions

These are defaults taken without the owner's ruling. Each is listed in the build report as a decision the owner may overturn.

- **A face that admits every role declares it.** This is the lead's default, following decision 5 of the architecture review. The other choice is to leave such a face typed only and hold nothing.
- **Layers are checked as well as slices.** `listModelChoices` is in the `llm` layer and a tRPC procedure reaches it with the principal the transport built. The cost is five allow-list entries for the audit layer's steps.
- **`giveFeedback` is declared.** An MCP entry reaches it with the transport's principal, so it is a face. Its result type gains `role-forbids`, which changes one type assertion (*Tests That Change*).
- **The reads only tests reach are declared.** `conceptByIri`, `footnotesOf`, `submitSuggestionSet` and `suggestionSetSummary` have no caller in `apps/` yet. Each is written as a face for a transport to call, and the issue names them.
- **The cross-slice reads are steps.** `findConcepts`, `readConcept`, `findPassages` and `passageAt` are called only by `find`, `open` and `ask`, with the principal those admitted. Declaring them would admit the same person twice.
- **The check is a test over each face, not an oxlint rule.** Whether a function is on a face is a fact about two files, and oxlint reads one at a time.

### Sources / Research

- `packages/core/src/kernel/admission.ts`: `Reaching`, `Admitted`, `AdmitsOf`, and `ADMIN_ALONE` beside `OPERATOR_ALONE`.
- `packages/core/src/answering/index.ts`: `findAction`, `openAction` and their `READERS` constant, the shape the new declarations take.
- `packages/core/src/members/index.ts`: nine files are re-exported whole with `export *`, so a face's functions cannot be read from its index file alone.
- `packages/devtools/src/refusal-unions.ts` and `packages/core/test/refusal-words.test.ts`: a source reader over `oxc-parser` in devtools, run over the committed tree by a core test. `packages/core/test/source-tree.ts` lists core's source files and says when Stryker has instrumented them.
- `packages/devtools/lint-rules/rules/import-direction.ts`: the zones a directory under `packages/core/src` falls in. Its lists are not exported.
- A prototype of the check over the tree at `467d3056` found 24 functions: the eight faces and the sixteen steps of *The Allow-List*. No exported face function takes an `AdmittedOf` or an intersection today.
- `docs/agents/mutation-triage.md`: stage by path, and confirm the `src` diff before the pull request.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **`Reaching` distributes over the named role.** A union's reach is the union of each member's reach, which is the reach of its lowest member. `Reaching<Role>` is then `Role`, and `Reaching<"Admin" | "Editor">` is `"Admin" | "Editor"`. `Admitted` already distributes over a union of declarations, so nothing else in the kernel moves.
- KTD2. **`writeConceptAction` keeps its two constants.** After KTD1 one object with a computed role would type the same. The two constants stay because `BUNDLE_WRITERS` and `ADMIN_ALONE` are each named elsewhere, and the type test pins the result either way.
- KTD3. **One constant for the level, in the kernel.** `ANY_ROLE` is `{ role: "Viewer", purposes: [] }`, beside `ADMIN_ALONE`. Answering's `READERS` goes, and `findAction` and `openAction` name the kernel's constant. Eight more declarations spelling the object out would fail the duplication gate.
- KTD4. **A declared face's input follows #691's convention.** A face with no input declares `z.object({})`. A face whose input no schema in core parses declares `z.custom<T>()` over its existing type.
- KTD5. **The check is a reader in devtools and a test in core.** `packages/devtools/src/face-admission.ts` takes a tree of sources and the face directories, and answers the functions that admit nobody. `packages/core/test/face-admission.test.ts` runs it over `packages/core/src` and compares the answer with the allow-list. The test reads the face directories from the tree: every directory under `packages/core/src`, less the four it names (`kernel`, `access`, `store`, `refusals`).
- KTD6. **What the reader calls a face function.** A function that a directory's `index.ts` exports: one it declares, one it re-exports by name from a file beside it, or any function a file it re-exports whole exports. A re-export from another directory is that directory's own.
- KTD7. **What the reader calls taking a person.** A parameter whose annotation names `UserPrincipal`, `Principal` or `AdmittedOf<…>`, alone or as a member of a union or an intersection. After KTD1 an `AdmittedOf` of a Viewer-level declaration is a type every person fits, so it cannot be exempt. The kernel's narrower names are exempt: `AdminUserPrincipal`, `PlatformPrincipal`, `OperatorPrincipal` and the purpose-typed platform principals.
- KTD8. **What the reader calls admitting.** A call to `admit` whose first argument is a name, anywhere in the function's body. This is how `action-admits-before-await` reads a declaration as admitted.
- KTD9. **`suggestionSetSummary` admits, then reads, then refuses.** Admission cannot judge ownership, because it reads no row. The declaration admits `ANY_ROLE` and lists `role-forbids` once, and the check after the read answers that word as it does today.
- KTD10. **The allow-list is data with a reason.** Each entry maps a face and a function to one sentence naming the action that admits for it. The test prints the reason beside a name it no longer finds.
- KTD11. **A step is typed by what its callers hold, where that costs nothing.** `recordGrantsEndedHere`, `endWorkspaceTokens` and `eventsOfAction` are called only with an admitted Admin or the platform. Each takes that narrower type and leaves the allow-list, if no caller and no test has to change for it. One that would need such a change keeps its type and its entry.

### The Eight Faces

| Face | File | Input | Refusal union gains |
| --- | --- | --- | --- |
| `ask` | `packages/core/src/answering/index.ts` | `z.custom` over `{ question }` | `role-forbids` |
| `giveFeedback` | `packages/core/src/answering/index.ts` | `z.custom<FeedbackInput>()` | `role-forbids`, where it had none |
| `conceptByIri` | `packages/core/src/concepts/index.ts` | `z.custom<ConceptIri>()` | `role-forbids` |
| `submitSuggestionSet` | `packages/core/src/concepts/suggestions.ts` | `z.custom<SubmitSuggestionSetInput>()` | `role-forbids` |
| `suggestionSetSummary` | `packages/core/src/concepts/suggestions.ts` | `z.custom<string>()` | nothing: it answers `role-forbids` today |
| `footnotesOf` | `packages/core/src/guides/index.ts` | `z.custom<string>()` | `role-forbids` |
| `readMember` | `packages/core/src/workspaces/index.ts` | `z.object({})` | `role-forbids` |
| `listModelChoices` | `packages/core/src/llm/index.ts` | `z.object({})` | `role-forbids` |

### The Allow-List

| Face | Function | Why it is a step |
| --- | --- | --- |
| concepts | `findConcepts` | `find` and `ask` call it with the reader they hold |
| concepts | `readConcept` | `open` calls it with the reader it admitted |
| concepts | `cascadingVisibility` | runs its caller's write inside that action's transaction |
| sources | `findPassages` | `find` calls it with the reader it admitted |
| sources | `passageAt` | `open` and a concept read call it for the reader they hold |
| guides | `recomputeWriteUpsIncluding` | a visibility change and a landed write call it in their transaction |
| members | `eventsAsked` | the audit log's and the export's actions call it after admitting |
| members | `eventsNamed` | the audit log's, the export's and the activity's actions call it after admitting |
| runs | `enqueueJob` | opens the transaction `enqueueJobIn` admits in |
| workspaces | `recordGrantsEndedHere` | writes an audit event in its caller's transaction (KTD11 may remove it) |
| workspaces | `endWorkspaceTokens` | ends tokens in its caller's transaction, for the principal that action admitted (KTD11 may remove it) |
| audit | `record` | writes the audit event of the action that called it |
| audit | `recordEach` | writes the audit events of the action that called it |
| audit | `eventsOfAction` | the reconciler reads through it as the platform (KTD11 may remove it) |
| audit | `eventsNewestFirst` | the audit log's action reads through it after admitting |
| audit | `eventsSoughtNewestFirst` | the audit log's and the activity's actions read through it after admitting |

### Tests That Change, and Why

| Test | Change | Reason |
| --- | --- | --- |
| `packages/core/test/answering.test.ts`, "hands every caller an outcome to read, not to catch" | `ask`'s result type gains `role-forbids`, and `giveFeedback`'s error type is `role-forbids` where it was `never` | A declared action answers admission's word in its type. No run-time case changes. |
| `packages/core/test/admission.test.ts`, the `everyone`-style fixtures | may name `ANY_ROLE` where they spell the level | KTD3. The assertions stand. |

No other test changes an expectation. A type annotation in a test that spells a face's old refusal union is corrected to the new one and named in the build report.

---

## Implementation Units

### U1. The kernel types a union of roles by its lowest

- **Goal:** R1, R2 and R3.
- **Requirements:** R1, R2, R3. Covers AE1, AE2.
- **Dependencies:** none.
- **Files:** `packages/core/src/kernel/admission.ts`, `packages/core/src/concepts/index.ts` (the comment only), `packages/core/test/admission.test.ts`.
- **Approach:** KTD1 and KTD2. The existing walk becomes the reach of one role, and `Reaching` applies it to each member of the named union.
- **Execution note:** Write the assertions first and watch the typecheck fail on them. An assertion that the admitted type is not an Admin passes on the old code too, because the platform arm never extends a person. Read the person's role out of the admitted type and compare it exactly.
- **Test scenarios:**
  - The person the enqueue admits is typed at any role: the role read from `AdmittedOf<typeof enqueueJobAction>` equals `Role`, and the platform is still admitted.
  - A computed role of two lower levels reaches all three, and one of the two higher reaches those two.
  - An Admin-only declaration still admits an Admin alone, and `writeConceptAction` still admits an Editor or above and no Viewer: the existing assertions pass unchanged.
- **Verification:** The new assertions fail before the kernel edit and pass after it, and the core typecheck passes.

### U2. Eight faces declare the level every role reaches

- **Goal:** R4, R5, R8, R9 and R10.
- **Requirements:** R4, R5, R8, R9, R10. Covers AE3, AE6.
- **Dependencies:** U1.
- **Files:** `packages/core/src/kernel/admission.ts`, `packages/core/src/kernel/index.ts`, the six files of *The Eight Faces*, `packages/core/src/sources/dpia.ts` if its refusal union needs the word passed on, `packages/core/src/workspaces/grants.ts` and `packages/core/src/audit/index.ts` for KTD11, `packages/core/test/answering.test.ts`, `packages/core/test/admission.test.ts`. Read, and edited only where a type annotation spells an old union: the core and api suites that call the eight faces, `apps/api/src/mcp/entries/index.ts`, `apps/api/src/trpc/router.ts`.
- **Approach:** KTD3, KTD4, KTD9 and KTD11. Each face admits first and uses the principal `admit` hands back. `conceptByIri` becomes `async`, because it returned a promise without awaiting. `ask` gains only its declaration, the admission and the refusal type.
- **Patterns to follow:** `find` and `open` in `packages/core/src/answering/index.ts`.
- **Test scenarios:**
  - Each of the three roles is answered by every newly declared face as before: the existing face tests pass with no run-time expectation changed.
  - A Viewer and an Editor reading another person's suggestion set are refused `role-forbids`, and an Admin reads it: the existing cases pass unchanged.
  - `ask` still answers `refuse` with the concepts its words find: the existing cases pass unchanged.
  - Every word a new declaration refuses is catalogued: the refusal walk passes unchanged.
- **Verification:** The core check, `pnpm check:api` and the web typecheck pass, and `Stryker disable` comments in `packages/core/src/concepts/index.ts` sit on the lines they were written for.

### U3. A reader names a face function that admits nobody

- **Goal:** The reader half of R6.
- **Requirements:** R6. Covers AE4.
- **Dependencies:** none.
- **Files:** `packages/devtools/src/face-admission.ts`, `packages/devtools/package.json` (the exports map), `packages/devtools/test/face-admission.test.ts`, `packages/devtools/README.md`.
- **Approach:** KTD5 to KTD8. The reader is pure: it is handed sources by path and reads no file. It throws on a file that does not parse, through `parsedSource`.
- **Patterns to follow:** `packages/devtools/src/refusal-unions.ts` and its test.
- **Test scenarios:**
  - A function on a face that takes a `UserPrincipal` and calls no `admit` is named, with its face and file.
  - The same function passing a declaration to `admit` is not named, and neither is one that admits inside a callback.
  - A function taking `Principal`, a union or an intersection holding `UserPrincipal`, or an `AdmittedOf<…>` is named. One taking `AdminUserPrincipal`, `PlatformPrincipal` or a purpose-typed platform principal is not.
  - A function re-exported by name from a file beside the index is named, and so is one in a file re-exported whole. A function exported from its file and not from the face is not named.
  - A function declared with `function`, and one exported in a list after its declaration, are read as an arrow constant is.
  - A source that does not parse throws.
- **Verification:** The devtools check passes.

### U4. The committed tree's faces admit, or are listed as steps

- **Goal:** R6 and R7 over `packages/core/src`.
- **Requirements:** R6, R7. Covers AE5.
- **Dependencies:** U2, U3.
- **Files:** `packages/core/test/face-admission.test.ts`.
- **Approach:** KTD5 and KTD10. The test hands the reader core's sources from `source-tree.ts` and the face directories it read from the tree, and compares what comes back with *The Allow-List*. It is skipped while Stryker has the tree instrumented, as the refusal walk is.
- **Test scenarios:**
  - The functions found are exactly the allow-list's, so a new face that admits nobody fails with its name, and an entry for a function that now admits fails too.
  - Every allow-list entry gives a reason.
  - Every directory the test leaves out is one the tree has, so a renamed one fails, and a directory in neither list is checked.
- **Verification:** The test passes on the tree after U2. Removing the `admit` from one declared face by hand makes it fail with that face's name, and the edit is then reverted.

### U5. The records say which faces declare

- **Goal:** R11.
- **Requirements:** R11.
- **Dependencies:** U4.
- **Files:** `docs/solutions/architecture-patterns/adr-0043-what-an-act-is.md`, `CODING_STANDARDS.md`.
- **Approach:** This unit's edits are committed with U4's, the commit that completes the check (R11). The decision doc's action bullets gain the rule and the test that holds it, and its History gains an entry for this plan. The standards' admission rule gains one sentence.
- **Test expectation:** none -- prose only. `pnpm check:docs` holds the words.
- **Verification:** `pnpm check:docs` passes.

---

## Verification Contract

| Check | Proves |
| --- | --- |
| `pnpm --filter @better-answers/core run check` | the type assertions, every face's cases, the refusal walk, the face check over the tree |
| `pnpm check:api` | the MCP entries and the tRPC procedures still cross every face's refusal |
| `pnpm --filter @better-answers/devtools run check` | the reader's cases |
| `pnpm check:gates` | the lint over the whole tree, the duplication gate, the format check, knip |
| `pnpm check:docs` | the words gate over the plan, the decision doc and the standards |
| `pnpm --filter @better-answers/web run typecheck` | the web still infers every refusal union |

All six run on the exact head that is pushed. A latency-budget or timeout failure on code this branch does not touch is rerun alone before it counts.

---

## Definition of Done

- Every acceptance example holds, and each criterion of BA-141 and BA-142 has its proof named in the build report.
- The six checks pass on the pushed head.
- `git diff --stat origin/main..HEAD -- packages/core/src` shows only the files the units name.
- No abandoned attempt is left in the diff, and the prototype of the check is not committed.
- The build report lists the eight faces by slice, the allow-list with each reason, and every assumption above as a decision the owner may overturn.
