---
title: "How a rename sweep lands a word in the words test"
date: 2026-10-03
last_updated: 2026-10-07
category: best-practices
module: apps/api
problem_type: best_practice
component: testing-framework
severity: medium
applies_when:
  - "A BA-29 sweep (U8 to U17) reaches KTD5 step 5 and marks its rows landed in apps/api/tests/old-words.ts"
  - "Adding or changing a permitted sense, a carve-out or a reach on a row of the old-words list"
  - "Removing a _Code rename pending._ mark from CONCEPTS.md"
  - "Refreshing apps/api/tests/old-words-ratchet.json"
  - "Reviewing a sweep pull request's diff of old-words.ts, CONCEPTS.md or the ratchet baseline"
  - "Landing a one-sense row for a shared word, such as run, check or act, whose first scan finds thousands of lines in other senses"
  - "A sweep widens the reach of a row that has already landed"
symptoms:
  - "KTD5 step 5 says only that a sweep marks its rows landed, but landing a row also needs senses, a plans carve-out, a glossary edit and a baseline refresh"
  - "Several mistakes in a landed row pass the words test without a finding: a sense regex without the g flag, a carve-out on a reader-text row, a row flipped back to pending, a plural under a one-sense row"
  - "A one-sense row held to Appendix G's senses for a common English word reports hundreds of findings in other senses"
  - "Widening a landed reader-text row fails planted fixtures that used it as their reader-text example"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
related_components:
  - development-workflow
tags:
  - words-test
  - old-words
  - rename-sweep
  - glossary
  - ratchet
  - carve-out
  - reader-text
  - ba-29
---

# How a rename sweep lands a word in the words test

## Context

BA-29 renames the platform's words to the reader's words, one noun per sweep (`docs/plans/2026-10-02-2325-docs-glossary-in-the-readers-words-plan.md`, units U7 to U17, KTD5 at plan:201-208). The words test, `apps/api/tests/avoid-words.test.ts`, refuses an old word once its row in `apps/api/tests/old-words.ts` is landed (KTD1, plan:178). KTD5's step 5 says only that a sweep "marks its rows landed in the words test's list" (plan:206). The state change is one line, but the scan behaves in ways a sweep must know to land a row correctly, and some of them let an old word through with no finding.

