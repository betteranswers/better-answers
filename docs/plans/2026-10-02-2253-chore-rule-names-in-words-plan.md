---
title: Rule Names in Words - Plan
type: chore
date: 2026-10-02
topic: rule-names-in-words
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Rule Names in Words - Plan

## Goal Capsule

- **Objective:** An agent that reads this repository's rules, a gate's failure or a plan writes rules in words and titles tests by their behaviour. The docs and tests it writes then carry nothing a reader has to look up elsewhere.
- **Means:** Each rule is named by its instruction, with no tag. Gates name the file that holds the rule. The exemption machinery the tags needed is deleted. The planner and the orchestrator are pointed at test scenarios named by their behaviour (KTD2, KTD4, KTD6).
- **Authority:** The Product Contract's requirements come first, then the Key Technical Decisions, then the units. A decision marked `session-settled` is not reopened.
- **Stop conditions:**
  - A settled decision proves infeasible.
  - The work needs an edit under `contracts/` or in a file BA-29 owns.
  - A gate's test cannot be kept green without exempting a file from the string check.
- **Execution profile:** One pull request, `Fixes BA-37`, with one commit per unit in unit order. It merges before BA-29, which rebases onto it.
- **Who finishes:** `ce-work` builds it, `ce-code-review` reviews it, and `ce-commit-push-pr` opens the pull request.

---

## Product Contract

### Summary

Every coding rule is named by its instruction. Every gate prints what is wrong, the fix, and the file that holds the rule. The machinery that kept tags out of the string check is deleted. Today's tag citations and plan ids are rewritten in words across docs, config and test titles. `AGENTS.md` and `docs/agents/workflow.md` have test scenarios named by the behaviour they check.

### Problem Frame

Each of the 65 rules is a heading that leads with a tag (`### [SEC2] Take a Principal…`). So a grep, a jDocMunch outline and a read all show the tag first.

Planners ask research agents to quote the rules that constrain a plan. The agents copy the tags into their dossiers, and the planners copy them into plans and ADR docs. Twenty-seven gate messages print a tag, and line 5 of the root rules file invites them ("an imperative under a tag that a finding can cite").

The rule against tags in docs sits in one heading's body that no tag-writing agent had read. Its only guard was a scan, and that scan was deleted.

Plan ids reached test titles the same way. CE's plan template opens a test scenario with `Covers AE<N>.`, and orchestrator prompts told workers to "name AE ids in the test titles". The result is 38 titles with an AE id, two with an R id, one comment and one report annotation.

A first-principles review on 02/10 tested every reader of a rule: agents, gates, reviewers and the owner. None needs an id. None of the 13 agent rule files sampled across 11 public repos uses rule ids, and linters name their rules in words. The owner wants the cause removed, not a new scan.

### Requirements

**Rules and gates**

- R1. Every rule heading in the five `CODING_STANDARDS.md` files is the rule's imperative in words, and the root file's group headings are words.
- R2. The rules files describe a rule as an imperative a finding can quote. They describe a gate as naming the file that holds its rule. The rule saying where a tag may be written is gone. *Comment only the why* lists what a comment never cites, and that list names no tag.
- R3. A gate that holds a coding rule prints what is wrong, the fix, and "the root `CODING_STANDARDS.md`". The two gates that cite an ADR state the decision in words.
- R4. No gate file is exempt from the string check, and no test helper splits a tag to hide it from a scan.

**Today's references**

- R5. No doc, config, wiki line or open Linear issue cites a rule by its tag. That covers the ADR docs, three plans, the race-test learning, `cubic.yaml`, `.cubic/wiki/`, the devtools README, a `.gitignore` comment, and Linear issues BA-13 and BA-27.
- R6. Every test title, test comment and report annotation states the behaviour it checks, with no plan id.

**Planning workflow**

- R7. `AGENTS.md` says a plan's test scenario opens with the behaviour it checks, and a unit carries its acceptance-example link in its Requirements field.
- R8. `docs/agents/workflow.md` tells an orchestrator that a worker prompt names each test scenario by the behaviour it checks.

