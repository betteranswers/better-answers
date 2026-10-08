---
title: Architecture Review Before S2 - Plan
type: docs
date: 2026-10-08
topic: architecture-review-before-s2
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Architecture Review Before S2 - Plan

## Goal Capsule

- **Objective:** S2a, search and the concept page for the first customer, can be planned without an open architecture question. Every decision it rests on is made and recorded in this plan, and each decision that changes a decision doc names that doc. The work that must land before or beside it is filed and ordered. BA-74 can check the architecture diagrams against a written list of what moved.
- **Means:** the staff review's fourteen decisions and work packages, each checked by an independent staff engineer against common engineering practice and approved under the owner's rule (Key Decisions). One docs pull request for BA-35's own edits; each work package then gets its own plan.
- **Product authority:** the owner's decisions of 08/10/2026 under Key Decisions. The owner's rule for the review: a recommendation the staff check finds to be standard practice is approved by default, and the owner decides only genuine trade-offs. The staff review (§5, §6) as amended by this plan is authoritative for what each package does. `docs/specs/v01-route.md` stays authoritative for blocks and their edges.
- **Stop conditions:** stop and ask the owner in any of these cases:
  - A Linear write fails, or the Linear tools cannot upload an attachment.
  - A route-spec edit would move a block's edge beyond what R9 records.
  - `pnpm check:docs` fails in a way no rewording fixes.
- **Execution profile:** one branch and one docs pull request carry U2, U3 and this plan. U1 (issues) runs before them and U4 (attachments and pointers) once the pull request is open.
- **Who finishes:** `ce-work` builds; `ce-code-review` reviews; `ce-commit-push-pr` opens the pull request. Cubic is over quota until 1 November, so the merge is armed by hand once `check` is green and every thread is resolved (`docs/agents/code-review.md`).
- **Open blockers:** none for planning. BA-36, the review of every page's design and usability, still gates S2a's build.

---

## Product Contract

### Summary

BA-35 settles the architecture under S2a and S2b. It records the fourteen decisions and the order of fifteen work packages. Two decisions move ADR 0047 now: where the concept page lives, and how renames follow the glossary. A known visibility gap (WP10) is fixed now, beside S2a rather than ahead of it. The review's evidence is attached to BA-35, and a "What moved" list is written for BA-74.

### Problem Frame

S2a is next on the knowledge strand, and the route holds it behind this review. A fresh survey on 08/10/2026 found 38 places where the code's shape will cost S2a: rules written two or three times, registries checked in one direction only, ground two features share kept inside one of them. Several sit exactly where S2a writes next, so S2a would copy them a third time. One is a correctness gap: when a sync narrows a document, the concepts citing it keep their old sensitivity. It cannot happen in production today, because nothing writes citations yet.

The staff review turned the survey into fourteen decisions and fourteen packages, WP1 to WP14; this plan adds WP15. The owner is not technical and asked that an independent staff engineer check each recommendation against common practice before approval. That check found thirteen standard, one genuine trade-off, and none wrong. It also corrected five premises and flagged three smells in the repository's own setup.

### Key Decisions

