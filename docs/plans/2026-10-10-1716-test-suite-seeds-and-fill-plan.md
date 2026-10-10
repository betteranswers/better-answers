---
title: A Refused Seed Leaves Nothing It Could Have Read Ahead, and the Gate Lends a Fill Only Where It Hugs - Plan
type: test
date: 2026-10-10
topic: suite-seeds-and-fill
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# A Refused Seed Leaves Nothing It Could Have Read Ahead, and the Gate Lends a Fill Only Where It Hugs - Plan

## Goal Capsule

- **Objective:** a spec's author who retries after a refused model-choices seed, or after a concepts seed refused for a reason the harness can read ahead, meets nothing that seed left, and the skill says what any other refused concepts seed can leave (BA-132). Also, the accessibility gate stops reading a layout box's background as a field's fill (BA-133).
- **Means:** three units in one pull request. U1 and U2 are the api's harness. U3 is the gate.
- **Authority:** the two issues' acceptance criteria, then the units.
- **Stop conditions:** the census of U3 finds a page on `main` that would fail the tighter check. Name the page to the lead before changing the check or the page.
- **Execution profile:** one pull request, `Fixes BA-132`, `Fixes BA-133`, `Merge risk: reversible`. The merge is not armed.
- **Who finishes:** `ce-work` builds it, `ce-code-review` reviews it, and `ce-commit-push-pr` opens the pull request.

---

## Product Contract

### Summary

Both issues are follow-ups to the pull request that closed BA-107 and BA-123, and both are the browser suite's own tooling. BA-107 made a seed the harness refuses answer 400 with its reason. Only `seedConnectedSources` writes in one transaction, so two other seeds can answer 400 or 500 with rows already written. A third action, `makeGroups`, goes through the members slice's own actions, a transaction each, and the skill already says so; it is left as it is. BA-123 made a wordless wrapper lend a field its border only on a side that hugs the field. The wrapper's fill has no such test.

### Problem Frame

- **Model choices.** `POST /__harness/model-choices` in `apps/api/tests/harness-control.ts` writes each model choice on a bare connection. A second choice that trips `model_choice_workspace_purpose_unique` leaves the first written.
- **Concepts.** `POST /__harness/concepts` in `apps/api/tests/harness-knowledge.ts` writes each concept through the concepts slice's own write, in order. A refusal at the second concept leaves the first one whole, and often the second one's connected sources, documents and passages too.
  - The seed cannot be one transaction. `writeConcept` takes the api's Postgres door, which is a pool, and opens its own transactions on it: one to read what stands, the cited documents among them, and one to write its rows. The harness writes its own rows on the superuser's pool. So a concept's sources must be committed before its `writeConcept` reads them, and each concept's rows commit as that concept is written.
  - A concept is also a commit in the workspace's git repository, made before its rows. No transaction rolls a commit back.
- **The gate.** `controlEdges` in `apps/web/e2e/locators.ts` measures a field's `fill` through a wordless wrapper and its `behind` from behind that wrapper, however far the wrapper's box stands off the field. Edgeless, see-through fields in a wordless layout box whose background stands 3:1 against the page pass. No page draws this today.

### Requirements

BA-132:

- R1. A model-choices seed whose second row is refused leaves no `model_choice` row.
- R2. A concepts seed is refused before its first write for every reason the harness can read ahead, and such a refusal answers 400 naming the field and the rule.
- R3. The `browser-suite` skill says which seeds are all-or-nothing, why the concepts seed is not, and what a concepts seed refused part-way can leave. It names `makeGroups` beside it as the other action that commits as it goes.

BA-133:

- R4. A wordless wrapper's fill counts as its field's only where the wrapper hugs the field, by the distance its border is held to.
- R5. A `test.fail()` case in `apps/web/e2e/accessibility-gate.spec.ts` draws the shape and prints *Expected to fail, but passed* on the gate as it is before the change.
- R6. Every page that passes the gate on `main` still passes it.

### Scope Boundaries

- `packages/core` is not changed. The concepts slice's write keeps its door and its transactions.
- `seedConcepts` keeps its inputs, its return shape and its exported names. `apps/web/e2e/harness.ts` is not changed.
- The `conceptsSeeding` schema is not changed. Another branch is moving the refusals a body alone can show into it: a link or a cited concept that is not earlier in the list, and a title named twice.
- The gate's rule changes; no page's markup does.

### Deferred to Follow-Up Work