**Decision record and constraints**

- R9. ADR 0045's doc states the decision as it now stands. It is amended in place, in the commits that move the decision.
- R10. Agent-facing text this change writes says what to do and never names what it forbids.
- R11. This change adds no scan, gate or test that looks for tags or ids, and it leaves `contracts/` and BA-29's files untouched.

### Key Decisions

- **Rules carry no ids. A rule's heading is its imperative.** Governs R1, R2, R3. (session-settled: user-approved — chosen over kebab-case slugs and over keeping tags: no reader of a rule needs an id, and agent rule files and linters name rules in words)
- **A gate names the rule's file, and the two ADR-citing gates say the decision in words.** Governs R3, R4. (session-settled: user-approved — chosen over a two-entry skip list for the ADR-citing gates: the skip list then goes entirely)
- **The plan-id fix reaches agents through `AGENTS.md` and `docs/agents/workflow.md`.** Governs R7, R8. (session-settled: user-approved — chosen over `workflow.md` alone: ce-plan never reads `docs/agents/`, and every session loads `AGENTS.md`)
- **Agent-facing text says what to do, and the test-title rule stays as it is.** Governs R10. (session-settled: user-approved — chosen over writing in the prohibitions as the issue first drafted them: a prohibition primes the thing it names)
- **`contracts/citation` stays untouched.** Governs R11. (session-settled: user-approved — chosen over editing its stale description here: any `contracts/` edit makes the pull request merge alone)
- **The Cubic wiki is hand-edited in this pull request.** Governs R5. (session-settled: user-approved — chosen over waiting for Cubic to regenerate it, which would leave its tags in place)

### Success Criteria

- An agent that greps, outlines or reads a rules file, or hits any gate, meets the rule in words and the file it lives in, and no id.
- A plan written after this change opens each test scenario with a behaviour, and the tests built from it carry no plan id.

### Scope Boundaries

- BA-29 owns `CONTEXT.md`, `apps/api/tests/avoid-words.test.ts` and its word list, and the docs for ADR 0019 and ADR 0047.
- Plan ids in solution docs that sit beside the plan's path stay. A reader can follow them.
- `docs/archive/` is frozen. `.scratch/` and `.planning/` are git-ignored.
- The comment gate's reaction to a tag in a comment stays: it quotes the tag back as "cites a rule tag". The contract fixes that wording.

#### Deferred to Follow-Up Work

- **`contracts/citation/cases.json` description.** It still says a tag is allowed in "three places". This is a new Linear issue, filed with the pull request and marked to merge alone.
- **"Code cites a decision as `ADR NNNN`".** `AGENTS.md` and `cubic.yaml` say it, while the comment gate refuses an ADR number in a comment. It is the same failure applied to decisions, and it predates this change.
- **`.claude/agents/ui-designer.md:18`.** It sends the UX and accessibility rules to the root file, but they live in `apps/web/CODING_STANDARDS.md`.
- **The owner's related findings from the BA-29 prose check:**
  - merge commit bodies running long;
  - no named prose pass;
  - Cubic skipping `docs/**` and test files.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The root file's group headings become words.** `DESIGN`, `TEST`, `CHECK`, `COMMENT`, `GLOSSARY`, `TYPES`, `LOG`, `SEC`, `AUDIT`, `DEPS` become words such as "Design", "Tests", "Gates", "Comments", "Glossary", "Types", "Logging", "Security", "Audit" and "Dependencies". `OKF` stays: it is the knowledge format's own name. Left as codes, the outline's top level would keep the tag vocabulary alive.