- **Recommendations approved under the owner's rule.** An independent staff check (Fable, as a senior staff engineer) judged each decision against common practice. Thirteen align and are approved as amended by their corrections. Governs R4, R5.
- **The card 1 gap is fixed now, as WP10.** (session-settled: user-directed — chosen over deferring the fix to the block that first writes citations in production, which the review and the staff check recommended: the owner prefers closing a known visibility gap to relying on a reminder.) Governs R8, R10.
- **WP10 is built beside S2a, not before it.** (session-settled: user-approved — chosen over landing WP10 before S2a's build starts: S2a needs nothing from WP10, so the first customer's search is not delayed.) Governs R8.
- **Nothing outside this repository writes citations.** (session-settled: user-approved — chosen over a production row count before deciding: every concept came in through the repository's own import command, which writes no citations.) WP10's tests seed their own citations.
- **Renames follow the glossary in one batch per block.** (session-settled: user-approved — chosen over renaming code within days of a glossary change, and over deferring the choice: the rule stays, and the rename-only churn that hides real diffs and stales the code index stops.) Governs R2, R3.
- **The review's evidence is attached to BA-35.** (session-settled: user-approved — chosen over committing it under `docs/` or leaving it on one machine: it stays findable, as the IA research is on BA-29, without 190 KB of review notes in the tree.) Governs R12.
- **The import-side-effect refusal register is replaced before S3, as WP15.** The staff check put it to the owner; the owner's rule that a smell probably is one decides it, so it does not wait for a sixth vocabulary. Governs R5.
- **S2a's plan does not wait for WP3.** The staff check found that order a preference, not a dependency. Governs R6.

### Requirements

**The decisions BA-35's own pull request moves**

- R1. The concept page is Search's detail page, at `/knowledge/search/<ulid>`. It is seen by every role and opened from a Search match, and later from an Ask citation. ADR 0047 is amended in BA-35's pull request: its v0.1 table stops placing the concept page on Ask, its open line on which area Search sits on closes as Knowledge, and its "a detail draws no toolbar" rule is named as the sentence S3 amends when it adds the page's actions.
- R2. ADR 0047's glossary amendment of 03/10/2026 changes when code follows a renamed word. The glossary entry, the text a person reads on a page, and live docs change at once. Code, types, tables, columns and contracts follow in one batch per block, which renames every remaining occurrence of the old word, wherever it sits, in that block's pull request.
- R3. While a renamed word's code batch is pending, its row in `apps/api/tests/old-words.ts` refuses it in reader text only and names the block whose batch renames it. When the batch lands, it widens the row to the reach it keeps: everywhere, or one sense for a word other senses share.

**The fourteen decisions**

- R4. Each decision is recorded as below. A decision moves its doc in the commit that changes the code, except decision 1, which moves ADR 0047 now (R1).

| # | Decision | Lands in | Doc edited | Correction carried from the staff check |
| --- | --- | --- | --- | --- |
| 1 | Concept page is Search's detail | BA-35's pull request (R1); built in S2a | ADR 0047 | Malformed, absent and withheld ids draw one in-page *not found* state |
| 2 | Search keeps its query in the address and pages by server, with no totals | S2a (needs WP5) | none | — |
| 3 | Concepts first, ranked by kind; passages fill the room and return their rank; no interleaving | S2a | none | S2a's plan answers the route's "whether `find`'s two arms share one score" line with this, explicitly |
| 4 | A citation mark `[^id]`, where `id` is a `sources[].id`, is never a `LINKS_TO` edge; a `contracts/links` fixture pins it | S2a | ADR 0015 and ADR 0031 | The fixture also pins a non-source footnote whose definition is an IRI, and whether a citation mark still takes a link ordinal |
| 5 | `find`, `open` and Search are declared actions, role Viewer, no purposes | S2a declares its reads; WP9 deletes `effect` | none | — |
| 6 | Card 1's gap is fixed now | WP10 | ADR 0031 if WP10 adds an agreement | Overrides the review's deferral (Key Decisions) |
| 7 | A live region mounted with its words inside is treated as unread | WP5 | none | — |
| 8 | Card 12's minimum now | WP4 | none | The fuller rework is WP15, not "when a sixth vocabulary arrives" |
| 9 | The second half of "read or …" is *action*; `FailedDuring`'s `"change"` is renamed | WP5 | none | — |
| 10 | System's home is `features/system/` at O1 | WP14 | none | — |
| 11 | The route spec stops naming the dead splitter | WP1's commit | none | Both sites: S0's "Builds on" line and S1's block |
| 12 | `UserId` becomes *person id* at P1's naming pass | P1 | none | — |
| 13 | Where plan · draft · record is composed is decided at S2b's brainstorm | S2b | none | WP8's guard is a runtime check; the type and the lint the route asks for are owed by S2b's plan |
| 14 | The identity set's read doors open `READ ONLY` if WP8's probe finds no writer | WP8 | none | S2a's pages run under `withPrincipal`, not these doors; a read-only query road is a separate probe on WP8's list |

**The work packages and their order**

- R5. The packages are the staff review's §5 table, amended by this plan:

| Package | Delivers | When | Merge risk | Doc edited |
| --- | --- | --- | --- | --- |
| WP1 Delete the dead splitter | `splitter.py` and its test gone; the route spec's two splitter lines corrected | any time | reversible | none |
| WP2 Schema registry pairs | mapped type pins over every table; an additive `ids` module; the `ConceptIri` brand reaching `open`, `find` and `walkFrom`; two declared cross-slice reads | before S2a's schema unit | reversible | none |
| WP3 One full-text rule | `full-text-match.ts` holds the language, the vector type and the query fragment | beside S2a's plan, before its `concept_index` vector | reversible if no expression changes | none |
| WP4 Admission and refusal gates | the lint watches `requireAdmin` and `requireFreshSignIn`; the refusal walk sees every exported union | any time before S3 | reversible | none |
| WP5 Web shared ground for lists | one searched-list hook; `ListState` delays its own words; `refusalsOf`; `selectFirst` | before S2a's web unit | reversible | none |
| WP6 Shared ground People and the shell share | one member read and one shared reset after a member change; the audit words in `shared/` | any time after S2a's web unit | reversible | none |
| WP7 Table-ownership gate | a gate scanning each slice's SQL against the ownership map, both ways | before S2b | reversible | ADR 0029 |
| WP8 A settled `Tx` refuses | a `Tx` whose `query` refuses after its transaction settles; the read-door probe; the query-road probe | before S2b | reversible, a behaviour change | none |
| WP9 Admission in one shape | the twenty `requireAdmin` sites declared; `writeConcept` a declared action over a step; `effect` gone | before S3 | reversible | ADR 0043 only if `requireAdmin` stays |
| WP10 Sync narrows, concepts follow | the sync's outcome names the documents it moved; a platform cascade on the api's tick; one cascade function typed on the principal | now, beside S2a | not reversible (a `contracts/` key) | ADR 0031 if it adds an agreement |
| WP11 Worker kinds | descriptors generated into the worker; a both-ways kind check; health counted by claiming tier | S4 and S6 | not reversible if it becomes an agreement | ADR 0031 if so |
| WP12 People's instant updates | `useOptimistic` over a filter; one table of the reads each action moves | P1 | reversible | none |
| WP13 Auth refusal crossing | auth's person routes answer `{ word, class }`; one unwrapping on the web | P1 | reversible | ADR 0043 |
| WP14 System's home | the audit log page under `features/system/` | O1 | reversible | none |
| WP15 One refusal catalogue | refusal words composed in one place instead of registered as each module loads | before S3 | reversible | ADR 0043 if its mechanism sentence changes |

- R6. S2a's critical path is: R1 → S2a's plan → its core units, with WP2 landed → its web units, with WP5 landed → its browser suite and budget test. WP3 lands before the core unit that writes the vector. Everything else runs beside the path.
- R7. S2a's plan carries the folded cards as units: card 2 (one link reader, held to `contracts/links`), card 20 (`concept-file.ts` for what a concept file asserts), card 5's exclusion clause rendered by the concepts slice and `findPassages` returning its rank, card 7's IRI parse where `open`, `find` and the concept page's route take it, card 18 (R1), card 19's test of an Admin reading a Restricted concept for each new read, and the trial survey's cards 1 and 5.
- R8. WP10 starts now and merges when ready, independent of S2a's order. Its first test is the probe the staff review wrote for card 1 (AE1), and it fails before the fix.

**Recording the packages**

- R9. The route spec records what this review moved in each block's lines. S2a's status row stops waiting on BA-35, names WP2, WP3 and WP5, and still waits on BA-36. S2a's *Must carry* names R7's folded cards. S2b's row names WP7 and WP8 and the type and lint that decision 13 leaves to it. S3's row names WP9 and WP15. S4 and S6 carry WP11, P1 carries WP12, WP13 and decision 12, and O1 carries WP14. Each block's lines also name the staff review's cards (§4) it placed on that block.
- R10. WP1 to WP10 and WP15 are each filed as a Linear issue in the better-answers project, with the review's evidence linked. WP11 to WP14 live in their blocks' route-spec lines (R9) and get no separate issue.
- R11. These findings put off for later are filed as Linear issues: card 27's detail-label pairing; card 9's remaining `<output>` writers; the 06/10 survey's card 23, pairing a page's listed keystrokes with the ones it binds; a gate holding that a Python module mirroring a TypeScript one names a `contracts/` fixture; and ADR 0031's filename, which says six agreements while its body lists thirteen. Card 16's health test goes into S6's *Must carry* line instead (R9). Card 1's probe is WP10's first test (R8), not an issue.
- R12. The survey board's markdown copy, the staff review and the staff check are attached to BA-35. A BA-35 comment links this plan and says what moved.

**For BA-74**

- R13. This plan's "What moved" section lists each component that appears, moves, or changes its edges once the packages are built, by package, so BA-74 can check the diagrams in `docs/architecture/` against it.

### Acceptance Examples

- AE1. **Covers R8.** **Given** a concept that cites an Internal document through its evidence, **when** a sync narrows that document to Restricted and the api's next tick runs, **then** `find` as an Editor who is not a named member does not return the concept. The test fails on today's tree.
- AE2. **Covers R2, R3.** **Given** the glossary replaces a word and its row names S3's batch, **when** the words test runs before that batch lands, **then** the old word in code passes and the old word on a page fails. **Given** S3's batch has landed and the row refuses the word everywhere, **then** the old word in code fails and the test names the line.
- AE3. **Covers R1, R4.** **Given** a reader opens `/knowledge/search/<ulid>` for a malformed id, an absent concept, or a concept withheld from them, **then** each draws the same in-page *not found* state and nothing says which.

### What moved

For BA-74. Each line is a change to the shape the diagrams draw, with the package that makes it.

- **Schema package.** Gains `concept-file.ts`, the pure reader of a concept file's grammar, cited sources and references (S2a). Gains an `ids` module of branded ids (WP2). `full-text-match.ts` becomes the full-text rule's one home (WP3).
- **Contracts.** Gains a `links` agreement both tiers' suites read (S2a). Gains a key on the sync's outcome naming the documents it moved (WP10). Possibly gains a job-kinds agreement (WP11).
- **Store doors.** The map door loses its private Markdown link reader to the schema package (S2a). The Postgres door hands work a `Tx` that refuses after its transaction settles (WP8), and the identity set's read doors may open read-only (WP8).
- **Concepts slice.** Owns the read of a concept with its trust words and evidence pane (S2a). Renders the passage search's exclusion clause (S2a). Owns one visibility cascade typed on the principal, run by a platform step on the api's tick after a sync narrows (WP10).
- **Answering slice.** Owns the boundary schemas that the MCP surface and tRPC share for `find` and `open` (S2a). `find`, `open` and Search become declared actions (S2a).
- **Kernel.** `requireAdmin` leaves the face and declarations lose `effect` (WP9).
- **Refusal words.** Every slice's words are composed in one catalogue, no longer registered as each module loads (WP15).
- **Worker.** `splitter.py` is deleted (WP1). `links.py` is held to the `links` agreement (S2a). Job kinds are generated from the schema's descriptors, and health counts by claiming tier (WP11).
- **Devtools.** Gains the table-ownership gate (WP7). The admission lint watches `requireAdmin` and `requireFreshSignIn` (WP4).
- **Web.** `shared/` gains the searched-list hook, `ListState`'s delay, `refusalsOf` and `selectFirst` (WP5), then the member read, the shared reset after a member change, and the audit words (WP6). Knowledge gains Search and the concept page as Search's detail (S2a). `features/system/` appears with the audit log page (WP14).
- **Api.** Auth's person routes answer `{ word, class }` (WP13).

### Unusual setup, examined

The owner asked that anything a typical repository would not do be flagged as probably unintended. The staff check sorted each into explained-and-kept or a smell.

| Practice | Verdict | Where the reason lives |
| --- | --- | --- |
| `contracts/` fixtures both tiers read, with a digest the database stamps | Kept: the worker is Python and cannot import TypeScript | ADR 0031, ADR 0005 |
| A Python module (`links.py`) copying a TypeScript one with no fixture holding them equal | Smell, fixed by card 2 in S2a, plus a gate issue (R11) | nowhere |
| Four stores, a git repository per workspace, no api-to-worker HTTP | Kept | ADR 0005, ADR 0012 |
| Hand-written SQL under row-level security | Kept; its two hand-held checks are smells, fixed by WP7 and card 19's test | ADR 0032; ADR 0029 for the map |
| No mocks of own code, every store real, gates tested on a throwaway tree | Kept | `CODING_STANDARDS.md`, ADR 0029 |
| Refusal words registered as each module loads; auth's routes outside the refusal rule | Smell, fixed by WP15 and WP13 | ADR 0043 states the rule, not the mechanism |
| Renaming code to the glossary within days | Kept as a rule; its cadence becomes one batch per block (R2) | ADR 0047 |

### Success Criteria

- S2a's `/ce-plan` starts from the route spec and this plan and asks no architecture question.
- BA-74 can check every diagram in `docs/architecture/` against "What moved" without reading the survey.
- BA-35's three acceptance lines hold: the review ran through `/ce-brainstorm` from a fresh survey with no area named and read its inputs; each moved decision edits its doc in the same commit; what moved is written down for BA-74.

### Scope Boundaries

- Building any package. Each gets its own `/ce-plan`, and S2a's plan carries R7's units.
- BA-36, which still gates S2a's build.
- S2b's own questions: where plan · draft · record is composed (decision 13, the trial survey's card 2), the three prompt rules from the rag_chatbot study, and where the synthetic recall reading belongs.
- Who can use S2a before C1 invites the first customer's people: S2a's brainstorm.
- Whether ⌘K's jump-to gains a "Search for …" row: S2a's plan.
- The survey skill's fixes (truncated walker replies, its `ADR NNNN` wording): a separate change through `ce-skill-work`.
- The handoff's other carried items (the "Provider" label, O1's subject requests, BA-72, CodeRabbit in pull request bodies, `ce-compound-refresh` over `CONCEPTS.md`, `contracts/citation/cases.json` naming ADR 0031, the C4 diagrams' old S2, "built before S2" lines, the migration replay tests, pull request body length).

