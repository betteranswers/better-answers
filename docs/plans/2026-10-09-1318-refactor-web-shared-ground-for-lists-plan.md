---
title: Web Shared Ground for Lists - Plan
type: refactor
date: 2026-10-09
topic: web-shared-ground-for-lists
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
origin: docs/plans/2026-10-08-2311-docs-architecture-review-before-s2-plan.md
---

# Web Shared Ground for Lists - Plan

## Goal Capsule

- **Objective:** a screen reader announces a list's loading and failure lines on every page that draws one, Members, a member's page and member activity included. S2a's Search page can take a searched list, page turns and refusal words from `shared/` without copying People's.
- **Means:** WP5 of the architecture review before S2 (R5 of the origin plan): one searched-list hook, `ListState` delaying its own words, `refusalsOf`, and `selectFirst(line)` (KTD1 to KTD6).
- **Product authority:** Linear BA-80's acceptance list, then the origin plan's decisions 7 and 9 and its WP5 row. The staff review's notes on cards 3, 9, 21 and 34 (attached to BA-35) fill in what those leave open.
- **Stop conditions:** stop and report when any of these happens:
  - A People browser spec changes what a reader sees or hears beyond the moved words.
  - A spec needs a new fixture or harness action.
  - `during` cannot be made required without a behaviour change at some call site.
- **Execution profile:** one branch and one pull request, `Fixes BA-80`. Units land as separate commits in the order under Sequencing.
- **Who finishes:** `ce-work` builds and `ce-code-review` reviews. `ce-commit-push-pr` opens the pull request. The merge is the owner's.
- **Open blockers:** none.

---

## Product Contract

### Summary

Four things that every list needs move from People into `apps/web/src/shared/`. The searched list settles its search into the address. `ListState` mounts its live region empty and fills it one render later. `refusalsOf` turns a failure into a feature's words. `selectFirst(line)` takes the feature's own line. Members, Invitations and the audit log take the shared parts. Nothing a reader sees changes, apart from loading and failure lines that a screen reader now hears.

### Problem Frame

The 08/10/2026 architecture survey found People's list ground written two or three times. Knowledge's Search page (S2a) cannot import `features/people`, so it would write a fourth copy. One copy has a defect. Members, a member's page and member activity mount `ListState`'s loading and failed regions with their words already inside. A region mounted that way may go unread (decision 7). BA-31's fix lives in `ListRead`, and those three pages bypass it.

### Requirements

- R1. One `shared/` hook over `useListAddress` and the settled search returns `{ state, write, search, setSearch, flush, pageIndex, clear }`. Members, Invitations and the audit log use it. The two `usePageTurns` copies go, and their keystrokes move into `ListPages`.
- R2. The audit log's local `useAsked` is gone or renamed, so no hook in `apps/web/src` shares `shared/address-ask.ts`'s `useAsked` name.
- R3. `ListState`'s `loading` and `failed` mount their region empty and fill it one render later, and `ListRead` only branches. With the read pending, `MembersTab`'s loading region is empty on the first render. That test fails on today's tree.
- R4. `members-tab.tsx`, `member-page.tsx` and `member-activity.tsx` need no edit of their own to announce their loading and failure lines.
- R5. `refusalsOf(featureWords)`, with `during` required, replaces each feature's hand-written refusal template. `FailedDuring`'s `"change"` becomes `"action"` across `query-client.ts` and the refusal module, which then share one type.
- R6. `SELECT_FIRST` leaves `shared/`. `selectFirst(line)` takes the feature's own words.

### Acceptance Examples

- AE1. **Covers R3, R4.** **Given** the members read has not answered, **when** `MembersTab` renders, **then** its loading region holds no words on the first commit and holds "The members are still loading." (`MEMBERS_LOADING`) after.
- AE2. **Covers R1.** **Given** a reader types a search and then Back moves the address, **when** the hook renders, **then** the box shows the address's search. While a typed search is still settling, the list draws its first page.
- AE3. **Covers R1.** **Given** Members is on its last page, **when** the reader presses the next-page keystroke, **then** the address does not change.
- AE4. **Covers R5.** **Given** a read fails with no refusal word, **when** its feature says the failure with `during: "read"`, **then** the line does not say that nothing was saved.

