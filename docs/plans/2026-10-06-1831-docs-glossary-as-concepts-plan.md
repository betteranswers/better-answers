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
- **Means:** The glossary moves from `CONTEXT.md` to `CONCEPTS.md`, and every reference follows (KTD1). Its entries then take CE's format, and the words test reads that format (KTD4, KTD7).
- **Authority:** The Product Contract's requirements come first, then the Key Technical Decisions, then the units. A decision marked `session-settled` is not reopened. An owner decision listed under Open Questions is the owner's to answer, and the build does not answer it.
- **Stop conditions:**
  - A test reads the glossary in a way the change cannot satisfy without changing what the test checks.
  - U2 is reached while #620 (BA-71) is still open, or while an owner decision under Open Questions is unanswered.
  - A CE rule turns out to conflict with the words test in a way this plan does not name.
  - The before-and-after comparison of entries (KTD8) differs in a way no owner decision explains.
- **Execution profile:** Two pull requests. U1 merged as #593 on 06/10/2026, `Related to BA-59`, and #596 recorded R8's check. U2 lands as the second, `Fixes BA-59`, on the branch `liam/ba-59-concepts-reshape`, rebased onto `main` once #620 has merged (KTD10). U2 changes `.ts` files, so its merge group runs the full lane.
- **Who finishes:** `ce-work` builds each, `ce-code-review` reviews it, and `ce-commit-push-pr` opens the pull request.

---

## Product Contract

### Summary

The glossary moves to `CONCEPTS.md` at the repository root, and every tracked file outside `docs/archive/` names it there. `AGENTS.md` and `docs/agents/domain.md` say that CE's skills edit it. After BA-29's last sweep, every entry becomes a `###` heading in CE's format, apart from the exceptions the owner records, and the words test reads only that shape.

### Problem Frame

`ce-plan`, `ce-brainstorm`, `ce-compound` and the learnings researcher in `ce-code-review` read a root `CONCEPTS.md`. None of them reads `CONTEXT.md`. They saw the glossary only because `AGENTS.md` pointed to it, and at least four `ce-compound` runs on 02/10 and 03/10/2026 stopped to reason that the glossary was `CONTEXT.md`. U1 fixed the name.

The entries still differ from CE's format. On 08/10/2026 the file has 1,226 lines and 254 entries, each a `- **head** —` bullet:
- 89 definitions open with `_Internal._`. The `_Code rename pending._` mark is defined in the preamble and carried by no entry, because BA-29's last sweep landed every pending row.
- 69 lines cite an ADR, 23 name a file path, 21 carry a date, 6 name the owner as the source of a decision, and 4 cite a ticket. 138 code spans name identifiers, keys or wire values.
- Many definitions run to several sentences, and one paragraph in *Trust words the reader sees* (the riders) sits between entries rather than in one.

The words test (`apps/api/tests/avoid-words.test.ts` with `words-scan.ts`) reads those entries for their heads, their marks and the word a page says instead. It also scans the file line by line for old words, and `apps/api/tests/old-words.ts` permits some senses only in phrases the glossary writes today.

### Requirements

**The rename**

- R1. The glossary is `CONCEPTS.md` at the repository root, moved with its history.
- R2. No tracked file outside `docs/archive/` names `CONTEXT.md`. That includes dated plans, BA-29's plan, and Cubic's generated wiki. The one exception is a document whose subject is the move itself: this plan, and a learning written about the rename, name the old path to say what moved.
- R3. The tests that read the glossary's path pass against the new name, and check what they checked before.

**Who edits it**

- R4. `AGENTS.md` and `docs/agents/domain.md` name `CONCEPTS.md` and say who may change an entry now that `ce-compound` and `ce-compound-refresh` edit the file. Whatever rule holds is also stated in the glossary's preamble, because CE's skills read that file and not `domain.md`.
- R5. `cubic.yaml`'s review instructions name `CONCEPTS.md` and keep their check that a new domain word is defined there in the same change as the code that uses it.

**The format**

- R6. After BA-29's last sweep, the glossary's structure and entries follow each of CE's rules, as the table under *CE's rules, rule by rule* records. A rule is not followed only where the owner has recorded an exception and its reason. The preamble names every exception, because CE's skills read that file and not this plan.
- R7. The words test reads the reshaped file and keeps every check it makes today: entry heads, the two marks, the word a page says instead, its old-words list against the glossary, and the line scan of the glossary for old words.
- R9. The words test fails, rather than reading nothing, when an entry is written in the bullet shape the reshape retires.