### Dependencies / Assumptions

- No production row in `concept_evidence` exists, because no writer outside this repository exists (owner, 08/10/2026). WP10 is therefore a fix ahead of any data that needs repair.
- WP10 and S2a both edit the concepts slice. Whichever merges second rebases onto the first.

### Outstanding Questions

**Deferred to the packages' own plans**

- Whether WP10 derives evidence from a concept's `sources[]`, as the trial survey's card 3 proposes, or keeps `concept_evidence` as written today.
- How WP15 builds the one catalogue, and whether that changes ADR 0043's mechanism sentence.

### Sources / Research

- The survey board, `.lavish/survey-architecture-all-2026-10-08-2037.md`: 38 cards from 8 areas at `b567fd5d`. Attached to BA-35 (R12).
- The staff review, `.lavish/survey-architecture-all-2026-10-08-2037-staff-review.md`: premise checks (§2), smells A–G (§3), card verdicts (§4), packages (§5), decisions (§6). Attached to BA-35.
- The staff check, attached to BA-35: the best-practice verdict per decision, the five corrections R4 carries, the unusual-setup sort, and the IA research read against ADR 0047.
- The trial survey of the concepts and answering slices, `.lavish/survey-architecture-packages-core-src-concepts-plus-1-2026-10-06-1611.md`, and the 06/10 all-areas survey, `.lavish/survey-architecture-all-2026-10-06-1607.md`.
- The IA research of 30/09/2026, attached to BA-29. ADR 0047 settles both of `ia-objects.md`'s conflicts. The rail holds surfaces with Control Centre as one area. A person sees a page by role or by owning a collection, and ownership lands with S3. The IA's concept page, reached from matches and citations and listed nowhere, is ADR 0047's detail page, so R1 fits it.
- Decision docs: `docs/solutions/architecture-patterns/adr-0047-the-platform-is-surfaces-groups-and-screens.md`, `adr-0015-compositions-cite-concepts-by-footnote.md`, `adr-0031-tier-contract-is-six-agreements.md`, `adr-0029-apps-over-packages-capability-slices.md`, `adr-0043-what-an-act-is.md`.
- The route spec, `docs/specs/v01-route.md`: S2a's and S2b's blocks and the status table.

