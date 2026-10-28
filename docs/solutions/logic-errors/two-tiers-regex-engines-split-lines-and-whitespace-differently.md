---
title: "The two tiers' regex engines split lines and whitespace differently, so an ASCII fixture hides a divergence"
date: 2026-10-09
category: logic-errors
module: contracts
problem_type: logic_error
component: tier-contract
severity: medium
applies_when:
  - "Changing the concept-body reader for links or citation marks in either tier"
  - "Adding a case to `contracts/links/cases.json`, or any regex both the api and the worker run"
  - "Seeing the api's map and the worker's rebuild name different edge ids for one body"
symptoms:
  - "One concept body made a LINKS_TO edge in the api's live map and none in the worker's full rebuild, or the reverse, and every later link on that body took a different ordinal, so the two maps named different edge ids"
  - "Both tiers' suites passed `contracts/links/cases.json`, because every case was ASCII text broken by line feeds"
  - "Found only by an adversarial review that ran both readers on bodies holding a lone carriage return, U+2028, U+FEFF and U+0085"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - map
  - worker
tags:
  - tier-contract
  - regex
  - unicode
  - multiline
  - whitespace
  - case-folding
  - links
  - cross-tier
retire_when: "the two tiers stop each implementing the concept-body reader, for example if the worker reads the api's derived edges instead of deriving its own"
---

# The two tiers' regex engines split lines and whitespace differently, so an ASCII fixture hides a divergence

## Problem

The api (TypeScript) and the worker (Python) each read a concept body's links and citation marks, and `contracts/links` holds both to one fixture. Both readers were written with the same-looking regular expressions and string calls, but JavaScript and Python give those different meanings outside ASCII and the line feed. A body holding one of the differing characters makes different edges in the live map and in the rebuild.

## Symptoms

- A footnote definition after a lone `\r` or a U+2028 counted in TypeScript and not in Python. Since S2a U2, whether a footnote takes a link ordinal depends on its definition, so every later link renumbered and its `links_to:<iri>:<ordinal>` id differed between the tiers.
- A citation mark labelled `[^﻿a]` matched source id `a` in TypeScript and not in Python. A label holding U+0085 split the other way.
- Both suites stayed green, because no fixture case held any of these characters.

## What Didn't Work

- **A shared fixture alone.** It proves the two tiers agree on the inputs it lists, and only those. Every case was ASCII prose broken by `\n`, so it could not reach the characters on which the engines differ.
- **Mutation testing.** StrykerJS over the TypeScript reader and hand probes on the Python one both confirmed that the tests constrain each reader. Neither compares one tier with the other, so neither could see the split.

## Solution

Both readers now state the line and whitespace rules explicitly, without relying on either engine's defaults (this PR, S2a U2):

- **Lines break at `\n` alone.** At S2a U2 the TypeScript patterns dropped the `m` flag and anchored with `(?<=^|\n)`, and Python anchored with `(?:^|(?<=\n))` without `re.M`. A later fix, "read a concept body in one walk", replaced every expression with a hand-written scanner that keeps the rule: a line starts at the string's start or after a `\n` (`lineStartFrom` in `packages/schema/src/knowledge/concept-file.ts`; `_line_start_from` in `apps/worker/src/better_answers_worker/concepts/links.py`).
- **Whitespace is `[ \t\n\r\f\v]`.** That set, `isAsciiWhitespace` (`packages/schema/src/knowledge/scan.ts`) and `_TIER_SHARED_WHITESPACE`, replaces `\s`, `\S`, `trim()` and `strip()` in labels, definitions and inline targets (`normalisedLabel`, `targetAfter` and `INLINE_TARGET` in `concept-file.ts`; `_normalised_label`, `_target_after` and `_INLINE_TARGET` in `links.py`).
- **The fixture pins each difference.** `contracts/links/cases.json` gains *only plain whitespace is trimmed from a label* (U+FEFF, U+0085) and *a definition starts only after a line feed* (a lone `\r`, U+2028). Both were shown to fail against the earlier readers before the fix.
- **An edge's heading and sentence follow the same rules.** A LINKS_TO edge stores the heading above its link and the sentence around it. Those readers kept `\s`, `trim()` and `strip()` after this fix, and the TypeScript heading pattern's `.` also stopped at `\r` and U+2028, so a CRLF heading was null in the live map and named in the rebuild. They now use the same set and line rule, and both make each whitespace run one space (`sectionAt` and `sentenceAt`, `packages/core/src/store/map/sentence.ts`; `_section_at` and `_sentence_at`, `links.py`). Collapsing the heading also hides the one place the tiers count characters differently: a code span is blanked one space per UTF-16 unit in TypeScript and per code point in Python, so an emoji in a heading's code span left five spaces in one tier and six in the other. Each link in `contracts/links/cases.json` carries its `section` and `sentence`, and three cases hold these characters in a heading and a sentence.
- **A blank line is a line of whitespace.** A paragraph ended only at `\n\n`, so in a CRLF body the line between two paragraphs held a `\r`, and a link's sentence ran on into the heading above it. Both tiers agreed, so no id split, but the stored sentence was wrong. A line of the body that holds only the six whitespace characters now ends a paragraph, and *a line of whitespace is a blank line* pins it. The line is read in the body, not the prose: the prose blanks a code span to spaces, so a line holding only a code span would end the paragraph, and *a line holding only a code span is no blank line* pins that.
- **A scheme is ASCII, with no ignore-case flag.** The scheme tests read `[a-z]` under `/i` and `re.I`. Python folds the Kelvin sign (U+212A), the long s (U+017F), the dotted capital I (U+0130) and the dotless i (U+0131) into that class, and JavaScript's `/i` without `u` folds only ASCII. So the worker read `<Ka:b>` with a Kelvin sign as an autolink, took an ordinal for it and renumbered every later link, and kept a source resource with such a scheme unresolved, which changed its content hash. Each tier now writes `[A-Za-z]` with no flag (`SCHEMED` in `scan.ts` and `concept_file.py`, and the autolink scanner's classes). *An autolink's scheme is ASCII alone* in `contracts/links` and the Kelvin case in `contracts/concept-file` pin it.
- **Trim with a loop or a split, not a lazy group before a trailing class.** A first draft trimmed the heading with `([^\n]*?)[ \t\n\r\f\v]*$`. The lazy group and the trailing class backtrack against each other, so a heading holding 32,000 spaces, which a blanked code span produces, took 3.8 s in Python and 0.7 s in Node. Both `reader-linear` suites now hold a heading of 80,000 spaces to one second.