**Proof**

- R8. A `ce-compound` run after the rename reports on `CONCEPTS.md`, creates no second glossary file, and leaves every `_Internal._` and `_Code rename pending._` mark in place.

### Key Decisions

- **CE's skills edit the glossary as CE defines** (session-settled: user-directed — chosen over "decision points add, compounding only tidies" and over keeping the owner's rule fully: every edit shows in the pull request's diff and Cubic reviews it, so the glossary can grow with the work). Governs R4, R5. Open Question D1 asks the owner whether that rule stands as #593 wrote it, now that unit 2 makes CE's format the file's own.
- **Every reference outside `docs/archive/` changes, dated plans and Cubic's wiki included** (session-settled: user-approved — confirmed in the scoping synthesis: the issue's acceptance criterion says no tracked file outside the archive may name `CONTEXT.md`, and BA-29's plan in progress must find the file). Governs R2.
- **The `_Internal._` and `_Code rename pending._` marks stay** (session-settled: user-approved — confirmed in the scoping synthesis over CE's rule against status marks: the words test uses them to keep internal words off pages and to hold pending renames). Governs R6, R7.
- **The glossary carries no `Avoid:` line.** The owner decided this on 06/10/2026, in a comment on BA-59, as the plan recommended. An agent reading the glossary learns only the word to write, and the words test holds the old words. The same reason covers CE's fold note, which names the old term on the entry that absorbs it. Governs R6.

### CE's rules, rule by rule

CE's rules are `skills/ce-compound/references/concepts-vocabulary.md` in the plugin release `.claude/settings.json` pins (3.30.4 on 08/10/2026). This table records where each lands. "Follow" is U2's work; "Exception" is recorded in the preamble; "D*n*" waits on the owner (Open Questions).

| CE's rule | Here |
|---|---|
| The file lives at the root as `CONCEPTS.md` | Follow (U1) |
| Which runs may add, refine, fold, retire, delete or scrub | Follow CE's list; who may add is D1 |
| Terms enter by accretion and by seeding | Follow. A repo-wide seeding bootstrap is deferred (Scope Boundaries) |
| Pick one word and list dropped synonyms as `Avoid:` | Exception: no `Avoid:` line, and no fold note naming an old word (Key Decisions) |
| No implementation specifics: paths, class and function names, table names, library calls | Follow for the platform's own identifiers. Names the platform does not own are D3 |
| No status fields, dates or owners on entries | Exception for the two marks (Key Decisions). Dates and owners' names are removed |
| No examples or current-config values: thresholds, counts, enum values | Follow: state the behaviour. A count that defines the concept, such as three layers, is the concept and stays. Wire values are D3 |
| No links to PRs, issues, channels or roadmap milestones | Follow for tickets and pull requests. ADR numbers are D2 |
| No version-specific claims | Follow for history ("until 30/09/2026 …"). The *v0.1* scope of a rule is D4 |
| A project-specific term an entry leans on is defined too | Follow for terms U2 meets. A sweep for missing terms is deferred |
| What earns a slot, and what keeps one | Deferred: U2 removes and folds no entry (D5) |
| One-sentence definition; a second paragraph only for behavioural rules | Follow (KTD11) |
| Relationships section, optional | Follow: each cluster's opening prose stays as its relationships note |
| Cluster by domain relationship | Follow: the `##` clusters stay |
| Flagged ambiguities tail | Follow (KTD12) |
| Retired tail, only when it has entries | Follow: absent, because U2 retires no entry (Scope Boundaries). A later `ce-compound-refresh` run, or D5's answer, may add it |

### Scope Boundaries

- No entry's meaning changes, and no head changes its wording. U2 changes format and removes what CE's rules exclude. Where removing a phrase would change what an entry says, that is a D-question, not a build call.
- No entry is added, folded, retired or deleted, apart from the three kinds of principal folded into their parent entry (KTD11).
- BA-29's sweeps and its old-words list are BA-29's work, and BA-29 is done.
- `docs/archive/` is not edited.
- Not built: a committed check that cluster prose sits only before a cluster's first entry. KTD8's second comparison catches prose the reshape absorbs. A later edit that puts prose after an entry would lengthen that entry's definition and change no mark, which the internal-word check would show only if the prose said what a page says. Evidence that would change the call: a CE run that writes cluster prose after entries.

#### Deferred to Follow-Up Work

- A repo-wide bootstrap by `ce-compound-refresh`, which would seed terms the glossary lacks and judge which entries keep their slot. It can run any time after U2.
- Before that bootstrap runs, a committed one-way check that every head marked `_Internal._` after U2 keeps its mark. A run that scrubs a mark as a status field would otherwise take that word out of the internal-word check without a failure. U2 does not add it, because the risk exists since U1 and a scoped run touches only its neighbourhood, but a whole-file refresh does not.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **One `git mv`, then a reference sweep, in one pull request.** Git follows the move, so open branches that edit glossary entries rebase over it cleanly. Each unrelated mention of the old path is a one-word edit. Prose that names the file "the glossary" keeps that wording and changes only the path. Governs R1, R2.
- KTD2. **In U1 the words test follows the path and learns CE's entry shape.** `GLOSSARY` in `apps/api/tests/words-scan.ts` is the one path the test reads. U1 taught the parser both shapes, taking the mark from the first word of the definition in each, so an entry CE writes in its own shape does not escape the test. The test also widened its guard against a list of avoided words to match CE's `Avoid:` line in any emphasis. Governs R3.
- KTD3. **`domain.md` states CE's rule in one sentence and points to CE.** It does not copy CE's mutation list, which CE owns and may change. It keeps the part of the earlier rule that still holds: a domain word used in code is defined in `CONCEPTS.md` in the same change. Governs R4, R5.
- KTD4. **U2 drops the parser's bullet branch once no entry is a bullet.** Kept, the branch would misread the reshaped file: a column-0 `- **x** —` list inside a `###` entry's body opens a new entry and cuts the heading entry's definition short. Dropped, a stray bullet entry would go unread, which R9's guard turns into a failure. Governs R7, R9.
- KTD5. **The marks open the definition sentence, as they do now.** A `###` entry reads `### head`, then a definition that starts with `_Internal._` or `_Code rename pending._` when it carries one. The preamble keeps defining both marks, the pending one included, so a later sweep and CE's skills know what it means. Governs R6, R7.
- KTD6. **U2 removes ticket numbers, pull request numbers, dates, owners' names and the platform's own identifiers from entries, and keeps the rule each one carried.** Where an entry needs the rule the pointer stood for, U2 states it in words. ADR numbers, names the platform does not own, and *v0.1* qualifiers wait on D2, D3 and D4. Governs R6.
- KTD7. **The parser reads no entry under `## Flagged ambiguities` or `## Retired`.** CE writes one-line notes there, and a `###` in a tail is not a term with a definition. Reading resumes under any other `##` heading. Today a `###` under a tail would be read as an entry, so this is new behaviour, built test-first. Governs R7.
- KTD8. **The reshape is proved by two before-and-after comparisons.** The first compares each entry's (head, mark, page word) triple, from `entriesOf`, the mark rule and `PAGES_SAY`, and any difference must be one an owner decision explains. Only five definitions say what a page says, so the triples cannot see prose absorbed into most entries. The second therefore compares each cluster's opening prose: every line that sits in no entry on the file as it stands, the riders paragraph included, must sit between its `##` heading and that cluster's first `###` on the reshaped file. Both are build-time checks reported in the pull request, not committed tests, because CE adds entries and a pinned list would refuse every one. Governs R7.
- KTD9. **The glossary keeps every phrase a permitted sense matches, on one line.** The line scan reads the glossary like any tracked file. Seven phrases for *run* are permitted only inside `CONCEPTS.md` (`old-words.ts`, the sense *a release's run and its outcome word*), and other senses match phrases anywhere. The scan reads line by line, so a phrase split across a line break is two lines that each fail. Where a definition must be reworded, U2 rewords the sense's pattern in the same commit rather than widening it. Governs R7.
- KTD10. **U2 builds after #620 merges, and adds no pending row.** #620 adds `landsBy` to `Renamed` and the overdue check to `words-scan.ts` after `stillPending`. U2 changes the top of `words-scan.ts` (`BULLET_HEAD`, `openedBy`, `continues`, the `Open` type) and the planted glossaries in the middle of `avoid-words.test.ts`, so the hunks do not meet. #620 appends a `describe` at the end of the test file, and U2 adds its tests inside *the glossary's entries* rather than at the end. U2 renames no word, so it adds no pending row. If the build finds it must, the row's `landsBy` is the day U2 is expected to merge. Governs R7.
- KTD11. **Definitions become one sentence, and every other sentence moves to a rule paragraph unless it may go.** The sentence says what the term means and what sets it apart from its neighbours, so a "Not *X*" distinction stays on the entry. Lifecycle, ownership and "never" rules, and any sentence that adds a distinction or a rule, go to a second paragraph. A sentence may go only when it is one KTD6 removes or says nothing the remaining text does not. The pull request lists every other sentence the reshape removed, entry by entry, for the owner to review against Scope Boundaries. The three kinds of principal, today a sub-bullet list, become a sentence in the principal entry's second paragraph. A column-0 list there would trip R9's guard. *Operator* keeps its own entry. The riders paragraph in *Trust words the reader sees* moves into that cluster's opening prose, before its first entry. Governs R6, R7.
- KTD12. **Flagged ambiguities holds only word pairs once used for one thing.** CE's tail is the audit trail for settled distinctions between two terms, such as *knowledge base* and *bundle*, or a *landed copy* and the verb *land*. A one-sided negation stays on its entry. A tail line names only words the glossary heads, each in its head's sense, and never a replaced word that has no entry of its own (Key Decisions). *Bundle* qualifies because it heads its own entry, though a page says *knowledge base*. Governs R6.
- KTD13. **One commit per `##` cluster, then one for the parser and its tests.** The parser reads both shapes until the last commit, so every commit keeps `pnpm check:docs` green. Dropping the bullet branch first would leave every old-words row under a head the parser no longer reads. Governs R7.

### Assumptions

- `ce-compound`'s vocabulary capture runs on any qualifying learning. U1's pull request satisfied R8 through #596.
- No sweep or other change marks an entry `_Code rename pending._` between now and U2's merge. If one does, its pending row carries the `landsBy` that #620 requires, and U2 keeps the mark at the head of the reshaped definition.

### Open Questions

Each is the owner's to decide. U2's build starts only once each has an answer, because each changes what the build writes. The recommendation is the planner's.

- **D1. Who may add an entry (unresolved).** `docs/agents/domain.md`, as #593 wrote it, says CE's skills add, refine, fold and retire entries under CE's rules, and that a domain word code uses is defined in the same change or before it. Before #593, a term entered only once a decision had settled it.
  - **A. Keep #593's rule.** Every CE edit shows in its pull request's diff, and Cubic and the owner review it. The glossary grows with the work. An entry can enter that no decision settled, and `ce-compound-refresh` applies its edits without asking.
  - **B. Additions only from settled decisions.** CE may refine, fold, scrub and retire, and a new entry comes only from a plan, a brainstorm or a decision doc that settled it. The preamble must say so, because CE reads it. CE's own rules let a `ce-compound` run add, so the preamble overrides CE's skills, and no test enforces it.
  - **C. Keep A, and have a pull request name each entry CE added.** That costs `ce-commit-push-pr` one line of body per addition, and the gate is review alone.
  - **Recommendation: A.** The owner chose it on 06/10/2026 against B's shape, and nothing since has shown an unreviewed entry landing. Whichever stands, the preamble says it in one sentence (R4).
- **D2. ADR numbers in entries (unresolved).** 69 lines cite one.
  - **A. Remove them and state the rule in words** (KTD6). The entry stands on its own, as CE requires, and a reader finds the reasoning by searching the decision docs for the term.
  - **B. Keep them, as an exception.** A reader can go straight to the reasoning, but CE's skills read a number they cannot resolve, and a renumbered decision leaves a stale pointer.
  - **Recommendation: A.**
- **D3. Names the platform does not own (unresolved).** The preamble already says OKF's keys, the MCP wire and a protocol's own names keep theirs. *Trust words the reader sees* maps each wire value, such as `human-reviewed`, to the words a reader sees. CE forbids implementation names and enum values.
  - **A. Keep names the platform does not own, as an exception, and remove the platform's own identifiers.** This keeps the mapping that the trust cluster exists to state.
  - **B. Remove every code-formatted name.** The file conforms fully, and the wire-to-reader mapping goes to the decision docs.
  - **Recommendation: A.**
- **D4. The *v0.1* scope of a rule (unresolved).** Nine lines bound a rule to v0.1, such as "a company's knowledge is one knowledge base in v0.1". CE forbids version-specific claims. Dropping the qualifier would make a scoped rule read as permanent, which changes the entry's meaning.
  - **A. Keep the qualifier, as an exception, where dropping it would change the rule.**
  - **B. Drop the qualifier and the sentence it scopes.** The file loses rules that hold today.
  - **Recommendation: A.**
- **D5. Whether U2 judges which entries keep their slot (unresolved).** CE's rules fold an entry that is a property of another and delete one that general programming vocabulary covers.
  - **A. Defer it to a `ce-compound-refresh` run after U2.** Folding or deleting changes heads, so it needs old-words rows moved and owner review per entry. U2's comparison (KTD8) stays a pure format check.
  - **B. Do it in U2.** The file conforms sooner, but the comparison can no longer tell a format change from a content change.
  - **Recommendation: A.**

### System-Wide Impact

- **Every agent session** reads the glossary through `AGENTS.md`, and CE's skills read and edit `CONCEPTS.md` directly. After U2, the entries around any new one are `###` headings, which is the shape the preamble tells CE to follow.
- **The words test** runs in the docs lane. A glossary it reads wrongly fails every docs-only pull request until fixed, and a glossary it reads as empty passes them silently, which R9 and KTD8 exist to prevent.
- **Code and docs that name an entry** keep working, because no head changes: `apps/api/src/ingress/hostnames.ts` cites *share agent token*, and old-words rows name their `entry` by head.
- **Open branches that edit the glossary** rebase over a file in which every entry has moved. U2 is a large diff, so it should merge when no other branch edits the glossary.

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
  4. Edit the tracked skill's files through `ce-skill-work`.
  5. Recount with a tracked-file search: no file outside `docs/archive/` names `CONTEXT.md`, apart from the R2 exception.
- **Patterns to follow:** `docs/solutions/best-practices/how-a-rename-sweep-lands-a-word-in-the-words-test.md`; one commit per concern (the move, then the references).
- **Test scenarios:**
  - The words test reads `CONCEPTS.md` and passes with the same number of tests as on `main`.
  - With the glossary briefly renamed back in a scratch tree, the words test fails because it cannot read the glossary.
  - `docs-lane.test.ts` still classifies a change to the glossary as docs-lane.
  - `survey-architecture-skill.test.ts` passes with the skill's new text.
  - A planted `### job` entry whose definition opens `_Internal._` is read as an internal head, beside planted bullet entries.
  - A planted `###` entry whose definition opens `_Code rename pending._` is read as pending.
  - A planted glossary with a `*Avoid:* x` line fails the avoided-words guard.
- **Verification:** A tracked-file search outside `docs/archive/` finds no `CONTEXT.md` apart from the R2 exception. `pnpm check:docs`, `pnpm check:gates` and the api's `check` pass.

### U2. Reshape the entries for CE, and the words test with them

- **Goal:** Every entry in `CONCEPTS.md` is a `###` heading in CE's format, apart from the exceptions the owner records, and the words test reads only that shape.
- **Requirements:** R4, R6, R7, R9; KTD4 to KTD13.
- **Dependencies:** U1 (merged), BA-29's U17 (merged), #620 merged, and D1 to D5 answered.
- **Files:**
  - `CONCEPTS.md`
  - `apps/api/tests/words-scan.ts`, `apps/api/tests/avoid-words.test.ts`
  - `apps/api/tests/old-words.ts`, only where a permitted sense's pattern must follow a reworded phrase (KTD9)
  - `AGENTS.md`, whose glossary line gains one sentence saying who may change an entry (R4), which it does not say today
  - `docs/agents/domain.md`, only if D1's answer changes the rule
- **Approach:**
  1. Rebase the branch onto `main` after #620 merges. Record both baselines on the file as it stands: the (head, mark, page word) triples and each cluster's opening prose (KTD8).
  2. Reshape one `##` cluster per commit (KTD13):
     - each entry becomes `### head`, with the head's wording unchanged
     - its mark, if any, opens the definition (KTD5)
     - the definition becomes one sentence, with rules in a second paragraph (KTD11)
     - ticket and pull request numbers, dates, owners' names and the platform's own identifiers come out, and ADR numbers, names the platform does not own and *v0.1* qualifiers follow D2, D3 and D4 (KTD6)
     - every permitted-sense phrase stays whole on one line (KTD9).
  3. Add `## Flagged ambiguities` at the tail (KTD12).
  4. Rewrite the preamble. It keeps the definitions of both marks and the note on names the platform does not own. It names every exception the owner recorded, says a new entry is a `###` heading, states D1's rule in one sentence, and writes no `Avoid:` form the avoided-words guard would match.
  5. In the last commit:
     - drop the parser's bullet branch (KTD4)
     - stop reading entries under the two tails (KTD7)
     - add the guard against a column-0 bullet entry outside the tails (R9)
     - rewrite `PLANTED_GLOSSARY` in the heading shape, keeping its indented sub-entry as a body line
     - remove the bullet-only planted tests.
  6. Run both comparisons again (KTD8) and report their differences in the pull request, with the list of removed sentences (KTD11).
- **Execution note:** Write the tails test and the bullet guard's tests first, against planted glossaries, before changing the parser. Run the full words test after each cluster's commit, because the line scan is what catches a reworded permitted phrase.
- **Patterns to follow:** the planted-glossary tests in *the glossary's entries* describe in `avoid-words.test.ts`; `docs/solutions/best-practices/what-a-rename-sweeps-runner-and-prose-pass-get-wrong-and-the-checks-that-catch-it.md`, item 9, on phrases across line breaks; CE's illustrative entry in `concepts-vocabulary.md`.
- **Test scenarios:**
  - A planted `- **job** — _Internal._ …` line at column 0 is no longer read as an entry.
  - A planted glossary with a column-0 bullet entry under a `##` cluster fails the guard, and the failure names the line and says to write it as `### head`.
  - The same bullet line under `## Retired` passes the guard.
  - A planted `### cursor` under `## Flagged ambiguities` or `## Retired` is not read as an entry.
  - A planted `### job` under an ordinary `##` cluster after a `## Retired` tail is read as an entry.
  - The headed-entry test reads a definition and its rule paragraph as one definition, and reads no entry under the Flagged ambiguities tail.
  - With `PLANTED_GLOSSARY` in the heading shape, the internal-word and list-fault tests that use it pass with their expectations unchanged.
  - On the real file, the list agrees with the glossary, the line scan, the reader-text scan and the internal-word scan find nothing, and the avoided-words guard passes.
  - On the real file, the (head, mark, page word) triples match the list recorded before the reshape, apart from differences an owner decision explains (KTD8).
- **Verification:** `pnpm check:docs` and the api's `check` pass. Every entry is a `###` heading, and none names a ticket, pull request, date or owner, or anything an owner decision removed. Both comparisons and the list of removed sentences are reported in the pull request.

---

## Verification Contract

| Check | Proves | Applies to |
|---|---|---|
| Tracked-file search outside `docs/archive/` for `CONTEXT.md` returns only the R2 exception | R2 | U1 |
| `pnpm check:docs` (words test, docs-lane tests, formatting) | R3, R7, R9 | U1, U2 |
| `pnpm check:gates` and the api's `check` | The `.ts` edits pass lint, types and comment gates | U1, U2 |
| The (head, mark, page word) triples, and each cluster's opening prose, match before and after the reshape, apart from owner-explained differences | R7 (KTD8) | U2 |
| A search of the reshaped file finds no ticket number, pull request number, date or owner's name in an entry | R6 | U2 |
| A `ce-compound` run after U1 merges reports a `CONCEPTS.md` line, creates no other glossary file, and leaves every mark it found | R8 | U1 |

---

## Definition of Done

- `CONCEPTS.md` is at the root with `CONTEXT.md`'s history, and nothing outside `docs/archive/` names `CONTEXT.md` apart from the R2 exception.
- `AGENTS.md`, `domain.md` and the glossary's preamble say who may change an entry, as D1's answer has it, and `cubic.yaml` names `CONCEPTS.md`.
- A `ce-compound` run reported on `CONCEPTS.md`, created no second file, and left the marks in place.
- After U2: every entry is a `###` heading in CE's format apart from the recorded exceptions, the preamble names those exceptions, the words test reads the same triples as before, and a bullet entry fails it.
- No abandoned wording or experimental edits are left in either diff.

---

## Appendix

### Sources

- Linear BA-59 and its comment of 06/10/2026 (the `Avoid:` decision); BA-29 for the sweeps; BA-71 and #620 for `landsBy`.
- CE 3.30.4: `skills/ce-compound/references/concepts-vocabulary.md` (the rules) and `skills/ce-plan/references/final-review.md` (the gap-fill step that writes the shape of existing entries).
- `apps/api/tests/words-scan.ts`: `entriesOf`, `openedBy`, `continues`, `markOf`, `PAGES_SAY`, `unlisted`. `apps/api/tests/old-words.ts`: the senses permitted `within: "CONCEPTS.md"`.
- `docs/solutions/best-practices/how-a-rename-sweep-lands-a-word-in-the-words-test.md` and `what-a-rename-sweeps-runner-and-prose-pass-get-wrong-and-the-checks-that-catch-it.md`.
- `.scratch/ce-evaluation-2026-10-06/owner-feedback-checks.md`, section 2, in the main checkout.