---

## Planning Contract

**Product Contract preservation:** changed: R9 now also names the staff review's cards placed on each block (owner, 08/10/2026, confirming the plan's scope). R2's batch renames every remaining occurrence, not only files the block touches, because the words test's everywhere reach scans every tracked file (owner, 08/10/2026, in the document review). The Goal Capsule's Objective now says decisions are recorded in this plan. The two planning questions on R3's row field and R9's timing are answered by KTD2 and KTD3. Every other R, AE and Key Decision is unchanged.

### Key Technical Decisions

- KTD1. **One docs pull request, with the Linear writes around it.** The issues are filed first so the route spec can name each package by its `BA-N`; the attachments and comments follow once the pull request exists to link. Reverting the merge undoes the docs and leaves the issues, which is the right way round: the issues describe work still owed.
- KTD2. **A batched rename reuses the words test's reader-text reach.** While its batch is pending, an old word's row in `apps/api/tests/old-words.ts` has `reach: "reader text"` and its `sweep` names the block's batch; the batch widens it to the reach it keeps. No new field and no pending state: BA-29 removed its pending phase and ratchet, and `docs/solutions/best-practices/how-a-rename-sweep-lands-a-word-in-the-words-test.md` already documents widening a row from reader text to everywhere. Governs R3.
- KTD3. **Every block's record is a dated "BA-35's lines" paragraph in BA-35's pull request.** T-113's verdicts took the same shape, as *T-113's lines* in each block. The later blocks' lines land now, because for WP11 to WP14 and the placed cards the route spec is the only record a planner opens. Governs R9.
- KTD4. **ADR 0047 changes in its body and gains a History paragraph.** The table and the open list are corrected in place, and a paragraph headed "Amended 08/10/2026 by the architecture review before S2 plan" says what moved, as its four earlier amendments do. Governs R1, R2.
- KTD5. **The rename rule's other two statements change with it.** `CODING_STANDARDS.md`'s glossary rule ("Code takes the glossary's word") and the rename learning's Context ("A rename lands the glossary entry, the code and the row in one pull request") would otherwise contradict R2. Governs R2.
- KTD6. **Issues carry the tracker's fields and their order as relations.** Each is filed in Triage with a priority and a `product` label. WP2, WP3, WP5 and WP10 are High: three sit on S2a's path, and the owner chose to fix WP10 now. WP10 and card 9's remaining live-region writers are `bug`; the rest are `improvement`. WP7 is blocked by WP2 and WP9 by WP4, and every issue is related to BA-35.

