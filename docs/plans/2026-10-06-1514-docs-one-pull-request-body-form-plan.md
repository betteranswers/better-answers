---
title: One Pull Request Body Form - Plan
type: docs
date: 2026-10-06
topic: one-pull-request-body-form
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# One Pull Request Body Form - Plan

## Goal Capsule

- **Objective:** Every merge commit on `main` from a pull request an agent writes has the same body shape. A reader of `git log` finds what changed first, then the change's risk and its Linear issue in fixed lines at the end. Linear closes the issue when a pull request that completes it merges.
- **Means:** `AGENTS.md` states the body form once, as required fields, where `ce-commit-push-pr` reads a project's body contract (KTD1). The other docs point to it, and Cubic stops writing its summary into the body (KTD5).
- **Authority:** The Product Contract's requirements come first, then the Key Technical Decisions, then the units. A decision marked `session-settled` is not reopened.
- **Stop conditions:**
  - The before-and-after run (U4) shows `ce-commit-push-pr` ignoring a required field that `AGENTS.md` states. Stop and report: the contract's wording or its place is wrong, and a second place to state it is a new decision.
  - Turning off Cubic's summaries stops Cubic's check from completing, so `arm-merge.yml` no longer arms a merge.
- **Execution profile:** Two pull requests, in order.
  1. U3 alone, `Related to BA-58`. It merges first, because Cubic reads `cubic.yaml` from the default branch only (KTD5).
  2. U1 and U2, `Fixes BA-58`, one commit per unit. Every path in it is markdown, so it takes the docs lane. It opens as a draft with a one-line placeholder body. U4 runs against the draft, then the final body is applied and the pull request is marked ready.
- **Who finishes:** `ce-work` builds both, and `ce-code-review` reviews them. `ce-commit-push-pr` opens the U3 pull request. It also writes the docs pull request's final body in U4, the first body written to the new form.

---

## Product Contract

### Summary

`AGENTS.md` gains a short pull request body contract:
- an opening that says what is now different
- a middle sized by Compound Engineering (CE) as it is today
- a closing `Merge risk:` line
- an issue line

`docs/agents/workflow.md` stops describing the pull request body as the commit's body with a `Refs:` footer, and points to the contract. Cubic stops adding its summary to the body. The commit form and commitlint stay as they are.

### Problem Frame

The repository merges with `merge_commit_message=PR_BODY`, so a pull request's body becomes the body of its merge commit on `main`. Four sources write or describe that body, and they disagree:

