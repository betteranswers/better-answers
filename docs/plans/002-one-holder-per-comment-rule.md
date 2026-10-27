---
title: One Holder per Comment Rule - Plan
type: chore
date: 2026-10-12
topic: one-holder-per-comment-rule
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# One Holder per Comment Rule - Plan

## Goal Capsule

- **Objective:** A contributor meets each comment rule once, from the one gate that holds it: at commit for the lint and the Python gate, and before a push for the workspace density ceiling. Nobody edits a config file's comments to satisfy a line counter that misreads them.
- **Means:** Remove the edit hook, move its coverage to the commit hook, narrow comment density to workspaces, and trim the test cases that repeat the rule suites (KTD1 to KTD4).
- **Authority:** The Key Decisions below, then `CODING_STANDARDS.md` and `AGENTS.md`, then this plan's units.
- **Stop conditions:** Stop and report when removing the edit hook or the directory ceilings would leave a comment rule with no mechanical holder for TypeScript or Python, or when the root check cannot pass without changing a rule's ceiling.
- **Execution profile:** One branch from `origin/main`, cut after PR #706 has merged, and one pull request. It changes gate config, tests and docs.
- **Who finishes:** `ce-work` implements. The calling pipeline reviews, opens the pull request, arms its merge and watches CI.

## Product Contract

### Summary

The Claude Code edit hook that re-ran the comment gates on every written file is removed, and the commit hook takes over what it covered: the Python gate runs at commit, and the commit hook's lint reads `.mjs` and `.js` files. Comment density is measured per workspace only. `comment-lint.test.ts` keeps its stock-rule cases and a refusing and an accepting pin per custom rule.

### Problem Frame

The comment rules are a 25-word cap, a ban on citing a ticket, date or decision number, and a ceiling on comment volume. Five mechanisms hold them: the custom oxlint rules, the root lint config with its test, the Python gate, the Claude Code edit hook and the density gate. Two cost more than they catch, and one test repeats others.

The edit hook, `.claude/hooks/comment-gate-hook.sh`, re-runs the lint and the Python gate over each file an agent writes. It catches nothing the commit and CI gates do not, and four of the twelve commits to it only re-synced path lists it copies by hand from the Python gate's command.

The density gate measures workspaces, four directories and one named set of root config files, `the-root-tool-configuration`. All seven commits it has forced in three weeks were on a directory or the named set, and three of those were cloc reading a glob string as a block comment. No workspace has ever gone over its ceiling.

`packages/devtools/test/comments/comment-lint.test.ts` holds 22 cases, and about 12 repeat cases the custom rules' own suites already hold.

### Key Decisions