The test arrived on branch `worktree-ba-29-u1-u4-words`, the first BA-29 pull request (U1 to U4, merged as #529), in the commits from "test(api): read the old words from their own list" to "test(api): fail the words test on a reader-text file it cannot parse". U6, on branch `feat/ba-29-u6-sweep-tooling`, then added the stored-names register and deferred senses. Line numbers below are from U6's head. U7 (#543) since added senses and rows to `old-words.ts`, so its line numbers have moved; find a row or helper there by name.

**Two row shapes** (`old-words.ts`):

- `Renamed` (23-34): `word`, `use`, `entry`, `sweep`, `state: "pending" | "landed"`, `reach`, and optional `why`, `permitted`, `carvedOut`, `reads`. The `pending(...)` helper (69-75) builds one with `state: "pending"` and none of the optional fields.
- `Avoided` (37-43): `sweep: null`, built by `avoided(...)` (61-67). `isRenamed` is `row.sweep !== null` (`words-scan.ts:60`). No scan reads an avoided row.

**The reach decides which scan reads a landed row** (`old-words.ts:19-20`):

| reach | Read by | Matches |
|---|---|---|
| `"everywhere"` | the line scan of every tracked file, `lineFindings` (`words-scan.ts:231-241`) | any form: plurals, camelCase, snake_case, hyphens (`findsIn` with `anyForm`, 122-129; `wordsOfCompounds`, 114-115) |
| `"one sense"` | the same line scan | the whole word only, any case (124-125) |
| `"reader text"` | reader strings only, `readerFindings` (402-412), in the files `READER_TEXT` names (255-260) | any form (406) |

**Landed rows to copy:** the api row (one sense, `APP_SENSES`, its own carve-outs; `old-words.ts:157-170`), `Better Answers` (one sense, `reads: isCodeAPersonReads`; 180-189), the audit log row (everywhere, with senses; 327-336), the audit action row (everywhere, no senses; 337-344), and the trust words `Changed since checked` (198-205), `Checked by` (208-216), `needs checking again` (368-375), all reader text, and `Unchecked`, which U14 widened to everywhere (step 10). U14's `check` row is the one-sense row that `reads:` holds to the files writing its sense (step 9). These line numbers predate later sweeps, so find a row by its word. The first sweep's three rows, from U7, are the rows whose `sweep` is `PAGE_AREA_MENU`: two one-sense rows whose senses are partly held to one tree by `within`, and one everywhere row with a sense for a stored browser key. All three carve out with `PAGE_AREA_MENU_CARVED_OUT`.

## Guidance

### The procedure

1. **Before the flip, prove the old word gone in every form.** Run KTD5 step 4's `rg` check case-insensitively, for plurals and compounds too. A landed one-sense row matches the whole word alone (trap 3), so this search is the only proof that its plural, and every compound name holding it, are gone.

2. **Flip the state.** Write the row out in full with `state: "landed"`, as the api and audit log rows are. `pending(...)` cannot express a landed row. Keep the row where it sorts: `outOfOrder` compares words case-insensitively and refuses a duplicate (`words-scan.ts:62-68`).

3. **Give it the senses it keeps.** A `Sense` (`old-words.ts:10-15`) has a `sense` label, a `written` regex, an optional `within` path prefix and an optional `until` sweep. `lineScanOf` blanks every permitted match, keeping only senses whose `within` the file path starts with and whose `until` names a sweep that still has a pending row (`keepsIn`, `words-scan.ts:175-177`), and every kept name, then tries the word again (`words-scan.ts:189-195`, `213`).
   - For a one-sense row, write the senses Appendix G lists for the word (plan:1001-1023). Add `within` when one tree alone writes the sense, as the api's own names for its tier are held to `apps/api/` (`old-words.ts:101-107`, the `within` at 104) and the cost ledger's contract to `contracts/cost-ledger/` (115-119). When the word is common English, measure what those senses leave before landing it (step 8).
   - A landed row can carry a sense with `until` naming the later sweep it waits on, for a name that sweep renames (plan:186). The sense holds while that sweep has a pending row, and once it lands the name is read again ("passes a deferred sense until its later sweep lands", `avoid-words.test.ts:543-562`).
   - An everywhere row may carry senses too. The audit log row is everywhere and carries `permitted` senses (335). The difference between the two reaches is how the word is matched, not whether senses apply.
   - Give every regex the `g` flag. `blankedBy` uses `String.replace` (`words-scan.ts:134-138`), so a regex without `g` blanks the first use on a line and leaves a second one to be read as the old word. Every sense in the file today is `/…/gi` or `/…/g`.
   - Names on the wire and in storage need no sense, because they reach the scan as kept names (step 7).
   - A reader-text row takes no senses. `readerFindings` reads only `rows` and `kept` from the scan (`words-scan.ts:402`), so `permitted`, `carvedOut` and `reads` on such a row do nothing. Its kept senses come from kept names alone.

4. **Carve out, on the row itself, the plans and dogfood reports dated before the landing.** `docs/plans/` has no global carve-out: the planted test reports a dated plan as a finding (`avoid-words.test.ts:301-325`, the plan at 321). R22 keeps completed plans' words (plan:103, Key Decision at plan:62), and the comment on `CARVED_OUT` says a sweep carves them out on its own row (`avoid-words.test.ts:38`). U7 (#543) wrote the first such carve-out as a helper in `old-words.ts`, `writtenBefore(day)`. It also covers `docs/dogfood-reports/`, because a dogfood report quotes the page text of its day. Use the helper, with the sweep's landing date in one constant shared by its rows, as U7's three `PAGE_AREA_MENU` rows do:

   ```ts
   const CONNECTED_SOURCE_LANDED = "2026-10-20";
   // on each row the sweep lands:
   carvedOut: [writtenBefore(CONNECTED_SOURCE_LANDED)],
   ```

   Inside the helper, a file with no dated name falls back to `"9999"`, so it is still scanned. The comparison is strict, so a plan or report dated on the landing day or later is read. A sweep whose own learning quotes the words it removes carves that one file out beside the helper, as `PAGE_AREA_MENU_CARVED_OUT` does. Carve out per row, never in the global `CARVED_OUT`: a global entry would stop every landed word being read in those plans, including words that landed before a plan was written. A row's carve-out holds for that row alone (`avoid-words.test.ts:327-340`). `CarveOut.why` is required (`old-words.ts:17`), and no carve-out ever holds a `CODING_STANDARDS.md` (`words-scan.ts:164-165`).

5. **Remove the glossary's pending mark when the entry's last pending row lands.** `unlisted` faults an entry marked `_Code rename pending._` that no pending row names (`words-scan.ts:75-82`). A landed row does not count (the planted case "a pending entry named by a landed row alone", `avoid-words.test.ts:1017-1021`). So landing the entry's last pending row without removing the mark fails the list test. Nothing checks the reverse: removing the mark while another pending row still names the entry passes, and the glossary then says the code is done when it is not. Rows share entries. `bind` (one sense) and `binding` (everywhere) both sit under *connected source* (`old-words.ts:191-192`). Search the list for the entry before removing its mark.

6. **Run the words test, and refresh the ratchet only after it has fallen.**

   ```sh
   pnpm --filter @better-answers/api run test tests/avoid-words.test.ts
   # only when that run is green:
   UPDATE_OLD_WORDS_RATCHET=1 pnpm --filter @better-answers/api run test tests/avoid-words.test.ts
   ```

   The ratchet counts pending rows alone (`words-scan.ts:471`), so a landed word disappears from the counts and its baseline entries stay behind. `ratchetRises` reports only a count above the baseline (487-495), so those leftover entries never fail; the refresh just clears them. Run the plain command first: the update writes the baseline before the comparison reads it (`avoid-words.test.ts:156-164`), so a refresh run always passes and would write any rise into the baseline. In the diff, the baseline should only lose entries or lower numbers.

7. **Never rename a stored or wire name.** R21 and R22 keep them (plan:102-103). They pass because `keptNamesUnder` reads them from where each is declared (`kept-names.ts:66-83`): refusal words; MCP entry names, scopes and schema keys and values; Better Auth's endpoints; the stored-names register's act names; stored act names from `audit-acts.ts`; old page addresses from `movedFrom`. Migrations and their snapshots are not kept names. They pass through the global `CARVED_OUT` (`avoid-words.test.ts:44-48`). The stored-names register (KTD15, plan:233) now exists at `packages/core/src/audit/stored-names.ts`. Its act names, `STORED_ACT_NAMES`, are kept names (`kept-names.ts:77`). Its detail keys are not: the register sits in the global `CARVED_OUT` (`avoid-words.test.ts:49-52`), so a stored detail key's literal is allowed there alone, and code elsewhere writes `STORED_DETAIL_KEYS.<name>` ("refuses a stored detail key outside the stored-names register", `avoid-words.test.ts:512-530`). A kept name that is one plain word counts as code only when quoted or backticked (`keptPatternsOf`, `words-scan.ts:144-149`), so prose writing the same word is still read. In reader text, a string that is a kept name whole is skipped (396-399).

### Traps the test does not report

1. **A reader-text row is never line-scanned.** `lineFindings` drops it (`words-scan.ts:235`). Landing one refuses the word in `READER_TEXT` files alone (255-260), never in docs or identifiers. That is by design for OKF and wire words (R15, R21), but a sweep cannot rely on the test to clear its docs. To refuse the word in code or CSS too, widen the row's reach (step 10).
2. **Flipping a landed row back to pending switches it off without a finding.** No scan reads a pending row (`landed`, `words-scan.ts:226`; "reads a pending word nowhere", `avoid-words.test.ts:375-381`), and `listFaults` does not object. A reviewer sees it only in the diff. The one side effect is that the ratchet counts the word again from no baseline, so a page using it fails as a rise once the baseline has been refreshed past it.
3. **A one-sense row matches the whole word alone.** `findsIn` without `anyForm` is `(?<!\w)word(?!\w)` (`words-scan.ts:124`), so a plural or a compound passes once the row lands ("reads a word held to senses whole, never in compounds", `avoid-words.test.ts:450-452`). While the row was pending the ratchet counted every form (`countIn`, 131-132), but only in page words (`PAGE_WORDS`, 249-252, read at 473), and it stops counting at the flip (471).
4. **A lone lowercase word is read only in a words module.** `isRead` reads it only when the file matches `WORDS_MODULE` (`words-scan.ts:310-312`, 245; planted at `avoid-words.test.ts:861-869`). A string such as `"binding"` in `navigation.ts`, an MCP entry, the answer renderer or an email is invisible to the reader-text, internal-word and ratchet checks. The line scan still sees it for an everywhere or one-sense row, but for a reader-text row nothing does. A sweep that renames a words module out of the `*words.ts` pattern drops it from those checks too, and passes. The test fails loudly only when a whole source of reader text yields no string (`readerStringsPerSource`, `words-scan.ts:386-393`; the test at `avoid-words.test.ts:112-119`) or a reader-text file does not parse (the throw at `words-scan.ts:360`; planted at `avoid-words.test.ts:871-875`). Losing one words module among several trips neither.
5. **Landing a row can wake the internal-word check.** `watchedInternals` leaves an `_Internal._` head unwatched while a pending row names its word (`words-scan.ts:422-436`; planted at `avoid-words.test.ts:763-778`). U8's `actor id` and `person id` are pending reader-text rows (`old-words.ts:143`, `397`) and internal heads (`CONCEPTS.md:613`, `620`), so landing them sets both `readerFindings` and `internalFindings` reading the same strings. If such a head is ordinary English, add it to `NOT_WATCHED_ON_PAGES` (`old-words.ts:527-554`). `unwatchedStrays` refuses an unwatched head that heads no internal entry (`words-scan.ts:86-91`).

### Landing a shared word that is mostly other senses

U13 landed *run*, held to one sense, when it renamed a connected source's run to a sync. The first scan after the flip found about 3,000 lines. Nearly all of them were a CI, test or release run, a backup, the plain verb, a code identifier or a command a tool runs. U14's *check* and U17's *act* have the same shape. What worked, in order:

1. **Fit the senses to the test's own findings, not to a guess.** Save the failing run's finding lines, then use a throwaway script that imports `OLD_WORDS`, takes the row's `permitted` senses (honouring `within`), blanks each finding line with them and reports what is left. Each edit to the senses then costs a second, not a full test run. Re-run the real test after each round, because the saved findings only cover lines the earlier senses missed. Tightening a sense can expose lines the old one hid.
2. **Scope by tree, and name the renamed thing's own trees file by file.** Most hits sat in trees that never write a sync: `.github/`, `deploy/`, `packages/devtools/`, `docs/operations/` and the journeys. A bare `\brun\b` sense, `within` each of those prefixes, cleared them (`OTHER_RUN_TREES`, `apps/api/tests/old-words.ts:605`). Where a tree also writes the renamed thing (the sources slice, the worker's pipeline, `CONCEPTS.md`, the C4 docs), list only the files whose runs are a tool's. Code review caught `apps/web/src/shared/` listed whole, which would have hidden a "Last run" in `navigation.ts`.
3. **Keep the renamed thing's natural phrases out of every sense.** A sense listing run kinds by their lead word let "first run" and "failed run" through. Those are the commonest ways to write a sync, so both came out after review, and the one tool-run "first run" left was exempted by file. A code sense that matched `run` before any punctuation also blanked prose ("On that run, a document…"). Code shapes have to be code-only: `run(`, `run.x`, `run =`, `run:` with a callable after it, a declaration keyword before it.
4. **Prove the row with a planted case, and watch it fail.** "refuses a sync written as a run, passing other runs" (`apps/api/tests/avoid-words.test.ts:640`) plants sync-shaped lines in a words module, the sources slice and a C4 doc, and plants other runs in their own trees. Only the first set may be found. Adding the sources tree to `OTHER_RUN_TREES`, or "first" back to the kinds, turns it red. The whole-tree scan alone cannot catch a sense that is too broad: it only fails when a sense is too narrow.
5. **Grep the compounds by hand.** Trap 3 above cuts both ways. A one-sense row cannot see `run` inside an identifier, because `findsIn` is `(?<!\w)word(?!\w)` (`apps/api/tests/words-scan.ts:146`) and `_` is a word character. After the green test, the cross-model review still found the worker's `_fail_the_run`. A grep it prompted found `ConnectedSourceRun`, eleven worker test names such as `..._reads_always_next_run`, and five test helpers such as `theRunThatRan`. Search the word's own trees for `[a-z]Run`, `Run[A-Z]`, `_run` and `run_` before calling the sweep done.