### Sequencing

U1 runs first. U2 and U3 follow on one branch, and U3 needs U1's issue numbers. U4 runs once the pull request is open.

---

## Implementation Units

### U1. File the package and follow-up issues

- **Goal:** every package that runs before or beside a block, and every finding put off for later, is a Linear issue a session can pick up.
- **Requirements:** R10, R11. Card 1's gap is WP10's issue, per the Key Decision that fixes it now (Governs R8).
- **Dependencies:** none.
- **Files:** none in the repository.
- **Approach:**
  1. File WP1 to WP10 and WP15 as eleven issues through `save_issue`, following `docs/agents/issue-tracker.md`: team and project `better-answers`, state Triage, a priority and a label per KTD6.
  2. Each description takes the tracker's Goal, Acceptance Criteria and Notes. The Goal is the package's *Delivers* cell in R5, its acceptance the staff review's test note for its cards, and its Notes name the route block, the cards, this plan's path and the evidence attached to BA-35.
  3. File the five findings R11 lists the same way, each labelled as a finding put off for later in its Notes.
  4. Add the relations KTD6 names.
- **Patterns to follow:** recent issues filed by this repository's sessions (BA-74's description shape); titles in the commit form, each checked with `pnpm exec commitlint` before it is written.
- **Test expectation:** none -- tracker writes, no repository change.
- **Verification:** sixteen new issues exist in Triage, each title passes commitlint, and the eleven package numbers are noted for U3.

