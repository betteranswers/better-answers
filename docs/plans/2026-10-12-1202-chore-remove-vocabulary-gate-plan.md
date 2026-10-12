---
title: Remove the Vocabulary Gate - Plan
type: chore
date: 2026-10-12
topic: remove-vocabulary-gate
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Remove the Vocabulary Gate - Plan

## Goal Capsule

- **Objective:** A contributor writes ordinary English in a plan, a doc or a code identifier and pushes it without a word list refusing the push. Vocabulary is held by review.
- **Means:** Delete the words test with its list, scanner and helpers, delete the four tests that pin the tracked-skill list, and remove every script, hook, test row and live doc that points at either (KTD1, KTD3).
- **Authority:** The Key Decisions below, then `CODING_STANDARDS.md` and `AGENTS.md`, then this plan's units.
- **Stop conditions:** Stop and report when a test outside this plan's scope imports a deleted file, when the root check cannot pass without a change to product code, or when the comment-density gate fires and clearing it needs more than a few comment edits in `apps/api/tests/`.
- **Execution profile:** One branch from `origin/main`, one pull request. It changes tests, docs, and the root `package.json` and `lefthook.yml` entries that name the deleted step.
- **Who finishes:** `ce-work` implements. The calling pipeline reviews, opens the pull request and watches CI. The merge queue merges.

## Product Contract

### Summary

The words test, its word list, its scanner and the three helpers only they import are deleted, and so is the step that runs them before every push and in CI's docs lane. The pin on `CONCEPTS.md`'s `_Internal._` marks (`apps/api/tests/internal-heads.ts`) goes with them. The four tests that pin the exact list of tracked skills are deleted. Docs that describe either are corrected or retired.

### Problem Frame

`apps/api/tests/avoid-words.test.ts` reads a list of replaced words from `apps/api/tests/old-words.ts` and refuses each one in every tracked text file: docs, code identifiers, product strings and migrations. It refuses ordinary English. On 12/10/2026 it failed the S2b plan and the route spec for "MCP App", "acts on flags" and "the router's composition". Each false positive is cleared by adding a permitted sense to a row, and the two files took 105 file-edits in under three weeks. The Compound Engineering review skills and Cubic's learnings already review vocabulary against `CONCEPTS.md`.

Four of the six tests in the describe block "the skills this repository tracks" in `packages/devtools/test/ci/provision-skills.test.ts` pin the exact set of skill folders git tracks. `.gitignore` already states that set, so each added skill is an edit in two places. The other two check something `.gitignore` does not state: that `.claude/skills/better-answers-design` links to `packages/design-system`, and that the vendored pixel-perfect plugin's licence, notice and manifest are tracked.

### Key Decisions

- **The words test goes, with its list, its scanner and its step** (session-settled: user-directed — chosen over keeping the gate and adding an exemption per false positive: it refuses ordinary English, took 105 file-edits in under three weeks, and review already covers vocabulary). Governs R1, R2, R5.
- **The tracked-skills block goes** (session-settled: user-directed — chosen over keeping it as a pin on the exact tracked-skill list: `.gitignore` already states that list). Governs R3, R4. Conflict found in review: the owner decided on the block as a duplicate of `.gitignore`, and two of its six tests are not. This plan removes the four that are and keeps the two that are not; removing those two as well is the owner's call.
- **Every other test stays** (session-settled: user-approved — chosen over a wider sweep of words tests and devtools tests in this change: those test product copy or run real scripts, and the audit found one removal). Governs R6.

### Requirements

**The gate**

- R1. `apps/api/tests/avoid-words.test.ts`, `apps/api/tests/old-words.ts`, `apps/api/tests/words-scan.ts`, `apps/api/tests/internal-heads.ts`, `apps/api/tests/kept-names.ts` and `apps/api/tests/tree-walk.ts` no longer exist.
- R2. No script, hook or test names the gate's step, `check:docs:api`, and the suites that hold those lists to each other pass.

**The tracked-skills block**