- KTD2. **A gate's message keeps its current account of what is wrong and how to fix it. Only the tag changes: it becomes "the root `CODING_STANDARDS.md`".** Every printed tag is a root-file rule. pytest runs from `apps/worker/`, Playwright from `apps/web/`, and two lint rules fire under `apps/api/`, and each of those has its own rules file. So a bare filename would open the wrong file. The messages that react to a citation keep the opening "cites {what} (`{cited}`)" word for word, because both tier-contract suites pin it. Each gate's test asserts the file phrase literally. A Python `pytest.raises(match=…)` escapes it. The comment-density report is the one message with no fix today, so it gains one: a comment says only what the code cannot, so delete what it restates.
- KTD3. **`import-direction` states each ADR 0029 rule as the clause it already carries, and names no file.** The ADR doc's path matches the citation contract's ADR pattern, so it cannot be printed.
  - The `rule` numbers in `ZONES` go, and the core test re-keys its table on the clause.
  - The `unexported` message also holds the rule on testing through a caller's interface, so it names the root rules file.
  - `mcp-entry-no-workspace-argument` says in words that the principal comes from the token, never from an argument, and names the root rules file.
  - Both rules' `docs.description` strings drop the ADR number.
- KTD4. **The exemption machinery is deleted, and the test-path check moves into `string-cites-nothing.ts`, its only importer.**
  - **Python:** `comment_gate.py` keeps its own test-path check and drops the list read, along with the `json` and `Any` imports only that read used.
  - **Exemption tests:** the two tests that assert a gate file is skipped flip to assert that the same string in a gate file is refused.
  - **Tag samples:** the two-halves helpers go, and tag-shaped samples are spelled whole. The contract's "a rule tag" pattern still needs samples, and the string check skips test paths in both tiers.
  - **Order:** this unit runs after KTD2's rewrite. The write-time hook checks every gate file an edit touches, so a gate file still holding a tag would block the edit.
- KTD5. **In docs, a tag in parentheses beside its rule's words is deleted. Any other tag is replaced by the rule's heading in italics.** This follows the archived sweep's convention and ADR 0032's line 34. Bare tags (`AUDIT8`, `SEC5`) count as tags.
- KTD6. **The `AGENTS.md` line gives the acceptance-example link a place: the unit's Requirements field.** CE's template tells the planner to prefix a scenario with the link, and its deepening pass checks that units cite their acceptance examples. A line that only took the link away would lose to both. Saying where the link goes satisfies both and keeps it out of the scenario a worker turns into a title.
- KTD7. **ADR 0045's doc is amended in place, and each commit that moves part of the decision edits that part.**
  - The title and H1 drop "tagged".
  - The `rule-tag` keyword goes.
  - History stays as it is (precedent: 915f977d).
  - The merge queue keeps every commit, so this holds per commit, not per pull request.
- KTD8. **A test title loses its plan id and still states the behaviour in at most 10 words.**
  - Where dropping the id leaves a sound title, only the id goes.
  - `people.spec.ts:1790` then reads the same as `:792`. They test different paths in different `describe` blocks, and the test-title rule has the `describe` name the unit, so both stay.
  - The `AE1 at 1440` annotation is renamed to say what it records. It has no other consumer.

### Assumptions

- Cubic's next wiki sync may overwrite the hand edit. That is acceptable: the source it regenerates from then holds no tags.

### System-Wide Impact

- **Agent context:** every session loads `AGENTS.md`, so its new line costs every agent one sentence. A jDocMunch outline of a rules file now lists instructions.
- **Reviewers:** CE's standards reviewer quotes "the exact quote or section reference", which is now the heading. Cubic reads `cubic.yaml`, and its quoted rule names now match headings (U5).
- **Gates:** every gate's reader sees the same file phrase, whichever directory the gate runs from (KTD2). A tag in a comment still gets "cites a rule tag", whose fix sends the reader to the comment rule.
- **BA-29:** this pull request merges first. BA-29 rebases over the headings in `apps/web/CODING_STANDARDS.md`, over `AGENTS.md`, and over any rule heading its renaming sweeps touch.
- **Mutation runs:** Stryker's incremental results are cached by test title, so renaming api and core titles costs one nightly re-test, not a failure.
- **The owner's shorthand:** a rule's old tag no longer resolves to anything in the live tree. Git history and `docs/archive/` still hold the old names.

---

## Implementation Units

### U1. Rules named by their instruction