- A concepts seed that is all-or-nothing in both stores. It needs the slice's write to take a transaction, or a harness door that turns the slice's transactions into savepoints on one connection, and a reset of the repository's head on failure.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The model-choices route writes through `inOneTransaction`.** It is the function `seedConnectedSources` already uses, exported from `apps/api/tests/harness-sources.ts`. Governs R1.
- KTD2. **For the concepts seed, "leaves nothing behind" means refused before the first write.** `seedConcepts` reads the workspace once before it writes anything and refuses the seed there for each reason it can know ahead:
  - the writer is a Viewer, whom the slice's write refuses; or the writer is an Editor and a concept asks for the Admin's override, by being shared with a group or by citing a document held at a sensitivity that differs from its own. The refusal names the field that asks. An Editor's seed that asks no override still lands, because the slice's write admits an Editor and the harness is no stricter than the product;
  - a concept's file is already held in the workspace. Every seeded concept's merge key is made from its kind and its title, so two that share a merge key share a file, and the file alone is read. A title two concepts of one seed share is left to the schema, with the other refusals a body alone can show;
  - for a concept shared with a group, a `groupMemberIds` entry is no member of the workspace, which `group_member_member_fk` would refuse after the concept was committed.

  The read needs the store, so it sits in `seedConcepts` and not in the schema, which `readBody` parses before any connection opens. It throws a `z.ZodRealError`, the class `parse` throws: in zod 4 a `new z.ZodError(...)` is not an `Error`, and Hono hands only an `Error` to `onError`. The harness's one error handler then answers 400 with the field and the rule. The repository is initialised after the read, so a seed refused there makes no repository either. Governs R2.
- KTD3. **What the read does not cover is said, not hidden.** The read covers what the body names: its writer and what it asks of them, its titles and its group members. Any other refusal at concept N leaves concepts before N whole in the repository, the index and the map. It may leave N's own connected sources, documents and passages, and N itself, written but not yet narrowed, shared or verified. One such refusal is a name the harness makes up that the workspace already holds, as a concept and a connected source of one name, both shared with a group, each make a group named `<name> readers`. The skill says so. This meets BA-132's second criterion by its "or". Governs R3.
- KTD4. **A wordless wrapper is part of its field only when one of its sides hugs.** `controlEdges` already holds a wrapper's border to a side that runs less than 8px from the field's own. The same measure now decides whether the parent is a wrapper at all. A wordless parent that hugs on no side lends nothing: `fill` is still what is painted under the field, and `behind` is measured at the field's parent, so the parent's own background is what the field is compared with. A wrapper that hugs on a side lends its fill as before, and its border on each side that hugs.
  - Chosen over "all four sides hug". A fill is a region and not a side, so all four is the stricter reading. But a field with an icon button beside it in one filled row is found by that row's fill, as Jump to's field is found by its row's rule from one side. One measure for both paints is the rule a person can hold in their head.
  - Governs R4, R6.

### Risks

| Risk | Mitigation |
|---|---|
| The tighter check fails a page on `main` | The census runs on the whole suite before the check changes; the whole suite runs again after |
| The read ahead refuses a seed that lands today | It refuses only what the store refuses later: a title seeded twice and an Editor's override both fail today, part-way. A test holds that an Editor's seed asking no override still lands, and the whole browser suite and `pnpm check:api` run after U2 |
| The other branch edits `seedConcepts` or its test | The edit is one call in `seedConcepts` and new functions beside it; the new tests sit in a `describe` of their own |

### Assumptions

- A unique index's violation carries the index's name as `constraint`, as a named constraint's does. U1's test proves it.
- `apps/web/e2e/concept-page.spec.ts` seeds one workspace twice with titles that differ. The browser suite proves it.

---

## Implementation Units

### U1. A model-choices seed is one transaction

- **Goal:** a refused model-choices seed leaves no row.
- **Requirements:** R1; KTD1. Covers BA-132's first criterion.
- **Dependencies:** none.
- **Files:**
  - `apps/api/tests/harness-control.ts`: the `/__harness/model-choices` route.
  - `apps/api/tests/harness-control.test.ts`: the test.
- **Patterns to follow:** `seedConnectedSources` and `connectedSourcesIn` in the same two files.
- **Execution note:** test first.
- **Test scenarios:**
  - Leaves no model choice when a seed's second choice is refused: two choices for one purpose answer 400 naming `model_choice_workspace_purpose_unique`, and the workspace holds no `model_choice` row.
- **Verification:** `pnpm check:api`.

### U2. A concepts seed is refused before its first write where the harness can read ahead

- **Goal:** the three refusals of KTD2 answer 400 before anything is written, and the skill says what is and is not all-or-nothing.
- **Requirements:** R2, R3; KTD2, KTD3. Covers BA-132's second criterion.
- **Dependencies:** none.
- **Files:**
  - `apps/api/tests/harness-knowledge.ts`: the read ahead, called from `seedConcepts` before `initRepository`.
  - `apps/api/tests/harness-knowledge.test.ts`: the tests, in a `describe` of their own.
  - `apps/api/tests/harness-asked.ts`: the one helper both harness test files ask a refusal through, so the duplication gate holds.
  - `.claude/skills/browser-suite/SKILL.md`: the paragraph under the actions table, through `ce-skill-work`.