- R3. The four tests that pin the tracked-skill list are gone from `packages/devtools/test/ci/provision-skills.test.ts`. The tests of `.claude/hooks/provision-skills.sh`, the design-skill link test and the pixel-perfect licence test stay as they are.
- R4. The docs lane's table says what each suite it runs reads after the change.

**Docs**

- R5. Each live doc describes what exists after the change. Dated plans, dogfood reports and `docs/archive/` stay as written.

**What stays**

- R6. No other test changes behaviour: `apps/web/test/*-words.test.ts`, `packages/core/test/refusal-words.test.ts`, `packages/schema/test/knowledge-words*.test.ts`, the lint-rule tests and the rest of `packages/devtools/test` keep every assertion they have, apart from the list rows and stand-in names this plan names.
- R7. The root `check` passes.

### Scope Boundaries

- No replacement check is built. A lint rule over the old list and an import of its rows into Cubic's learnings were both considered and not built: the owner decided review holds vocabulary. Retired words reappearing in merged code would be the evidence to revisit that.
- `CONCEPTS.md` keeps its `_Internal._` marks and its entries. Only the preamble sentence that names the words test changes. After the change nothing mechanical pins the marks or keeps an internal word off a page; review holds both.
- The unpushed commit `6138708b` on the local `main` (the S2b ask plan) is not part of this change.

## Planning Contract

### Key Technical Decisions

- KTD1. **`check:docs:api` is removed outright, not left pointing at nothing.** The words test was its only suite, and `packages/devtools/test/ci/check-scripts.test.ts` refuses a test step that passes with no tests. The docs lane keeps its core, devtools and web steps.
- KTD2. **`packages/devtools/test/lefthook-config.test.ts` takes `check:docs:core` as its stand-in failing gate.** It still shows a prose-suite step failing beside a `check:gates` step (`knip`), which is what those four sites were written to show.
- KTD3. **`provision-skills.test.ts` stays in the docs lane.** The design-skill link test still reads `packages/design-system/SKILL.md` through its symlink, so the file keeps its `PROSE_SUITES` row and its place in `check:docs:devtools`. The row's `reads` text is corrected to what the file reads now.
- KTD4. **One learning is deleted and two are edited.** `docs/solutions/best-practices/how-a-rename-sweep-lands-a-word-in-the-words-test.md` describes only the deleted list and is removed. `docs/solutions/best-practices/what-a-rename-prose-pass-gets-wrong-and-the-checks-that-catch-it.md` is about rename passes in general: its passages on the words test and its carve-outs go, its grep-based checks stay, and its link to the deleted learning goes. `docs/solutions/best-practices/renaming-a-table-drizzle-kit-will-not-generate-so-the-migration-and-snapshot-are-written-by-hand.md` loses its link to the deleted learning and any sentence that relies on the words test.
- KTD5. **The decision doc gets a dated amendment, and its earlier amendments stay.** `docs/solutions/architecture-patterns/adr-0047-the-platform-is-surfaces-groups-and-screens.md` says an old word leaves the glossary for `old-words.ts`. Its 08/10/2026 amendment says the old word's row refuses it in reader text until a block's rename lands. A new amendment line dated 12/10/2026 says an old word now leaves the glossary, no list of old words is kept in the tree, and no gate refuses an old word: review holds a staged rename. The pull request body says this decision doc was edited.
- KTD6. **`.claude/skills/ce-skill-work/references/evaluate.md` and `references/new-skill.md` are edited through the `ce-skill-work` skill**, as `AGENTS.md` requires for a tracked skill.

### Risks

- **Comment density.** The deleted files are about 3,000 lines of the api workspace's test arm, so the arm's comment ratio moves. The gate may fire on files this plan does not touch.
- **Unused code left behind.** A helper export or a dev dependency that only the deleted files used will fail `knip`. Remove what it names. A file `knip` names beyond the six in R1 is a stop condition, not a deletion.
- **Mentions by another name.** Docs call the gate "the words test" without naming a file, so a search for file names alone misses them.

### Sources