- `docs/agents/workflow.md` (*Merging*, step 1, and the last line of *The commit's form*) says the body is the commit's body, with a `Refs: BA-N` footer.
- `AGENTS.md` (*Issue tracker*) and `docs/agents/issue-tracker.md` say the pull request names its issue as `Fixes BA-N`.
- `ce-commit-push-pr` (CE 3.30.3) sizes the body by decision cost. It puts the opening under `## Summary` when the body has headings, folds risk into the prose, and writes `Fixes` or `Related to`.
- Cubic appends a "Summary by cubic" block with HTML and an image link (`cubic.yaml`, `pr_descriptions.generate: true`). It is in 55 of the last 80 merge commits on `main`.

Nothing checks the body. Recent merge bodies therefore mix `Refs: BA-29`, `Related to BA-28` and `Fixes` lines, and over twenty different `##` headings. Every merge to `main` reaches production in the next nightly release (`RELEASE_MODE` has been `nightly` since 05/10/2026), and a rollback restores the previous release's digests, undoing every merge since then. Yet no body says whether a change can be undone by reverting it. The owner agreed this item on 06/10/2026 in the CE workflow evaluation (`.scratch/ce-evaluation-2026-10-06/release-pr.md`).

### Requirements

**The body form**

- R1. `AGENTS.md` states the pull request body form once, as the project's body contract for `ce-commit-push-pr`. Its fields are required, so CE's sizing and audit cannot drop them.
- R2. The opening comes first and says what is now different. When the body has `##` headings, the opening sits under `## Summary`, as CE writes it today. Below the opening, CE sizes and arranges the middle as it does now.
- R3. After the middle and its sections, the body ends with the `Merge risk:` line, followed by the issue line when the pull request has one (R4). Any attribution a tool appends comes after them.
- R4. The issue line is `Fixes BA-N` when the pull request completes the issue, and `Related to BA-N` when it does not. A pull request with no issue has no issue line.
- R5. Every pull request carries the `Merge risk:` line. It states whether reverting the merge commit undoes the change (`reversible` or `not reversible`), then what a failure would reach.

**The other sources**

- R6. `docs/agents/workflow.md` (*Merging*) and `AGENTS.md` no longer disagree on the issue line, and *Merging* points to the contract rather than restating it.
- R7. Cubic no longer writes its summary into a pull request's body.
- R8. The commit checks stay as they are: `commitlint.config.mjs`, the `commit-msg` hook, the `pr-title` job, and the commit's `Refs: BA-N` footer as *The commit's form* describes it. Only that section's closing statement about the pull request body changes (U2).

**Proof**

- R9. `ce-commit-push-pr`, run in description-only mode on the same open pull request before and after the change, writes the stated form after it.

### Key Decisions

- **A `Merge risk:` line on every pull request** (session-settled: user-directed — chosen over a line only for changes that cannot be undone, and over no line, and re-affirmed once merges were known to ship in the nightly release: whoever weighs a nightly rollback needs to know which merges a revert cannot undo, and a line that appears only sometimes cannot be told apart from one that was forgotten). Governs R5.
- **The form fixes the two ends and leaves the middle to CE** (session-settled: user-approved — confirmed in the scoping synthesis over a fixed template of sections: CE's sizing by decision cost stays, so the contract does not fight the writer that applies it). Governs R2, R3.
- **Cubic's summary is turned off** (session-settled: user-approved — confirmed in the scoping synthesis: while Cubic appends it, no merge body has the stated shape). Governs R7.

### Success Criteria

- A merge commit on `main` written after this lands opens with the change's outcome and ends with `Merge risk:` and `Fixes BA-N` or `Related to BA-N`, followed only by tool attribution. There is no Cubic block and no `Refs:` footer in the body.
- Linear moves BA-58 to Done when the docs pull request merges.

### Scope Boundaries

- Renovate's pull requests are not bound by the form. Renovate writes their bodies from its own template, and no agent writes them.
- History is not rewritten. Earlier merge bodies keep their mixed forms.
- Nothing new checks the body. The contract is held by the skill that writes it, and by review.
- `docs/agents/issue-tracker.md` already says `Fixes BA-N` and is left as it is.
- The Claude Code attribution line stays. The harness appends it, and the repository does not control it.

#### Deferred to Follow-Up Work

- Merge subjects that pass 90 characters once GitHub appends ` (#N)`: #586, #518 and #509 in the last 400 commits. The `pr-title` job reads the title before the suffix, so nothing catches it. This needs its own Linear issue.
- A `Merge risk:` line on Renovate's pull requests, through `renovate.json`'s body notes, if the owner wants Renovate bound too.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The contract lives in `AGENTS.md`, in *Workflow*.** `ce-commit-push-pr` resolves a project's body contract from instructions already in context, and the project contract wins over its defaults (`pr-description-writing.md`, *Project PR-body contract*). `AGENTS.md` is in every session's context through `CLAUDE.md`'s `@AGENTS.md`. `docs/agents/workflow.md` is read only when an agent is pointed to it. The *Workflow* subsection already says that `ce-commit-push-pr` opens the pull request, so the contract sits beside that sentence. Governs R1.
- KTD2. **The contract names its fields as required.** CE cuts anything that does not raise a reviewer's confidence, except fields a project's contract requires. It folds risk into the prose, may fold the closing reference into a tiny opening, and places `## New concepts`, evidence and branding after the related references. So the contract says outright that the `Merge risk:` line is required on every body, that the issue line is required on every body whose pull request has an issue (R4), and that they are the last lines of the pull request's own text. It does not restate CE's sizing or audit rules. Governs R1, R3.
- KTD3. **The issue line uses CE's Linear words: `Fixes` and `Related to`.** Linear closes an issue on a closing word such as `fixes`, in the PR description, title or a commit message. `related to` is one of its relation words, which link without moving the issue to Done. Both are CE's defaults, so CE writes them without being told. `Refs: BA-N` in the body is rejected: `refs` is non-closing, so the issue would stay open. The commit footer keeps `Refs: BA-N` (R8). commitlint's refusal text cites that footer, and branch commits reach `main` through a true merge (`arm-merge.yml` arms `--merge`), so they keep linking the issue without each one claiming to close it. Governs R4, R8.
- KTD4. **The risk line says "reversible", not "door".** The issue's source, Matt Pocock's `pr` skill, says "one-way or two-way door". `CONTEXT.md` already uses "door" for a store door, and Cubic flags a domain word used outside its glossary meaning. The test for the first word is mechanical: would reverting the merge commit undo the change? A migration that has run, data written to a store, an email sent, or a `contracts/` change the other tier has read are not undone by a revert. The second part is a short phrase for what a failure would reach, such as `docs only`, `CI`, `one workspace`, `every workspace's data`. The contract shows one example line and no list. Governs R5.
- KTD5. **`pr_descriptions.generate: false`, not `skip_if_author_description: true`.** Cubic's schema says the skip setting still writes a summary when a body is "empty or template-only", and it applies to new pull requests only. Turning generation off is the one setting with no exception. Cubic's review and its check run do not depend on it, and `arm-merge.yml` arms on the check run. Cubic reads `cubic.yaml` from the default branch only (its config docs), so the change lands in its own pull request ahead of the docs one. Governs R7.
- KTD6. **The before-and-after check runs on an open pull request.** CE's PR mode reports and stops when a pull request is not open. Its current-branch mode diffs against `origin/HEAD`, so a merged head gives an empty range. Both runs therefore describe the docs pull request while it is a draft with a placeholder body. CE's PR mode reads the existing body and keeps its issue reference, so a body already in the new form would feed the answer into both runs. The before run happens in a session started in the main checkout, which loads the old `AGENTS.md`. The after run happens in a session started in this branch's worktree, which loads the new one. The session that edits `AGENTS.md` cannot run the after check, because it loaded the old text at start. Governs R9.

### Assumptions

- Linear's GitHub integration is switched on for the workspace. The repository cannot show it. Earlier `Fixes BA-N` pull requests suggest it is, and the Success Criteria's check on BA-58 confirms it.
- With `generate: false`, the `cubic_review_link` setting no longer edits the body. The schema describes the link as part of the generated description, so this is likely but unconfirmed until U4 reads the docs pull request's body.

### System-Wide Impact

- **Every agent session** reads the new contract, because `AGENTS.md` is always loaded. The contract must be short: the skill-authoring standard asks always-loaded text to earn its place (`docs/solutions/skill-design/portable-agent-skill-authoring.md`).
- **Cubic** reads `AGENTS.md` before each review, so the contract's words must match `CONTEXT.md` (KTD4).
- **Link targets keep their names.** `commitlint.config.mjs`'s `helpUrl` names *The commit's form*. `arm-merge.yml` names *Merging*. Neither heading is renamed.
- **The refused-words test** (`apps/api/tests/avoid-words.test.ts`, run by `check:docs:api`) scans the edited docs. New text must not use a word it refuses.

---

## Implementation Units

### U1. The body contract in `AGENTS.md`

- **Goal:** `AGENTS.md` states the pull request body form once, as required fields CE keeps.
- **Requirements:** R1, R2, R3, R4, R5; KTD1, KTD2, KTD3, KTD4.
- **Dependencies:** none.
- **Files:** `AGENTS.md`.
- **Approach:**
  1. In *Workflow*, after the sentence on `ce-commit-push-pr`, add the contract as one short paragraph or a list of at most four items: the opening, the middle left to CE, then the `Merge risk:` line and the issue line as the body's last lines.
  2. Mark the `Merge risk:` line as required on every body and the issue line as required whenever the pull request has an issue. Say they come after every section CE adds, before any appended attribution.
  3. Give one example of the two closing lines, e.g. `Merge risk: reversible, docs only` followed by `Fixes BA-58`.
  4. In *Issue tracker*, change "names its issue as `Fixes BA-N`" to point to the contract in *Workflow*, so the issue line is stated once.
- **Patterns to follow:** the plain declarative sentences `AGENTS.md` already uses. Bold leads only where the file already uses them.
- **Test expectation:** none. This is documentation. U4 proves the behaviour.
- **Verification:** A reader of `AGENTS.md` alone can write a conforming body. The issue line appears in one place in the file. `pnpm check:docs` passes.

### U2. `docs/agents/workflow.md` points to the contract

- **Goal:** *Merging* no longer says the pull request body is the commit's body with a `Refs:` footer.
- **Requirements:** R6, R8.
- **Dependencies:** U1.
- **Files:** `docs/agents/workflow.md`.
- **Approach:**
  1. In *Merging*, step 1, keep "its title is the commit's subject". Replace "its body is the commit's body, footer included" with a pointer to the body contract in `AGENTS.md`.
  2. In the last paragraph of *The commit's form*, keep the `PR_BODY` fact. Say the pull request's body, in the `AGENTS.md` form, becomes the merge commit's body, and the branch commits keep their own footers.
  3. Leave the rest of *The commit's form* unchanged, along with both headings.
- **Patterns to follow:** the doc's existing numbered steps under *Merging*.
- **Test expectation:** none. This is documentation.
- **Verification:** No sentence in `docs/agents/workflow.md` says the pull request body carries `Refs: BA-N`. *The commit's form* still describes the commit footer. `pnpm check:docs` passes.

### U3. Cubic stops writing the body

- **Goal:** Cubic's summary no longer lands in pull request bodies or merge commits.
- **Requirements:** R7; KTD5.
- **Dependencies:** none.
- **Files:** `cubic.yaml`.
- **Approach:** Set `pr_descriptions.generate` to `false`, in its own pull request that merges before the docs pull request opens. Leave the other `pr_descriptions` keys unless U4 shows `cubic_review_link` still editing the body. In that case set it to `false` too, in a follow-up pull request. Add no comment beside the value, because the comment gates check new comments. This pull request's own body still gets Cubic's summary, because the setting is read from `main` only. History is not rewritten.
- **Test expectation:** none. This is configuration. Its effect shows on the docs pull request, the first one Cubic reviews under the new setting.
- **Verification:** On the docs pull request, Cubic's check completes, `arm-merge.yml` arms the merge once the pull request is marked ready, and no "Summary by cubic" block appears in the body.

### U4. Before and after, on the docs pull request

- **Goal:** Show that `ce-commit-push-pr` writes the stated form once `AGENTS.md` carries it.
- **Requirements:** R9; KTD6.
- **Dependencies:** U3 merged to `main`. U1 and U2 committed and pushed, in a draft pull request whose body is a one-line placeholder with no `Merge risk:` line and no issue line. A draft holds the merge: `arm-merge.yml` skips drafts, and Cubic does not review them (`check_drafts: false`).
- **Files:** none. The results go in the docs pull request's body, under a short heading in the middle.
- **Approach:**
  1. Before: in a fresh session started in the main checkout, which holds the old `AGENTS.md`, run `ce-commit-push-pr` in description-only mode on the draft. Keep its output.
  2. After: in a fresh session started in this branch's worktree, run the same request on the same draft. Keep its output.
  3. Compare the two outputs against R2 to R5. Apply the after run's body, with the comparison added, as the pull request's body. Do not paste both bodies whole.
  4. Mark the pull request ready. Cubic then reviews it and `arm-merge.yml` arms it.
- **Test scenarios:**
  - The after run ends with a `Merge risk:` line and then `Fixes BA-58`, with only the attribution line after them. The placeholder body names no issue, so CE must find BA-58 from the branch name. If it does not, name the issue in the request to both runs, and do not count the missing line against the contract.
  - The after run's `Merge risk:` line says `reversible` and names what a failure reaches.
  - The after run has no `Refs:` footer in the body.
  - The before run lacks the `Merge risk:` line, which shows the change caused the difference. The diff itself contains the contract, so a `Merge risk:` line in the before run makes the comparison inconclusive, not failed. Report that, and do not count the scenario as passed.
  - The live pull request body, after Cubic has reviewed the ready head, carries no Cubic summary block.
- **Verification:** All five scenarios hold. If the after run drops a required field, the first stop condition applies.

---

## Verification Contract

| Check | Proves | Applies to |
|---|---|---|
| `pnpm check:docs` | Formatting, the refused-words scan, and the docs-lane tests pass on the edited docs | U1, U2 |
| `pnpm check:gates` | The comment gates and lint pass with the `cubic.yaml` change | U3 |
| Cubic's check on the docs pull request completes, and `arm-merge.yml` arms the merge once it is ready | Turning off summaries left the review and the arming intact | U3 |
| The U4 before-and-after comparison, in the docs pull request's body | CE writes the stated form after the change | U4 |
| BA-58 moves to Done when the docs pull request merges | `Fixes BA-N` closes the issue through Linear's integration | U1 |

---

## Definition of Done

- `AGENTS.md` states the body form once. `docs/agents/workflow.md` points to it. Neither says the pull request body carries `Refs: BA-N`.
- `cubic.yaml` on `main` has `pr_descriptions.generate: false`, and the docs pull request's body has no Cubic summary.
- The U4 comparison is in the docs pull request's body, and every U4 scenario holds.
- `commitlint.config.mjs`, `lefthook.yml` and the `pr-title` job are unchanged.
- The docs pull request's body is in the new form, ending with `Merge risk:` and `Fixes BA-58`.
- No abandoned wording or experimental edits are left in the diff.

---

## Appendix

### Sources

- `.scratch/ce-evaluation-2026-10-06/release-pr.md` in the main checkout: the three sources, the commit checks, Pocock's `pr` skill against CE.
- CE 3.30.3, `skills/ce-commit-push-pr/references/pr-description-writing.md`: *Project PR-body contract*, *Step Pre-A* (the open-state stop), the Linear reference table, and *Step C*.
- Linear's GitHub integration docs (`https://linear.app/docs/github`): closing, non-closing and relation magic words, and where they are read.
- Cubic's repository config schema (`https://cubic.dev/schema/cubic-repository-config.schema.json`): `pr_descriptions.generate` and `skip_if_author_description`.
- `docs/solutions/skill-design/portable-agent-skill-authoring.md`: state an instruction once; always-loaded text earns its place.