- **Goal:** Each rule's heading in the five rules files is its imperative. The root file's prose describes rules without tags.
- **Requirements:** R1, R2, R9, R10.
- **Dependencies:** None.
- **Files:**
  - `CODING_STANDARDS.md`
  - `apps/api/CODING_STANDARDS.md`
  - `apps/web/CODING_STANDARDS.md`
  - `apps/worker/CODING_STANDARDS.md`
  - `deploy/CODING_STANDARDS.md`
  - `docs/solutions/architecture-patterns/adr-0045-coding-rule-is-one-imperative.md`
- **Approach:**
  1. Strip the bracket tag from all 65 headings. The root file uses `###`, the workspace files `##`.
  2. Rename the root group headings (KTD1).
  3. Rewrite line 5 so a rule is "an imperative a finding can quote", with no word about tags.
  4. Delete the rule saying where a tag may be written, *Write a rule tag in a rules file, a review finding or a gate's failure message*.
  5. Reword the list at line 138 in *Comment only the why* so it names the ticket, date, decision and rule a comment never cites, and nothing else.
  6. In ADR 0045's doc, rewrite the title, H1, the `rule-tag` keyword, and lines 25, 29, 38 and 40 for the form (KTD7). Leave the gate lines to U2.
- **Patterns to follow:** The headings' existing imperative wording, which stays unchanged. ADR doc amendment in place, as in 915f977d.
- **Test expectation:** none. These are docs. `check:docs` runs avoid-words over the rewritten rules files.
- **Verification:**
  - The five rules files hold 64 rule headings, all distinct, none opening with a bracket.
  - The root file's group headings are words.
  - `check:docs` is green.

### U2. Gates name the rule's file

- **Goal:** Every gate that prints a tag or an ADR number prints the rule in words and the root rules file instead (KTD2, KTD3).
- **Requirements:** R3, R9, R10.
- **Dependencies:** U1.
- **Files:**
  - Gate rules:
    - `.oxlintrc.json`
    - `apps/worker/tests/conftest.py`
    - `packages/devtools/lint-rules/rules/act-admits-before-await.ts`
    - `packages/devtools/lint-rules/rules/comment-only-the-why.ts`
    - `packages/devtools/lint-rules/rules/declaration-doc-block.ts`
    - `packages/devtools/lint-rules/rules/import-direction.ts`
    - `packages/devtools/lint-rules/rules/mcp-entry-no-workspace-argument.ts`
    - `packages/devtools/lint-rules/rules/string-cites-nothing.ts`
  - Other gates:
    - `packages/devtools/python/comment_gate.py`
    - `packages/devtools/src/comment-density.ts`
    - `packages/devtools/src/insert-scan.ts`
    - `packages/schema/test/test-title.ts`
  - Docs:
    - `CODING_STANDARDS.md` (*Land a gate with the test that runs it*)
    - `docs/solutions/architecture-patterns/adr-0045-coding-rule-is-one-imperative.md`
    - `packages/devtools/README.md` (the message lines near 166 to 169)
  - Tests:
    - `packages/devtools/test/act-admits-before-await.test.ts`
    - `packages/devtools/test/comment-gate-hook.test.ts`
    - `packages/devtools/test/comment-gate-python.test.ts`
    - `packages/devtools/test/comment-lint.test.ts`
    - `packages/devtools/test/comment-density.test.ts`
    - `packages/devtools/test/comment-only-the-why.test.ts`
    - `packages/devtools/test/declaration-doc-block.test.ts`
    - `packages/devtools/test/insert-scan.test.ts`
    - `packages/devtools/test/restricted-syntax.test.ts`
    - `packages/devtools/test/string-cites-nothing.test.ts`
    - `packages/devtools/test/test-title-setup.test.ts`
    - `packages/core/test/import-direction.test.ts`
    - `apps/worker/tests/test_title_hold.py`
    - `apps/worker/tests/test_monkeypatch_guard.py`