### Scope Boundaries

- The eight other `<output>` writers that call `useReadSaid` themselves are BA-88. `read-said.ts` and its test stay.
- BA-38 (`OutcomeLine`'s `<output>` hidden while empty) is a different fix and stays open.
- The console's `useAsking` (Everyone's search) moving onto the hook is a follow-up.
- Requests and Groups adopting the shared list parts are BA-49's U13. This plan changes only their `selectFirst` and refusal call sites.
- WP15's single refusal catalogue is out of scope. `refusalsOf` binds a dictionary; it does not move where dictionaries are registered.

### Sources

- Linear BA-80; origin plan R4 (decisions 7 and 9) and R5 (WP5's row).
- Survey cards 3, 9, 21, 34 and the staff review's verdicts on them, attached to BA-35.
- Prior fix: BA-31, commits `d7e38aef` and `0750b3c4`.

---

## Planning Contract

**Product Contract preservation:** bootstrap plan. R1 to R6 restate BA-80's acceptance list without changing scope. R4 is read as being about the live-region delay. `members-tab.tsx` is still edited under R1, R5 and R6.

### Key Technical Decisions

- KTD1. **`useSearchedList` in `shared/searched-list.ts`.** It takes `(prefix, fields, options)`, where `options.kept` names the fields that `clear` leaves alone. Members keeps `sort` and Invitations keeps `status`, as they do today. `pageIndex` is a function of the total, `pageIndex(pageSize, total)`. Members and Invitations filter by the draft search after the hook, so the total is not known inside it. A settled search writes `page: 1` only when `fields` has a `page` key. The audit log uses Load more and has no page, so it never gets a stray `audit.page=1`. `useSettledSearch`, `pageIndexOf` and `SETTLE_MS` move into this module, and `members-address.ts` keeps only Members' own address. Governs R1, R2.
- KTD2. **`ListPages` binds the page-turn keystrokes.** `Pages.keystrokes` takes `Keystroke` objects, not key labels. A child component binds them before `PageTurns`' one-page early return, the way `MoreOn` binds Load more's. `onTurn` is only called within `0..pageCount-1`. A turn past either end does nothing. That check moves out of both `usePageTurns` copies into `ListPages`. (session-settled: user-approved — chosen over the hook returning `turnTo` and binding the keys: `ListPages` already binds Load more's keystroke, so the hook stays about state.) Governs R1.
- KTD3. **`ListState` defers a flag, not its words.** A child component per live kind reads `useDeferredValue(true, false)`. The region is empty on the first commit and filled on the next. Deferring the `failed` ReactNode itself would defer again on every render, because each render makes a new element. `ListRead` drops `useReadSaid` and only chooses a state. A region that stays mounted while its words change keeps them live, which is what a screen reader hears. (session-settled: user-approved — chosen over keeping the delay only in `ListRead`: three pages mount `ListState` directly and skip it.) Governs R3, R4.
- KTD4. **One `FailedDuring = "read" | "action"`, owned by `shared/api/query-client.ts`.** `refusal-outcome.tsx`'s `FailedIn` is deleted and `failureOutcome` takes `during` with no default. `features/auth/pending-refusal.ts` compares against `"action"`. `rememberAChangeUnsaved` keeps its name, because it describes what the reader loses. (session-settled: user-approved — chosen over keeping "change": *action* is the glossary's word for what an entry asks core to do.) Governs R5.
- KTD5. **`refusalsOf(featureWords)` returns `{ outcomeOfFailure, refusedFor, saidOf }`.** `outcomeOfFailure(failure, during)` has `during` required. `refusedFor(word, class)` gives an `Outcome`, and `saidOf(word, class)` gives the `Said`. Each feature binds its dictionaries once, in the module that holds its one-line wrappers today (`features/people/refusal.tsx`, `features/sources/refusal.tsx`, `features/console/words.ts`), and the wrappers go. A `refusal-words.ts` stays a word table that the specs import, with no React or tRPC import at runtime. Logic that is more than a binding stays in its feature: `outcomeOfSendingFailure`'s ceiling, sources' `whyAndNextOf`, the audit export's ceiling, and console's `readRefused`. (session-settled: user-approved — chosen over defaulting `during` to "action": a read that forgets it would say nothing was saved.) Governs R5.
- KTD6. **Each feature owns its "select first" line.** `selectFirst(line: string)` builds the outcome, and each line sits in its feature's words module. The three Playwright specs that read `SELECT_FIRST` import each line from its feature's word table instead, as the browser suite reads every sentence. A word table imports no React or tRPC code at runtime, so each line goes in a module that keeps that true. Governs R6.

### Assumptions

- The MembersTab test selects `ListState`'s own `<output>`, not the count line's, which is also an `<output>`. The implementer scopes the selector to the list region, for example the `EmptyAction` title.
- Members' `MembersRead` still decides loading with `read.data === undefined`. That is left alone (R4), because `ListState` now carries the delay whichever test picks the state.

### Sequencing

U1 (`ListState`'s delay) has no dependency, and its test goes first because it fails today. U2 (the hook and `ListPages`' keystrokes), U3 (refusals) and U4 (`selectFirst`) can follow in any order. U5 runs last: the People browser specs and the full `check`.

---

## Implementation Units

### U1. `ListState` mounts its live region empty

- **Goal:** every loading or failed region `ListState` draws is announced, whoever mounts it.
- **Requirements:** R3, R4, AE1; KTD3.
- **Dependencies:** none.
- **Files:** `apps/web/src/shared/list-pages.tsx`; new `apps/web/test/list-state.test.tsx`, replacing `apps/web/test/list-read.test.tsx`.
- **Approach:** add small `Loading` and `Failed` children that defer a shown flag and render the words only once it is true. `ListRead` keeps its failed-before-pending branching and passes the read's words straight through.
- **Test scenarios:**
  1. Mounting `ListState` with `loading` and words already set: empty on the first commit, the words after.
  2. The same for `failed`'s alert.
  3. `ListRead` with a pending read draws the loading region, and with an answered read draws its children and no region. This keeps `list-read.test.tsx`'s cases.
  4. `MembersTab` with `fetch` stubbed to never answer: its loading region is empty on the first commit and holds `MEMBERS_LOADING` after (AE1). Written first, it fails on today's tree.
- **Verification:** the new suite passes and fails with the deferral removed. `said-after-mount.test.tsx` and `read-said.test.tsx` are unchanged and pass.

### U2. One searched-list hook; page turns in `ListPages`

- **Goal:** a list's search, address and page turns are one shared call.
- **Requirements:** R1, R2, AE2, AE3; KTD1, KTD2.
- **Dependencies:** none.
- **Files:** new `apps/web/src/shared/searched-list.ts`; `apps/web/src/shared/list-pages.tsx`; `apps/web/src/features/people/members-address.ts`, `members-tab.tsx`, `invitations-tab.tsx`, `audit-log-page.tsx`; `apps/web/test/settled-search.test.tsx`, renamed to `searched-list.test.tsx`; `apps/web/test/grid-table.test.tsx`; `apps/web/test/members-list.tsx` if it passes key labels.
- **Approach:** the hook composes `useListAddress` and the settled search. Members' and Invitations' narrowing hooks call it, then filter and page. The audit log's `useAsked` dissolves into one call in `AuditLogRegion`. `ListPages` callers pass the `PEOPLE_KEYSTROKES` objects.
- **Test scenarios:**
  1. The existing settled-search cases, retitled by what they do and run against the shared hook: every key kept; settle after a pause; Back or a link moves the box; flush before leaving; page one again once settled; the page kept within the last page.
  2. `clear` empties the search and every filter but leaves a `kept` field.
  3. A list with no `page` field settles its search without writing a page.
  4. In `grid-table.test.tsx`'s pages section: the next and previous keystrokes turn the page. A turn past the last or before the first page does nothing (AE3).
- **Verification:** no `usePageTurns` remains, and only `shared/address-ask.ts` defines `useAsked`. `features/people` no longer exports `useSettledSearch` or `pageIndexOf`.

### U3. `refusalsOf` and one word for "read or action"

- **Goal:** a feature says a failure in its own words by naming its dictionary once.
- **Requirements:** R5, AE4; KTD4, KTD5.
- **Dependencies:** none.
- **Files:** `apps/web/src/shared/api/query-client.ts`, `apps/web/src/shared/refusal-outcome.tsx`, `apps/web/src/features/auth/pending-refusal.ts`, `apps/web/src/app/router.tsx` (type only); `apps/web/src/features/people/refusal.tsx` and its callers; `apps/web/src/features/sources/refusal.tsx` and its callers; `apps/web/src/features/console/words.ts`; `apps/web/src/features/people/audit-log-page.tsx`; `apps/web/test/refusal-outcome.test.tsx` and any test that passes `"change"`.
- **Approach:** add `refusalsOf` beside `failureOutcome` and make `during` required down the chain. Every call site that relied on the default passes `"action"` explicitly. The type checker lists the about 50 sites.
- **Test scenarios:**
  1. `refusalsOf(words).outcomeOfFailure` with no refusal word, `"read"` against `"action"` (AE4).
  2. A known word is said in the feature's words, and an unknown word falls back to its class.
  3. `refusedFor` and `saidOf` agree with `saidOfRefusal`.
  4. The query client reports `"action"` for a mutation's failure.
- **Verification:** `typecheck` passes with no `FailedIn` left, and no `"change"` is a `FailedDuring` value.

### U4. `selectFirst(line)`

- **Goal:** a new list with a row keystroke edits only its own feature.
- **Requirements:** R6; KTD6.
- **Dependencies:** none.
- **Files:** `apps/web/src/shared/keystroke-words.ts`, `apps/web/src/shared/outcome.tsx`; the callers in `features/people` (members, member bulk actions, invitations, invitation actions, groups, requests), `features/sources/connected-sources-page.tsx` and `features/console/people-keystrokes.ts`, each with its line in its words module; `apps/web/e2e/people.spec.ts`, `console-people.spec.ts`, `people-groups.spec.ts`.
- **Approach:** delete the map and type the parameter as a string. Each line moves verbatim beside its feature's words.
- **Test expectation:** none new. The three specs check the lines word for word.
- **Verification:** `SELECT_FIRST` appears nowhere in the tree.

### U5. The People pages, end to end

- **Goal:** nothing a reader sees or hears regresses.
- **Requirements:** R1 to R6.
- **Dependencies:** U1 to U4.
- **Files:** none expected beyond U4's specs.
- **Approach:** run the browser suite's People and console specs through the served build, as the `browser-suite` skill says.
- **Verification:** `people.spec.ts`, `people-invitations.spec.ts`, `audit-log.spec.ts`, `people-groups.spec.ts` and `console-people.spec.ts` pass, with their accessibility gates.

---

## Verification Contract

| Check | Proves | When |
| --- | --- | --- |
| `pnpm --filter @better-answers/web check` | types and the web unit suite | after each unit |
| The People and console Playwright specs (U5) | pages unchanged for a reader, accessibility gate included | after U4 |
| `pnpm check` at the root | every workspace and gate, the lint and copy-detection included | before the pull request |
| `/ce-code-review` | a reviewer reads the diff against this plan | before the pull request |
| CI `check` | the arbiter | on the pull request |

## Definition of Done

- R1 to R6 hold, and each unit's verification passes.
- The pull request body ends with `Merge risk: reversible, web only, no stored data or agreement` and `Fixes BA-80`.
- No dead code from abandoned attempts is left in the diff. `list-read.test.tsx` and `settled-search.test.tsx` are replaced, not duplicated.