- **Patterns to follow:** `whyNotWritten` in `apps/api/tests/harness-control.ts` for the 400's shape; `askedOfTheHarness`, now in `apps/api/tests/harness-asked.ts`, for reading a refusal's status and body.
- **Execution note:** test first. Each test is seen to fail with the read ahead removed.
- **Test scenarios:**
  - Refuses a seed whose second concept's title the workspace already holds: after one concept is seeded, a seed of a new concept with a cited document and then the held title again answers 400 naming `concepts.1.title`. The index holds one concept, the workspace holds no connected source, and the repository's head has not moved.
  - Refuses a seed whose second concept, shared with a group, names a group member who is no member of the workspace: 400 naming that entry alone, with no concept, no group and no commit. The same id on the first concept, which is shared with everyone and makes no group, is not refused.
  - Refuses a seed written by a Viewer: 400 naming `userId`, with no row and no repository made.
  - Refuses an Editor's seed in which one concept is shared with a group and another cites a document held at another sensitivity: 400 naming `concepts.1.audience` and the source's `sensitivity`, with no row and no repository.
  - Lands an Editor's seed that asks no override.
  - Every refusal above reads both stores afterwards: the index, the connected sources, the groups, and whether the repository exists and where its head stands.
  - Existing: every seed in the file still lands, and `concept-page.spec.ts` still seeds one workspace twice.
- **Verification:** `pnpm check:api`; the browser suite.

### U3. The gate lends a wrapper's fill only where the wrapper hugs

- **Goal:** `controlEdges` treats a wordless parent as a wrapper only when a side of it hugs the field.
- **Requirements:** R4, R5, R6; KTD4. Covers BA-133's three criteria.
- **Dependencies:** none.
- **Files:**
  - `apps/web/e2e/locators.ts`: `controlEdges`.
  - `apps/web/e2e/accessibility-gate.spec.ts`: one `test.fail()` case and its passing twin.
  - `.claude/skills/browser-suite/SKILL.md`: the gate's rule and the `controlEdges` row, through `ce-skill-work`.
- **Approach:**
  1. Census first, on untouched code: run the whole suite with every control that has a wordless parent recorded, with the parent's paint, what is behind it and the distance of each of its sides. A parent lends a fill today where its paint differs from what is behind it. If a control outside `accessibility-gate.spec.ts` passes today and would fail with nothing lent, its own edges and fill measured against its parent's paint, stop. The gate's own see-through-tint fixture stands 8px off its field and is expected to keep failing. The census's patch is thrown away before the check changes.
  2. Write the two fixtures and watch the `test.fail()` one print *Expected to fail, but passed* on the untouched check.
  3. Change the check, then run the whole suite.
- **Patterns to follow:** `drawEdgelessFieldsInABorderedBox` and `drawAWordlessCheckbox` in `accessibility-gate.spec.ts`, the second for one fixture drawn at two measures.
- **Execution note:** test first.
- **Test scenarios:**
  - Refuses an edgeless, see-through field in a filled box whose sides stand 9px off it: `test.fail()`. The box's fill stands 3:1 against the page in both themes, the field is 32px tall so axe's `target-size` is silent, and its edge is see-through so it has no edge against the box.
  - Finds the same field by the box's fill when the box's top alone stands 5px off it, which pins the one-side rule of KTD4.
  - Existing: *refuses a field with no edge on a see-through tint* and *refuses fields that only a layout box's border surrounds* still fail for their own reason, and *finds a field by the rule its row draws* still passes.
  - Existing: every spec still passes the gate, `jump-to.spec.ts` among them.
- **Verification:** the whole browser suite on port 3232.

---

## Verification Contract

| Check | Proves | Applies to |
|---|---|---|
| `pnpm check:api` | R1, R2 | U1, U2 |
| The web `check`: typecheck, unit tests and the whole browser suite, on port 3232 | R4, R5, R6, and that no spec's seed is newly refused | U2, U3 |
| `pnpm check:gates` | lint, formatting and the repository gates | all |
| `pnpm check:docs` | this plan's words and the skill's | all |

---

## Definition of Done

- A model-choices seed refused at its second row leaves no row.
- A concepts seed refused for a reason of KTD2 answers 400 and leaves nothing in Postgres or the repository, and the skill says what any other refusal can leave.
- The new gate case fails for its own reason, its twin passes, and the whole suite passes on the tighter check.
- Every check in the Verification Contract passes on the head that is pushed.
