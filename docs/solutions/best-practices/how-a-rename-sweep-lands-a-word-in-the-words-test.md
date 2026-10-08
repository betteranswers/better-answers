---
title: "How a rename adds its old word to the words test"
date: 2026-10-03
last_updated: 2026-10-08
category: best-practices
module: apps/api
problem_type: best_practice
component: testing-framework
severity: medium
applies_when:
  - "A pull request renames a word the glossary defines, and adds the old word's row to apps/api/tests/old-words.ts"
  - "Adding or changing a permitted sense, a carve-out, a reads list or a reach on a row of the old-words list"
  - "Reviewing a pull request's diff of old-words.ts or CONCEPTS.md"
  - "Adding a row for a shared word, such as check or class, whose first scan finds hundreds of lines in other senses"
  - "Widening the reach of a row the list already holds"
  - "Changing a glossary word whose code follows later, in a block's rename batch"
  - "Writing a plain-verb sense for a shared word, or a second row for its plural"
symptoms:
  - "Several mistakes in a row pass the words test without a finding: a sense regex without the g flag, a carve-out on a reader-text row, a plural under a one-sense row"
  - "A one-sense row for a common English word reports hundreds of findings in other senses"
  - "Widening a reader-text row fails planted fixtures that used it as their reader-text example"
  - "A plain-verb sense written as the determiners it excludes passes a noun with a word between, such as 'a live act on the same bundle'"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
related_components:
  - development-workflow
tags:
  - words-test
  - old-words
  - rename
  - glossary
  - carve-out
  - reader-text
---

# How a rename adds its old word to the words test

## Context

The words test, `apps/api/tests/avoid-words.test.ts`, refuses each word in `apps/api/tests/old-words.ts` where its row's reach says. A rename lands in two steps (ADR 0047, amended 08/10/2026). The glossary entry, the text on pages, live docs and the row land first, the row reading reader text alone, with its `sweep` naming the block whose batch renames the code. That block's batch renames every remaining occurrence and widens the row in its own pull request. The row needs no state beyond its reach and its `sweep`. BA-29 renamed the platform's words in sweeps, each with a pending phase, a ratchet and a glossary mark; all of that is gone. What stays is how the scan reads a row, and the mistakes that pass it in silence.

**A row** (`OldWord` in `old-words.ts`): `word`, `use` (the word to write), `entry` (the glossary head it sits under), `sweep` (the rename that replaced it, named in each finding), `reach`, and optional `why`, `permitted`, `carvedOut` and `reads`. `listFaults` keeps the list sorted case-insensitively, one row per word, each under a head the glossary has.

**The reach decides which scan reads a row:**

| reach | Read by | Matches |
|---|---|---|
| `"everywhere"` | the line scan of every tracked file, `lineFindings` | any form: plurals, camelCase, snake_case, hyphens (`findsIn` with `anyForm`, `wordsOfCompounds`) |
| `"one sense"` | the same line scan | the whole word only, any case |
| `"reader text"` | reader strings only, `readerFindings`, in the files `READER_TEXT` names | any form |

**Rows to copy:** the api row (`app`: one sense, `APP_SENSES`, its own carve-outs), `Better Answers` (one sense, `reads: isCodeAPersonReads`), the audit log row (`ledger`: everywhere, with senses), the audit action row (everywhere, no senses), the trust words (reader text), `Unchecked` (widened from reader text to everywhere), and `check` (one sense, held by `reads:` to the files that write the trust event).

## Guidance

### The procedure

1. **Before each step, prove the old word gone from what that step's row reads.** When the reader-text row lands, prove it gone from reader text, and search live docs by hand, since a reader-text row never reads them (trap 1). When the batch widens the row, prove it gone in every form. Search case-insensitively for plurals and compounds too. A one-sense row matches the whole word alone (trap 2), so this search is the only proof that its plural, and every compound name holding it, are gone.

2. **Add the row where it sorts,** in the pull request that changes the glossary entry. While the code waits for a block's batch, the row reads reader text and its `sweep` names that block's batch. The same pull request names the batch in that block's lines in the route spec, as P1's lines name the `UserId` rename, so the block's planner finds it. The batch then sets the reach it keeps: everywhere for a word with no other sense, one sense for a word other senses share, reader text for a word only a page must not write.