### U2. Amend ADR 0047 and the two rename statements

- **Goal:** the concept page's place and the rename cadence are decided in their decision doc, and no other doc contradicts them.
- **Requirements:** R1, R2, R3, AE2, AE3; KTD2, KTD4, KTD5. R2 carries the owner's choice to batch renames (Key Decisions).
- **Dependencies:** none.
- **Files:** `docs/solutions/architecture-patterns/adr-0047-the-platform-is-surfaces-groups-and-screens.md`, `CODING_STANDARDS.md`, `docs/solutions/best-practices/how-a-rename-sweep-lands-a-word-in-the-words-test.md`.
- **Approach:**
  1. In ADR 0047's v0.1 table, the Ask row drops the concept page and the Knowledge row gives Search the concept page as its detail (S2a).
  2. "Two things stay open" becomes one: the work area's name. Search's area is settled as Knowledge.
  3. A History paragraph dated 08/10/2026 records R1 (the address, seen wherever Search is seen, one in-page *not found* for a malformed, absent or withheld id, and the no-toolbar sentence S3 amends) and R2. It closes, as the others do, with "The four levels and every rule above stand."
  4. `CODING_STANDARDS.md`'s glossary rule gains one clause: a renamed word's code follows in its block's batch.
  5. The learning's Context and its procedure step 2 say the glossary entry and a reader-text row land first, and the batch renames the code and widens the row (KTD2). Its procedure step 1 proves the old word gone from reader text when the row lands, and in every form when the batch widens it. Its *When to Apply* review line allows a reader-text row ahead of the code rename when the row's `sweep` names the block whose batch renames it. Its `last_updated` moves to the edit's date.
