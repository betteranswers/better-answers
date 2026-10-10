---
title: One Admission Declaration for Every Gated Action, and the Manifest Commit's Word - Plan
type: refactor
date: 2026-10-10
topic: one-admission-declaration
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
origin: docs/plans/2026-10-08-2311-docs-architecture-review-before-s2-plan.md
execution: code
---

# One Admission Declaration for Every Gated Action, and the Manifest Commit's Word - Plan

## Goal Capsule

- **Objective:** Whoever writes S3's concept actions finds one way to admit an action, and the lint and the refusal walk see every gated action in core. An operator whose import loses a race for the bundle's head while it writes the manifest gets an exit code that says to run it again.
- **Means:** Every action that judged a role by hand is declared and admitted through `admit` (KTD1), and a refused manifest commit keeps the git door's word (KTD7).
- **Issues:** BA-84 (package WP9 of the origin plan, under the origin's own R4, R5 and R10) and BA-131, landed as one pull request.
- **Authority:** The two issues' acceptance criteria, then `docs/solutions/architecture-patterns/adr-0043-what-an-act-is.md`, then the root `CODING_STANDARDS.md`. This plan decides how.
- **Execution profile:** One branch, `liam/ba-84-one-admission-declaration`, in its own worktree. The units land in order, and each leaves the tree compiling.
- **Stop conditions:** Stop and report if a face test's `role-forbids` case has to change its expectation, if a `refuses` list needs a word the catalogue lacks, or if `writeConcept`'s signature has to change.
- **Who ships:** The implementing agent opens the pull request. The lead queues the merge.

---

## Product Contract

### Summary

Core has three ways to judge whether a principal may ask for an action: a declaration read by `admit`, the shorthand `requireAdmin`, and a role compared by hand. This plan leaves one. Each of the 21 `requireAdmin` sites is admitted through a declaration, and so are the import and the manifest write, which compared the role by hand. `effect` leaves the declaration, and `requireAdmin` is deleted. Beside it, `importBundle` passes on `stale-precondition` when the git door refuses the manifest commit, so `pnpm ops import-bundle` exits as a conflict.

### Problem Frame

`adr-0043-what-an-act-is.md` says an action "is declared beside its hand-written face function". About half of core's gated actions are not: they call `requireAdmin`, or compare `principal.role` themselves. The refusal walk reads a declaration's `refuses` list, so it sees those actions' words only where a `*Refusal` alias happens to name them. An author of a new action has to pick a mechanism, and S3 adds the concept actions next.

`ActionDeclaration.effect` is read by nothing but two assertions in `packages/core/test/admission.test.ts`.

BA-131 is a separate defect in the same file. `manifestRefusalOf` in `packages/core/src/concepts/index.ts` turns a manifest commit refused as `stale-precondition` into an `Error` whose message names the word. `pnpm ops import-bundle` then prints a refusal word and exits 1, which the usage text keeps for a run that names where it stopped.

### Requirements

**Admission**

- R1. Each of the 21 production `requireAdmin` sites is admitted through `declareAction` and `admit`. Twenty admit in a face of their own. `latestIndexOutcomeIn` runs for the Admin its one caller's declaration admitted (KTD3). The count by slice is concepts 4, erasure 2, members 6, runs 5, sources 4.
- R2. Every converted face answers `role-forbids` to the same principals as before, and answers every other principal what it answered before. No face test changes an expectation.
- R3. A helper that held the gate for several faces takes the principal its face admitted and judges nothing.
- R4. `writeConcept` is a declared action over an unexported step. Its name and signature are unchanged. Acceptance, the import and the erasure rehearsal reach the step through it.
- R5. `effect` is gone from the declaration type and from every declaration, and `admission.test.ts` no longer reads it.
- R6. `requireAdmin` is not exported from the kernel's face, and no file under `apps/` or `packages/` names it.

**Refusal words**

- R7. Every word in a new `refuses` list is already in `REFUSAL_CATALOGUE`. No word is added, removed or reclassed.
- R8. A converted face's refusal union is read from its declaration, so its words are stated once.

**The manifest commit (BA-131)**

- R9. A manifest commit the git door refuses as `stale-precondition` reaches `importBundle`'s caller as that word, and `pnpm ops import-bundle` exits with the conflict class's code.
- R10. `malformed`, `malformed-path` and `malformed-message` on the manifest commit stay an `Error`, and the command exits 1. The usage text and `adr-0043-what-an-act-is.md` name that exception.

**Records**

- R11. `adr-0043-what-an-act-is.md` is edited in the commit that changes the import's exit, and gains a History entry for this plan.

### Acceptance Examples

- AE1. **Covers R1, R2.** Given an Editor and a Viewer of a workspace, when either calls a converted Admin-only face (`createGroup`, `listConnectedSources`, `recordSubjectRequest`, `runsOfSubject`, `acceptSuggestions`), then it answers `role-forbids`. An Admin gets the answer they got before.
- AE2. **Covers R4.** Given a workspace with a bundle, when an Editor writes a concept it lands. When a Viewer writes one, or an Editor writes one carrying an acceptance, `writeConcept` answers `role-forbids`. An Admin's acceptance without a `base` precondition answers `malformed`.
- AE3. **Covers R1, R2.** Given the platform acting for any purpose, when it calls `jobById`, `endedSyncs` or `lockSyncIn`, it is admitted. An Editor is refused `role-forbids`.
- AE4. **Covers R9.** Given a workspace whose bundle ref cannot be moved when the import writes its manifest, when `importBundle` runs, then it answers `stale-precondition`. `pnpm ops import-bundle` prints one refusal line and exits 8.
- AE5. **Covers R10.** When `pnpm ops` prints its usage, the line on runs that exit 1 names the manifest commit the git door calls malformed.
- AE6. **Covers R5, R6.** A search of `apps/` and `packages/` for `requireAdmin` finds nothing, and no `declareAction` call carries an `effect` key.

### Scope Boundaries

- No real zod schema is written for an input no entry parses yet. S3 writes `writeConcept`'s when it puts the action behind tRPC.
- `suggestionSetSummary` keeps its check that a person who is not an Admin reads only their own set. It judges rows it has read, which is not admission.
- Faces that admit by their parameter type alone (`ask`, `submitSuggestionSet`, the reads that take any `UserPrincipal`) gain no declaration here. They hold no gate to convert.
- `AdminUserPrincipal` and `RoleRefusal` stay on the kernel's face. Some forty step signatures take the first, and the refusal walk reads the second.
- No mutation report is edited. The September reports name lines in files this plan edits, and those line numbers go stale.

#### Deferred to Follow-Up Work

- A lint for an exported face that admits nobody: the 06/10/2026 survey's card G6. Look for an open issue before filing one.

### Assumptions

These are defaults taken without the owner's ruling. Each is listed in the build report as a decision the owner may overturn.

- **The input convention.** A declaration's `input` is the schema its entry already parses with. A face that takes no input declares `z.object({})`, as `listMembersAction` does. A face whose input no entry parses declares `z.custom<T>()` over its existing type, which states the type and parses nothing.
- **The malformed manifest commit stays an error (R10).** Only a defect in the import can cause it, and no caller can act on it. The lead's default.
- **`importBundle` and `writeManifest` are converted too.** They are not `requireAdmin` sites. They compare the role by hand in the files this plan already edits, and leaving them would keep a third mechanism beside `writeConcept`'s declaration.
- **The lint stops naming `requireAdmin`.** BA-79 added the name this morning. Once the function is deleted, a call to it fails typecheck first.
- **`holdsEveryGroup` keeps its own gate.** `adr-0043-what-an-act-is.md` says a step judges nothing, and this read runs inside its caller's transaction. Its face test asserts `role-forbids` for an Editor and a Viewer, and R2 holds that test.

### Sources / Research

- `packages/core/src/answering/index.ts`: `findAction` and `openAction`, the shape to converge on.
- `packages/core/src/sources/connected-source.ts`: `reprocessConnectedSource` and `actingOn`, a face that admits and hands a helper the admitted principal.
- `packages/core/src/runs/index.ts`: `enqueueJobAction`, whose `admits` reads the input, and `latestRunsOf`, a read that takes `AdminUserPrincipal` and judges nothing.
- `packages/devtools/lint-rules/rules/action-admits-before-await.ts`: a declaration must be passed to `admit` by a function in its own file.
- `packages/core/src/store/git/index.ts`: `commitFailure` answers `stale-precondition` when `git update-ref` cannot lock the ref, whatever head was expected.
- GitNexus `impact`, upstream: `requireAdmin` CRITICAL (21 direct callers, 67 symbols), `writeConcept` HIGH, `declareAction` HIGH. The index was 19 commits behind `main`.
- `docs/agents/mutation-triage.md`: stage by path, and confirm the `src` diff before the pull request.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **A declaration per face, not per `requireAdmin` site.** The decision doc declares an action beside its face function, and the lint pairs a declaration with an `admit` in the same file. So a helper's one site becomes one declaration for each face that called it. The 21 sites become 33 declarations, and two more for the import and the manifest.
- KTD2. **A shared helper takes the admitted principal.** `adminOnConnectedSource`, `groupTarget`, `claimForDecision`, `decide` and `readsSyncs` stop judging. So do the helpers that only passed a principal on to one of them: `memberTarget`, `sensitivitySet` and `spansCommanded`. Each face admits first and passes `admitted.value`. `reprocessConnectedSource` already does this with `actingOn`.
- KTD3. **An exported function with a gate and a test on it keeps the gate.** `holdsEveryGroup` and `lockSyncIn` are declared and admit in their own bodies. `latestIndexOutcomeIn` has one caller, which has admitted an Admin, and no test of its own gate, so it takes `AdminUserPrincipal` as its neighbour `latestRunsOf` does.
- KTD4. **`writeConcept`'s `admits` reads its input.** It admits an Editor, or an Admin when the input carries an acceptance. `admits` returns one of two constant objects, one for each level, so the admitted type is a person who is an Editor or above. One object whose `role` is computed would be typed as an Admin, because the kernel reads a union of roles as its highest. The `malformed` answer for an acceptance without a `base` precondition stays after `admit`.
- KTD5. **`returnToProposer` is a step.** Only `acceptSuggestions` reaches it, after admitting an Admin. `declineSuggestion` is the declared face over `decide`.
- KTD6. **Admission for a person or any platform purpose is `{ role: "Admin", purposes: EVERY_PURPOSE }`.** That is what `jobById` and `readsSyncs` wrote by hand.
- KTD7. **The manifest's `stale-precondition` falls through `manifestRefusalOf` as itself.** `ImportBundleRefusal` gains the word, which concepts already declares as a conflict. `importRefused` in `apps/api/src/ops/index.ts` sends any string refusal to `refused`, so the exit follows with one new sentence and no new branch.
- KTD8. **`effect` goes in one unit, before any conversion.** Removing a key from the declaration type breaks every existing declaration at once, so the new declarations are written without it from the start.

### The Twenty-One Sites

| # | Site | Slice | Becomes |
| --- | --- | --- | --- |
| 1 | `requestRefusalOf` in `concepts/index.ts` | concepts | `writeConcept` declared (KTD4) |
| 2 | `acceptSuggestions` | concepts | declared |
| 3 | `decide` in `concepts/suggestions.ts` | concepts | `declineSuggestion` declared; `decide` takes the Admin (KTD5) |
| 4 | `overrideConceptSensitivity` | concepts | declared |
| 5 | `recordSubjectRequest` | erasure | declared |
| 6 | `subjectRequestFor` | erasure | declared |
| 7 | `groupTarget` in `members/groups.ts` | members | `renameGroup`, `deleteGroup`, `addToGroup`, `removeFromGroup` declared |
| 8 | `createGroup` | members | declared |
| 9 | `holdsEveryGroup` | members | declared (KTD3) |
| 10 | `listGroups` | members | declared |
| 11 | `claimForDecision` in `members/requests.ts` | members | `approveRequest`, `declineRequest` declared |
| 12 | `listWaitingRequests` | members | declared |
| 13 | `jobById` | runs | declared (KTD6) |
| 14 | `latestIndexOutcomeIn` | runs | takes `AdminUserPrincipal` (KTD3) |
| 15 | `readsSyncs` | runs | `endedSyncs`, `lockSyncIn` declared (KTD6) |
| 16 | `runsOfSubject` | runs | declared |
| 17 | `bundleHealth` | runs | declared |
| 18 | `adminOnConnectedSource` | sources | `publishConnectedSource`, `dpiaInputFor`, `narrowConnectedSource`, `widenConnectedSource`, `previewPassages`, `findingsOf`, `keepInText`, `dismissAsNotSpecialCategory`, `narrowDocuments` declared |
| 19 | `connectUpload` | sources | declared |
| 20 | `restoreFinding` | sources | declared |
| 21 | `listConnectedSources` | sources | declared |

BA-84 counts 20 sites, with runs at 4. The fifth runs site is `readsSyncs`, a one-line ternary.

### Tests That Change, and Why

| Test | Change | Reason |
| --- | --- | --- |
| `packages/core/test/kernel.test.ts`, "the guard on an action only an Admin may perform" | deleted | The function is gone. `admission.test.ts` holds the same three facts for an Admin-only declaration. |
| `packages/core/test/admission.test.ts`, "declares both the enqueue and reprocessing as writes" | deleted | It reads `effect`. |
| `packages/core/test/admission.test.ts`, the fixtures and the reprocess declaration's `toEqual` | lose `effect` | R5. |
| `packages/core/test/admission.test.ts`, "the two actions that carry a declaration today" | renamed | More than two do. |
| `packages/devtools/test/action-admits-before-await.test.ts` and `refusal-unions.test.ts` fixtures | lose `effect` | R5. |
| `packages/devtools/test/action-admits-before-await.test.ts`, the `requireAdmin` shorthand cases | deleted | R6. The `requireFreshSignIn` cases stay. |
| `apps/api/tests/ops.test.ts`, "says which runs exit 1 whatever word they name" | the usage line it quotes gains the manifest commit | R10. |

No other test changes an expectation.

---

## Implementation Units

### U1. `effect` leaves the declaration

- **Goal:** The declaration type states what an action admits, takes and refuses, and nothing else.
- **Requirements:** R5. Covers AE6.
- **Dependencies:** none.
- **Files:** `packages/core/src/kernel/admission.ts`, every file under `packages/core/src/` holding a `declareAction` call, `packages/core/test/admission.test.ts`, `packages/devtools/test/action-admits-before-await.test.ts`, `packages/devtools/test/refusal-unions.test.ts`.
- **Approach:** Remove the `Effect` type and the fourth type parameter, then the key from each declaration. Apply the admission rows of *Tests That Change*.
- **Test scenarios:**
  - A declaration states its admits, input and refuses: the reprocess declaration's assertion compares those three keys.
  - Every existing admission case passes unchanged.
- **Verification:** The core and devtools checks pass, and no `declareAction` call in the tree carries `effect`.

### U2. Members' groups and access requests

- **Goal:** Sites 7 to 12 admit through declarations.
- **Requirements:** R1, R2, R3, R7, R8. Covers AE1.
- **Dependencies:** U1.
- **Files:** `packages/core/src/members/groups.ts`, `packages/core/src/members/requests.ts`. Tests read, not edited: `packages/core/test/members.test.ts`, `packages/core/test/access-requests.test.ts`.
- **Approach:** Each face declares with its existing input schema. `listGroups` and `listWaitingRequests` declare `z.object({})`. `groupTarget`, `memberTarget` and `claimForDecision` take the admitted Admin (KTD2). `holdsEveryGroup` keeps its gate (KTD3).
- **Patterns to follow:** `packages/core/src/members/roles.ts`, `packages/core/src/members/member-list.ts`.
- **Test scenarios:**
  - An Editor and a Viewer are refused every group and request face: the existing `role-forbids` cases pass unchanged.
  - An Editor is refused the held-groups check and an Admin is answered: the existing case passes unchanged.
  - A malformed group id still answers `malformed` to an Admin, after admission.
- **Verification:** The two suites pass with no edit.

### U3. Runs

- **Goal:** Sites 13 to 17.
- **Requirements:** R1, R2, R3, R7, R8. Covers AE1, AE3.
- **Dependencies:** U1.
- **Files:** `packages/core/src/runs/index.ts`, `packages/core/src/sources/review.ts` (the one caller of `latestIndexOutcomeIn`, which passes the Admin it holds). Tests read: `packages/core/test/runs.test.ts`.
- **Approach:** `jobById`, `endedSyncs` and `lockSyncIn` declare under KTD6. `runsOfSubject` and `bundleHealth` admit an Admin alone. `jobById` keeps answering `no-such-job` to a person who names another workspace, after admission.
- **Test scenarios:**
  - The platform reads a job, the ended syncs and the lock for any purpose: existing cases.
  - An Editor is refused the syncs and the lock: the existing case passes unchanged.
  - An Admin naming another workspace's job reads `no-such-job`: existing case.
- **Verification:** `runs.test.ts` passes with no edit.

### U4. Sources

- **Goal:** Sites 18 to 21.
- **Requirements:** R1, R2, R3, R7, R8. Covers AE1.
- **Dependencies:** U1, U3.
- **Files:** `packages/core/src/sources/admin-connected-source.ts`, `connected-source.ts`, `dpia.ts`, `index.ts`, `passages.ts`, `review.ts`, `findings.ts`, `listing.ts`, `packages/core/test/admission.test.ts` (its type assertion on `adminOnConnectedSource`'s first parameter). Tests read: `packages/core/test/sources.test.ts` and the suites beside it.
- **Approach:** `adminOnConnectedSource` becomes a plain constructor over an Admin. `sensitivitySet` and `spansCommanded` take the Admin their faces admitted. `connectUpload`'s input holds a stream, so its declaration states the type and parses nothing.
- **Patterns to follow:** `reprocessConnectedSource` and `actingOn` in `connected-source.ts`.
- **Test scenarios:**
  - An Editor is refused each of the twelve faces: the existing `role-forbids` cases pass unchanged.
  - The platform still cannot be passed to publish, preview or the DPIA read: the type assertions in `admission.test.ts` hold.
- **Verification:** The sources suites pass with no edit beyond the type assertion's subject, if its name moves.

### U5. Erasure

- **Goal:** Sites 5 and 6.
- **Requirements:** R1, R2, R7, R8. Covers AE1.
- **Dependencies:** U1.
- **Files:** `packages/core/src/erasure/requests.ts`. Tests read: `packages/core/test/erasure*.test.ts`.
- **Approach:** Both declare an Admin alone. `recordSubjectRequest` answers `identifier-too-broad` inside an object beside what was said, so its refusal union keeps that member beside the declaration's words.
- **Test scenarios:**
  - An Editor is refused recording and reading a subject request: existing cases pass unchanged.
- **Verification:** The erasure suites pass with no edit.

### U6. Concepts, and `writeConcept` over a step

- **Goal:** Sites 1 to 4, and the two hand-compared gates.
- **Requirements:** R1, R2, R3, R4, R7, R8. Covers AE1, AE2.
- **Dependencies:** U1, U2.
- **Files:** `packages/core/src/concepts/index.ts`, `suggestions.ts`, `visibility.ts`, `manifest.ts`. Tests read: `packages/core/test/concepts.test.ts`, `suggestions.test.ts`, `visibility.test.ts`, `import-bundle.test.ts`, `manifest.test.ts`, `erasure-rehearsal.test.ts`, `apps/api/tests/harness-knowledge.ts`.
- **Approach:**
  1. `writeConcept` admits under KTD4 and calls an unexported step holding everything after the gate. `requestRefusalOf` and `mayWrite` go.
  2. `acceptSuggestions` declares and passes its Admin down through `acceptOne` to `writeConcept` and `returnToProposer` (KTD5).
  3. `declineSuggestion`, `overrideConceptSensitivity`, `importBundle` and `writeManifest` declare. The last two admit an Editor.
- **Execution note:** Before editing, confirm `concepts.test.ts` holds each arm of AE2, and add the missing arm as a characterisation test that passes on the old code.
- **Test scenarios:**
  - An Editor's write lands and a Viewer's is refused `role-forbids`.
  - An Editor's write carrying an acceptance is refused `role-forbids`.
  - An Admin's acceptance without a `base` precondition answers `malformed`.
  - The principal `writeConcept` admits is typed an Editor or above: a type assertion holds that it accepts an Editor and is not an `AdminUserPrincipal`.
  - A Viewer is refused the import and the manifest write: existing cases pass unchanged.
  - The erasure rehearsal seeds its concept through `writeConcept`: the existing suite passes unchanged.
- **Verification:** `writeConcept`'s exported name and parameters are what they were, and every caller compiles without an edit.

### U7. The manifest commit answers in its word (BA-131)

- **Goal:** R9 and R10.
- **Requirements:** R9, R10, R11. Covers AE4, AE5.
- **Dependencies:** U6.
- **Files:** `packages/core/src/concepts/index.ts`, `apps/api/src/ops/index.ts`, `packages/core/test/import-bundle.test.ts`, `apps/api/tests/ops.test.ts`, `docs/solutions/architecture-patterns/adr-0043-what-an-act-is.md`.
- **Approach:** KTD7. `importReason` gains the sentence for the word: another writer moved the bundle, run the import again. The usage line and the decision doc's `pnpm ops` bullet name the malformed manifest commit beside the runs that exit 1.
- **Execution note:** Write the core test first and watch it fail on the `Error`. The fixture is a lock file left on the bundle's ref, which makes `git update-ref` fail the way a second writer does.
- **Test scenarios:**
  - An import whose manifest commit cannot move the ref answers `stale-precondition` and lands no concept.
  - `pnpm ops import-bundle` over that workspace exits `EXIT_OF_CLASS.conflict` and prints one refusal line.
  - A rerun after the lock is gone imports the bundle.
  - The usage text names the malformed manifest commit among the runs that exit 1.
- **Verification:** Each new case fails before the change and passes after it.

### U8. `requireAdmin` leaves the kernel

- **Goal:** R6.
- **Requirements:** R6, R11. Covers AE6.
- **Dependencies:** U2, U3, U4, U5, U6.
- **Files:** `packages/core/src/kernel/role.ts`, `packages/core/src/kernel/index.ts`, `packages/core/test/kernel.test.ts`, `packages/devtools/lint-rules/rules/action-admits-before-await.ts`, `packages/devtools/test/action-admits-before-await.test.ts`, `docs/solutions/architecture-patterns/adr-0043-what-an-act-is.md`.
- **Approach:** Delete the function and its export. `role.ts` keeps the two types. The lint's set of admitting calls keeps `admit` and `requireFreshSignIn`. The decision doc gains its History entry.
- **Test scenarios:**
  - The lint still reports a `requireFreshSignIn` after an `await` and passes one before it.
  - A late `admit` after an early `requireFreshSignIn` is still reported.
- **Verification:** A search of `apps/` and `packages/` for `requireAdmin` finds nothing.

---

## Verification Contract

| Check | Proves |
| --- | --- |
| `pnpm --filter @better-answers/core run check` | types, every face's `role-forbids` case, the refusal walk both ways |
| `pnpm check:api` | the ops exits, the harness, the transports' crossings |
| `pnpm --filter @better-answers/devtools run check` | the lint's cases |
| `pnpm check:gates` | `action-admits-before-await` over the whole tree, the format check, knip |
| `pnpm check:docs` | the words gate over the plan and the decision doc |
| `pnpm --filter @better-answers/web run typecheck` | the web still infers every refusal union |

All six run on the exact head that is pushed. A latency-budget failure on code this branch does not touch is rerun alone before it counts.

---

## Definition of Done

- Every acceptance example holds, and each criterion of BA-84 and BA-131 has its proof named in the build report.
- The six checks pass on the pushed head.
- `git diff --stat origin/main..HEAD -- packages/core/src` shows only the files the units name.
- No abandoned attempt is left in the diff.
- The build report says 21 sites against the issue's 20, counts the conversions by slice, and lists every assumption above as a decision the owner may overturn.
