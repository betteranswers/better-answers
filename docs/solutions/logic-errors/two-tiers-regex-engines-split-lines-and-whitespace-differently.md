---
title: "The two tiers' regex engines split lines and whitespace differently, so an ASCII fixture hides a divergence"
date: 2026-10-09
category: logic-errors
module: contracts
problem_type: logic_error
component: tier-contract
severity: medium
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

- **Lines break at `\n` alone.** The TypeScript patterns drop the `m` flag and anchor with `(?<=^|\n)` and `(?=\n|(?![\s\S]))` (`packages/schema/src/concept-file.ts:30`, `:37`). Python anchors with `(?:^|(?<=\n))` without `re.M` (`apps/worker/src/better_answers_worker/links.py:27`, `:42`). Python's look-behind must be fixed width, so its form uses an alternation outside the look-behind.
- **Whitespace is `[ \t\n\r\f\v]`.** That class replaces `\s`, `\S`, `trim()` and `strip()` in labels, definitions and inline targets (`concept-file.ts:94`, `links.py:52`, `links.py:100`).
- **The fixture pins each difference.** `contracts/links/cases.json` gains *only plain whitespace is trimmed from a label* (U+FEFF, U+0085) and *a definition starts only after a line feed* (a lone `\r`, U+2028). Both were shown to fail against the earlier readers before the fix.

```ts
// before: m-flag ^ also starts a line after \r, U+2028 and U+2029; \s and trim() follow JS's table
const LINK_DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*(\S+)/gm;
label.trim().replaceAll(/\s+/g, " ").toLowerCase();

// after
const LINK_DEFINITION = /(?<=^|\n) {0,3}\[([^\]]+)\]:[ \t\n\r\f\v]*([^ \t\n\r\f\v]+)/g;
label.split(/[ \t\n\r\f\v]+/).filter((word) => word !== "").join(" ").toLowerCase();
```

## Why This Works

The two engines disagree in three places, checked on Node 24 and Python 3:

| | JavaScript | Python |
| --- | --- | --- |
| `^` under multiline | starts a line after `\n`, `\r`, U+2028, U+2029 | after `\n` alone (`re.M`) |
| `\s` | includes U+FEFF, excludes U+001C–U+001F and U+0085 | the reverse |
| `trim()` / `strip()` | strips U+FEFF, keeps U+0085 | the reverse |

An explicit class and an explicit `\n` anchor mean the same in both engines, so the readers agree on every input rather than on the ones a fixture happens to list.

One difference is left: `toLowerCase()` and `str.lower()` follow each runtime's Unicode tables, so a letter newer than the older runtime's tables can still fold differently. Folding only A–Z would remove it, but would also stop non-ASCII labels from matching regardless of case. That choice was left open.

## Prevention

- When both tiers implement one reader of tenant text, write its rules as explicit character classes and anchors. Never lean on `\s`, `\S`, `^`/`$` under a multiline flag, `trim()`/`strip()` or `split()` with no separator. Each engine defines those its own way.
- Give a cross-tier text fixture at least one case per class of character the engines disagree on: a lone `\r`, U+2028, U+FEFF, U+0085 and a C0 separator such as U+001F. Write the fixture with JSON `\u` escapes so the characters stay visible in review.
- Show that a new case fails against the earlier reader on both tiers before trusting it. A case both tiers already agree on proves nothing about the split.
- When mutation-testing a module from another workspace, run it from that module's own workspace. StrykerJS reads `mutate` relative to its project and will not instrument `packages/schema/src/concept-file.ts` from a run started in `packages/core`. This run used the `command` test runner from `packages/schema`, whose command drove core's contract tests.

## Related

- `docs/solutions/architecture-patterns/adr-0031-tier-contract-is-six-agreements.md`: the tier contract, and why each tier holds its own code to the fixture.
- `docs/solutions/architecture-patterns/adr-0015-compositions-cite-concepts-by-footnote.md`: what a citation mark is.