3. **Give it the senses it keeps.** A `Sense` has a `sense` label, a `written` regex and an optional `within` path prefix. `lineScanOf` blanks every permitted match whose `within` the file path starts with, and every kept name, then tries the word again.
   - Add `within` when one tree alone writes the sense, as the api's own names for its tier are held to `apps/api/` and the cost ledger's contract to `contracts/cost-ledger/`.
   - An everywhere row may carry senses too. The difference between the two reaches is how the word is matched, not whether senses apply.
   - Give every regex the `g` flag. `blankedBy` uses `String.replace`, so a regex without `g` blanks the first use on a line and leaves a second one to be read as the old word.
   - Names on the wire and in storage need no sense, because they reach the scan as kept names (step 5).
   - A reader-text row takes no senses. `readerFindings` reads only `rows` and `kept`, so `permitted`, `carvedOut` and `reads` on such a row do nothing.

4. **Leave the dated plans to the global carve-out.** `CARVED_OUT` in `avoid-words.test.ts` holds `writtenBefore("2026-10-08")`, so a plan or dogfood report dated before 08/10/2026 keeps the words of its day (R22). One dated later is read for every row, so a plan written after a rename writes the new word. A rename whose old word is in a plan or dogfood report dated from the cutoff up to its own merge, its own plan included, moves the date in `writtenBefore` to its merge day in the same pull request, and never edits the plan. When the code follows in a block's batch, that is the batch's pull request, which widens the row: a reader-text row never reads a plan, so a date moved at the glossary change protects nothing. A file with no dated name falls back to `"9999"` and is read. A row's own `carvedOut` holds for that row alone; `CarveOut.why` is required, and no carve-out ever holds a `CODING_STANDARDS.md`.

5. **Never rename a stored or wire name.** R21 and R22 keep them. They pass because `keptNamesUnder` reads them from where each is declared: refusal words; MCP entry names, scopes and schema keys and values; Better Auth's endpoints; the stored-names register's action names; stored action names from `audit-actions.ts`; old page addresses from `movedFrom`. Migrations and their snapshots pass through the global `CARVED_OUT`. The stored-names register, `packages/core/src/audit/stored-names.ts`, sits in `CARVED_OUT` too, so a stored detail key's literal is allowed there alone and code elsewhere writes `STORED_DETAIL_KEYS.<name>`. A kept name that is one plain word counts as code only when quoted or backticked (`keptPatternsOf`), so prose writing the same word is still read. In reader text, a string that is a kept name whole is skipped. A renamed table's derived names are refused in the database by `packages/schema/test/renamed-names.test.ts`.

6. **Prove the row with a planted case, and watch it fail.** Plant the old word where the row must refuse it and where a sense must pass it, and expect only the first set. Widening a sense, or adding a tree to a `within`, turns it red. The whole-tree scan cannot catch a sense that is too broad: it fails only when a sense is too narrow.

### Traps the test does not report

