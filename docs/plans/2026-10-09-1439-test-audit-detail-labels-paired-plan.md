---
title: Pair each audit action's detail labels with the keys core declares - Plan
type: test
date: 2026-10-09
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Pair each audit action's detail labels with the keys core declares - Plan

## Goal Capsule

- **Objective:** a detail key that core starts or stops writing for an audit action can no longer reach the Audit log page unlabelled or leave a dead label behind without `check` going red.
- **Means:** core's generated web copy carries each action's declared detail keys (KTD1, KTD2), and a web test pairs them with the page's labels and an explicit kept-off set in both directions (KTD3).
- **Authority:** Linear BA-87's acceptance list, then this plan. Card 27's wider fix (one home for an action's words) belongs to S3 and is out of scope.
- **Stop conditions:** stop and report if pairing needs a product call on which keys the page shows beyond keeping today's display as it is.
- **Finishes and ships:** `/lfg BA-87`, ending at an open pull request with `check` green.

---

## Product Contract

### Summary

The generated `apps/web/src/features/people/audit-actions.ts` gains each declared action's detail keys. `apps/web/src/features/people/audit-details.ts` exports the keys it labels and names, per action, the keys it keeps off the page on purpose. A new web test fails when an action's key is neither labelled nor kept off for that action, and when a label or kept-off entry matches no declared key.

### Problem Frame

An audit action's words live in three places: core's headline, the web's sentence, and the web's detail labels. Headlines and sentences are already paired with core's declared actions. Detail labels are not: `detailLinesOf` drops any key it has no label for, so a key core adds shows nothing and passes, and a label for a key core stopped writing sits unused and passes. This is card 27 of the 08/10/2026 architecture survey, put off for later under R11 of `docs/plans/2026-10-08-2311-docs-architecture-review-before-s2-plan.md` and filed as BA-87.

### Requirements

**The pairing**

- R1. A test reads each audit action's declared detail keys from core and fails, naming the action and key, on a key that has no label and is not kept off on purpose.
- R2. The same test fails on a label, or a kept-off entry, whose key no declared action carries.
- R3. The test runs under `check`, and the web's copy of the keys cannot drift from core without `check` failing.

**Today's tree**

- R4. Today's mismatches are resolved in this change without altering what the Audit log page shows.

### Scope Boundaries

- Card 27's wider fix, giving an action's headline, sentence and labels one home, stays with S3.
- Labelling a key the page does not show today is a product change and is not made here. The kept-off list records each such key so the owner can move one to a label later.
- Considered and not built: keeping a label for a key core retires, so rows written before still show it. No key is retired today, and core's stored-names register already ties every stored key to a declaration; the retirement that first needs it should decide it.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Core records detail keys per action.** `declareActions` already holds each action's `detail` shape. `Declaration` replaces its per-call union `detailKeys` with a per-action record of keys, so the generator can emit them and the stored-names test derives its union from the same record. One source, no parallel union to keep in step.
- KTD2. **The generated copy carries the keys as one `[action, key]` pair per line.** The copy must stay byte-identical to a regeneration and pass `format:check`. A per-action array would wrap or collapse at oxfmt's print width depending on its length, so the renderer would have to reimplement the formatter. One short pair per line is stable under the formatter, and actions with no keys simply contribute no pairs.
- KTD3. **Kept-off entries are `[action, key]` pairs beside the per-key labels.** The page's stated rule is that an id is said by what it names and a key with no word is left off. Making the left-off entries an explicit export turns that silent fallback into a declared choice. Labels stay per key, because `detailLinesOf` labels by key. Kept-off entries are per action, because the choice to hide a key is made for an action: a key kept off for one action that a new action starts writing still turns `check` red until someone decides. The exports mirror `ACTIONS_SAID` and `ACTIONS_HEADED` in `audit-sentences.ts`, which exist for the same kind of pairing.
- KTD4. **Today's unlabelled pairs go into the kept-off list.** They cover fifteen keys. `setId`, `workspaceId`, `authenticatorId`, `passkeyId`, `commitSha`, `contentHash`, `bundleId`, `verificationId`, `findingId`, `dpiaHash`, `subjectRequestId` and `erasureRequestId` are ids and hashes the read does not name. From `platform.graph.swept`, `generation` is already the event's subject, and `nodes` and `edges` count rows of a deleted map copy that a reader cannot act on. Keeping all of them off preserves today's page (R4); the pull request lists them for the owner to correct.

### Assumptions

- No label today names a key that no action declares. The R2 direction is checked by the new test itself on first run; any hit is removed in this change.

---

## Implementation Units

### U1. Per-action detail keys in core's declarations

- **Goal:** `declarations()` answers each action's own detail keys.
- **Requirements:** R1, R3; KTD1.
- **Dependencies:** none.
- **Files:**
  - Modify: `packages/core/src/audit/vocabulary.ts`
  - Test: `packages/core/test/audit.test.ts`, `packages/core/test/stored-names.test.ts`
- **Approach:**
  1. `Declaration` swaps `detailKeys` for a per-action record keyed by action name.
  2. `declareActions` fills it from each action's `detail` shape. `declareIdentitySetActions` funnels through it already.
  3. The stored-names test derives its declared-key union from the record.
- **Patterns to follow:** the existing `declared.push` in `declareActions`.
- **Test scenarios:**
  - Declaring `platform.probe.accepted` with detail `{ confirmed }` lists that action with keys `["confirmed"]` among the declarations.
  - Declaring an identity-set action lists its own keys the same way.
  - The stored-names register still pins exactly the union of every action's keys.
- **Verification:** the core suite passes with the two `toContainEqual` expectations updated to the new shape.

### U2. Generated copy carries each action's keys

- **Goal:** the web reads every declared action's detail keys from core's generated copy.
- **Requirements:** R1, R3; KTD2.
- **Dependencies:** U1.
- **Files:**
  - Modify: `packages/core/scripts/audit-actions.ts`, `packages/core/scripts/generate-audit-actions.ts`
  - Regenerate: `apps/web/src/features/people/audit-actions.ts`
  - Test: `packages/core/test/audit-actions.test.ts`
- **Approach:**
  1. The script's reader answers each action with its keys, not names alone.
  2. The renderer appends a `DETAIL_KEYS` list of `[action, key]` pairs after `HEADLINES`, sorted by action then key in code-unit order, typed against `DECLARED_ACTIONS`.
  3. Regenerate the web copy through `generate:audit-actions`.
- **Patterns to follow:** the `HEADLINES` block in `renderAuditActions`.
- **Test scenarios:**
  - Rendering two actions, one with keys `role` and `previousRole` and one with none, gives the existing header, actions and headlines, then the pairs for the first action in code-unit key order and none for the second.
  - The checked-in copy is byte-identical to a regeneration.
- **Verification:** `audit-actions.test.ts` passes, and `format:check` leaves the regenerated file unchanged.

### U3. The web pairs labels with declared keys

- **Goal:** a web test fails on a declared key with no label and on a label with no declared key.
- **Requirements:** R1, R2, R3, R4; KTD3, KTD4.
- **Dependencies:** U2.
- **Files:**
  - Modify: `apps/web/src/features/people/audit-details.ts`
  - Create: `apps/web/test/audit-details.test.ts`
- **Approach:**
  1. Export the keys the page labels, drawn from the two label maps, and the kept-off `[action, key]` pairs of KTD4, with a comment giving the reason for each group.
  2. The test walks `DETAIL_KEYS` and collects every pair whose key is not labelled and which is not itself kept off, expecting none.
  3. It then collects every labelled key that no pair carries, and every kept-off pair absent from `DETAIL_KEYS`, expecting none.
- **Patterns to follow:** the three pairing tests at the end of `apps/web/test/audit-sentences.test.ts`.
- **Test scenarios:**
  - Every declared action's keys are labelled or kept off for that action; a failure names the action and the key.
  - Every labelled key is declared by at least one action, and every kept-off pair is a declared pair.
- **Verification:** the web suite passes on today's tree. Deleting one label, or adding a label for an undeclared key, turns the test red with the key named.

---

## Verification Contract

| Gate | Command | Proves |
| --- | --- | --- |
| Core suite | `pnpm --filter @better-answers/core run check` | U1, U2: declarations, register, byte-identical copy |
| Web suite | `pnpm --filter @better-answers/web run test` and `typecheck` | U3 pairing in both directions |
| Root gates | `pnpm run check:gates` | `format:check` on the generated copy, `knip` on the new exports, `jscpd` |
| CI | `check` on the pull request | the whole tree |

---

## Definition of Done

- R1 to R4 hold, each proved by a named test above.
- The generated copy is regenerated by the script, never edited by hand.
- The Audit log page shows the same lines it showed before.
- No abandoned attempt remains in the diff.
- The pull request lists the kept-off keys of KTD4 for the owner to correct.