- `package.json`: `check:docs` and `check:docs:api`, lines 20 and 21 on `origin/main`.
- `lefthook.yml`: the `check:docs:api` command under `pre-push-gates`.
- `packages/devtools/test/ci/docs-lane.test.ts`: the `PROSE_SUITES` table, and the tests under "what the docs lane runs" that hold it to `check:docs` in both directions.
- `packages/devtools/test/lefthook-config.test.ts`: `PUSHED_SCRIPTS` and "runs each step `check:gates` and `check:docs` name, and nothing else", which holds `lefthook.yml` to the two scripts.
- `docs/operations/local-gates.md`, *The pre-push hook*: names the four prose suites, says `check:docs:api` is the slowest command, and uses it in a `LEFTHOOK_EXCLUDE` example.
- `CONCEPTS.md`, the preamble: "the words test holds the old words it refuses".
- A search of `origin/main` for the three file names and `check:docs:api` found no mention in `AGENTS.md` or in any `CODING_STANDARDS.md`.

## Implementation Units

### U1. Delete the gate and its step

- **Goal:** The words test, its list, its scanner, their three helpers and `check:docs:api` are gone, and the suites that hold the hook and the docs lane to the root scripts pass.
- **Requirements:** R1, R2, R6. Carries KTD1 and KTD2.
- **Dependencies:** none.
- **Files:**
  - delete `apps/api/tests/avoid-words.test.ts`, `apps/api/tests/old-words.ts`, `apps/api/tests/words-scan.ts`
  - delete `apps/api/tests/internal-heads.ts`, `apps/api/tests/kept-names.ts`, `apps/api/tests/tree-walk.ts`, which only those three import
  - `package.json`
  - `lefthook.yml`
  - `packages/devtools/test/ci/docs-lane.test.ts`
  - `packages/devtools/test/lefthook-config.test.ts`
- **Approach:**
  1. Delete the six files.
  2. Remove the `check:docs:api` script and its name from `check:docs` in the root `package.json`.
  3. Remove the `check:docs:api` command from `pre-push-gates` in `lefthook.yml`.
  4. Remove the words test's row from `PROSE_SUITES`.
  5. Replace `check:docs:api` with `check:docs:core` at the four sites in `lefthook-config.test.ts`.
- **Execution note:** Run `comment-density`, `knip` and `jscpd` straight after the deletion, before the other edits, so a gate the deletion trips is seen alone.
- **Test scenarios:** Test expectation: none new, because this unit removes a gate. Existing suites prove the removal:
  - The pre-push hook runs exactly the steps `check:gates` and `check:docs` name: "runs each step `check:gates` and `check:docs` name, and nothing else" passes with no `check:docs:api` on either side.
  - A push with two failing gates names each one's run-alone command: "refuses a push, naming each failed gate's run-alone command" passes with `knip` and `check:docs:core`.
  - A failing gate's push goes through when it is skipped: both `LEFTHOOK_EXCLUDE` and `--no-verify` rows pass with `check:docs:core`.
  - The docs lane runs exactly the suites its table puts in it: "runs exactly the prose suites this table puts in it" and "names an existing step and file for each suite" pass.
  - No test script passes with no tests: "has no test script that passes with no tests" passes.
- **Verification:** The devtools workspace's `check` passes, `check:gates` passes, and the api workspace typechecks.

### U2. Remove the tracked-skill list pins

- **Goal:** `provision-skills.test.ts` no longer pins which skills git tracks, and the docs lane's table says what the file reads now.
- **Requirements:** R3, R4, R6. Carries KTD3.
- **Dependencies:** U1, which edits the same table and script list.
- **Files:**
  - `packages/devtools/test/ci/provision-skills.test.ts`
  - `packages/devtools/test/ci/docs-lane.test.ts`
- **Approach:**
  1. In the describe block "the skills this repository tracks", delete the four list-pin tests: "tracks its own three skills", "tracks seven third-party skills", "tracks nothing else" and "tracks the api's two Resend skills".
  2. Keep "links the design system's skill" and "tracks the pixel-perfect plugin with its licence and notice", with the `tracked` helper the second one uses. Rename the describe block to say what the two tests check.
  3. Correct the file's `reads` text in `PROSE_SUITES`, under KTD3.