- **The three oxlint comment rules, `comment-only-the-why`, `declaration-doc-block` and `string-cites-nothing`, and the oxlint config stay unchanged** (session-settled: user-approved — chosen over removing or loosening the word cap and citation ban: they are the sole holder of those rules for TypeScript). Governs R6.
- **`comment-lint.test.ts` is trimmed to its stock-rule cases plus a refusing and an accepting pin per custom rule** (session-settled: user-approved — chosen over keeping all 22 cases: about 12 repeat the rule suites' own cases). Governs R5.
- **The Python gate stays and also runs at commit on staged `.py` files** (session-settled: user-approved — chosen over pre-push and CI only: it is the sole holder for Python and takes under a second). Governs R2.
- **The edit hook goes, with its settings entry, its script and its test** (session-settled: user-approved — chosen over keeping write-time feedback: it catches nothing the commit hook does not, and four of its twelve commits only re-synced its copied path lists). Governs R1.
- **Comment density is measured per workspace only** (session-settled: user-approved — chosen over keeping directory and named-unit ceilings: all seven forced commits were on those, three of them cloc misreadings, and no workspace arm has ever fired). Governs R4.

### Requirements

**The edit hook**

- R1. `.claude/settings.json` wires no `PostToolUse` comment hook, and `.claude/hooks/comment-gate-hook.sh` and `packages/devtools/test/comment-gate-hook.test.ts` no longer exist.

**The commit hook**

- R2. A commit that stages a `.py` file runs the Python comment gate over the staged files.
- R3. A commit that stages a `.mjs` or `.js` file runs the lint over it, as it does for `.ts` and `.tsx`.

**Density**

- R4. The root `comment-density` script measures workspaces only: it takes no `--directory` and no `--unit`, and the code and tests that served only those are gone.

**The lint config's test**

- R5. `packages/devtools/test/comments/comment-lint.test.ts` holds the refusing cases for each stock rule setting with their accepting twins, one refusing and one accepting pin for each of the three custom rules, and the case that proves the config reaches a root script.

**What stays**

- R6. `.oxlintrc.json`, the custom rules under `packages/devtools/lint-rules/`, their suites and `packages/devtools/python/comment_gate.py` are unchanged, and every ceiling keeps its number.
- R7. Live docs describe the gates as they are after the change.
- R8. The root `check` passes.

### Scope Boundaries

- No replacement gate is built for comments in YAML, shell, TOML and SQL. A per-language word cap was tried and removed before; the owner accepts that review holds those files' comments. A config file whose comments grow back past what a reviewer catches would be the evidence to revisit.
- The migration comment rule in `CODING_STANDARDS.md` ("its comment cites that decision in a few words") stays as written. Nothing mechanical measures migrations after this change.
- The workspace density ceiling stays. Removing it is not part of this change.

#### Deferred to Follow-Up Work

- If no workspace arm fires over the coming blocks, removing the density gate altogether is the next step.

## Planning Contract

### Key Technical Decisions

- KTD1. **The commit hook's Python command runs the same script the root gate runs, over staged files.** The root `comment-gate:python` script names `packages/devtools/python/comment_gate.py` with its roots; the hook names the same file with `{staged_files}` and a `*.py` glob. It runs from the repository root with no `root:` key, because the gate reads `apps/worker/src/` and test directories from the path it is handed. `packages/devtools/test/root-config/lefthook-config.test.ts` proves each pre-commit command against what the root runs, so the new command gets a proof there that holds the two to one script.
- KTD2. **The commit hook's oxlint glob widens to `.mjs` and `.js`, and its run takes `--no-error-on-unmatched-pattern`.** The root lint already walks those files, and the edit hook was the only pre-CI reader of them. Without the flag, a commit whose only staged script sits under a path the lint config ignores is refused with "No files found to lint"; the `oxfmt` command carries the same flag for the same reason.
- KTD3. **Density loses the directory kind, not just its arguments.** `packages/devtools/src/comments/comment-density.ts` drops the `directory` kind, the config-language set and a unit's `holds` list, and `scripts/comment-density.mjs` drops the two options. A workspace still measures TypeScript and Python only, in a source arm and a test arm.
- KTD4. **A `comment-lint.test.ts` case goes only when a rule suite holds the same case.** Before deleting a case, find its twin in `comment-only-the-why.test.ts` or `string-cites-nothing.test.ts`. A case with no twin stays.
- KTD5. **The decision doc on rule form is amended, not rewritten.** `docs/solutions/architecture-patterns/adr-0045.md` says the density ceiling is "the only gate on a config file's comments". A dated amendment says density is now a workspace backstop, a config file's comments have no mechanical gate, and the edit hook is gone. The pull request body says this decision doc was edited.
- KTD6. **The cloc learning is retired unless its trap still bites a workspace.** `docs/solutions/integration-issues/cloc-counts-a-glob-in-a-config-string-as-a-block-comment.md` describes the named root-config unit, which goes. Run the learning's own check on a TypeScript file inside a workspace: if cloc still counts the lines between two glob strings as comments, keep the learning and move its example to that case; otherwise delete it.

### Assumptions

- The Python gate reads a staged file the same whether it is named alone or found under a root, when the path is repository-relative. The edit hook already called it with one such path.
- A session that loaded the old settings keeps calling the removed script until it restarts. The call exits non-zero without code 2, which the hook contract treats as no refusal.

### Risks

- **A machine without `python3` cannot commit a `.py` file.** The same machine already cannot pass `check:gates`. If the worker's own interpreter is the safer route, run the gate through `uv` as the `actionlint` command does, with `--project apps/worker` from the repository root and never under `root: apps/worker/`, and keep KTD1's proof.
- **`knip` names a helper only the deleted test used.** Remove what it names inside `packages/devtools`; a file outside it is a stop.
- **PR #706 changed the same files.** Cut the branch only after it merges.

### Sources

- `.claude/settings.json`: the `PostToolUse` entry with matcher `Edit|Write`.
- `lefthook.yml`: `pre-commit` commands `oxlint`, `ruff-format` and `ruff-check`; `pre-push-gates` commands `comment-gate:python` and `comment-density`.
- `package.json`: `comment-gate:python` and `comment-density`.
- `packages/devtools/test/root-config/lefthook-config.test.ts`: the `HOOK` map of pre-commit proofs and the tests under "the pre-commit hook".
- `packages/devtools/src/comments/comment-density.ts`: `MEASURED_LANGUAGES`, `Unit`, `heldBy`, `measure`.
- `scripts/comment-density.mjs`: the `directory` and `unit` options and the checks that serve them.
- `docs/operations/local-gates.md`, *The Claude Code hooks*: the section on the write-time comment gate.
- `packages/devtools/README.md`: the lines on the edit hook and on what the density ceiling holds.
- The audit of the five gates, run in the planning session: commit counts, measured run times and density headroom per unit.

## Implementation Units

### U1. Remove the edit hook

- **Goal:** No write-time comment hook is wired, and its script and test are gone.
- **Requirements:** R1.
- **Dependencies:** none.
- **Files:**
  - `.claude/settings.json`
  - delete `.claude/hooks/comment-gate-hook.sh`
  - delete `packages/devtools/test/comment-gate-hook.test.ts`
- **Approach:**
  1. Remove the `PostToolUse` entry; leave `SessionStart`, `WorktreeCreate` and `WorktreeRemove` as they are.
  2. Delete the script and its test, and any helper `knip` then names inside `packages/devtools`.
- **Test scenarios:** Test expectation: none new, because this unit removes a mechanism. Existing suites prove the rest still holds:
  - The remaining hooks still run: the worktree and watch-cap hook suites under `packages/devtools/test/ci/` pass unchanged.
- **Verification:** `check:gates` passes, including `lint:workflows`' shell check over `.claude/hooks`.

### U2. Give the commit hook the edit hook's coverage

- **Goal:** A commit runs the Python comment gate over staged `.py` files and the lint over staged `.mjs` and `.js` files.
- **Requirements:** R2, R3. Carries KTD1 and KTD2.
- **Dependencies:** U1.
- **Files:**
  - `lefthook.yml`
  - `packages/devtools/test/root-config/lefthook-config.test.ts`
- **Approach:**
  1. Add a `pre-commit` command for the Python gate with a `*.py` glob, under KTD1.
  2. Widen the `oxlint` command's glob and add the flag, under KTD2.
  3. Add the Python command's proof to the `HOOK` map, with a proof kind that holds the hook's script path to the root script's.
- **Execution note:** Write the new proof first and see it fail against the current `lefthook.yml`.
- **Test scenarios:**
  - The commit hook runs the Python gate from the script the root gate runs: the proof fails when the hook names another file and passes when both name `packages/devtools/python/comment_gate.py`.
  - The commit hook hands the Python gate the staged files: the command's run ends with `{staged_files}`.
  - The commit hook lints a staged root script: the `oxlint` command's glob takes a `.mjs` path and a `.js` path.
  - The commit hook lets through a commit whose only staged script the lint config ignores: the `oxlint` run names `--no-error-on-unmatched-pattern`.
- **Verification:** The devtools workspace's `check` passes.

### U3. Narrow density to workspaces

- **Goal:** The density gate measures each workspace's source and test arms and nothing else.
- **Requirements:** R4, R6. Carries KTD3.
- **Dependencies:** none.
- **Files:**
  - `package.json`
  - `scripts/comment-density.mjs`
  - `packages/devtools/src/comments/comment-density.ts`
  - `packages/devtools/test/comments/comment-density.test.ts`
- **Approach:**
  1. Cut the root script's arguments to the two workspace roots.
  2. Remove the `directory` and `unit` options and the checks that serve them from the script.
  3. Remove the `directory` kind, the config-language set and `holds` from the module.
  4. Delete the test cases for directories and named units; keep every workspace case.
- **Test scenarios:**
  - A workspace over its source ceiling is named with its ratio: the existing case passes unchanged.
  - A test arm is held to the tighter ceiling: the existing case passes unchanged.
  - A workspace is blind to the SQL beside it: the existing case passes unchanged.
  - A run that measured nothing is refused: the existing case passes unchanged.
- **Verification:** `pnpm run comment-density` reports every workspace under its ceiling and names no directory.

### U4. Trim the lint config's test

- **Goal:** `comment-lint.test.ts` proves the root config holds each of the comment rules at error, once.
- **Requirements:** R5, R6. Carries KTD4.
- **Dependencies:** U1, which deletes the proof step 3 replaces.
- **Files:**
  - `packages/devtools/test/comments/comment-lint.test.ts`
- **Approach:**
  1. Keep the stock-rule cases: both `@ts-ignore` cases, `@ts-expect-error` with no reason, the TODO, the FIXME, the blanket disable and the unused disable, with their accepting twins.
  2. Keep one refusing and one accepting pin for `comment-only-the-why` and for `string-cites-nothing`.
  3. Load `better-answers/declaration-doc-block` in the suite's rule list and add its refusing pin, a line comment directly above a declaration. The existing "a `/** */` on a declaration" case is its accepting pin. The deleted hook test held the only proof that the root config carries this rule. Reshape any accepting fixture that puts a line comment directly above a declaration.
  4. Keep "refuses a 26-word comment in a root script", which proves the config's reach.
  5. Delete each other case after finding its twin under KTD4.
- **Test scenarios:**
  - The root config refuses a line comment directly above a declaration, at error: the new pin fails if `.oxlintrc.json` drops or softens `declaration-doc-block`.
  - The kept cases pass unchanged.
- **Verification:** The file's suite passes, and each deleted case has a named twin in a rule suite.

### U5. Correct the docs

- **Goal:** Live docs describe four holders: the lint config, the Python gate, the workspace density ceiling and review.
- **Requirements:** R7. Carries KTD5 and KTD6.
- **Dependencies:** U1, U2, U3.
- **Files:**
  - `docs/operations/local-gates.md`
  - `packages/devtools/README.md`
  - `docs/solutions/architecture-patterns/adr-0045.md`
  - `docs/solutions/integration-issues/cloc-counts-a-glob-in-a-config-string-as-a-block-comment.md`
- **Approach:**
  1. `local-gates.md`: remove the section on the write-time comment gate and correct the count of scripts the settings wire; add the Python gate and the wider glob to the pre-commit section.
  2. `packages/devtools/README.md`: remove the edit hook's lines and its test's row; say density holds each workspace; replace the sentence that a comment in YAML, shell, TOML or SQL is the density ceiling's alone.
  3. The decision doc: add the amendment under KTD5.
  4. The cloc learning: keep or delete under KTD6.
  5. Search `AGENTS.md`, each `CODING_STANDARDS.md` and `docs/agents/` for the hook and the directory ceilings, and correct what the search finds.
- **Test scenarios:** Test expectation: none, docs only.
- **Verification:** `check:docs` passes, and a search for `comment-gate-hook`, `--directory .github` and `the-root-tool-configuration` finds them only in dated plans, `docs/archive/` and passages that record a past event.

## Verification Contract

| Command | Proves | Applies to |
| --- | --- | --- |
| `pnpm run check:gates` | lint, both comment gates, `knip` and the shell check pass | all |
| `pnpm --filter @better-answers/devtools run check` | the hook proofs, the density suite and the lint config's suite pass | U1 to U4 |
| `pnpm run check:docs` | the docs lane passes | U5 |
| `pnpm exec lefthook run pre-commit` with a staged `.py` file holding a 26-word comment | the commit hook refuses it | U2 |
| `pnpm check` | the whole tree passes; needs Docker running | all |

## Definition of Done

- Every command in the Verification Contract passes, and the staged-file trial is undone afterwards.
- No ceiling's number changed, and no file under `packages/devtools/lint-rules/` or `.oxlintrc.json` is in the diff.
- No live doc describes the edit hook or a directory density ceiling as something that exists.
- The pull request body says the decision doc was edited and carries `Merge risk: reversible, gate config, tests and docs only`.