```ts
// before: m-flag ^ also starts a line after \r, U+2028 and U+2029; \s and trim() follow JS's table
const LINK_DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*(\S+)/gm;
label.trim().replaceAll(/\s+/g, " ").toLowerCase();

// after, at S2a U2; the one-walk fix later replaced the expression with a scanner over the same six
const LINK_DEFINITION = /(?<=^|\n) {0,3}\[([^\]]+)\]:[ \t\n\r\f\v]*([^ \t\n\r\f\v]+)/g;
label.split(/[ \t\n\r\f\v]+/).filter((word) => word !== "").join(" ").toLowerCase();
```

## Why This Works

The two engines disagree in four places, checked on Node 24 and Python 3:

| | JavaScript | Python |
| --- | --- | --- |
| `^` under multiline | starts a line after `\n`, `\r`, U+2028, U+2029 | after `\n` alone (`re.M`) |
| `\s` | includes U+FEFF, excludes U+001C–U+001F and U+0085 | the reverse |
| `trim()` / `strip()` | strips U+FEFF, keeps U+0085 | the reverse |
| `[a-z]` ignoring case | ASCII alone with `/i`; with `/iu`, also U+212A and U+017F | also U+212A, U+017F, U+0130 and U+0131 (`re.I`) |

An explicit class and an explicit `\n` anchor mean the same in both engines, so the readers agree on every input rather than on the ones a fixture happens to list.

One difference is left: `toLowerCase()` and `str.lower()` follow each runtime's Unicode tables, so a letter newer than the older runtime's tables can still fold differently. Folding only A–Z would remove it, but would also stop non-ASCII labels from matching regardless of case. That choice was left open.

## Prevention

- When both tiers implement one reader of tenant text, write its rules as explicit character classes and anchors. Never lean on `\s`, `\S`, `^`/`$` under a multiline flag, `trim()`/`strip()`, `split()` with no separator, or an ignore-case flag on a letter class. Each engine defines those its own way.
- Give a cross-tier text fixture at least one case per class of character the engines disagree on: a lone `\r`, a CRLF, U+2028, U+FEFF, U+0085, a C0 separator such as U+001F, and a letter that folds to ASCII, such as U+212A or U+017F. Write the fixture with JSON `\u` escapes so the characters stay visible in review.
- Show that a new case fails against the earlier reader on both tiers before trusting it. A case both tiers already agree on proves nothing about the split.
- When mutation-testing a module from another workspace, run it from that module's own workspace. StrykerJS reads `mutate` relative to its project and will not instrument `packages/schema/src/knowledge/concept-file.ts` from a run started in `packages/core`. This run used the `command` test runner from `packages/schema`, whose command drove core's contract tests.

## Related

- `docs/solutions/architecture-patterns/adr-0031.md`: the tier contract, and why each tier holds its own code to the fixture.
- `docs/solutions/architecture-patterns/adr-0015.md`: what a citation mark is.