- **Patterns to follow:** ADR 0047's amendment paragraphs of 02/10, 03/10 and 05/10/2026.
- **Test expectation:** none -- docs only; the words test and the docs lane read the prose.
- **Verification:** the table places the concept page under Knowledge's Search alone; one item stays open; `CODING_STANDARDS.md`, the learning and ADR 0047 agree on when code follows a renamed word.

### U3. Record the review in the route spec

- **Goal:** a planner opening any block finds what this review moved onto it, with the issue numbers.
- **Requirements:** R6, R7, R9; KTD3. The order R6 sets includes WP10 beside S2a, per its Key Decision (Governs R8).
- **Dependencies:** U1.
- **Files:** `docs/specs/v01-route.md`.
- **Approach:**
  1. Further Notes gains a bullet for the review of 08/10/2026 (BA-35), beside the T-113 and pass-4 bullets: the survey, the staff review and the independent staff check, the owner's override on card 1, this plan's path, and the eleven package issues by number.
  2. S2a, S2b, S3, S4, S6, S8, P1, P2 and O1 each gain a *BA-35's lines (08/10/2026)* paragraph. It names the packages and §4 cards placed on that block, with issue numbers, and for S2a the folded units R7 lists.
  3. The status table's S2a and S2b rows stop waiting on BA-35 and keep BA-36. S2a's row names WP2, WP3 and WP5, S2b's names WP7 and WP8, and S3's *Blocked by* names WP9 and WP15 as edges on its concept actions and refusal words.
  4. The S0 and S1 splitter lines stay for WP1's own commit (decision 11).
- **Patterns to follow:** *T-113's lines* in S2a and S2b; the "Six owner decisions (08/10/2026)" bullet; the rule that a status row is updated in the same commit as the change it records.
- **Test expectation:** none -- docs only.
- **Verification:** the Further Notes bullet names all eleven package issues. Each package R9 places on a block, and each §4 card placed on a block, appears in that block's lines. WP10 appears as running beside S2a, and no block's existing edge changes beyond R9.

### U4. Attach the evidence and leave pointers

- **Goal:** the review's reasoning outlives this machine, and BA-74 knows where "What moved" is.
- **Requirements:** R12, R13.
- **Dependencies:** the pull request is open.
- **Files:** none in the repository. Uploaded: `.lavish/survey-architecture-all-2026-10-08-2037.md`, `.lavish/survey-architecture-all-2026-10-08-2037-staff-review.md`, `.lavish/survey-architecture-all-2026-10-08-2037-staff-check.md`.
- **Approach:**
  1. Upload the three files to BA-35 as attachments.
  2. Comment on BA-35 with the pull request, this plan's path, the filed issue numbers and a short account of what moved.
  3. Comment on BA-74 pointing to this plan's "What moved" section.
  4. Move BA-35 to In Review.
- **Test expectation:** none -- tracker writes.
- **Verification:** BA-35 shows three attachments and the comment; BA-74 shows the pointer.

---

## Verification Contract

| Check | Proves | When |
| --- | --- | --- |
| `pnpm check:docs` | the words test, the docs lane, the tier-contract fixtures and formatting pass over every edited doc | after U2 and U3, before the pull request |
| `printf '%s\n' "<title>" \| pnpm exec commitlint` | each issue title and the pull request title take the commit form | per title, in U1 and at the pull request |
| `/ce-code-review` | a reviewer reads the docs diff against the decisions | before the pull request |
| CI `check` | the arbiter | on the pull request |

## Definition of Done

- U2's and U3's edits and this plan are on one branch, `pnpm check:docs` is green, and the pull request body says it amends ADR 0047, ending `Merge risk: reversible, docs only` and `Fixes BA-35`.
- Sixteen issues are filed as U1 says, and the route spec names the eleven package issues by number.
- BA-35 carries the three attachments and the comment; BA-74 carries the pointer.
- No abandoned or half-made edit is left in the diff.