### What the verification sweep added (U14)

U14 renamed *check* to *verification* as the trust event (branch `feat/ba-29-u14-verification`). Its rows met three cases steps 1 to 7 do not cover. Each matters to the sweeps still to come: U15 lands *class*, *candidate* and *repair*, and U17 lands *act* across 366 files, all common English.

8. **Count first, then take the road to the owner.** The section above fits a shared word's senses across the whole tree. Before choosing that road, flip the row locally with only Appendix G's senses, run the words test and count what is left. For *check*, Appendix G's three senses (CI's `check`, CHECK constraints, `knowledge.check.imported`) left 885 findings in about 200 files outside `docs/plans/`, almost none of them the trust event. Fitting senses across the tree, as above, or holding the row to the files that write the renamed sense (step 9) is a scope decision the plan did not make, so take the count to the owner with a recommendation.

9. **Hold such a row with `reads:` to the files that write the sense it renames.** The owner chose this for *check*. The row lists `TRUST_EVENT_FILES`: core's concepts and answering slices, their tests and the MCP entries (`old-words.ts:788`, the row at `940`). The line scan ANDs a row's `reads` with its carve-outs (`words-scan.ts:208-209`), so the word is refused only in those files and keeps every other sense elsewhere. The *Better Answers* row's `reads: isCodeAPersonReads` is the precedent. Three consequences follow:
   - No dated plan sits under those files, so the row needs no `writtenBefore` carve-out.
   - A `reads` list passes silently if it names the wrong files. Prove it bites: plant the word in one of the files (`// a planted check`), run the test, see the finding, and remove the plant.
   - Trap 3 still applies inside the list. Search every form of the word over those files (`checks`, `checked`, `checker`) before the flip. The ratchet stops counting the word once it lands (step 6), so verb uses on pages are no longer counted. That follows from the scope, not a defect.

   Widening the list later is the owner's call. The review's second model proposed adding the erasure slice and the schema, and the finding was set aside as settled scope.

