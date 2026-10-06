---
title: The Glossary as CONCEPTS.md - Plan
type: docs
date: 2026-10-06
topic: glossary-as-concepts
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# The Glossary as CONCEPTS.md - Plan

## Goal Capsule

- **Objective:** Compound Engineering's planning, brainstorming, compounding and review skills read the project's glossary in the place they look for it, and keep it current in a form they can edit without working around it. No `ce-compound` run stops to reason about a second glossary again.
- **Means:** The glossary moves from `CONTEXT.md` to `CONCEPTS.md`, and every reference follows (KTD1). Once BA-29's sweeps finish, its entries take CE's format and the words test reads that format (KTD4).
- **Authority:** The Product Contract's requirements come first, then the Key Technical Decisions, then the units. A decision marked `session-settled` is not reopened.
- **Stop conditions:**
  - A test reads the glossary in a way the rename cannot satisfy without changing what the test checks.
  - U2 is reached while BA-29 still has an unmerged sweep that edits glossary entries.
  - A CE rule turns out to conflict with the words test in a way this plan does not name.
- **Execution profile:** Two pull requests. U1 lands now, `Related to BA-59`. U2 lands after BA-29's U17 has merged, `Fixes BA-59`. U1 changes a `.ts` file, so its merge group runs the full lane. BA-29's sweeps keep landing around U1: a sweep that merges after U1 rebases over the move, and U1's recount runs again on the head that goes up for review.
- **Who finishes:** `ce-work` builds each, `ce-code-review` reviews it, and `ce-commit-push-pr` opens the pull request. Edits to a tracked skill go through `ce-skill-work`.

---

## Product Contract

### Summary

The glossary moves to `CONCEPTS.md` at the repository root, and every tracked file outside `docs/archive/` names it there. `AGENTS.md` and `docs/agents/domain.md` say that CE's skills edit it. After BA-29's last sweep, its entries take CE's format, apart from two marks the words test needs, and the words test reads that format.

### Problem Frame

`ce-plan`, `ce-brainstorm`, `ce-compound` and the learnings researcher in `ce-code-review` read a root `CONCEPTS.md`. None of them reads `CONTEXT.md`. They see the glossary today only because `AGENTS.md` points to it.

`AGENTS.md` runs `ce-compound` non-interactively after solved problems. Its first qualifying run would create a second, unreviewed glossary. At least four runs on 02/10 and 03/10/2026 stopped to reason that the glossary is `CONTEXT.md` and declined to create `CONCEPTS.md`. The prompt audit of 03/10/2026 flagged the gap as High.

The rename was planned on 28/09/2026 for the move to CE and deferred on 30/09 to the glossary brainstorm. BA-29's plan never picked it up.

The glossary has about 1,220 lines and differs from CE's format:
- Each entry is a bullet headed by the reader's word.
- Some definitions open with `_Internal._` or `_Code rename pending._`.
- Many entries cite ADRs and some name files.

The words test (`apps/api/tests/avoid-words.test.ts` with `words-scan.ts`) reads those bullets and marks. BA-29's sweeps U11 to U17 are still rewriting entries.

### Requirements

**The rename**

- R1. The glossary is `CONCEPTS.md` at the repository root, moved with its history.
- R2. No tracked file outside `docs/archive/` names `CONTEXT.md`. That includes dated plans, BA-29's plan in progress, and Cubic's generated wiki. The one exception is a document whose subject is the move itself: this plan, and a learning written about the rename, name the old path to say what moved.
- R3. The tests that read the glossary's path pass against the new name, and check what they checked before.

**Who edits it**

- R4. `AGENTS.md` and `docs/agents/domain.md` name `CONCEPTS.md` and say that `ce-brainstorm`, `ce-plan`, `ce-compound` and `ce-compound-refresh` edit it as CE defines. The rule that a term enters only once a decision has settled it is replaced, not kept beside CE's.
- R5. `cubic.yaml`'s review instructions name `CONCEPTS.md` and keep their check that a new domain word is defined there in the same change as the code that uses it.

**The format**