1. **A reader-text row is never line-scanned.** `lineFindings` drops it. The row refuses the word in `READER_TEXT` files alone, never in docs or identifiers. To refuse the word in code or CSS too, widen the row's reach (trap 5).
2. **A one-sense row matches the whole word alone.** `findsIn` without `anyForm` is `(?<!\w)word(?!\w)`, so a plural or a compound passes, and `_` is a word character, so a snake_case name holding the word passes too. Search the word's own trees for `[a-z]Word`, `Word[A-Z]`, `_word` and `word_` by hand.
3. **A lone lowercase word is read only in a words module.** `isRead` reads it only when the file matches `WORDS_MODULE`. A string such as `"member"` in `navigation.ts`, an MCP entry, the answer renderer or an email is invisible to the reader-text and internal-word checks. The test fails loudly only when a whole source of reader text yields no string (`readerStringsPerSource`) or a reader-text file does not parse. Losing one words module among several trips neither.
4. **An internal head is watched on pages.** `internalFindings` refuses an `_Internal._` head's word in reader text unless `NOT_WATCHED_ON_PAGES` lists it as ordinary English. `INTERNAL_HEADS` (`apps/api/tests/internal-heads.ts`) fails the test when a listed head loses its mark, so retiring or renaming an internal entry edits that list in the same change.
5. **Widening a reader-text row to everywhere breaks the planted fixtures that borrowed it.** `Unchecked` was reader text alone, so the old colour tokens `--trust-unchecked-*` passed. Its row was widened to everywhere with `UNCHECKED_SENSES` (TypeScript's `noUncheckedIndexedAccess`), and the planted tests that used the live row as their reader-text example failed, because the row now read their CSS line too. Pin such fixtures to a reader-text copy of the row (`CHECKED_IN_READER_TEXT`).

### A shared word that is mostly other senses

BA-29 held *run*, *act*, *domain*, *client*, *hit*, *screen* and *surface* to senses fitted across the whole tree: thousands of lines for *run* alone, a list of trees that never write the renamed thing, a plain-verb sense per word. On 08/10/2026 the owner moved *run*, *client*, *hit*, *screen* and *surface* to reader text, and made *route*, *graph* and *bind* avoided words with no row. *act* and *domain* kept their senses, because a page says "act as you" and "testing domain" in their other senses, and a reader-text row has no senses to pass them. The lesson is to choose the narrow road first:

1. **Count, then take the road to the owner.** Add the row locally with the obvious senses, run the words test and count what is left. For *check*, three senses left 885 findings in about 200 files, almost none of them the trust event. Fitting senses across the tree is a scope decision, so take the count to the owner with a recommendation.
2. **Prefer reader text or `reads:`.** A row held by `reads:` to the files that write the renamed sense is refused there alone and keeps every other sense elsewhere; the line scan ANDs `reads` with the carve-outs. `check`, `class`, `candidate`, `repair` and `inbox` are held that way. A `reads` list passes silently if it names the wrong files, so plant the word in one of them and see the finding.
3. **When senses are fitted, fit them to the test's own findings.** Save the failing run's lines, and blank them with the row's senses in a throwaway script that imports `OLD_WORDS`, so each edit costs a second. Keep the renamed thing's own phrases out of every sense: "first run" and "failed run" are the commonest ways to write a sync.
4. **Name the words that make the verb, never the words that make the noun.** A plain-verb sense that blanked *act on* unless a determiner came directly before it passed every noun with a word between: "a live act on the same bundle". List what makes the verb instead, a modal or pronoun before it, or a subject before the plural, as `ACTS_AS_A_VERB` does, and match the verb in lower case so a label such as "Acts for {name}" stays refused.
5. **A one-sense row and an everywhere row for the plural still miss a singular compound.** The *acts* row reads everywhere and finds `declareActs`, but `anyFormOf` wants the plural `s`, so `declareAct` passes both rows. The row's `why` says so, and the proof that none remain is a grep outside the words test (`rg -P '[a-z]Act\b|\bAct[A-Z]|_act\b|\bact_'`; on macOS, `git grep -E` ignores `\b`).

## Why This Matters

The words test is the one gate that refuses an old word once its rename has merged (R12), and it keeps stored history (R22). Most mistakes in a row pass in silence: a missing `g`, a carve-out on a reader-text row, a plural under a one-sense row, a `reads` list naming the wrong files. The ones that fail loudly tempt the wrong fix. An old plan edited to pass breaks R22, and a wire name renamed to pass breaks the assistants R21 protects.

## When to Apply

- In each pull request that renames a word the glossary defines.
- On any change to `old-words.ts`.
- When reviewing such a change. Check the diff for `g` on every new sense, `within` where one tree writes a sense, a planted case for every new sense, and no row added ahead of its code rename unless it reads reader text alone and its `sweep` names the block whose batch renames the code.

## Examples

**A row for a word with no other sense:**

```ts
{
  word: "ledger act",
  use: "audit action",
  entry: "audit action",
  sweep: "audit log",
  reach: "everywhere",
},
```

**A one-sense row to copy:** the api row holds its senses in `APP_SENSES`, with the api's own names held to `apps/api/` by `within`. It carves out `apps/web/` and `packages/design-system/` on its own row, because the word there is the SPA's own zone, not the tier.

**A row held to the files of its sense:** the `candidate` row reads only `SUGGESTION_KIND_FILES`, so a candidate under test keeps its word everywhere else.

## Related

- `docs/plans/2026-10-02-2325-docs-glossary-in-the-readers-words-plan.md`: the BA-29 plan, with R12, R21 and R22.
- `docs/solutions/best-practices/renaming-a-table-drizzle-kit-will-not-generate-so-the-migration-and-snapshot-are-written-by-hand.md`: the migration a rename of a stored name needs.
- `CONCEPTS.md`'s preamble, which defines `_Internal._`.