10. **Widening a landed reader-text row to everywhere breaks the planted fixtures that borrowed it.** `Unchecked` was landed in reader text alone (trap 1), so the old colour tokens `--trust-unchecked-*` passed the test. To refuse them, U14 set the row's reach to everywhere and gave it `UNCHECKED_SENSES` (TypeScript's `noUncheckedIndexedAccess`) and `VERIFICATION_CARVED_OUT` (the row at `old-words.ts:1390`, the two lists at `779` and `830`). It also reworded the plain-English *unchecked* in two ADR docs and a hook script. Three planted tests in `avoid-words.test.ts` used the live row as their reader-text example, and two of them failed, because the row now reads the planted CSS line too. Pin those fixtures to a reader-text copy of the row (`CHECKED_IN_READER_TEXT`, `avoid-words.test.ts:221`), as `pendingNow` pins a pending copy. Add a planted case showing the widened row refusing the token ("refuses the old trust token once its row reads everywhere", `avoid-words.test.ts:919`).

## Why This Matters

The words test is the one gate on R12, which refuses an old word once it has landed, and on R22, which keeps stored history. Eleven sweeps each repeat this landing. Most mistakes here pass in silence: a missing `g`, a carve-out on a reader-text row, a flip back to pending, a plural under a one-sense row. The ones that fail loudly tempt the wrong fix. An old plan edited to pass breaks R22, a wire name renamed to pass breaks R21's clients, and a ratchet rise refreshed away hides new old words on pages.