- R6. After BA-29's last sweep, the glossary's structure and entries follow CE's rules for `CONCEPTS.md`. The only exceptions are the ones this plan records with the owner's reason (Key Decisions). The glossary's own preamble names those exceptions from U1 on, because CE's skills read that file and not this plan.
- R7. The words test reads the new format and keeps every check it makes today: entry heads, the two marks, and its old-words list against the glossary.

**Proof**

- R8. A `ce-compound` run after the rename reports on `CONCEPTS.md`, creates no second glossary file, and leaves every `_Internal._` and `_Code rename pending._` mark in place.

### Key Decisions

- **CE's skills edit the glossary as CE defines** (session-settled: user-directed — chosen over "decision points add, compounding only tidies" and over keeping the owner's rule fully: every edit shows in the pull request's diff and Cubic reviews it, so the glossary can grow with the work). Governs R4, R5.
- **Every reference outside `docs/archive/` changes, dated plans and Cubic's wiki included** (session-settled: user-approved — confirmed in the scoping synthesis: the issue's acceptance criterion says no tracked file outside the archive may name `CONTEXT.md`, and BA-29's plan in progress must find the file). Governs R2.
- **The `_Internal._` and `_Code rename pending._` marks stay** (session-settled: user-approved — confirmed in the scoping synthesis over CE's rule against status marks: the words test uses them to keep internal words off pages and to hold pending renames). Governs R6, R7.

### Scope Boundaries

- No entry's meaning changes. U2 changes format and removes content CE's rules exclude, not definitions.
- BA-29's sweeps and its old-words list are BA-29's work.
- `docs/archive/` is not edited.

#### Deferred to Follow-Up Work

- A repo-wide bootstrap by `ce-compound-refresh`, which would seed terms the glossary lacks. It can run any time after U2.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **One `git mv`, then a reference sweep, in one pull request.** Git follows the move, so open branches that edit glossary entries (BA-29's sweeps) rebase over it cleanly. Each unrelated mention of the old path is a one-word edit. Prose that names the file "the glossary" keeps that wording and changes only the path. Governs R1, R2.
- KTD2. **In U1 the words test follows the path and learns CE's entry shape.** `GLOSSARY` in `apps/api/tests/words-scan.ts` is the one path the test reads. From U1's merge, CE's skills may add or refine an entry as a `### head` heading, and the parser reads only `- **head** —` bullets. So U1 teaches the parser both shapes, taking the mark from the first word of the definition in each. Without that, an entry CE writes in its own shape escapes the test, or removes a head an old-words row names and turns the docs lane red. The test also widens its guard against a list of avoided words to match CE's `Avoid:` line in any emphasis. The test's failure messages and `old-words.ts`'s header comment name the file for the reader, so they follow it. `packages/devtools/test/ci/docs-lane.test.ts` and `survey-architecture-skill.test.ts` use the name as a fixture path or an expected string, so they change in step with the files they describe. Governs R3.
- KTD3. **`domain.md` states CE's rule in one sentence and points to CE.** It does not copy CE's mutation list, which CE owns (`skills/ce-compound/references/concepts-vocabulary.md` in the plugin) and may change. It keeps the part of today's rule that still holds: a domain word used in code is defined in `CONCEPTS.md` in the same change. Governs R4, R5.
- KTD4. **U2 reshapes the glossary, then drops the parser's bullet branch.** Once every entry is a `###` heading, the bullet branch U1 added reads nothing, so U2 removes it in the same pull request. Governs R6, R7.
- KTD5. **The marks open the definition sentence in both shapes, as they do now.** A `###` entry reads `### head`, then a definition that starts with `_Internal._` or `_Code rename pending._` when it carries one. The parser reads the mark from the first word of the definition, from U1 on. Governs R6, R7.
- KTD6. **U2 drops ADR numbers and file paths from entries, and keeps the decision.** CE's rule is that an entry stands on its own. An ADR number or a path is a pointer, and the decision doc already cites the glossary. Where an entry needs the rule the ADR states, U2 says the rule in words. Governs R6.

### Assumptions

- `ce-compound`'s vocabulary capture runs on any qualifying learning. If U1's pull request produces none, R8's check runs `ce-compound` on a short learning about the rename itself, which qualifies because the rename is durable reasoning a future reader would otherwise rediscover.

### Open Questions

- **CE's `Avoid:` line (decide before U2 starts; today's rule holds until then).** CE lists dropped synonyms under an entry. `apps/api/tests/old-words.ts` says the glossary deliberately never shows an old word, so an agent learns only the word to write, and the words test holds the old words instead. Following CE puts old words back in the file agents read most. The recommendation is to keep the old words out and record that as an exception. Until the owner decides, U1 keeps today's rule: the preamble says the file carries no `Avoid:` line, and the words test refuses one. The question decides only whether U2 changes that.

### System-Wide Impact

- **Every agent session** reads the glossary's new path through `AGENTS.md`. CE's skills start reading and editing `CONCEPTS.md` directly once it exists.
- **Cubic** reads its review instructions from `cubic.yaml` on `main`, so its check of new domain words follows the rename only after U1 merges.
- **BA-29's sweeps in flight** rebase over U1. Their plan's references change in U1, so a sweep that starts after U1 edits `CONCEPTS.md`.
- **The words test** runs in the docs lane, so a glossary path it cannot read fails every docs-only pull request until fixed.

---

## Implementation Units

### U1. Move the glossary and every reference

- **Goal:** The glossary is `CONCEPTS.md`, and every tracked file outside `docs/archive/` names it there.
- **Requirements:** R1, R2, R3, R4, R5, R7; KTD1, KTD2, KTD3, KTD5.
- **Dependencies:** none.
- **Files:**
  - `CONTEXT.md` → `CONCEPTS.md` (moved; its title line names the new file)
  - `AGENTS.md`, `docs/agents/domain.md`, `CODING_STANDARDS.md`, `apps/web/CODING_STANDARDS.md`, `README.md`, `cubic.yaml`, `.gitnexusignore`
  - `apps/api/tests/words-scan.ts`, `apps/api/tests/avoid-words.test.ts`, `apps/api/tests/old-words.ts`, `apps/api/src/ingress/hostnames.ts`
  - `packages/devtools/test/ci/docs-lane.test.ts`, `packages/devtools/test/ci/survey-architecture-skill.test.ts`
  - `.claude/skills/survey-architecture/SKILL.md`, `.claude/skills/survey-architecture/references/report.md`, `packages/design-system/readme.md`, `packages/design-system/guidelines/kits-adoption.card.html`
  - `docs/architecture/` (8 files), every other plan in `docs/plans/` that names it, `docs/solutions/` (4 files), `docs/specs/v01-route.md`, `docs/dogfood-reports/2026-09-30-docs-shell-people-dogfood-dogfood.md`, `.cubic/wiki/` (5 files)
- **Approach:**
  1. `git mv CONTEXT.md CONCEPTS.md` and change its title line. Its opening paragraph gains two sentences. One says CE's skills edit the file as CE defines. The other names this repository's exceptions to CE's rules: the two marks open a definition and stay, the file carries no `Avoid:` line, and entries keep the file's present format until it is reshaped.
  2. Change the path in every file above. Where `domain.md` and `AGENTS.md` state the old "settled before it enters" rule, replace it per KTD3.
  3. Teach the words test's parser the `###` shape and widen its avoided-words guard (KTD2), planted tests first.
  4. Edit the tracked skill's files through `ce-skill-work`. AGENTS.md routes any tracked-skill edit there.
  5. Recount with a tracked-file search: no file outside `docs/archive/` names `CONTEXT.md`, apart from the R2 exception. Count again on the head that goes up for review, because new files may have landed on `main` in between.
- **Execution note:** The words test is the proof. Run it after the path constant changes and before the sweep of prose, so a parse failure shows on its own.
- **Patterns to follow:** the earlier renames in `docs/solutions/best-practices/how-a-rename-sweep-lands-a-word-in-the-words-test.md`; one commit per concern (the move, then the references).
- **Test scenarios:**
  - The words test reads `CONCEPTS.md` and passes with the same number of tests as on `main`.
  - With the glossary briefly renamed back in a scratch tree, the words test fails because it cannot read the glossary, which shows it reads the new path rather than passing on an empty read.
  - `docs-lane.test.ts` still classifies a change to the glossary as docs-lane.
  - `survey-architecture-skill.test.ts` passes with the skill's new text.
  - A planted `### job` entry whose definition opens `_Internal._` is read as an internal head, beside planted bullet entries.
  - A planted `###` entry whose definition opens `_Code rename pending._` is read as pending.
  - A planted glossary with a `*Avoid:* x` line fails the avoided-words guard.
- **Verification:** A tracked-file search outside `docs/archive/` finds no `CONTEXT.md` apart from the R2 exception. `pnpm check:docs`, `pnpm check:gates` and the api's `check` pass.

### U2. Reshape the entries for CE, and the words test with them

- **Goal:** The glossary follows CE's format, apart from the recorded exceptions, and the words test reads it.
- **Requirements:** R6, R7; KTD4, KTD5, KTD6.
- **Dependencies:** U1 merged, BA-29's U17 merged, and the `Avoid:` open question answered.
- **Files:** `CONCEPTS.md`, `apps/api/tests/words-scan.ts`, `apps/api/tests/avoid-words.test.ts`, and `apps/api/tests/old-words.ts` if a row's `entry` names a head whose wording changes.
- **Approach:**
  1. Record the words test's list of heads and marks on the file as it stands.
  2. Reshape `CONCEPTS.md`:
     - `##` clusters as today, `###` per entry.
     - A one-sentence definition, with a second paragraph only for behavioural rules.
     - ADR numbers and file paths removed (KTD6).
     - A Flagged ambiguities tail for the distinctions the glossary already settles.
     - A `## Retired` tail only if an entry qualifies.
  3. Move the opening paragraph's notes about the marks and the old-words list into `docs/agents/domain.md`, which explains the file to agents. The glossary keeps a one-paragraph preamble that still names the exceptions (R6).
  4. Remove the parser's bullet branch and the planted bullet tests (KTD4).
- **Test scenarios:**
  - A planted bullet entry is no longer read, once the bullet branch is gone.
  - A heading inside the Flagged ambiguities or Retired tail is not read as an entry head.
  - On the real file, the words test finds the same heads and marks it found before the reshape. Compare the two lists, not just the pass.
- **Verification:** The words test passes on the reshaped file with the same set of heads and marks as before. No entry names a file path or an ADR number. `pnpm check:docs` passes.

---

## Verification Contract

| Check | Proves | Applies to |
|---|---|---|
| Tracked-file search outside `docs/archive/` for `CONTEXT.md` returns only the R2 exception | R2 | U1 |
| `pnpm check:docs` (words test, docs-lane tests, formatting) | R3, R7 | U1, U2 |
| `pnpm check:gates` and the api's `check` | The `.ts` edits pass lint, types and comment gates | U1 |
| Heads-and-marks list from the words test before and after the reshape is identical | R7 | U2 |
| A `ce-compound` run after U1 merges reports a `CONCEPTS.md` line, creates no other glossary file, and leaves every mark it found | R8 | U1 |

---

## Definition of Done

- `CONCEPTS.md` is at the root with `CONTEXT.md`'s history, and nothing outside `docs/archive/` names `CONTEXT.md` apart from the R2 exception.
- `AGENTS.md`, `domain.md` and `cubic.yaml` say CE's skills edit the glossary as CE defines.
- A `ce-compound` run reported on `CONCEPTS.md`, created no second file, and left the marks in place.
- After U2: entries follow CE's format apart from the recorded exceptions, and the words test reads the same heads and marks as before.
- No abandoned wording or experimental edits are left in either diff.

---

## Appendix

### Sources

- Linear BA-59, and BA-29 for the sweeps in progress.
- `.scratch/ce-evaluation-2026-10-06/owner-feedback-checks.md`, section 2, in the main checkout.
- CE 3.30.3: `skills/ce-compound/references/concepts-vocabulary.md` (the rules), `skills/ce-compound/references/assembly.md` (Phase 2.4, vocabulary capture), `skills/ce-brainstorm/references/plan-write.md` and `skills/ce-plan/references/final-review.md` (their gap-fill steps).
- `docs/solutions/best-practices/how-a-rename-sweep-lands-a-word-in-the-words-test.md`.