- **Approach:**
  1. Replace each of the 28 printed tags with "the root `CODING_STANDARDS.md`".
  2. Drop the ADR numbers from the seven `import-direction` and `mcp-entry` strings, and drop the `ZONES` rule numbers (KTD3).
  3. Rewrite the `docs.description` strings in `comment-only-the-why.ts` and `string-cites-nothing.ts` positively. Leave the exemption sentence in `string-cites-nothing.ts` to U3.
  4. Rewrite *Land a gate with the test that runs it* so a gate's message names the file that holds its rule.
  5. Rewrite ADR 0045's lines 37 and 51.
  6. Update each test's expected text. Retitle the tests whose titles say "naming its rule" so they say what is now named.
- **Patterns to follow:** `apps/api/tests/avoid-words.test.ts:305`, which already names a document (`CONTEXT.md`) in a gate message.
- **Test scenarios:**
  - **Restricted syntax:** each pattern (an `in` over an upper-case table, `for…in`, a label, a list inside `z.enum`) is refused with its fix and "the root `CODING_STANDARDS.md`".
  - **Admission before await:** an act that awaits before it admits is refused with a message naming the root rules file.
  - **Python comment gate:** a 40-word Python comment is refused with its word count and the root rules file. A directive with a 26-word reason is refused the same way.
  - **Comment that cites:** a TypeScript comment citing a ticket is refused with "cites a ticket id (`T-12`)" and the root rules file. A Python one gets the same.
  - **String that cites:** a string a person reads that cites a ticket is refused with the same "cites" opening.
  - **Line comment on a declaration:** it is refused with the doc-block form to write and the root rules file.
  - **Raw insert:** a TypeScript raw insert is refused with its line and the root rules file.
  - **Long title:** an 11-word title is refused by the vitest setup, the oxlint title rule and the pytest title hold, each naming the root rules file.
  - **Mock of our own code:** monkeypatching our own module raises an error naming the root rules file. The test matches it with an escaped literal.
  - **Import direction:** an import against each import-direction clause is refused with that clause in words and no ADR number. The case table is keyed by clause.
  - **Workspace argument:** an MCP entry that takes a workspace argument is refused with "the principal comes from the token" and the root rules file.
  - **Comment density:** a file over the ceiling reports its ratio, the ceiling, the fix (delete what the comments restate) and the root rules file.
- **Verification:**
  - The devtools, core, schema and worker suites pass.
  - `pnpm run lint` and `pnpm run comment-gate:python` are green.
  - No gate file prints a tag or an ADR number.

### U3. The exemption machinery goes

- **Goal:** No gate file is exempt from the string check, and no helper splits a tag (KTD4).
- **Requirements:** R4, R11.
- **Dependencies:** U2.
- **Files:**
  - Delete: `packages/devtools/gates-printing-a-tag.json`, `packages/devtools/src/tag-printing-gates.ts`
  - Gates:
    - `packages/devtools/lint-rules/rules/string-cites-nothing.ts`
    - `packages/devtools/python/comment_gate.py`
  - Docs: `packages/devtools/README.md` (around lines 211 to 214 and 304 to 305)
  - Tests:
    - `packages/devtools/test/fixture-text.ts`
    - the nine devtools tests that import `tag`
    - `packages/devtools/test/comment-gate-hook.test.ts`
    - `apps/worker/tests/test_title_hold.py`
    - `packages/devtools/test/string-cites-nothing.test.ts`
    - `packages/devtools/test/comment-gate-python.test.ts`
- **Approach:**
  1. Move the test-path pattern into `string-cites-nothing.ts`, and drop that rule's sentence about exempt gates.
  2. In `comment_gate.py`, drop `_gates_printing_a_tag`, `PRINTS_A_TAG` and the now-unused imports.
  3. Delete the list and the module.
  4. Delete the `tag` export from `fixture-text.ts` but keep `wordsOf`. Delete the local `tag` and `TAG` copies. Spell each tag sample whole.
  5. Leave the two-halves strings in `insert-scan.test.ts` and `comment-only-the-why.test.ts`, which split other things for other reasons.
  6. Rewrite the README's exemption paragraphs.