- **Test scenarios:** Test expectation: none new, because this unit removes assertions. Existing suites prove the removal:
  - The provisioning script still copies, links and reinstalls as before: every test under "the skills stage of worktree provisioning" passes unchanged.
  - The design-skill link and the pixel-perfect licence files are still checked: the two kept tests pass unchanged.
  - The docs lane's table and `check:docs` agree: the tests under "what the docs lane runs" pass.
- **Verification:** The devtools workspace's `check` passes and `check:docs` passes.

### U3. Correct the docs

- **Goal:** No live doc describes the words test, its list, `check:docs:api` or the tracked-skill list pins as something that exists.
- **Requirements:** R5. Carries KTD4, KTD5 and KTD6.
- **Dependencies:** U1, U2.
- **Files:**
  - `CONCEPTS.md`
  - `docs/operations/local-gates.md`
  - `.claude/skills/ce-skill-work/references/evaluate.md`
  - `.claude/skills/ce-skill-work/references/new-skill.md`
  - `docs/solutions/architecture-patterns/adr-0047-the-platform-is-surfaces-groups-and-screens.md`
  - delete `docs/solutions/best-practices/how-a-rename-sweep-lands-a-word-in-the-words-test.md`
  - `docs/solutions/best-practices/what-a-rename-prose-pass-gets-wrong-and-the-checks-that-catch-it.md`
  - `docs/solutions/best-practices/renaming-a-table-drizzle-kit-will-not-generate-so-the-migration-and-snapshot-are-written-by-hand.md`
- **Approach:**
  1. `CONCEPTS.md` preamble: keep the rule that the file carries no lines of words to avoid and names no replaced word, and drop the clause saying the words test holds them.
  2. `docs/operations/local-gates.md`: the hook runs three prose suites; drop the sentence naming `check:docs:api` as the slowest command; correct which suites start Postgres; use another step in the `LEFTHOOK_EXCLUDE` example. Re-measure the hook's duration with every gate passing, or remove the stale figure.
  3. Through `ce-skill-work`: in `evaluate.md`, the sentence listing what each docs-lane suite holds loses its words-test clause and says what `provision-skills.test.ts` holds now; in `new-skill.md`, the sentence on what a tracked skill needs loses the clause about that test's lists.
  4. The decision doc: add the amendment line under KTD5.
  5. The learnings under KTD4, and the links to them in the table-rename learning.
  6. Search live docs for the gate by its other names ("the words test", "old words", "the list") and for `provision-skills.test.ts`, and correct what the search finds. Check `AGENTS.md`, each `CODING_STANDARDS.md`, `docs/operations/CI.md`, `docs/agents/` and `packages/devtools/README.md` in particular.
- **Test scenarios:** Test expectation: none, docs only.
- **Verification:** `check:docs` passes, and the search in the Definition of Done finds only history.

## Verification Contract

| Command | Proves | Applies to |
| --- | --- | --- |
| `pnpm run check:gates` | format, lint, comment gates, `jscpd` and `knip` pass after the deletion | U1, U2, U3 |
| `pnpm --filter @better-answers/devtools run check` | the hook and docs-lane suites agree with the root scripts | U1, U2 |
| `pnpm run check:docs` | the docs lane runs with three prose steps | U1, U2, U3 |
| `pnpm --filter @better-answers/api run typecheck` | nothing in the api workspace imported a deleted file | U1 |
| `pnpm check` | the whole tree passes; needs Docker running | all |

## Definition of Done

- A search of the tree for `avoid-words`, `old-words`, `words-scan` and `check:docs:api` finds them only in dated plans, dogfood reports, `docs/archive/` and passages that record a past event: the 03/10/2026 and 08/10/2026 amendments in the decision doc and the incident file list in `docs/solutions/integration-issues/lefthook-reverts-unstaged-only-files-when-a-pre-commit-formatter-conflicts.md`.
- No live doc calls the words test or the tracked-skill list pins a current gate.
- Every command in the Verification Contract passes.
- The diff holds no product code and no change to a test outside the files this plan names.
- The pull request body says the decision doc was edited and carries `Merge risk: reversible, tests, docs and hook config only`.