## When to Apply

- At KTD5 step 5 of every sweep still to come, U8 to U17.
- On any change to `old-words.ts`, the `_Code rename pending._` marks in `CONCEPTS.md`, or `old-words-ratchet.json`.
- When reviewing a sweep's pull request. Check the diff for `state` flips both ways, `g` on every new sense, `within` where one tree writes a sense, a `writtenBefore` carve-out on each newly landed line-scanned row, and a baseline that only fell.

## Examples

**A pending row, and the same row landed.** U11 lands `binding` on, say, 2026-10-20:

```ts
// before (old-words.ts:192)
pending("binding", "connected source", "connected source", "connected source", "everywhere"),

// after
{
  word: "binding",
  use: "connected source",
  entry: "connected source",
  sweep: "connected source",
  state: "landed",
  reach: "everywhere",
  carvedOut: [writtenBefore(CONNECTED_SOURCE_LANDED)], // "2026-10-20"
},
```

KTD1 also gives this row a deferred sense for `binding_id` on `index.chunk`, the worker's store-directory constant and the store-size env key until U12 renames them (plan:186). Written with `until: "passage"`, U12's sweep, the sense stops keeping those names once U12 lands. `bind` still names *connected source* as a pending row, so the glossary keeps its mark until `bind` lands as well.