- **Patterns to follow:** The existing test-path pattern in `comment_gate.py`, which already stands alone.
- **Test scenarios:**
  - A string a person reads that cites a ticket, inside `packages/devtools/src/insert-scan.ts`, is refused, just as it is in any other source file.
  - The same in `packages/devtools/python/comment_gate.py`: the Python gate refuses it.
  - The same string in a test file still passes in both tiers.
  - A comment holding a whole-spelled tag is still refused with "cites a rule tag", including the case with a digit inside the family name.
- **Verification:**
  - Devtools `check` is green, with ruff reporting no unused import.
  - `pnpm run comment-gate:python` reads every gate file and passes.
  - Nothing in the tree names the deleted list, module or constant.

### U4. Test titles state the behaviour

- **Goal:** No test title, test comment or report annotation carries a plan id (KTD8).
- **Requirements:** R6.
- **Dependencies:** None.
- **Files:**
  - api tests: `apps/api/tests/members-invitations.test.ts`, `apps/api/tests/members-procedures.test.ts`
  - core tests:
    - `packages/core/test/invitation-sets.test.ts`
    - `packages/core/test/invitations.test.ts`
    - `packages/core/test/member-activity.test.ts`
    - `packages/core/test/member-bulk.test.ts`
  - web unit tests:
    - `apps/web/test/invite-addresses.test.ts`
    - `apps/web/test/jump-to.test.tsx`
    - `apps/web/test/navigation.test.ts`
  - e2e specs:
    - `apps/web/e2e/frame.spec.ts`
    - `apps/web/e2e/home.spec.ts`
    - `apps/web/e2e/jump-to.spec.ts`
    - `apps/web/e2e/people-invitations.spec.ts`
    - `apps/web/e2e/people.spec.ts`
    - `apps/web/e2e/routes.spec.ts`
    - `apps/web/e2e/workspace-switcher.spec.ts`
- **Approach:**
  1. Remove the id from each of the 38 AE titles and the two R titles, then check that each still states its behaviour in at most 10 words.
  2. Drop `(R14)` from the comment at `frame.spec.ts:909`.
  3. Rename the `AE1 at 1440` annotation type to what it records.
- **Test expectation:** none. Only titles, a comment and an annotation change, and no behaviour under test moves. The suites hold the titles through the title gates.
- **Verification:**
  - No test title, comment or annotation in a `.ts`, `.tsx` or `.py` test file holds an AE or R id.
  - The api, core and web suites pass, the browser suite included.

### U5. Today's tag citations, in words

- **Goal:** No doc, config or wiki line cites a rule by its tag (KTD5).
- **Requirements:** R5, R10.
- **Dependencies:** U1, so the italic headings match the new names.
- **Files:**
  - ADR docs in `docs/solutions/architecture-patterns/`:
    - `adr-0005-own-app-in-two-tiers.md`
    - `adr-0008-trpc-inside-openapi-and-mcp-outside.md`
    - `adr-0025-signals-are-queries-over-rows.md`
    - `adr-0027-open-core-under-apache-2-0.md`
    - `adr-0037-reader-screen-latency-budget.md`
    - `adr-0041-secrets-in-seven-credential-classes.md`
    - `adr-0042-product-ships-accessibility-statement.md`
  - Learning: `docs/solutions/best-practices/a-race-test-held-late-or-released-in-turn-cannot-prove-a-lock-order.md`
  - Plans:
    - `docs/plans/2026-09-30-1959-feat-shell-and-layout-foundations-plan.md`
    - `docs/plans/2026-10-01-2241-feat-people-sign-in-and-security-plan.md`
    - `docs/plans/2026-10-02-1625-feat-signed-in-journeys-in-production-plan.md`
  - Config: `cubic.yaml`, `.gitignore`
  - Cubic wiki, in `.cubic/wiki/`:
    - `01-s-overview/03-p-coding-rules.md`
    - `02-s-architecture/01-p-high-level-arch.md`
    - `04-s-data-management/01-p-relational-schema.md`
    - `06-s-frontend/02-p-design-system.md`
    - `07-s-devtools-testing/03-p-linting-tools.md`
    - `08-s-deployment/01-p-docker-stacks.md`