**Landed and pending, side by side** (`avoid-words.test.ts:481-486`): `const binding = await read(tx);` passes while the row is pending and is reported once it lands. The migration SQL, its snapshot and `old-words.ts` itself in the same planted tree pass either way.

**A sense added for a collision** (`avoid-words.test.ts:595-610`): `act` landed with `permitted: [{ sense: "React's and Testing Library's act", written: /\bact\(/g }]` passes `await act(...)` in a web test and still refuses "Each act lands at once." in a words module.

**A one-sense row to copy:** the api row (`old-words.ts:157-170`) holds its senses in `APP_SENSES` (77-108), with the api's own names held to `apps/api/` by `within`. It carves out `apps/web/` and `packages/design-system/` on its own row, because the word there is the SPA's own zone, not the tier.

## Related

- `docs/plans/2026-10-02-2325-docs-glossary-in-the-readers-words-plan.md`: KTD1 (178), KTD5 (201-208), KTD6 (209-215), KTD7 (216), KTD8 (217), KTD15 (233), R12 (93), R21 and R22 (102-103), U7 (543-571), Appendix G (1001-1023).
- `docs/solutions/architecture-patterns/adr-0047-the-platform-is-surfaces-groups-and-screens.md`, amended by the same plan.
- `CONCEPTS.md:5-7`, the preamble that defines `_Internal._` and `_Code rename pending._`.