- **Approach:**
  1. **ADR docs:** apply KTD5 to the tag citations in the seven ADR docs. Rewrite the "specification wearing a rule tag" lines at ADR 0025:49 and ADR 0041:51 in words.
  2. **The learning:** apply KTD5 to its line 159.
  3. **Plans:** apply KTD5 to the bracketed tags in two plans and the bare tags in the sign-in plan.
  4. **`cubic.yaml`:**
     - Rewrite lines 31 to 32 so each directory's rules apply to its changes, with no word about prefixes.
     - Align the rule names quoted at lines 114 and 133 to today's headings.
  5. **`.gitignore`:** drop the deleted tag scan from the comment at line 13.
  6. **Cubic wiki:** rewrite its tag lines in words. The tag table becomes a list of headings.
  7. **Linear:** through linear-server, rewrite BA-13's three citations of the test-interface rule and BA-27's one citation of the real-stores rule as each rule's heading in italics. Both issues escape the brackets (`\[TEST1\]`), so a plain bracket search misses them.
- **Test expectation:** none. Docs and config only.
- **Verification:**
  - A one-off search with hidden files included finds no bracketed or bare tag outside `docs/archive/`, `contracts/`, the tag samples in devtools tests, and this plan, which quotes the old form as examples.
  - `check:docs` is green.
  - BA-13 and BA-27 cite their rules in words.

### U6. Test scenarios named by their behaviour

- **Goal:** Planners and orchestrators name each test scenario by the behaviour it checks (KTD6).
- **Requirements:** R7, R8, R10.
- **Dependencies:** None.
- **Files:** `AGENTS.md`, `docs/agents/workflow.md`
- **Approach:**
  1. **`AGENTS.md`:** add one line to `### Workflow`. A plan's test scenario opens with the behaviour it checks, and a unit carries its acceptance-example link in its Requirements field. Extend that section's existing pointer to `docs/agents/workflow.md` so it also says the file sets what a worker prompt carries. That sends an orchestrator to the new bullet, since nothing else loads `docs/agents/` into its session.
  2. **`workflow.md`:** add one bullet to "What CE does not know about this repository". A worker prompt names each test scenario by the behaviour it checks, and a test's title is that behaviour.
  3. Neither line names what it replaces (R10).
- **Test expectation:** none. Docs only. No test reads either file's text.
- **Verification:** Both lines read positively and fit their neighbours' one- or two-sentence form.

---

## Verification Contract

| Check | Proves | Units |
| --- | --- | --- |
| `pnpm check` | every gate and suite, both tiers | all |
| `pnpm run lint`, `pnpm run comment-gate:python` | each gate file passes the string check with no exemption | U2, U3 |
| `pnpm --filter @better-answers/devtools run check` | gate tests, and ruff's unused-import check | U2, U3 |
| `pnpm --filter @better-answers/core run test test/import-direction.test.ts test/tier-contract.test.ts` | import-direction by clause, and the pinned "cites" wording | U2 |
| `pnpm run check:worker` | title hold, mock guard, tier contract | U2, U3 |
| `pnpm run check:docs` | avoid-words over the rewritten rules files | U1, U5 |
| The web browser suite (`/browser-suite`) | the renamed e2e titles pass the title hold | U4 |

Run these once by hand at review time. They are not gates (R11):
- A hidden-file search for bracketed tags and for bare family-plus-number tokens, excluding this plan's quoted examples.
- A search of `.ts`, `.tsx` and `.py` test files for AE and R ids.
- A search for the deleted list, module and constant names.

---

## Definition of Done

- Every unit's verification holds, and `pnpm check` is green on the branch.
- ADR 0045's doc reads as the decision now stands, edited in the commits that move it.
- The follow-up issue for the `cases.json` description is filed in Linear and marked to merge alone.
- The BA-29 session is told the pull request has merged, so it can rebase.
- No abandoned attempt is left in the diff.
