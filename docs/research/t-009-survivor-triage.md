# T-009 — packages/core survivor triage, 2026-09-07

The baseline the weekly mutation report is read against. Source: the first green core
leg (run 34128668967, score 76.37% — 1,481 Killed + 9 Timeout of 1,951 mutants). Every
one of the 461 Survived/NoCoverage mutants was walked by an agent against the current
source and tests; per-module reports follow, verbatim. `[TEST6]` holds: this is a
report, never a gate — its verdicts feed hardening tickets, not CI.

Verdicts: **must-kill** — the mutation changes observable behaviour at a seam that
matters; a missing test is a real gap. **worth-killing** — real behaviour, lower
stakes; kill when touching the area. **noise** — cosmetic. **equivalent** — cannot
change observable behaviour.

| Module group | mutants | must-kill | worth-killing | noise | equivalent |
| --- | --- | --- | --- | --- | --- |
| answering | 139 | 109 | 13 | 9 | 8 |
| store (git · postgres · graph doors) | 163 | 48 | 81 | 12 | 22 |
| workspaces + audit + kernel | 68 | 53 | 9 | 2 | 4 |
| concepts + members | 91 | 36 | 41 | 13 | 1 |
| **total** | **461** | **246** | **144** | **36** | **35** |

Two caveats from the walk:

- `src/store/git/index.ts` was edited by T-054 (`e97fb04`) after the Stryker run; the
  store report re-anchored every mutant to HEAD by code context, so its line numbers
  are current. A few of its Survived verdicts look stale against existing assertions
  (flagged inline) — the next weekly run confirms them before test effort is spent.
- `answering`'s "draft"/"removed" status text in `trustOf` is dead code by
  construction (non-published concepts never reach it), not a gap — confirmed against
  the read predicate; details in the answering report.

---

# answering — survivor triage
Counts: must-kill 109 · worth-killing 13 · noise 9 · equivalent 8 (of 139)

File: `packages/core/src/answering/index.ts`. Covering tests: `packages/core/test/answering.test.ts` (unit-level renderings and type-only checks on the four acts), `packages/core/test/concepts.test.ts` (`open`/`trustOf`/shelf-life integration via a real Postgres-backed workspace), `packages/core/test/suggestions.test.ts` (incidental `open` calls through a helper).

## Untested branches (from the NoCoverage clusters)

- **`find` and `renderFind` — the whole find/preview path (ids 54, 55, 248–254).** `find` always returns `ok({query, hits: []})`; `renderFind` turns a `FindResult` into the "Nothing matches"/one-line-per-hit preview. Neither is ever called at runtime by any test — `find` is only referenced through a compile-time `expectTypeOf`, and `renderFind` isn't imported into `answering.test.ts` at all. Deserves tests: yes, both are exported, user-facing acts.
- **"machine-confirmed" tier and the "imported" rider (ids 65, 70).** `trustOf` derives tier `"machine-confirmed"` when a check exists but its actor isn't a person, and rider `"imported"` when a check carries no content hash. No test ever creates a non-person check or a hash-less check, so both output strings are never produced. Deserves tests: yes — these are named, documented trust states (CONTEXT.md) with no coverage at all.
- **`ask` and `giveFeedback` — literal bodies never executed (ids 236–243, 245, 246).** Both are only exercised through `expectTypeOf`, never awaited and asserted on at runtime. Deserves tests: yes.
- **`open`'s locator-not-found short-circuit (ids 219–222) and the render of "No passage at …" (ids 265, 266).** `open` is never called with `{ locator }` anywhere in the test suite — only `{ iri }`. The entire passage-by-locator input mode is unexercised. Deserves tests: yes, it's a documented second form of `open` (ADR 0018).
- **`renderOpen`'s concept markdown — by far the largest single gap (ids 276–302, 27 mutants).** The `# title`, body, trust caption and evidence-list formatting (including the title-vs-iri fallback and the evidence-present/absent join) has zero coverage; `renderOpen` is only ever tested with a `passage` result or a `found:false` result, never a real `concept`. Deserves tests: yes, urgently — this is the primary "show me a concept" rendering a reader sees.
- **`renderFeedback`'s "flagged as X" detail-less path (id 361).** Every existing test supplies a `detail`; the no-detail phrasing is unexercised (see also survived id 359, same gap).
- **`pastShelfLife`'s offset-datetime impossible-day guard (id 165)**, and **`evidenceOf`'s citedSource-filtered-out path (ids 196, 205)** — fold into the same gaps flagged by survived mutants 163 and 194/206 below; no separate action needed beyond those.
- **id 93 ("draft" status text) is dead code, not a gap** — see equivalence note below.

## Must-kill shortlist

- **`packages/core/src/answering/index.ts:213-224` (trustOf, ids 57, 67)** — mutator ConditionalExpression/ConditionalExpression. Forcing `checkedAt` to always be `null`, and forcing the `"imported"` rider to never fire, both survive. `concepts.test.ts`'s "reads a person's check…" test (~line 1206) only asserts `toMatchObject({ tier, status, checkedBy })`, never `checkedAt` — add an exact `checkedAt` assertion and a second scenario with a hash-less (`contentHash: null`) verification row to prove the `imported` rider.
- **`packages/core/src/answering/index.ts:225-228` (trustOf's status ternary, ids 80, 81, 82, 84)** — the `deprecated`/`removed`/`draft` status derivation. No test ever opens a concept whose `status` is `"deprecated"` (the only reachable non-`"current"`, non-shelf-life status — `"removed"` and `"draft"` concepts never reach `trustOf` at all, since their `publishedAt` is nulled at write time and `readableClause` filters on `published_at IS NOT NULL`, `packages/core/src/concepts/index.ts:659` and `packages/core/src/access/index.ts:52`). Add a `concepts.test.ts` case that writes a stable concept, deprecates it, opens it, and asserts `trust.status === "deprecated"`.
- **`packages/core/src/answering/index.ts:301-318` (evidenceOf, ids 191, 194, 206, 208, 209, 212, 214)** — `answering.test.ts`'s only concept-opening tests either supply no `sources[]` at all (the SHELF_LIVES table, 10 cases, none of which assert `evidence`) or a single plain-string source that always has a title. Nothing exercises: a source `citedSource` can't resolve (should be filtered out), or an object-form source whose `title` is absent/empty (should fall back to `cited.resource`). Add cases to the "opening a concept by IRI" describe block in `concepts.test.ts`.
- **`packages/core/src/answering/index.ts:328-337` (open, ids 217, 225)** — `open` is never called with `{ locator }` (id 217, whole early-return branch dead in tests), and the "concept not found" guard (id 225) survives because `concepts.test.ts`'s own assertion (`absent.ok && absent.value.found`) can't tell a legitimate `found: false` from a thrown error — both short-circuit to `false`. Assert `absent).toEqual({ ok: true, value: { found: false, iri: ... }})` instead, and add an `open(principal, tx, { locator: "..." })` case.
- **`packages/core/src/answering/index.ts:387-414` (renderOpen, ids 260, 267, and all 27 NoCoverage ids 276-302)** — no test ever renders a real `concept` result; only `passage` and `found:false` are covered. Add a `renderOpen({ found: true, concept: {...} })` case asserting the markdown shape (title line, body, trust caption, evidence block present/absent), plus a `renderOpen({ found: false, iri: "..." })` case for the "No concept at …" message.
- **`packages/core/src/answering/index.ts:429-445` (renderAnswer, ids 316, 318-321, 327-330, 332-336, 338, 339, 342, 344)** — the `warn` verdict phrase is never rendered; citation line content/numbering is never asserted (both existing tests skip past the citations line); and the three `lines.push` guards (body text suppressed on refuse, citations shown only when non-empty, unmapped shown only when non-empty) are only exercised in the direction that happens to be a no-op either way. Add a `verdict: "warn"` case, a case with 2+ citations asserting the rendered `[1]`/`[2]` lines, and assertions that an `ok` answer's `result.text` appears while a `refuse` answer's does not.
- **`packages/core/src/answering/index.ts:52-53, 357-361, 372-376, 379-384` (find/ask/giveFeedback/renderFind, ids 52, 53, 235, 244, 247)** — `NOT_ANSWERED`'s own text is only checked by interpolating the same live constant back into the expectation (self-referential, can never fail); `find`, `ask` and `giveFeedback` are only checked with `expectTypeOf` (compile-time), never awaited and asserted at runtime. Add runtime assertions with a hardcoded expected string/object for each.
- **`packages/core/src/answering/index.ts:247-248` (CALENDAR_DATE/OFFSET_DATETIME regexes, ids 101, 109, 110, 126, 128, 130)** — anchor removal (101, 109, 110) and offset sign/digit character-class inversions (126, 128, 130) all survive. The inversions are masked because the only explicit-offset SHELF_LIVES case (`"3000-01-01T00:00:00+01:00"`) expects `"current"` regardless of whether it's parsed correctly or rejected outright. Add a *past* explicit-offset case (e.g. `"2020-01-01T00:00:00+01:00"` expecting `"out-of-date"`) and a garbage-prefixed string (e.g. `"not-a-date2026-01-01"`) to pin the anchors.
- **`packages/core/src/answering/index.ts:449-460` (REASON_WORDS / renderFeedback, ids 347, 349, 350, 359)** — only the `"out-of-date"` reason and a with-detail flag are ever rendered; `"wrong"`, `"incomplete"`, `"should-not-have-shown"` and the detail-less phrasing are all unverified. Add one case per reason word, plus a detail-less flag case.

## Full table

| file:line | status | mutator | replacement (truncated) | verdict | why (one clause) |
| --- | --- | --- | --- | --- | --- |
| index.ts:71 | NoCoverage | StringLiteral | `""` | worth-killing | human-reviewed's `checkedBy ?? "a person"` fallback never exercised; invariant-protected in production |
| index.ts:71 | NoCoverage | StringLiteral | `"Stryker was here!"` | worth-killing | same fallback text, different literal target |
| index.ts:201 | NoCoverage | ObjectLiteral | `{}` | must-kill | `find()` never runtime-invoked/asserted, only type-checked |
| index.ts:201 | NoCoverage | ArrayDeclaration | `["Stryker was here"]` | must-kill | same — `find()`'s `hits: []` literal never asserted |
| index.ts:221 | NoCoverage | StringLiteral | `""` | must-kill | "machine-confirmed" tier text never produced by any test |
| index.ts:222 | NoCoverage | StringLiteral | `""` | must-kill | "imported" rider text never produced by any test |
| index.ts:226 | NoCoverage | StringLiteral | `""` | must-kill | "deprecated" status text: no test opens a deprecated concept |
| index.ts:228 | NoCoverage | StringLiteral | `""` | equivalent | "draft" status is dead code — draft concepts never reach `trustOf` (publishedAt nulled, filtered by readableClause) |
| index.ts:283 | NoCoverage | BooleanLiteral | `true` | worth-killing | offset-datetime impossible-day guard, same gap as survived id163 |
| index.ts:310 | NoCoverage | ArrayDeclaration | `["Stryker was here"]` | must-kill | citedSource-undefined filter-out path never exercised |
| index.ts:314 | NoCoverage | StringLiteral | `"Stryker was here!"` | must-kill | same evidence-loop cluster, locator fallback text |
| index.ts:333 | NoCoverage | ObjectLiteral | `{}` | must-kill | `open()` never called with `{ locator }` |
| index.ts:333 | NoCoverage | BooleanLiteral | `true` | must-kill | same — locator-not-found branch dead in tests |
| index.ts:333 | NoCoverage | LogicalOperator | `input.locator && ""` | must-kill | same cluster |
| index.ts:333 | NoCoverage | StringLiteral | `"Stryker was here!"` | must-kill | same cluster |
| index.ts:362-370 | NoCoverage | ObjectLiteral | `{}` | must-kill | `ask()` never runtime-invoked/asserted |
| index.ts:363 | NoCoverage | StringLiteral | `""` | must-kill | same — `ask()`'s verdict literal |
| index.ts:365 | NoCoverage | ArrayDeclaration | `["Stryker was here"]` | must-kill | same — citations literal |
| index.ts:366 | NoCoverage | ArrayDeclaration | `["Stryker was here"]` | must-kill | same — conflicts literal |
| index.ts:367 | NoCoverage | ObjectLiteral | `{}` | must-kill | same — coverage literal |
| index.ts:368 | NoCoverage | ArrayDeclaration | `["Stryker was here"]` | must-kill | same — unmappedPassages literal |
| index.ts:369 | NoCoverage | ObjectLiteral | `{}` | must-kill | same — map literal |
| index.ts:369 | NoCoverage | StringLiteral | `""` | must-kill | same — map.state literal |
| index.ts:376 | NoCoverage | ObjectLiteral | `{}` | must-kill | `giveFeedback()` never runtime-invoked/asserted |
| index.ts:376 | NoCoverage | StringLiteral | `""` | must-kill | same — outcome literal |
| index.ts:380 | NoCoverage | ConditionalExpression | `true` | must-kill | `renderFind()` never called by any test |
| index.ts:380 | NoCoverage | ConditionalExpression | `false` | must-kill | same |
| index.ts:380 | NoCoverage | EqualityOperator | `!== 0` | must-kill | same |
| index.ts:381 | NoCoverage | StringLiteral | `""` | must-kill | same — empty-hits message |
| index.ts:383 | NoCoverage | ArrowFunction | `() => undefined` | must-kill | same — hit-line formatter |
| index.ts:383 | NoCoverage | StringLiteral | `` `` `` | must-kill | same |
| index.ts:384 | NoCoverage | StringLiteral | `""` | must-kill | same — join separator |
| index.ts:390 | NoCoverage | StringLiteral | `""` | must-kill | "No passage at …" message, locator-not-found path untested |
| index.ts:391 | NoCoverage | StringLiteral | `` `` `` | must-kill | "No concept at …" message untested |
| index.ts:401 | NoCoverage | ConditionalExpression | `true` | must-kill | renderOpen's concept branch never reached by any test |
| index.ts:401 | NoCoverage | ConditionalExpression | `false` | must-kill | same |
| index.ts:401 | NoCoverage | EqualityOperator | `!== undefined` | must-kill | same |
| index.ts:401 | NoCoverage | StringLiteral | `""` | must-kill | same — "Nothing to show." message |
| index.ts:404 | NoCoverage | ConditionalExpression ×2 | `true`/`false` | must-kill | title-vs-iri fallback, concept branch untested |
| index.ts:404 | NoCoverage | EqualityOperator | `!== "string"` | must-kill | same |
| index.ts:404 | NoCoverage | StringLiteral ×3 | `""` | must-kill | same |
| index.ts:405 | NoCoverage | ArrowFunction | `() => undefined` | must-kill | evidence-line formatter, concept branch untested |
| index.ts:405 | NoCoverage | StringLiteral ×2 | `` `` ``/`""` | must-kill | same |
| index.ts:406-413 | NoCoverage | ArrayDeclaration | `[]` | must-kill | whole markdown-lines array, concept branch untested |
| index.ts:407 | NoCoverage | StringLiteral | `` `` `` | must-kill | `# title` line |
| index.ts:408 | NoCoverage | StringLiteral | `"Stryker was here!"` | must-kill | body placeholder line |
| index.ts:410 | NoCoverage | StringLiteral | `"Stryker was here!"` | must-kill | body line |
| index.ts:411 | NoCoverage | StringLiteral | `` `` `` | must-kill | trust caption line |
| index.ts:412 | NoCoverage | ConditionalExpression ×2 | `true`/`false` | must-kill | evidence-present/absent guard |
| index.ts:412 | NoCoverage | EqualityOperator | `!== ""` | must-kill | same |
| index.ts:412 | NoCoverage | StringLiteral ×3 | various | must-kill | same |
| index.ts:412 | NoCoverage | ArrayDeclaration ×2 | `[]`/`["Stryker..."]` | must-kill | same |
| index.ts:413 | NoCoverage | StringLiteral | `""` | must-kill | join separator, evidence block |
| index.ts:460 | NoCoverage | StringLiteral | `"Stryker was here!"` | must-kill | detail-less flag phrasing untested |
| index.ts:65-66 | Survived | ConditionalExpression | `case "current":` | noise | ambiguous AST target on the switch's terminal case; likely no-op but unconfirmed |
| index.ts:65 | Survived | StringLiteral | `""` | equivalent | `"current"` is the switch's last case; emptying its label leaves no case matching, same fall-through as the original `break` |
| index.ts:71 | Survived | ConditionalExpression | `false` | worth-killing | forces the date-suffix branch even when `checkedAt` is null; combination is invariant-protected in production `trustOf` output |
| index.ts:82 | Survived | ConditionalExpression | `false` | worth-killing | skips the invalid-ISO-date guard in `ukLongDate`; no malformed-date input tested |
| index.ts:215 | Survived | ConditionalExpression | `true` | must-kill | forces `checkedAt` to always be null; test uses `toMatchObject` and never asserts it |
| index.ts:222 | Survived | ConditionalExpression | `false` | must-kill | "imported" rider never produced by any test |
| index.ts:225 | Survived | ConditionalExpression | `false` | must-kill | disables the "deprecated" status arm; no test opens a deprecated concept |
| index.ts:225 | Survived | LogicalOperator | `&&` for `\|\|` | must-kill | same — deprecated arm effectively unreachable under `&&` |
| index.ts:225 | Survived | ConditionalExpression | `false` | must-kill | same cluster, second conditional node |
| index.ts:225 | Survived | StringLiteral | `""` | must-kill | "deprecated" string literal blanked, same cluster |
| index.ts:225 | Survived | ConditionalExpression | `false` | noise | likely targets the dead "removed" arm; can't confirm precisely without column data |
| index.ts:225 | Survived | StringLiteral | `""` | noise | same — likely the "removed" string literal |
| index.ts:227 | Survived | ConditionalExpression | `false` | equivalent | "draft" status arm is dead code (draft concepts never reach `trustOf`) |
| index.ts:227 | Survived | StringLiteral | `""` | equivalent | same — "draft" string literal, dead code |
| index.ts:259 | Survived | MethodExpression | `setUTCMinutes(0,0,0,0)` | equivalent | epoch `new Date(0)` already has zero UTC time fields; either call is a no-op |
| index.ts:261 | Survived | LogicalOperator | `(A&&B)\|\|C` | must-kill | proven distinguishing case: an invalid month (e.g. `13`) rolls the year, but a coincidentally-matching day makes the OR-relaxed condition wrongly true |
| index.ts:261 | Survived | ConditionalExpression | `true` (year check) | noise | single-operand force-true inside an `&&` chain; other real comparisons still gate most invalid inputs, not proven equivalent for all |
| index.ts:261 | Survived | LogicalOperator | `(A\|\|B)&&C` | noise | couldn't hand-construct a distinguishing invalid-date input for this variant |
| index.ts:261 | Survived | ConditionalExpression | `true` (month check) | noise | same family as above |
| index.ts:261 | Survived | ConditionalExpression | `true` (day check) | noise | same family as above |
| index.ts:261 | Survived | ConditionalExpression | `true` (combined) | noise | same family as above |
| index.ts:277 | Survived | ConditionalExpression | `false` | worth-killing | bypasses the `typeof staleAfter !== "string"` guard; masked because the only non-string input tested (`undefined`) still fails the regex match either way |
| index.ts:283 | Survived | ConditionalExpression | `false` | noise | bypasses the offset-datetime impossible-day guard; likely masked by `new Date(iso)`'s own strict ISO rejection of invalid calendar days, not fully certain across engines |
| index.ts:285 | Survived | EqualityOperator | `<=` for `<` | worth-killing | offset-datetime exact-"now" boundary untested |
| index.ts:291 | Survived | ConditionalExpression | `true` | equivalent | bypasses `midnight !== undefined`, but `undefined + ONE_DAY_MS` is `NaN` and `NaN <= x` is always false — same outcome |
| index.ts:291 | Survived | EqualityOperator | `<` for `<=` | worth-killing | calendar-date exact-boundary ("lasts through the day") untested |
| index.ts:302 | Survived | ArrayDeclaration | `["Stryker was here"]` | must-kill | non-array `sources` produces a bogus placeholder array; SHELF_LIVES tests never assert `evidence` |
| index.ts:310 | Survived | ConditionalExpression | `false` | must-kill | citedSource-undefined filter-out path never exercised (no malformed source entry tested) |
| index.ts:311 | Survived | ConditionalExpression | `false` | equivalent | `typeof entry === "string"` forced false, but `entry["title"]` on a string entry is `undefined` too — same result either way |
| index.ts:311 | Survived | StringLiteral | `""` | equivalent | same reasoning, `typeof entry === ""` is always false |
| index.ts:315 | Survived | ConditionalExpression | `true` | must-kill | title-vs-resource fallback for citation source label, untested |
| index.ts:315 | Survived | LogicalOperator | `\|\|` for `&&` | must-kill | same cluster |
| index.ts:315 | Survived | ConditionalExpression | `true` | must-kill | same cluster |
| index.ts:315 | Survived | ConditionalExpression | `true` | must-kill | same cluster |
| index.ts:315 | Survived | StringLiteral | `"Stryker was here!"` | must-kill | same cluster |
| index.ts:333 | Survived | ConditionalExpression | `false` | must-kill | `open()` never called with `{ locator }` |
| index.ts:336 | Survived | ConditionalExpression | `false` | must-kill | concept-not-found guard bypass would throw; test's `ok && found` pattern can't distinguish a thrown error from a legitimate not-found |
| index.ts:389 | Survived | ConditionalExpression | `true` | must-kill | "No concept at {iri}." message never asserted, only the locator variant is |
| index.ts:393 | Survived | ConditionalExpression | `true` | must-kill | renderOpen's concept branch never reached by any test |
| index.ts:432 | Survived | StringLiteral | `""` | must-kill | "warn" verdict phrase never rendered/tested |
| index.ts:435 | Survived | ArrowFunction | `() => undefined` | must-kill | citations line content never asserted |
| index.ts:435 | Survived | StringLiteral | `` `` `` | must-kill | same cluster |
| index.ts:435 | Survived | ArithmeticOperator | `i - 1` | must-kill | citation numbering off-by-one undetected |
| index.ts:435 | Survived | StringLiteral | `""` | must-kill | same cluster |
| index.ts:440 | Survived | StringLiteral | `""` | worth-killing | multi-passage join separator untested (only one unmapped passage ever used) |
| index.ts:442 | Survived | ConditionalExpression | `false` | must-kill | refuse-suppresses-text guard unverified (neither direction asserted) |
| index.ts:442 | Survived | ConditionalExpression | `true` | must-kill | same cluster |
| index.ts:442 | Survived | EqualityOperator | `===` for `!==` | must-kill | same cluster |
| index.ts:442 | Survived | StringLiteral | `""` | must-kill | same cluster |
| index.ts:442 | Survived | StringLiteral | `"Stryker was here!"` | must-kill | same cluster |
| index.ts:443 | Survived | ConditionalExpression | `true` | must-kill | citations-guard unverified (neither direction asserted) |
| index.ts:443 | Survived | EqualityOperator | `===` for `!==` | must-kill | same cluster |
| index.ts:443 | Survived | ConditionalExpression | `false` | must-kill | same cluster |
| index.ts:443 | Survived | StringLiteral | `"Stryker was here!"` | must-kill | same cluster |
| index.ts:443 | Survived | StringLiteral | `"Stryker was here!"` | must-kill | same cluster |
| index.ts:444 | Survived | ConditionalExpression | `true` | must-kill | unmapped-passages guard unverified for the suppress-when-empty direction |
| index.ts:444 | Survived | StringLiteral | `"Stryker was here!"` | must-kill | same cluster |
| index.ts:444 | Survived | StringLiteral | `"Stryker was here!"` | must-kill | same cluster |
| index.ts:460 | Survived | ConditionalExpression | `false` | must-kill | detail-less flag renders literal "undefined" text, untested |
| index.ts:172 | Survived | StringLiteral | `""` | must-kill | `NOT_ANSWERED` blanked; test compares against the same live symbol, so it's structurally blind to the mutation |
| index.ts:197-201 | Survived | ArrowFunction | `() => undefined` | must-kill | `find()` never runtime-invoked/asserted, only type-checked |
| index.ts:247 | Survived | Regex | anchor `^` removed | must-kill | CALENDAR_DATE loses its start anchor; no prefixed-garbage input tested |
| index.ts:248 | Survived | Regex | anchor `^` removed | must-kill | OFFSET_DATETIME loses its start anchor |
| index.ts:248 | Survived | Regex | anchor `$` removed | must-kill | OFFSET_DATETIME loses its end anchor |
| index.ts:248 | Survived | Regex | `(\.\d+)?`→`(\.\d)?` | worth-killing | fractional-seconds narrowed to one digit; narrow real-world impact |
| index.ts:248 | Survived | Regex | `(\.\d+)?`→`(\.\D+)?` | worth-killing | fractional-seconds digit class inverted; narrow impact |
| index.ts:248 | Survived | Regex | `[+-]`→`[^+-]` | must-kill | inverts the offset-sign class, breaking real `+`/`-` offsets; masked because the only explicit-offset test expects "current" either way |
| index.ts:248 | Survived | Regex | offset hour `\d{2}`→`\d:` | worth-killing | offset-hour narrowed to one digit; narrow impact |
| index.ts:248 | Survived | Regex | offset hour `\d{2}`→`\D{2}` | must-kill | inverts offset-hour digit class, same masking as the sign-class mutant above |
| index.ts:248 | Survived | Regex | offset minute `\d{2}`→`\d:` | worth-killing | offset-minute narrowed to one digit; narrow impact |
| index.ts:248 | Survived | Regex | offset minute `\d{2}`→`\D{2}` | must-kill | inverts offset-minute digit class, same masking |
| index.ts:357-370 | Survived | ArrowFunction | `() => undefined` | must-kill | `ask()` never runtime-invoked/asserted, only type-checked |
| index.ts:372-376 | Survived | ArrowFunction | `() => undefined` | must-kill | `giveFeedback()` never runtime-invoked/asserted, only type-checked |
| index.ts:379-384 | Survived | ArrowFunction | `() => undefined` | must-kill | `renderFind()` never called by any test |
| index.ts:449 | Survived | StringLiteral | `""` | must-kill | "wrong" reason word untested — the most common feedback reason |
| index.ts:451 | Survived | StringLiteral | `""` | must-kill | "incomplete" reason word untested |
| index.ts:452 | Survived | StringLiteral | `""` | must-kill | "should not have been shown" reason word untested |

### Settled by T-103 (2026-09-08)

- index.ts:225 ("removed" arm, "likely") and index.ts:227-228 ("draft" arm) — already resolved: `trustOf`'s status derivation on the current tree (`answering/index.ts`, `trustOf`, ~256-279) has no "removed" or "draft" case at all, only `deprecated` / `out-of-date` / `changed-since-checked` / `current`. The dead arms these rows named were removed by an earlier change; nothing left to remove or prove.
- index.ts:259 (`setUTCMinutes`/`setUTCHours(0,0,0,0)` on `new Date(0)`) — removed: the epoch's UTC time is already midnight and `setUTCFullYear` never touches the time-of-day fields, so the call was a no-op. Deleted from `utcMidnight` (~297-312), with a one-line comment in its place.
- index.ts:283 (the offset-datetime impossible-day guard, "not fully certain") — reclassified must-kill, and already killed: `new Date("2026-02-30T00:00:00Z")` does not go Invalid in this runtime, it rolls forward to 2 March — checked directly against Node's Date parser — so the guard is load-bearing, not masked by anything. `concepts.test.ts`'s `SHELF_LIVES` table already carries "an impossible calendar day with an offset" (`2026-02-30T00:00:00Z` expecting `"current"`), added after this report's baseline run; the original hedge is resolved and the row is not a survivor against the suite as it stands. A corrective comment sits beside the guard in `pastShelfLife` (~328-339).
- index.ts:291 (`midnight !== undefined`) — proved in a comment, not removed: unlike 283, this branch has no second, more lenient parse to fall through to, so dropping the check would still answer `false` by `NaN` propagation (`undefined + ONE_DAY_MS` is `NaN`, and every comparison with `NaN` is `false`). Kept as the clearer form; comment beside it in `pastShelfLife` (~344-348).
- index.ts:311 (`typeof entry === "string"`) — proved in a comment: a string entry has no `"title"` property either way, so the two branches of the ternary agree; the check exists for the type (`entry["title"]`'s object-shaped access), not because the branches ever differ. Comment in `evidenceOf` (~367-372).
- index.ts:65 and 65-66 (`"current"`, the trust switch's terminal case) — equivalent by construction, no code to touch: `"current"` is the last case and the switch's fall-through answers the same word, so emptying the label or dropping the case changes no answer. Recorded, not commented: the switch's shape is the proof and a comment would restate it (review round, 2026-09-09).
- index.ts:261 (the year/month/day force-true cluster, "couldn't hand-construct a distinguishing input") — proved in a comment, hedged rather than overclaimed: JS's own calendar rollover of an invalid year/month/day usually moves more than one of `utcMidnight`'s three checks at once (a month of 13 changes the year too; a day of 0 or 32 changes the month and sometimes the year), so relaxing one clause alone rarely flips the verdict. Not proven for every calendar combination, only tried against representative ones — the comment says so plainly rather than claiming a proof this ticket did not do. In `utcMidnight` (~302-308).

---

# store — survivor triage
Counts: must-kill 48 · worth-killing 81 · noise 12 · equivalent 22 (of 163)

A caveat before the detail: `packages/core/src/store/git/index.ts` was edited by T-054 (commit `e97fb04`) after this Stryker run — its report's line numbers are stale by a constant +3 offset from that commit's 3-line insertion (corrected below by matching each mutant's code context against the current file, not by trusting the JSON's `line` field). A few mutants in `git/index.ts` and `graph/index.ts` — noted individually — look like they *should* be killed by an existing, specific assertion (the `Suggestion:` trailer test, the SUPERSEDES/DERIVED_FROM succession test, the path/IRI link-resolution tests) but are reported Survived; this may mean the Stryker run predates those tests, or a per-mutant fluke. Flagged as must-kill regardless — a re-run would settle it either way.

## Must-kill shortlist

- `packages/core/src/store/git/index.ts:249` — StringLiteral mutant 1207: isBundlePath's `malformed-path` refusal on writes is untested. Covering test: no test in concepts.test.ts. Missing assertion: add a test that writes with a leading-slash or `..`-segment path and asserts `{ ok: false, error: "malformed-path" }`.
- `packages/core/src/store/git/index.ts:144` — OptionalChaining mutant 1123: removing the stdin `.end()` call stops blob content ever reaching `git hash-object --stdin`. Covering test: concepts.test.ts's content assertions (surprising this survives). Missing assertion: re-run this mutant directly to confirm; if it truly survives, the existing 'writes the file to the bundle...' test needs strengthening.
- `packages/core/src/store/git/index.ts:206` — ArrayDeclaration mutant 1156: the `Suggestion:` trailer tuple, mutated away. Covering test: suggestions.test.ts 'mints the concept, lands its rows...' (asserts `Suggestion: set.suggestionIds[0]`). Missing assertion: likely a stale report (file changed after the run) — re-run Stryker to confirm the assertion still kills it.
- `packages/core/src/store/git/index.ts:229` — ConditionalExpression mutant 1174: isBundlePath's whole guard forced true — the bundle traversal guard. Covering test: no test. Missing assertion: write a path with `..`, a leading `/`, or an empty segment and assert the commit refuses.
- `packages/core/src/store/git/index.ts:231` — ArrowFunction mutant 1188: the bad-segment predicate becomes `() => undefined`, disabling `.some()` entirely. Covering test: no test. Missing assertion: same as above — a single path-traversal test kills this whole cluster (1174–1202, 1206).
- `packages/core/src/store/git/index.ts:265` — ObjectLiteral mutant 1230: `read-tree`'s `GIT_INDEX_FILE` env dropped — commits would share the process's index instead of a per-commit temp one. Covering test: no direct assertion of index isolation. Missing assertion: a concurrent-commit test that checks each commit's tree is exactly what it should be, not polluted by another in-flight commit.
- `packages/core/src/store/git/index.ts:267` — ConditionalExpression mutant 1232: skips reading the parent's tree — an edit-commit would drop every file except the one just written. Covering test: no test commits two different files across two commits and checks both survive. Missing assertion: commit file A, then commit file B, and assert the tree at B's sha still contains A.
- `packages/core/src/store/git/index.ts:353` — BlockStatement mutant 1281: the per-workspace lock registry's cleanup on exit — without it the map leaks a key per workspace, or a waiter can be handed a stale entry. Covering test: the concurrency test proves ordering, never that the registry clears afterward. Missing assertion: assert the lock map holds no entry for a workspace once every queued write has resolved.
- `packages/core/src/store/postgres/index.ts:220` — LogicalOperator mutant 1735: `||`→`&&` on the malformed-claims guard — a request with exactly one malformed field (not both) would proceed instead of being refused. Covering test: the one 'refuses claims...' test passes both fields invalid at once. Missing assertion: add a case with a valid workspaceId and a malformed userId (and the reverse).
- `packages/core/src/store/postgres/index.ts:360` — EqualityOperator mutant 1806: the revocation-instant boundary `<`→`<=` at the exact issued-at-equals-revoked-at instant. Covering test: existing tests use ±1 second offsets either side, never the exact instant. Missing assertion: issue a credential at exactly the revocation instant and assert it is refused (or accepted — whichever the intended boundary is) explicitly.
- `packages/core/src/store/postgres/index.ts:457` — OptionalChaining mutant 1836: readWorkspaceConfig throws instead of returning undefined when no config row exists — the common, unset-key case. Covering test: the only readWorkspaceConfig test always seeds a value first. Missing assertion: call readWorkspaceConfig for a key nobody set and assert it resolves to `undefined` rather than throwing.
- `packages/core/src/store/graph/index.ts:375` — ConditionalExpression mutant 1577: supersedes() forced always-true — every lineage edge would land as SUPERSEDES regardless of the cited concept's real status/kind. Covering test: 'derives a succession over a deprecated concept...' (asserts one SUPERSEDES + one DERIVED_FROM). Missing assertion: likely a stale report — re-run Stryker; if it genuinely survives, the test needs a second assertion pass.
- `packages/core/src/store/graph/index.ts:467-468` — StringLiteral mutant 1634: the DELETE that clears a concept's stale outgoing edges before re-deriving them, replaced with a no-op query. Covering test: no test re-links (or un-links) an already-landed concept and checks the old edge is gone. Missing assertion: edit a concept's body to remove or change a link it already had, and assert the old graph_edge row is gone.
- `packages/core/src/store/graph/index.ts:573-575` — StringLiteral mutant 1664: the UPDATE that keeps an inbound LINKS_TO edge's denormalised `to_kind` column in sync when the target's kind changes, replaced with a no-op query. Covering test: no test changes a concept's kind after it already has inbound links. Missing assertion: re-commit a cited concept with a new `type`, then assert citing edges' `to_kind` reflects it.
- `packages/core/src/store/graph/index.ts:588` — ConditionalExpression mutant 1668: the SUPERSEDES-relabel trigger forced always-true — an ordinary edit to a still-stable cited concept could flip its citers' lineage label to SUPERSEDES. Covering test: no test re-commits a non-deprecating edit to a cited concept and checks citers stay DERIVED_FROM. Missing assertion: re-write a stable cited concept (title tweak, no status change) and assert its citer's lineage label is unchanged.

## Full table

### `packages/core/src/store/git/index.ts`

| file:line | status | mutator | replacement (truncated) | verdict | why (one clause) |
|---|---|---|---|---|---|
| `src/store/git/index.ts:140` | Survived | StringLiteral | `""` | worth-killing | LC_ALL=C locale-pinning for the stale-precondition regex is untested (would need a non-English git locale); real but environment-dependent and hard to test cheaply |
| `src/store/git/index.ts:141` | Survived | ArithmeticOperator | `64 * 1024 / 1024` | worth-killing | maxBuffer's arithmetic (64*1024*1024) is untested; a shrunk buffer only bites on very large git output, an edge/capacity concern |
| `src/store/git/index.ts:141` | Survived | ArithmeticOperator | `64 / 1024` | worth-killing | maxBuffer's arithmetic (64*1024*1024) is untested; a shrunk buffer only bites on very large git output, an edge/capacity concern |
| `src/store/git/index.ts:143` | Survived | ConditionalExpression | `true` | noise | forcing `child.child.stdin?.end(options.input)` to always run just calls `.end(undefined)` on commands that never read stdin — a harmless no-op for every current call site |
| `src/store/git/index.ts:144` | Survived | OptionalChaining | `child.child.stdin.end` | must-kill | removing the `.end(...)` call means blob content is never written to git's `hash-object --stdin`; on paper this should break every commit's file-content assertions (`writes the file to the bundle...` test) — flagging as surprising it survived and recommending the team re-verify this mutant directly |
| `src/store/git/index.ts:191` | Survived | ConditionalExpression | `true` | worth-killing | isSubjectLine's `length > 0` boundary (an empty commit message/trailer value) is untested; existing malformed-message tests use a forged newline, never an empty string |
| `src/store/git/index.ts:191` | Survived | EqualityOperator | `message.length >= 0` | worth-killing | isSubjectLine's `length > 0` boundary (an empty commit message/trailer value) is untested; existing malformed-message tests use a forged newline, never an empty string |
| `src/store/git/index.ts:205` | Survived | ArrayDeclaration | `[]` | noise | the `Run` trailer tuple is never given a real value in any test (no test sets `trailers.run`), so removing it is unobservable |
| `src/store/git/index.ts:205` | Survived | StringLiteral | `""` | noise | the `Run` trailer tuple is never given a real value in any test (no test sets `trailers.run`), so removing it is unobservable |
| `src/store/git/index.ts:206` | Survived | ArrayDeclaration | `[]` | must-kill | the `Suggestion` trailer tuple IS asserted with a real value in suggestions.test.ts (`Suggestion: set.suggestionIds[0]`) — this should kill the mutant; flagging as a likely-stale verdict (git/index.ts changed after the Stryker run landed — see T-054 commit e97fb04) and recommending a re-run before trusting the Survived status here |
| `src/store/git/index.ts:206` | Survived | StringLiteral | `""` | must-kill | the `Suggestion` trailer tuple IS asserted with a real value in suggestions.test.ts (`Suggestion: set.suggestionIds[0]`) — this should kill the mutant; flagging as a likely-stale verdict (git/index.ts changed after the Stryker run landed — see T-054 commit e97fb04) and recommending a re-run before trusting the Survived status here |
| `src/store/git/index.ts:207` | Survived | ArrayDeclaration | `[]` | worth-killing | the `Projection` trailer tuple's real-value path isn't exercised by the concept/suggestion test suites in this slice |
| `src/store/git/index.ts:207` | Survived | StringLiteral | `""` | worth-killing | the `Projection` trailer tuple's real-value path isn't exercised by the concept/suggestion test suites in this slice |
| `src/store/git/index.ts:209` | Survived | ArrayDeclaration | `["Stryker was here"]` | noise | an extra non-`Key: value` line in the raw commit message doesn't affect the trailers object any test parses and asserts on |
| `src/store/git/index.ts:229-231` | Survived | ConditionalExpression | `true` | must-kill | isBundlePath's guard is forced true/weakened — this is the traversal guard on where a governed write can put a file in the bundle's object graph |
| `src/store/git/index.ts:229-231` | Survived | LogicalOperator | `candidate.length > 0 && !candidate.startsWith("/") || !cand…` | must-kill | isBundlePath's guard is forced true/weakened — this is the traversal guard on where a governed write can put a file in the bundle's object graph |
| `src/store/git/index.ts:229-230` | Survived | ConditionalExpression | `true` | must-kill | isBundlePath's guard is forced true/weakened — this is the traversal guard on where a governed write can put a file in the bundle's object graph |
| `src/store/git/index.ts:229-230` | Survived | LogicalOperator | `candidate.length > 0 || !candidate.startsWith("/")` | must-kill | isBundlePath's guard is forced true/weakened — this is the traversal guard on where a governed write can put a file in the bundle's object graph |
| `src/store/git/index.ts:229` | Survived | ConditionalExpression | `true` | must-kill | isBundlePath's guard is forced true/weakened — this is the traversal guard on where a governed write can put a file in the bundle's object graph |
| `src/store/git/index.ts:229` | Survived | EqualityOperator | `candidate.length >= 0` | worth-killing | the `candidate.length >= 0` mutation is a no-op on its own (length is never negative) — only the empty-path rejection is lost, not the traversal guard itself |
| `src/store/git/index.ts:230` | Survived | MethodExpression | `candidate.endsWith("/")` | must-kill | flips the leading-slash check to a trailing-slash check, defeating the absolute-path guard entirely |
| `src/store/git/index.ts:231` | Survived | MethodExpression | `candidate.split("/").every(segment => segment === "" || seg…` | must-kill | flips `.some(bad segment)` to `.every(bad segment)` — a path with one `..` among safe segments would no longer be rejected |
| `src/store/git/index.ts:231` | Survived | ArrowFunction | `() => undefined` | must-kill | the segment predicate becomes `() => undefined`, so `.some()` is always false — the whole `..`/`.`/empty-segment guard is disabled |
| `src/store/git/index.ts:231` | Survived | ConditionalExpression | `false` | must-kill | each disables one clause of the bundle-path traversal guard (`..`, `.`, or empty-segment detection) — no test writes a path containing these segments to prove the guard still bites |
| `src/store/git/index.ts:231` | Survived | LogicalOperator | `(segment === "" || segment === ".") && segment === ".."` | must-kill | each disables one clause of the bundle-path traversal guard (`..`, `.`, or empty-segment detection) — no test writes a path containing these segments to prove the guard still bites |
| `src/store/git/index.ts:231` | Survived | ConditionalExpression | `false` | must-kill | each disables one clause of the bundle-path traversal guard (`..`, `.`, or empty-segment detection) — no test writes a path containing these segments to prove the guard still bites |
| `src/store/git/index.ts:231` | Survived | LogicalOperator | `segment === "" && segment === "."` | must-kill | each disables one clause of the bundle-path traversal guard (`..`, `.`, or empty-segment detection) — no test writes a path containing these segments to prove the guard still bites |
| `src/store/git/index.ts:231` | Survived | ConditionalExpression | `false` | must-kill | each disables one clause of the bundle-path traversal guard (`..`, `.`, or empty-segment detection) — no test writes a path containing these segments to prove the guard still bites |
| `src/store/git/index.ts:231` | Survived | StringLiteral | `"Stryker was here!"` | must-kill | each disables one clause of the bundle-path traversal guard (`..`, `.`, or empty-segment detection) — no test writes a path containing these segments to prove the guard still bites |
| `src/store/git/index.ts:231` | Survived | ConditionalExpression | `false` | must-kill | each disables one clause of the bundle-path traversal guard (`..`, `.`, or empty-segment detection) — no test writes a path containing these segments to prove the guard still bites |
| `src/store/git/index.ts:231` | Survived | StringLiteral | `""` | must-kill | each disables one clause of the bundle-path traversal guard (`..`, `.`, or empty-segment detection) — no test writes a path containing these segments to prove the guard still bites |
| `src/store/git/index.ts:231` | Survived | ConditionalExpression | `false` | must-kill | each disables one clause of the bundle-path traversal guard (`..`, `.`, or empty-segment detection) — no test writes a path containing these segments to prove the guard still bites |
| `src/store/git/index.ts:231` | Survived | StringLiteral | `""` | must-kill | each disables one clause of the bundle-path traversal guard (`..`, `.`, or empty-segment detection) — no test writes a path containing these segments to prove the guard still bites |
| `src/store/git/index.ts:249` | NoCoverage | StringLiteral | `""` | must-kill | the `malformed-path` refusal (isBundlePath rejecting the write) is never exercised by any test — nobody writes with a leading slash or a `..` segment |
| `src/store/git/index.ts:249` | Survived | ConditionalExpression | `false` | must-kill | confirms the `isBundlePath` refusal branch itself is never taken by any test (pairs with NoCoverage id 1207) |
| `src/store/git/index.ts:268` | Survived | ObjectLiteral | `{}` | must-kill | drops `GIT_INDEX_FILE` from `read-tree`'s env — commits would read/write the process's shared index instead of the per-commit temp index, breaking the one-act-one-commit isolation the git door exists for |
| `src/store/git/index.ts:270` | Survived | ConditionalExpression | `false` | must-kill | skips reading the parent's tree before writing — every edit-commit would drop every file except the one just written; a real data-loss bug, and no test currently proves the parent's tree is preserved across two edits to different files |
| `src/store/git/index.ts:270` | Survived | ObjectLiteral | `{}` | must-kill | same `read-tree` call loses its index-file env, corrupting the per-commit index isolation |
| `src/store/git/index.ts:307-316` | NoCoverage | BlockStatement | `{}` | must-kill | the commit function's entire catch block — where a mid-write git failure is told apart from a stale precondition — is never reached by any test; a real git failure here is currently unverified and mutating it to swallow silently still passes |
| `src/store/git/index.ts:312` | NoCoverage | ConditionalExpression | `true` | must-kill | the commit function's entire catch block — where a mid-write git failure is told apart from a stale precondition — is never reached by any test; a real git failure here is currently unverified and mutating it to swallow silently still passes |
| `src/store/git/index.ts:312` | NoCoverage | ConditionalExpression | `false` | must-kill | the commit function's entire catch block — where a mid-write git failure is told apart from a stale precondition — is never reached by any test; a real git failure here is currently unverified and mutating it to swallow silently still passes |
| `src/store/git/index.ts:312-314` | NoCoverage | BlockStatement | `{}` | must-kill | the commit function's entire catch block — where a mid-write git failure is told apart from a stale precondition — is never reached by any test; a real git failure here is currently unverified and mutating it to swallow silently still passes |
| `src/store/git/index.ts:313` | NoCoverage | StringLiteral | `""` | must-kill | the commit function's entire catch block — where a mid-write git failure is told apart from a stale precondition — is never reached by any test; a real git failure here is currently unverified and mutating it to swallow silently still passes |
| `src/store/git/index.ts:316-318` | Survived | BlockStatement | `{}` | worth-killing | the temp-index cleanup in `finally` is a resource-leak concern (accumulating temp dirs), not a correctness break |
| `src/store/git/index.ts:317` | Survived | BooleanLiteral | `false` | worth-killing | the temp-index cleanup in `finally` is a resource-leak concern (accumulating temp dirs), not a correctness break |
| `src/store/git/index.ts:353-358` | Survived | BlockStatement | `{}` | must-kill | the per-workspace lock registry's cleanup on exit; without it a waiter can be handed a stale lock or the map leaks a key per workspace forever — the concurrency test proves ordering but never asserts the registry is cleared afterward |
| `src/store/git/index.ts:357` | Survived | ConditionalExpression | `true` | must-kill | the per-workspace lock registry's cleanup on exit; without it a waiter can be handed a stale lock or the map leaks a key per workspace forever — the concurrency test proves ordering but never asserts the registry is cleared afterward |
| `src/store/git/index.ts:357` | Survived | ConditionalExpression | `false` | must-kill | the per-workspace lock registry's cleanup on exit; without it a waiter can be handed a stale lock or the map leaks a key per workspace forever — the concurrency test proves ordering but never asserts the registry is cleared afterward |
| `src/store/git/index.ts:357` | Survived | EqualityOperator | `locks.get(key) !== chained` | must-kill | the per-workspace lock registry's cleanup on exit; without it a waiter can be handed a stale lock or the map leaks a key per workspace forever — the concurrency test proves ordering but never asserts the registry is cleared afterward |
| `src/store/git/index.ts:357` | Survived | CallExpression | `;` | must-kill | the per-workspace lock registry's cleanup on exit; without it a waiter can be handed a stale lock or the map leaks a key per workspace forever — the concurrency test proves ordering but never asserts the registry is cleared afterward |

### `packages/core/src/store/graph/index.ts`

| file:line | status | mutator | replacement (truncated) | verdict | why (one clause) |
|---|---|---|---|---|---|
| `src/store/graph/index.ts:142` | Survived | Regex | `/ {0,3}\[([^\]]+)\]:\s*(\S+)/gm` | worth-killing | LINK_DEFINITION's line-anchor and whitespace-flexibility are untested edge cases (a definition-looking fragment mid-line, or zero/multiple spaces after the colon) |
| `src/store/graph/index.ts:142` | Survived | Regex | `/^ {0,3}\[([^\]]+)\]:\s(\S+)/gm` | worth-killing | LINK_DEFINITION's line-anchor and whitespace-flexibility are untested edge cases (a definition-looking fragment mid-line, or zero/multiple spaces after the colon) |
| `src/store/graph/index.ts:156` | Survived | Regex | `/^ {0,3}((`|~)\2)[^\n]*\n[\s\S]*?(?:^ {0,3}\1\2*[ \t]*$|(?!…` | worth-killing | FENCED_BLOCK's closing-fence variants (anchor, trailing-whitespace class) aren't distinguished by the one longer-closing-run test on file |
| `src/store/graph/index.ts:156` | Survived | Regex | `/^ {0,3}((`|~)\2{2,})[^\n]*\n[\s\S]*?(?: {0,3}\1\2*[ \t]*$|…` | worth-killing | FENCED_BLOCK's closing-fence variants (anchor, trailing-whitespace class) aren't distinguished by the one longer-closing-run test on file |
| `src/store/graph/index.ts:156` | Survived | Regex | `/^ {0,3}((`|~)\2{2,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1\2*[ \t]*|…` | worth-killing | FENCED_BLOCK's closing-fence variants (anchor, trailing-whitespace class) aren't distinguished by the one longer-closing-run test on file |
| `src/store/graph/index.ts:156` | Survived | Regex | `/^ {0,3}((`|~)\2{2,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1\2*[^ \t]*…` | worth-killing | FENCED_BLOCK's closing-fence variants (anchor, trailing-whitespace class) aren't distinguished by the one longer-closing-run test on file |
| `src/store/graph/index.ts:159` | Survived | StringLiteral | `""` | worth-killing | blanking to `""` instead of a same-length space breaks the documented 'index into the prose is an index into the file' offset invariant, even though nothing inside this module currently relies on it externally |
| `src/store/graph/index.ts:159` | Survived | ArrowFunction | `() => undefined` | worth-killing | replacing `blanked` with `() => undefined` would splice the literal string "undefined" into quoted/fenced regions — a real, visible bug no test's exact-body assertions happen to catch |
| `src/store/graph/index.ts:177` | Survived | ArrayDeclaration | `[]` | worth-killing | seeding a new per-length queue with `[]` instead of `[position]` loses the very run being processed from its own queue — a real span-pairing bug for a length's first occurrence |
| `src/store/graph/index.ts:184` | Survived | EqualityOperator | `at <= runs.length` | equivalent | the off-by-one bound admits one extra out-of-bounds loop iteration that immediately no-ops via the adjacent undefined-guard |
| `src/store/graph/index.ts:186` | Survived | ConditionalExpression | `false` | equivalent | `runs` is a dense array and `at` stays in-bounds, so `opener` is never undefined |
| `src/store/graph/index.ts:187` | NoCoverage | ArrayDeclaration | `["Stryker was here"]` | equivalent | every run-length seen in the file is already seeded into `queued` in the first pass, so `queued.get(...)` is never undefined when this line runs |
| `src/store/graph/index.ts:189` | Survived | EqualityOperator | `head <= queue.length` | equivalent | the off-by-one bound admits one extra out-of-bounds loop iteration that immediately no-ops via the adjacent undefined-guard |
| `src/store/graph/index.ts:191` | Survived | ConditionalExpression | `false` | worth-killing | the `position > at` lookahead bound (not just the undefined-guard) is real pairing logic the dedicated backtick test doesn't fully pin |
| `src/store/graph/index.ts:194` | Survived | CallExpression | `;` | worth-killing | dropping `heads.set(...)` stops per-length pairing progress from advancing, risking mis-pairing on repeated runs of one length |
| `src/store/graph/index.ts:195` | Survived | UnaryOperator | `+1` | worth-killing | the `-1` sentinel for 'no closer queued' becomes a real array index, which could wrongly pair an opener with an unrelated run |
| `src/store/graph/index.ts:210-211` | Survived | ArrowFunction | `() => undefined` | worth-killing | normalisedLabel's trim/collapse/case-fold pipeline has several untested sub-behaviours (case direction, multi-space collapsing, the collapse-to-space vs collapse-to-empty choice) |
| `src/store/graph/index.ts:211` | Survived | MethodExpression | `label.trim().replaceAll(/\s+/g, " ").toUpperCase()` | worth-killing | normalisedLabel's trim/collapse/case-fold pipeline has several untested sub-behaviours (case direction, multi-space collapsing, the collapse-to-space vs collapse-to-empty choice) |
| `src/store/graph/index.ts:211` | Survived | MethodExpression | `label` | worth-killing | normalisedLabel's trim/collapse/case-fold pipeline has several untested sub-behaviours (case direction, multi-space collapsing, the collapse-to-space vs collapse-to-empty choice) |
| `src/store/graph/index.ts:211` | Survived | Regex | `/\s/g` | worth-killing | normalisedLabel's trim/collapse/case-fold pipeline has several untested sub-behaviours (case direction, multi-space collapsing, the collapse-to-space vs collapse-to-empty choice) |
| `src/store/graph/index.ts:211` | Survived | Regex | `/\S+/g` | worth-killing | normalisedLabel's trim/collapse/case-fold pipeline has several untested sub-behaviours (case direction, multi-space collapsing, the collapse-to-space vs collapse-to-empty choice) |
| `src/store/graph/index.ts:211` | Survived | StringLiteral | `""` | worth-killing | normalisedLabel's trim/collapse/case-fold pipeline has several untested sub-behaviours (case direction, multi-space collapsing, the collapse-to-space vs collapse-to-empty choice) |
| `src/store/graph/index.ts:217` | NoCoverage | StringLiteral | `"Stryker was here!"` | equivalent | LINK_DEFINITION's two capture groups (`[^\]]+`, `\S+`) are mandatory, non-optional groups — always captured whenever the regex matches at all |
| `src/store/graph/index.ts:218` | Survived | ConditionalExpression | `true` | worth-killing | the 'first definition of a label wins' rule (repeated `[label]: target` lines) is untested |
| `src/store/graph/index.ts:219` | NoCoverage | StringLiteral | `"Stryker was here!"` | equivalent | LINK_DEFINITION's two capture groups (`[^\]]+`, `\S+`) are mandatory, non-optional groups — always captured whenever the regex matches at all |
| `src/store/graph/index.ts:219` | Survived | Regex | `/</` | worth-killing | the autolink `<...>` bracket-stripping regexes' anchors are untested edge cases |
| `src/store/graph/index.ts:219` | Survived | StringLiteral | `"Stryker was here!"` | worth-killing | the autolink `<...>` bracket-stripping regexes' anchors are untested edge cases |
| `src/store/graph/index.ts:219` | Survived | Regex | `/>/` | worth-killing | the autolink `<...>` bracket-stripping regexes' anchors are untested edge cases |
| `src/store/graph/index.ts:219` | Survived | StringLiteral | `"Stryker was here!"` | worth-killing | the autolink `<...>` bracket-stripping regexes' anchors are untested edge cases |
| `src/store/graph/index.ts:233` | Survived | OptionalChaining | `/\]\(\s*<?([^)\s>]+)/.exec(text)[1]` | worth-killing | removing `?.` before `[1]` would throw instead of returning undefined if `](` is present but the stricter inline-link regex still fails to match — an untested malformed-link shape |
| `src/store/graph/index.ts:234` | Survived | Regex | `/\[([^\]]*)\]\[([^\]]*)\]$/` | worth-killing | the reference-link regex's anchors are untested edge cases |
| `src/store/graph/index.ts:234` | Survived | Regex | `/^\[([^\]]*)\]\[([^\]]*)\]/` | worth-killing | the reference-link regex's anchors are untested edge cases |
| `src/store/graph/index.ts:238` | NoCoverage | StringLiteral | `"Stryker was here!"` | equivalent | the reference regex's groups are `[^\]]*` — always captured (possibly empty), never undefined |
| `src/store/graph/index.ts:238` | Survived | ConditionalExpression | `false` | worth-killing | the reference-link match branch's true/false path and label selection have an untested sub-case |
| `src/store/graph/index.ts:238` | Survived | StringLiteral | `"Stryker was here!"` | worth-killing | the reference-link match branch's true/false path and label selection have an untested sub-case |
| `src/store/graph/index.ts:272` | NoCoverage | StringLiteral | `"Stryker was here!"` | equivalent | `String.split` always returns at least one element, so `[0]` is never undefined |
| `src/store/graph/index.ts:273` | Survived | ConditionalExpression | `false` | worth-killing | an empty-fragment-only target (e.g. a bare `#anchor` with nothing before it) is untested |
| `src/store/graph/index.ts:273` | Survived | StringLiteral | `"Stryker was here!"` | worth-killing | an empty-fragment-only target (e.g. a bare `#anchor` with nothing before it) is untested |
| `src/store/graph/index.ts:277` | Survived | ConditionalExpression | `false` | worth-killing | the external-scheme / protocol-relative detection in targetOf is well covered overall (coveredBy=28) but these specific sub-branches (case sensitivity, scheme character class, the `//host` check) aren't individually pinned |
| `src/store/graph/index.ts:277` | Survived | LogicalOperator | `/^[a-z][a-z0-9+.-]*:/i.test(bare) && bare.startsWith("//")` | worth-killing | the external-scheme / protocol-relative detection in targetOf is well covered overall (coveredBy=28) but these specific sub-branches (case sensitivity, scheme character class, the `//host` check) aren't individually pinned |
| `src/store/graph/index.ts:277` | Survived | Regex | `/[a-z][a-z0-9+.-]*:/i` | worth-killing | the external-scheme / protocol-relative detection in targetOf is well covered overall (coveredBy=28) but these specific sub-branches (case sensitivity, scheme character class, the `//host` check) aren't individually pinned |
| `src/store/graph/index.ts:277` | Survived | Regex | `/^[^a-z][a-z0-9+.-]*:/i` | worth-killing | the external-scheme / protocol-relative detection in targetOf is well covered overall (coveredBy=28) but these specific sub-branches (case sensitivity, scheme character class, the `//host` check) aren't individually pinned |
| `src/store/graph/index.ts:277` | Survived | Regex | `/^[a-z][a-z0-9+.-]:/i` | worth-killing | the external-scheme / protocol-relative detection in targetOf is well covered overall (coveredBy=28) but these specific sub-branches (case sensitivity, scheme character class, the `//host` check) aren't individually pinned |
| `src/store/graph/index.ts:277` | Survived | Regex | `/^[a-z][^a-z0-9+.-]*:/i` | worth-killing | the external-scheme / protocol-relative detection in targetOf is well covered overall (coveredBy=28) but these specific sub-branches (case sensitivity, scheme character class, the `//host` check) aren't individually pinned |
| `src/store/graph/index.ts:277` | Survived | MethodExpression | `bare.endsWith("//")` | worth-killing | the external-scheme / protocol-relative detection in targetOf is well covered overall (coveredBy=28) but these specific sub-branches (case sensitivity, scheme character class, the `//host` check) aren't individually pinned |
| `src/store/graph/index.ts:283` | Survived | MethodExpression | `body` | worth-killing | searching the whole body for a heading instead of only the text before the link is untested with more than one heading in a document |
| `src/store/graph/index.ts:284` | Survived | ArithmeticOperator | `lines.length + 1` | equivalent | the two out-of-bounds starting iterations this produces immediately fall through via `lines[at] ?? ""` never matching, reaching the same first real heading |
| `src/store/graph/index.ts:285` | NoCoverage | StringLiteral | `"Stryker was here!"` | equivalent | `lines[at]` is always in-bounds inside its own loop, and the heading regex's capture group is always present when the regex matches |
| `src/store/graph/index.ts:285` | Survived | Regex | `/#{1,6}\s+(.*)$/` | worth-killing | the heading regex's level range (only a single `#` is exercised by any test) and anchor/quantifier variants are untested |
| `src/store/graph/index.ts:285` | Survived | Regex | `/^#{1,6}\s+(.*)/` | worth-killing | the heading regex's level range (only a single `#` is exercised by any test) and anchor/quantifier variants are untested |
| `src/store/graph/index.ts:285` | Survived | Regex | `/^#\s+(.*)$/` | worth-killing | the heading regex's level range (only a single `#` is exercised by any test) and anchor/quantifier variants are untested |
| `src/store/graph/index.ts:285` | Survived | Regex | `/^#{1,6}\s(.*)$/` | worth-killing | the heading regex's level range (only a single `#` is exercised by any test) and anchor/quantifier variants are untested |
| `src/store/graph/index.ts:286` | NoCoverage | StringLiteral | `"Stryker was here!"` | equivalent | `lines[at]` is always in-bounds inside its own loop, and the heading regex's capture group is always present when the regex matches |
| `src/store/graph/index.ts:286` | Survived | MethodExpression | `heading[1] ?? ""` | worth-killing | dropping `.trim()` on a heading's captured text is untested (no heading with trailing whitespace in the fixtures) |
| `src/store/graph/index.ts:306` | Survived | ConditionalExpression | `false` | worth-killing | the paragraph-boundary math (`lastIndexOf`/`indexOf` on the blank-line separator) has untested edge cases beyond a single mid-body paragraph |
| `src/store/graph/index.ts:306` | Survived | UnaryOperator | `+1` | worth-killing | the paragraph-boundary math (`lastIndexOf`/`indexOf` on the blank-line separator) has untested edge cases beyond a single mid-body paragraph |
| `src/store/graph/index.ts:308` | Survived | ConditionalExpression | `true` | worth-killing | the paragraph-boundary math (`lastIndexOf`/`indexOf` on the blank-line separator) has untested edge cases beyond a single mid-body paragraph |
| `src/store/graph/index.ts:313` | Survived | Regex | `/[.!?](?=\s)/g` | worth-killing | sentenceAt's boundary loop and final formatting are only exercised by single-sentence paragraphs; a multi-sentence paragraph around a link is untested, so the loop body, its else-branch and the final trim/flatten steps all survive |
| `src/store/graph/index.ts:313-319` | Survived | BlockStatement | `{}` | worth-killing | sentenceAt's boundary loop and final formatting are only exercised by single-sentence paragraphs; a multi-sentence paragraph around a link is untested, so the loop body, its else-branch and the final trim/flatten steps all survive |
| `src/store/graph/index.ts:314` | NoCoverage | ArithmeticOperator | `boundary.index - 1` | worth-killing | the 'a sentence boundary was found before the link's position' branch of sentenceAt is untested — every current test's link sits in the paragraph's first (or only) sentence |
| `src/store/graph/index.ts:314` | Survived | ConditionalExpression | `false` | worth-killing | sentenceAt's boundary loop and final formatting are only exercised by single-sentence paragraphs; a multi-sentence paragraph around a link is untested, so the loop body, its else-branch and the final trim/flatten steps all survive |
| `src/store/graph/index.ts:314` | Survived | EqualityOperator | `boundary.index <= at` | worth-killing | sentenceAt's boundary loop and final formatting are only exercised by single-sentence paragraphs; a multi-sentence paragraph around a link is untested, so the loop body, its else-branch and the final trim/flatten steps all survive |
| `src/store/graph/index.ts:315-318` | Survived | BlockStatement | `{}` | worth-killing | sentenceAt's boundary loop and final formatting are only exercised by single-sentence paragraphs; a multi-sentence paragraph around a link is untested, so the loop body, its else-branch and the final trim/flatten steps all survive |
| `src/store/graph/index.ts:320` | Survived | MethodExpression | `flattenedLinks(paragraph.slice(start, end)).replaceAll(/\s+…` | worth-killing | sentenceAt's boundary loop and final formatting are only exercised by single-sentence paragraphs; a multi-sentence paragraph around a link is untested, so the loop body, its else-branch and the final trim/flatten steps all survive |
| `src/store/graph/index.ts:320` | Survived | MethodExpression | `paragraph` | worth-killing | sentenceAt's boundary loop and final formatting are only exercised by single-sentence paragraphs; a multi-sentence paragraph around a link is untested, so the loop body, its else-branch and the final trim/flatten steps all survive |
| `src/store/graph/index.ts:346` | Survived | ArrayDeclaration | `["Stryker was here"]` | noise | a malformed `sources[]` entry likely gets filtered by citedSourceOf immediately after, making this fallback's effect hard to observe either way |
| `src/store/graph/index.ts:348` | Survived | ConditionalExpression | `false` | worth-killing | lineage target-resolution's undefined-target short-circuits are untested with an actually-unresolvable cited resource |
| `src/store/graph/index.ts:349` | NoCoverage | ArrayDeclaration | `["Stryker was here"]` | worth-killing | a lineage citation whose resource resolves to nothing (an unrecognised/external resource in sources[]) is untested |
| `src/store/graph/index.ts:349` | Survived | ConditionalExpression | `false` | worth-killing | lineage target-resolution's undefined-target short-circuits are untested with an actually-unresolvable cited resource |
| `src/store/graph/index.ts:375` | Survived | ConditionalExpression | `true` | must-kill | supersedes() decides SUPERSEDES vs DERIVED_FROM (ADR 0019's trust/successor rule) and forcing it to always-true should flip the DERIVED_FROM half of the 'derives a succession...' test's assertion — flagging as a likely-stale Survived verdict and recommending the team re-run Stryker to confirm before trusting it |
| `src/store/graph/index.ts:390` | Survived | ArrayDeclaration | `["Stryker was here"]` | must-kill | replacing `[ref.target.path]` with a bogus placeholder should poison the whole `paths` Set used to resolve path-based links, breaking nearly every link test in the file — flagging as a likely-stale Survived verdict, recommend re-verifying directly |
| `src/store/graph/index.ts:393` | Survived | ArrayDeclaration | `["Stryker was here"]` | must-kill | the IRI-target equivalent of 1584 — should poison IRI-based link resolution the same way |
| `src/store/graph/index.ts:397` | Survived | ConditionalExpression | `true` | noise | these guard whether the byPath/byIri lookup query runs at all when the id list is empty; running it anyway against an empty `ANY($2::text[])` array returns zero rows, so the end state is identical — a cost-only guard |
| `src/store/graph/index.ts:397` | Survived | EqualityOperator | `paths.length >= 0` | noise | these guard whether the byPath/byIri lookup query runs at all when the id list is empty; running it anyway against an empty `ANY($2::text[])` array returns zero rows, so the end state is identical — a cost-only guard |
| `src/store/graph/index.ts:407` | Survived | ConditionalExpression | `true` | noise | these guard whether the byPath/byIri lookup query runs at all when the id list is empty; running it anyway against an empty `ANY($2::text[])` array returns zero rows, so the end state is identical — a cost-only guard |
| `src/store/graph/index.ts:407` | Survived | EqualityOperator | `iris.length >= 0` | noise | these guard whether the byPath/byIri lookup query runs at all when the id list is empty; running it anyway against an empty `ANY($2::text[])` array returns zero rows, so the end state is identical — a cost-only guard |
| `src/store/graph/index.ts:421` | NoCoverage | ObjectLiteral | `{}` | worth-killing | the documented 'an IRI target makes its edge whether or not the target has landed' dangling-edge rule is only tested via a path link to unwritten knowledge, never an IRI link to one |
| `src/store/graph/index.ts:425` | NoCoverage | ArrayDeclaration | `["Stryker was here"]` | worth-killing | the 'one lineage edge per cited concept, however many sources[] entries repeat it' dedup rule has no test that cites the same concept twice |
| `src/store/graph/index.ts:425` | Survived | ConditionalExpression | `false` | worth-killing | the lineage dedup set (`cited`) that keeps repeated citations to one concept to a single edge is untested (pairs with NoCoverage id 1625) |
| `src/store/graph/index.ts:426` | Survived | CallExpression | `;` | worth-killing | the lineage dedup set (`cited`) that keeps repeated citations to one concept to a single edge is untested (pairs with NoCoverage id 1625) |
| `src/store/graph/index.ts:467-468` | Survived | StringLiteral | ```` | must-kill | the DELETE that clears a concept's stale outgoing edges before re-inserting them is never proven by a test that changes/removes a link on an already-landed concept — without it, a removed link would leave a phantom edge on the map |
| `src/store/graph/index.ts:469` | Survived | ArrayDeclaration | `[]` | must-kill | the DELETE that clears a concept's stale outgoing edges before re-inserting them is never proven by a test that changes/removes a link on an already-landed concept — without it, a removed link would leave a phantom edge on the map |
| `src/store/graph/index.ts:504` | Survived | StringLiteral | ```` | noise | namePattern is explicitly documented as a cost-only pre-filter ('precision here is cost, never edges') — its own docblock says correctness never depends on it |
| `src/store/graph/index.ts:518` | Survived | OptionalChaining | `row.rows[0].live_gen` | equivalent | liveGeneration's `INSERT ... ON CONFLICT ... RETURNING live_gen` always yields exactly one row with a NOT NULL column |
| `src/store/graph/index.ts:519` | NoCoverage | StringLiteral | `""` | equivalent | the upsert's `RETURNING live_gen` always yields a row and the column is NOT NULL, so the throw is unreachable dead code |
| `src/store/graph/index.ts:519` | Survived | ConditionalExpression | `false` | equivalent | liveGeneration's `INSERT ... ON CONFLICT ... RETURNING live_gen` always yields exactly one row with a NOT NULL column |
| `src/store/graph/index.ts:553` | Survived | ConditionalExpression | `true` | noise | forcing the inbound backfill to always run (instead of only for newly-mapped concepts) just re-derives already-correct edges redundantly — idempotent, so no observable state difference, only extra cost |
| `src/store/graph/index.ts:573-575` | Survived | StringLiteral | ```` | must-kill | the UPDATE that keeps an inbound LINKS_TO edge's denormalised `to_kind` in sync when the target's kind changes is never proven by a test that changes a concept's kind after it's already linked to |
| `src/store/graph/index.ts:588` | Survived | ConditionalExpression | `true` | must-kill | forcing the SUPERSEDES-relabel trigger to always-true means an ordinary, non-deprecating edit to a cited concept could spuriously flip its citers' lineage label to SUPERSEDES — no test re-commits a still-stable cited concept to prove citers stay DERIVED_FROM |
| `src/store/graph/index.ts:592` | Survived | ConditionalExpression | `false` | noise | forcing the inbound backfill to always run (instead of only for newly-mapped concepts) just re-derives already-correct edges redundantly — idempotent, so no observable state difference, only extra cost |
| `src/store/graph/index.ts:599` | Survived | UnaryOperator | `+1` | worth-killing | `.at(-1)` vs `.at(1)` for the filename used in the backfill pre-filter coincide only for a 2-segment path (the one fixture used) — a 3+-segment path would silently break the not-yet-written-knowledge backfill |

### `packages/core/src/store/postgres/index.ts`

| file:line | status | mutator | replacement (truncated) | verdict | why (one clause) |
|---|---|---|---|---|---|
| `src/store/postgres/index.ts:180` | Survived | ConditionalExpression | `true` | must-kill | isRole's own membership test is inverted/forced-true — the role-validity check every Principal is built from; no test seeds an invalid role value to prove it still refuses |
| `src/store/postgres/index.ts:180` | Survived | EqualityOperator | `role !== value` | must-kill | isRole's own membership test is inverted/forced-true — the role-validity check every Principal is built from; no test seeds an invalid role value to prove it still refuses |
| `src/store/postgres/index.ts:220` | Survived | LogicalOperator | `!workspaceId.success && !userId.success` | must-kill | `||`→`&&` on the malformed-claims guard: the one existing test passes a workspaceId AND a userId that are BOTH invalid, so it doesn't distinguish `||` from `&&` — a request with exactly one malformed field would silently proceed under the mutant instead of being refused |
| `src/store/postgres/index.ts:236` | Survived | OptionalChaining | `row.role` | equivalent | every one of these optional-chaining removals sits after `refuse(row, ...)` has already returned early when row is undefined, so row is provably non-null at this point in both withPrincipal's and withMembership's callbacks and in resolveScoped itself |
| `src/store/postgres/index.ts:282` | Survived | OptionalChaining | `row.role` | equivalent | every one of these optional-chaining removals sits after `refuse(row, ...)` has already returned early when row is undefined, so row is provably non-null at this point in both withPrincipal's and withMembership's callbacks and in resolveScoped itself |
| `src/store/postgres/index.ts:318` | NoCoverage | StringLiteral | `"Stryker was here!"` | equivalent | `row?.role ?? ""` — row is always defined here (refuse() already returned not-a-member otherwise) and `role` is NOT NULL, so the `??` fallback is genuinely dead |
| `src/store/postgres/index.ts:318` | Survived | OptionalChaining | `row.role` | equivalent | every one of these optional-chaining removals sits after `refuse(row, ...)` has already returned early when row is undefined, so row is provably non-null at this point in both withPrincipal's and withMembership's callbacks and in resolveScoped itself |
| `src/store/postgres/index.ts:319-322` | NoCoverage | BlockStatement | `{}` | worth-killing | the role-unknown branch (member row holds a role outside Admin/Editor/Viewer) is never taken in any test — would need a raw-SQL-seeded invalid role, cheap to add but nobody has |
| `src/store/postgres/index.ts:319` | Survived | ConditionalExpression | `false` | worth-killing | the two condition-mutants over the same untested role-unknown check (see 1778/1779/1797) — real but low-value without a corrupted-role fixture |
| `src/store/postgres/index.ts:321` | NoCoverage | StringLiteral | `""` | worth-killing | the role-unknown branch (member row holds a role outside Admin/Editor/Viewer) is never taken in any test — would need a raw-SQL-seeded invalid role, cheap to add but nobody has |
| `src/store/postgres/index.ts:332` | NoCoverage | ArrayDeclaration | `["Stryker was here"]` | equivalent | `row?.group_ids ?? []` — row is guaranteed defined at this point by the same invariant as 1774 |
| `src/store/postgres/index.ts:332` | Survived | OptionalChaining | `row.group_ids` | equivalent | every one of these optional-chaining removals sits after `refuse(row, ...)` has already returned early when row is undefined, so row is provably non-null at this point in both withPrincipal's and withMembership's callbacks and in resolveScoped itself |
| `src/store/postgres/index.ts:357` | NoCoverage | StringLiteral | `""` | worth-killing | same untested role-unknown path, the second copy of the check inside refuse() |
| `src/store/postgres/index.ts:357` | Survived | ConditionalExpression | `false` | worth-killing | the two condition-mutants over the same untested role-unknown check (see 1778/1779/1797) — real but low-value without a corrupted-role fixture |
| `src/store/postgres/index.ts:360` | Survived | EqualityOperator | `credentialIssuedAtMs <= revokedAt.getTime()` | must-kill | the revocation-instant boundary (`<` vs `<=`) at the exact issued-at-equals-revoked-at instant is untested — existing tests only use ±1 second offsets either side; this is exactly the revocation-timing class the brief calls out |
| `src/store/postgres/index.ts:414` | Survived | OptionalChaining | `counted.rows[0].count` | equivalent | `counted.rows[0]?.count ?? 1` — the upsert's `RETURNING count` always yields exactly one row, so the optional chaining and fallback never fire |
| `src/store/postgres/index.ts:441` | Survived | OptionalChaining | `counted.rows[0].count` | equivalent | `counted.rows[0]?.count ?? 1` — the upsert's `RETURNING count` always yields exactly one row, so the optional chaining and fallback never fire |
| `src/store/postgres/index.ts:457` | Survived | OptionalChaining | `found.rows[0].value` | must-kill | readWorkspaceConfig's `found.rows[0]?.value` — when no config row exists (the common, unset case) the SELECT returns zero rows and `found.rows[0]` really is undefined; the mutant would throw instead of returning undefined, and no test exercises the unset-key path |
| `src/store/postgres/index.ts:469-475` | NoCoverage | BlockStatement | `{}` | worth-killing | tablesPresent has no test anywhere in packages/core (only apps/api/src/ops/index.ts calls it) — deserves at least one direct test of the pass-through query, unless it's already covered at the apps/api layer (not checked here) |
| `src/store/postgres/index.ts:471` | NoCoverage | StringLiteral | `""` | worth-killing | tablesPresent has no test anywhere in packages/core (only apps/api/src/ops/index.ts calls it) — deserves at least one direct test of the pass-through query, unless it's already covered at the apps/api layer (not checked here) |
| `src/store/postgres/index.ts:472` | NoCoverage | ArrayDeclaration | `[]` | worth-killing | tablesPresent has no test anywhere in packages/core (only apps/api/src/ops/index.ts calls it) — deserves at least one direct test of the pass-through query, unless it's already covered at the apps/api layer (not checked here) |
| `src/store/postgres/index.ts:474` | NoCoverage | ArrowFunction | `() => undefined` | worth-killing | tablesPresent has no test anywhere in packages/core (only apps/api/src/ops/index.ts calls it) — deserves at least one direct test of the pass-through query, unless it's already covered at the apps/api layer (not checked here) |

### Settled by T-103 (2026-09-08)

`src/store/graph/index.ts`:
- 184/186/187/189 (`blankedSpans`'s loop bounds, `opener`, the `queued.get` fallback) — proved in comments, not removed: `noUncheckedIndexedAccess` types every index as possibly undefined; the pairing invariant the function's own opening comment already describes is what actually rules it out, and restructuring the loop to let the type see that would change the algorithm (the loop reassigns its own index to skip ahead). Comments at ~221-226 (the outer bound, `opener`, `queued.get`) and ~232-233 (the inner `while` bound).
- 217/219 (`definitionsOf`'s `match[1]`/`match[2]`) and 238 (`linkTargetOf`'s `reference[1]`/`reference[2]`) — proved in comments: `LINK_DEFINITION`'s two groups are `+`-quantified, never optional, and the reference regex's groups always participate (possibly capturing "") once the regex matches at all — so the `?? ""` fallbacks are for the type, never a real undefined. Comments at ~262-263 and ~284-285.
- 272 (`targetOf`'s `raw.split("#")[0]`) — proved in a comment: `String.split` always returns at least one element (~321).
- 285/286 (`sectionAt`'s `lines[at]`, `heading[1]`) — proved in a comment: `at` stays inside the loop's own bound, and the heading regex's capture group always participates once it matches (~335-337).
- 346 (the `sources[]` fallback "filtered by citedSourceOf immediately after") — this is the ticket's named reshape, and it is done: `EdgeSource` now carries `sources: readonly CitedSource[]` instead of raw `frontmatter` (~65-82), and `referencesOf`'s own `cited === undefined` arm is gone — it reads `concept.sources` directly (~377-408). The write path reduces `sources[]` **once**, in `concepts/file.ts`'s `hashedFileOf`, the reduction the content hash is made from, and hands the same pairs through `landRows` to the delta; the loop that skips an entry naming no resource lives beside the reader in the boundary package (`citedSourcesOf`, `packages/schema/src/concept-tables.ts`), outside this report's scope, so no arm of it stands in `packages/core`. The inbound backfill (`writeConceptDelta`'s `naming` query) reads other concepts' already-landed rows and reduces each with the same boundary reader, once per row (review round, 2026-09-09).
- 284 (`sectionAt`'s starting index) — proved by the same comment as 285/286 (~335-337): the loop's own bound keeps `at` inside `lines`, so the two extra out-of-bounds starts the mutant adds read `""` and fall through to the same first heading.
- 504 (`namePattern`, the backfill's pre-filter) — left as it stands, cost-only by its own docblock ("precision here is cost, never edges"): the backfill re-derives every candidate whole, so a looser pattern re-derives more rows to the same edges (review round, 2026-09-09).
- 397/407 (the empty-path/-iri list guards in `resolveOutgoing`) — left as guards, proved cost-only in comments, per the ticket's instruction: an empty `ANY($2::text[])` is a legal query that returns nothing anyway (~447-448, ~459-460).
- 518/519 (`liveGeneration`'s `RETURNING live_gen`) — proved in a comment: an insert-or-update `RETURNING` always yields exactly one row over a `NOT NULL` column; Postgres guarantees it, not the type (~576-577).
- 553/592 (the inbound backfill's `isNew` guard) — left as a guard, proved cost-only in a comment, per the ticket's instruction: bypassing it would only re-run the idempotent backfill for an already-mapped concept (~659-661).

`src/store/postgres/index.ts`:
- 236/282/318 (the `?? ""` role fallback)/332 (`row?.role` / `row?.group_ids` after `refuse` already returned undefined-or-not) and 319-322/357 (the second `isRole` check) — removed, by the ticket's named reshape (`CODING_RULES.md`'s one-guard-per-condition rule and its worked example): `refuse` (~372-388) now returns `Result<ResolvedMember, PrincipalRefusal>` — `ResolvedMember = MembershipRow & { role: Role }` (~363) — instead of `PrincipalRefusal | undefined`. Both callers (`withPrincipal` ~243-259, `withMembership` ~286-305) and `resolveScoped` (~314-355) read the role and group ids off that narrowed value instead of re-deriving them from the raw row, so the second `isRole` check, the `row?.role ?? ""`, and the `row?.group_ids ?? []` are all gone — `CODING_RULES.md`'s worked example is updated to say so. The one remaining `isRole` call, inside `refuse` itself (~380), is proved in a comment rather than removed: `member_role_check` (`identity-tables.ts`) refuses a member row a role outside the three at the database, before this code can ever see one, confirmed by reading the table definition — so a live-Postgres test seeding "a member row holding an unknown role" is not constructible without dropping that constraint, which this ticket does not do. The test the ticket suggested adding to `principal.test.ts` is therefore not added; this is the one deviation from the ticket's notes, and the reasoning is recorded here and in T-103's own report.
- 414/441 (`counted.rows[0]?.count ?? 1`) — proved in comments at both call sites (`consumeIngress` ~437-438, `consumeCall` ~466): an upsert's `RETURNING` always yields exactly one row.

---

# workspaces + audit + kernel — survivor triage
Counts: must-kill 53 · worth-killing 9 · noise 2 · equivalent 4 (of 68)

## Must-kill shortlist

- **`src/audit/index.ts:148`** (ids 411,412,413,414 — ConditionalExpression×2, EqualityOperator, StringLiteral) — breaks the tenancy-scope selection in `record()`'s ternary `principal.kind === "user" ? principal.workspaceId : null`. The docblock says this is deliberate: the explicit workspace id lets Postgres's RLS policy *refuse* a write when it disagrees with the transaction's ambient scope, rather than silently landing in the wrong tenant. No test in `audit.test.ts` constructs a principal whose `workspaceId` disagrees with the transaction's scope, so all four inversions of this ternary survive — the safety net for cross-tenant audit writes is unverified. Missing test in `packages/core/test/audit.test.ts`: call `record` with a user principal inside a transaction scoped to a *different* workspace and assert the write is refused, not silently landed against the ambient scope.

- **`src/kernel/result.ts:53-55`** (ids 765,767,768,769,770,771,772 — full `normalizeError` body except the `instanceof Error` happy path) — `attempt()` is the one `try`/`catch` every slice entry point in the repo relies on (per its own docblock); if it is ever handed a thrown string or a thrown non-Error value, `normalizeError`'s string- and fallback-branches are what turn it into a proper `Error`. Not one test throws anything but a real `Error`, so this entire secondary/tertiary path is unexercised — a foundational kernel primitive with two of its three branches untested. Missing test: a dedicated `result.test.ts` (or addition to an existing kernel suite) calling `attempt(() => { throw "boom" })` and `attempt(() => { throw { weird: true } })`, asserting the returned `Error`'s message/cause.

- **`src/workspaces/index.ts:397-417`** (ids 1950,1952,1954–1971 — 20 mutants across the whole body of `readMembership`) — every mutant here is NoCoverage or survives with the same root cause: no test in `workspaces.test.ts` calls `readMembership` end-to-end. The one incidental hit (coveredBy 1 on the earliest lines) appears to come from an unrelated test that reaches an early DB-error branch, never the intended happy path or the `no-such-workspace`/`no-such-person` refusals. This is the read that backs the shell's who/where/role display (T-037); its optional-chaining guards and undefined-checks exist specifically for a stale/deleted workspace or person row. Missing tests in `packages/core/test/workspaces.test.ts`: (1) happy path — `readMembership` under a valid principal returns the `Membership` shape with workspace name, person name/email, and role; (2) a principal pointing at a workspace row that no longer exists returns `err("no-such-workspace")`; (3) same for a deleted person row returning `err("no-such-person")`.

- **`src/workspaces/index.ts:153-183`** (ids 1897,1881,1883,1889,1893,1895 — `revokeCredentials`) — no test calls `revokeCredentials` for a syntactically-valid but nonexistent user id, and none verifies the actual DB row state after revocation. That gap is exactly why 1895 survives disabled (masks "user not found" as success), 1893 survives disabled (masks a genuine store failure as `"no-such-user"`), 1881/1883 survive (the optional-chaining/undefined guard for a zero-row UPDATE is never hit), and 1889 survives (the access-token-revoking UPDATE's SQL text can be blanked to a no-op — Postgres treats an empty query as valid and silent — with nothing checking that access tokens were actually revoked in the DB). Missing tests in `workspaces.test.ts`: revoke credentials for a nonexistent user → `err("no-such-user")`; revoke credentials with a real prior session/refresh-token/access-token and assert each is actually ended in the DB afterward, not just that the call returned `ok`.

- **`src/workspaces/index.ts:264`** (id 1917 — `revokeWorkspaceTokens`) — disabling `if (!ended.ok) return err(ended.error)` lets a genuine store failure fall through to `ok({...ended.value})`, where `ended.value` is `undefined` and spreads to nothing — so a failed token revocation reports success with the count fields silently missing. No test forces a store failure here. Missing test: force `withIdentityWrite`'s transaction to reject and assert `revokeWorkspaceTokens` returns the raw `Error`, not a partial `ok`.

- **`src/workspaces/index.ts:321`** (id 1931 — `workspacesHeldBy`) — same failure-masking shape: disabling `if (!held.ok) return err(held.error)` turns a store failure into `ok(undefined)`, i.e. "this person holds no workspaces" instead of an error — dangerous for a picker deciding whether to show "you have no workspaces" vs. "something broke." Missing test: force the underlying query to reject and assert an `Error` comes back, not `ok(undefined)`.

- **`src/audit/vocabulary.ts:84-148`** (ids 423,424,437,438,441,443,446,448,449,453,457,459,461 — the whole of `act`, `declarationRefusal`, `declareActs`) — every existing test in `audit.test.ts`'s "declared-acts walk" either asserts a **refusal** (bad family, bad subject, duplicate name) or relies on the whole app importing successfully; none directly asserts what a *successful* declaration produces (the returned `Act`'s `name`/`detail`, or that `declareActs` registers exactly the given acts and nothing else). That's the gap every one of these logic-inversion/always-refuse/always-return-undefined mutants slips through. Missing test: a focused unit test that declares one well-formed act and asserts the returned object's shape and that `declarations()` now contains it — proving the acceptance path, not just the refusal paths.

- **`src/kernel/actor.ts:65`** (id 742 — `isPersonActor`) — mutating `startsWith("human:")` to `startsWith("")` makes the function return `true` for *every* actor id, human or not. The docblock ties this directly to a trust-tier decision a person's check earns and a machine's doesn't. The one covering test apparently only asserts `true` for a human actor and never asserts `false` for a process/agent actor. Missing test: `isPersonActor("process:better-answers-bootstrap")` (or an agent id) must be `false`.

## Full table

### src/audit/index.ts
| file:line | status | mutator | replacement (truncated) | verdict | why |
| --- | --- | --- | --- | --- | --- |
| index.ts:88 | NoCoverage | StringLiteral | `` | noise | the "detail is missing the field" message is never hit because `DETAIL_KINDS` rejects an `undefined` value identically on the very next line, giving an equivalent throw either way |
| index.ts:134 | NoCoverage | StringLiteral | `` | noise | "landed no row" message is unreachable — a plain `INSERT … RETURNING id` with no `ON CONFLICT` always returns exactly one row or rejects first |
| index.ts:88 | Survived | ConditionalExpression | `false` | equivalent | disabling the "missing field" check is masked by the next line's `DETAIL_KINDS` check, which rejects `undefined` for every kind — same observable throw |
| index.ts:110 | Survived | ObjectLiteral | `{}` | worth-killing | drops the zod `cause` from the thrown boundary-refusal Error; message text still matches so the test passes, but the diagnostic cause chain is silently lost |
| index.ts:133 | Survived | OptionalChaining | `inserted.rows[0].id` | equivalent | `rows[0]` can't be undefined given a plain `INSERT … RETURNING` with no conflict clause — the guard is unreachable in practice |
| index.ts:134 | Survived | ConditionalExpression | `false` | equivalent | same reasoning as 133 — `id` can't be undefined, and even if it somehow were, `.parse(undefined)` downstream still throws, just with a generic Zod message |
| index.ts:148 | Survived | ConditionalExpression | `true` | must-kill | forces `record()` to always use `principal.workspaceId`, breaking the platform-principal path (no such field) and removing the tenancy-scope-disagreement safety net (see shortlist) |
| index.ts:148 | Survived | ConditionalExpression | `false` | must-kill | forces `record()` to always pass `null`, discarding the explicit workspace id RLS uses to refuse a scope mismatch (see shortlist) |
| index.ts:148 | Survived | EqualityOperator | `principal.kind !== "user"` | must-kill | inverts the same branch selection (see shortlist) |
| index.ts:148 | Survived | StringLiteral | `""` | must-kill | breaks the `"user"` comparison the same way as forcing it false (see shortlist) |

### src/kernel/result.ts
| file:line | status | mutator | replacement (truncated) | verdict | why |
| --- | --- | --- | --- | --- | --- |
| result.ts:54 | NoCoverage | ConditionalExpression | `true` | must-kill | the string-thrown branch of `normalizeError` is never exercised by any test (see shortlist) |
| result.ts:54 | NoCoverage | ConditionalExpression | `false` | must-kill | same untested branch |
| result.ts:54 | NoCoverage | EqualityOperator | `typeof cause !== "string"` | must-kill | same untested branch |
| result.ts:54 | NoCoverage | StringLiteral | `""` | must-kill | same untested branch |
| result.ts:55 | NoCoverage | StringLiteral | `` | must-kill | the catch-all non-Error message is never exercised |
| result.ts:55 | NoCoverage | ObjectLiteral | `{}` | must-kill | drops `{ cause }` from the fallback Error — never exercised |
| result.ts:53 | Survived | ConditionalExpression | `true` | must-kill | every test throws a real `Error`, so forcing this branch always-true never surfaces — same root gap as the whole cluster |

### src/workspaces/index.ts
| file:line | status | mutator | replacement (truncated) | verdict | why |
| --- | --- | --- | --- | --- | --- |
| index.ts:183 | NoCoverage | StringLiteral | `""` | must-kill | "no-such-user" refusal word for a nonexistent-user revocation, never triggered by any test (see shortlist) |
| index.ts:400 | NoCoverage | OptionalChaining | `workspace.value.rows[0].name` | must-kill | `readMembership` untested — see shortlist |
| index.ts:401 | NoCoverage | ConditionalExpression | `true` | must-kill | `readMembership` untested |
| index.ts:401 | NoCoverage | ConditionalExpression | `false` | must-kill | `readMembership` untested |
| index.ts:401 | NoCoverage | EqualityOperator | `name !== undefined` | must-kill | `readMembership` untested |
| index.ts:401 | NoCoverage | StringLiteral | `""` | must-kill | `readMembership` untested |
| index.ts:403-407 | NoCoverage | ArrowFunction | `() => undefined` | must-kill | `readMembership` untested |
| index.ts:405 | NoCoverage | StringLiteral | `""` | must-kill | `readMembership` untested |
| index.ts:406 | NoCoverage | ArrayDeclaration | `[]` | must-kill | `readMembership` untested |
| index.ts:409 | NoCoverage | BooleanLiteral | `person.ok` | must-kill | `readMembership` untested |
| index.ts:409 | NoCoverage | ConditionalExpression | `true` | must-kill | `readMembership` untested |
| index.ts:409 | NoCoverage | ConditionalExpression | `false` | must-kill | `readMembership` untested |
| index.ts:411 | NoCoverage | ConditionalExpression | `true` | must-kill | `readMembership` untested |
| index.ts:411 | NoCoverage | ConditionalExpression | `false` | must-kill | `readMembership` untested |
| index.ts:411 | NoCoverage | EqualityOperator | `row !== undefined` | must-kill | `readMembership` untested |
| index.ts:411 | NoCoverage | StringLiteral | `""` | must-kill | `readMembership` untested |
| index.ts:413-417 | NoCoverage | ObjectLiteral | `{}` | must-kill | `readMembership`'s return value untested |
| index.ts:414 | NoCoverage | ObjectLiteral | `{}` | must-kill | `readMembership`'s `workspace` field untested |
| index.ts:415 | NoCoverage | ObjectLiteral | `{}` | must-kill | `readMembership`'s `person` field untested |
| index.ts:153 | Survived | ConditionalExpression | `false` | worth-killing | skips input-format validation on `userId`; downstream SQL still needs a matching row so this is a shallower gap than the DB-level ones, but malformed-input handling is untested |
| index.ts:162 | Survived | OptionalChaining | `person.rows[0].at` | must-kill | manifests only when the UPDATE affects zero rows (nonexistent user) — same missing test as the revokeCredentials cluster (see shortlist) |
| index.ts:163 | Survived | ConditionalExpression | `false` | must-kill | same "user doesn't exist" gap as above |
| index.ts:173 | Survived | StringLiteral | `""` | must-kill | blanks the access-token-revocation SQL; Postgres treats an empty query as a silent no-op, so access tokens are never actually revoked and no test checks DB state (see shortlist) |
| index.ts:182 | Survived | ConditionalExpression | `false` | must-kill | masks a genuine store failure as `"no-such-user"` instead of propagating the real Error (see shortlist) |
| index.ts:183 | Survived | ConditionalExpression | `false` | must-kill | masks "user not found" as a successful revocation (see shortlist) |
| index.ts:264 | Survived | ConditionalExpression | `false` | must-kill | masks a store failure in `revokeWorkspaceTokens` as a partial `ok` (see shortlist) |
| index.ts:321 | Survived | ConditionalExpression | `false` | must-kill | masks a store failure in `workspacesHeldBy` as `ok(undefined)` (see shortlist) |
| index.ts:351 | Survived | ConditionalExpression | `false` | worth-killing | bypassing the slug-format pre-check just pushes an invalid slug into the query, which finds no matching row anyway — same eventual `ok(undefined)`, but the intentional early-return optimization/guard is unverified |
| index.ts:397 | Survived | ArrayDeclaration | `[]` | must-kill | the one test that reaches `readMembership` already exits via a different error path before this matters — part of the untested-function cluster (see shortlist) |
| index.ts:399 | Survived | ConditionalExpression | `true` | must-kill | same — `readMembership`'s only covering execution already takes this branch for an unrelated reason |
| index.ts:44 | Survived | StringLiteral | `""` | worth-killing | mutates a string literal inside the `WORKSPACE_ACTS` declaration (family or act-name label); the exact survival mechanics are unclear from the slice alone, but this is a functional identifier (not a log string) worth a human's second look |
| index.ts:35 | Survived | StringLiteral | `""` | worth-killing | `TOOLS_LIST_TTL_CONFIG_KEY` — blanking this config key would break any lookup by the real key name, but no test asserts the actual key string written into `workspace_config` |
| index.ts:45 | Survived | StringLiteral | `""` | worth-killing | same family as index.ts:44 — a functional label inside the act declaration, not a cosmetic string |

### src/audit/vocabulary.ts
| file:line | status | mutator | replacement (truncated) | verdict | why |
| --- | --- | --- | --- | --- | --- |
| vocabulary.ts:84-87 | Survived | ArrowFunction | `() => undefined` | must-kill | `act()` always returning `undefined` breaks every act declaration in the tree — no direct unit test asserts what `act()` returns (see shortlist) |
| vocabulary.ts:87 | Survived | ObjectLiteral | `{}` | must-kill | same gap, `act()` returns `{}` instead of `{name, detail}` |
| vocabulary.ts:119 | Survived | StringLiteral | `""` | must-kill | part of `declarationRefusal`'s core validation-gate logic, untested on the acceptance path (see shortlist) |
| vocabulary.ts:120 | Survived | ConditionalExpression | `true` | must-kill | would refuse every legitimately-formed act; only the refusal paths are directly tested, not acceptance |
| vocabulary.ts:120 | Survived | BooleanLiteral | `ACT.test(name)` | must-kill | same validation-gate gap |
| vocabulary.ts:120 | Survived | EqualityOperator | `prefix === family` | must-kill | inverts the family-prefix check with the same untested-acceptance-path gap |
| vocabulary.ts:123 | Survived | ConditionalExpression | `true` | must-kill | would refuse every act as "never a ledger row"; acceptance path untested |
| vocabulary.ts:123 | Survived | LogicalOperator | `subject !== undefined \|\| …` | must-kill | same gap, different operator |
| vocabulary.ts:123 | Survived | ConditionalExpression | `true` | must-kill | duplicate AST-level mutant of the same untested condition |
| vocabulary.ts:126 | Survived | ConditionalExpression | `true` | must-kill | would report every first-time declaration as "declared twice"; acceptance path untested |
| vocabulary.ts:145 | Survived | ArrowFunction | `() => undefined` | must-kill | `Object.values(acts).map(...)` always returning `undefined` breaks every `declareActs` call; untested |
| vocabulary.ts:148 | Survived | ConditionalExpression | `true` | must-kill | would throw on every declared act; untested acceptance path |
| vocabulary.ts:148 | Survived | EqualityOperator | `refusal === undefined` | must-kill | inverts the throw condition; same gap |

### src/kernel/actor.ts
| file:line | status | mutator | replacement (truncated) | verdict | why |
| --- | --- | --- | --- | --- | --- |
| actor.ts:65 | Survived | StringLiteral | `""` | must-kill | `isPersonActor` becomes always-`true`, defeating the trust-tier check the docblock says this feeds (see shortlist) |

### src/kernel/constraint.ts
| file:line | status | mutator | replacement (truncated) | verdict | why |
| --- | --- | --- | --- | --- | --- |
| constraint.ts:25 | Survived | ConditionalExpression | `true` | worth-killing | forcing the guard true only differs from reality when `.constraint` exists but isn't a string — a contrived shape real Postgres errors don't produce; no test proves the guard is needed |
| constraint.ts:25 | Survived | LogicalOperator | `"constraint" in error \|\| …` | worth-killing | differs only for the same contrived non-string-`.constraint` case; untested edge |
| constraint.ts:25 | Survived | ConditionalExpression | `true` | worth-killing | duplicate AST-level mutant of the same untested edge case |
| constraint.ts:25 | Survived | StringLiteral | `"Stryker was here!"` | equivalent | the exact fallback placeholder string doesn't matter — neither `""` nor `"Stryker was here!"` will ever equal a real Postgres constraint name, so the substring-search fallback behaves identically either way |

### Settled by T-103 (2026-09-08)

`src/audit/index.ts`:
- 88 (the "missing field" check masked by the next line's `DETAIL_KINDS` check) — proved in a comment, not removed: every `DETAIL_KINDS` predicate opens with a `typeof` check that a `value` of `undefined` never passes, so a missing field is still refused one line down — but under the less specific message "is not a kind" rather than "is missing the field". Kept for the sharper message a developer reads back off a thrown audit error; comment at ~125-128.
- 133/134 (`inserted.rows[0]?.id` and its throw) — proved in a comment: a plain `INSERT … RETURNING` with no `ON CONFLICT` always yields exactly one row (~174-175). `docs/agents/mutation-triage.md`'s warning that `audit/index.ts:89`'s verdict was later found wrong is about a different, already-resolved row: `record()` no longer holds the tenancy-scope ternary inline (it now delegates to `scopeParameter`, `store/postgres/index.ts`), so that historical finding is confirmed moot for the rows this ticket settles, not relied on.

`src/kernel/constraint.ts`:
- 25 (the fallback placeholder string) — proved in a comment: neither `""` nor any other placeholder ever equals a real Postgres constraint name, so the lookup answers the same `undefined` either way, whichever placeholder stands there (~24-26).

---

# concepts + members — survivor triage

Counts: must-kill 36 · worth-killing 41 · noise 13 · equivalent 1 (of 91)

A general caveat before the detail: for a handful of mutants (mostly on the `!x.ok` /
`!x.success` guard pattern and on `foldKind`) my static reading of the current source and
test files says the mutation *should* already be caught by an existing assertion, yet the
report marks them Survived/NoCoverage. That can happen honestly (Stryker's line/coverage
counts are per-AST-node, not per-branch-taken, so "43 tests cover this line" does not mean
43 tests exercise the branch the mutant actually changes), but it is also consistent with
this being a weekly run against a slightly earlier commit than what is on disk now. Where I
flag this below I still give a verdict based on the seam's real importance, not on faith that
the report is current — worth a re-run to confirm before trusting the exact numbers.

## Must-kill shortlist

**Frontmatter trust/identity keys — `concepts/index.ts:322-328` (`UNHASHED_KEYS`), mutants 508–513 (ArrayDeclaration/StringLiteral, NoCoverage-equivalent, cov=1).**
The set of keys ADR 0014 excludes from the content hash (`generated`, `verified`,
`stale_after`, `status`, `iri`) is asserted nowhere. Emptying the set, or dropping any one
key from it, means recording a check (or any status/trust write) would move the concept's
own content hash — turning *Checked* into *Changed since checked* the instant it was
recorded, exactly the failure the docblock at that line warns about. `concepts.test.ts`
needs a test that hashes two frontmatters differing only in one `UNHASHED_KEYS` member (e.g.
`status: "draft"` vs `status: "stable"`, all else equal) and asserts the hash is unchanged.

**Concept trust fail-closed check — `concepts/index.ts:1198-1203` (`checkOf`), mutants 722, 723, 724, 725, 727 (LogicalOperator/ConditionalExpression, cov=1–13).**
`checkOf` is the fail-closed guard that turns a partial or unattributable verification row
into *Unchecked* rather than a guessed check. 723/725/727 force the guard's whole condition
to `false`, so a row with `checked_by === null` (genuinely never checked) would still build
`{ actor: null, at: null, contentHash: null }` instead of `undefined` — fail-open on the
platform's own trust signal. 722/724 restructure the `||` chain so a row where exactly one
of `checked_by`/`checked_at` is null (a partial verification row) is no longer caught. No
test constructs a `concept_verification` row with a null `checked_at` alongside a set
`checked_by`, or an actor string `isActorId` rejects. `concepts.test.ts`'s "opening a concept
by IRI" block needs a case for a malformed/partial verification row asserting `trust.tier`
still reads *unverified*, not a guessed reviewer.

**Content-hash canonical JSON — `concepts/index.ts:376-386` (`canonicalFrontmatter`), mutants 541, 545, 551.**
All three restructure the RFC-8785-style canonical JSON the hash is computed over (dropping
the `.filter/.map` chain, always reducing every key as if it were `sources`, or collapsing
`pairs.join(",")` to `""`). Every test that checks a content hash does so by calling
`contentHashOf` a second time and comparing — the same (mutated) function against itself —
so these survive as long as the mutation is deterministic, even though the actual bytes
hashed are wrong. That matters because the hash is a cross-tier contract (docs/okf-v02.md,
"readable by any OKF tool") — the Python worker or a golden fixture would disagree with a
TypeScript-side canonicalisation change that no TypeScript test can see. `concepts.test.ts`
needs at least one test asserting `canonicalFrontmatter`'s (or `contentHashOf`'s) output
against a fixed literal string, not against itself.

**Rendered concept file — `concepts/index.ts:414-422` (`yamlValue`), mutants 572, 577, 579, 580, 583, 585, 586.**
The one existing literal-string test ("writes the file to the bundle…") only exercises a
frontmatter of two scalar strings and one non-empty array of *objects* (`sources`). That
never exercises: an empty array value (572 — malformed YAML, no `[]` marker), a plain string
list like `tags: ["a", "b"]` (577/579/580/583/585 — the object-vs-primitive branch and the
primitive item's own template are entirely unexercised, despite `FrontmatterValue` naming
`readonly string[]` as a first-class shape), or a multi-entry array's line separator (586 —
untested because the one array-typed fixture value has exactly one entry, so `.join("\n")`
vs `.join("")` produce the same string). Any of these would silently write malformed YAML
into the bundle. `concepts.test.ts` needs cases with an empty array frontmatter value, a
plain string-list value, and a `sources` array of two or more entries, each asserted against
the literal rendered file.

**Pre-commit validation guard — `concepts/index.ts:572` (`if (!mergeKey.success || !evidence.success) return err("malformed")`), mutants 618, 619, 622.**
This is the guard the module's own docblock calls out: "every refusal decidable from the
concept's own row is made before a commit exists." Forcing it to never fire (618) or to only
fire when *both* halves are invalid (619) lets a malformed `mergeKey` or a malformed
`evidence[]` entry (e.g. a bad `locator`) reach the transaction — the boundary is meant to
refuse that pre-commit, per ADR 0028. No test in `concepts.test.ts` supplies an invalid
`mergeKey` or an invalid evidence entry to `writeConcept`; it needs one of each, asserting
`{ ok: false, error: "malformed" }` and no commit made.

**Membership/role re-checks around the commit — `concepts/index.ts:597` (`existing.value.ok`) and `concepts/index.ts:739` (`landed.value.ok`), mutants 628 and 691.**
Both are `withMembership`'s own Result, i.e. the authority-at-time-of-act re-read ADR 0012
relies on. 628 guards the pre-commit read (role/credentials/membership); the "authority that
moved while the act was in flight" describe block in `concepts.test.ts` covers this one well
in every case except that it can't observe a `!existing.ok`/`!existing.value.ok` mutation
directly without a store-level trigger, so treat it as must-kill on stakes rather than as
proven-uncovered. 691 guards the *second* re-check inside the transaction that actually lands
the rows — the race window the docblock at `landed = await attempt(...)` describes
explicitly ("a revocation landing in the window this act cannot see refuses the rows here").
That window is a genuine TOCTOU race and no test constructs it (the existing concurrent-
revocation tests revoke *before* the act starts, which is caught earlier at 628, not here).
This is real, hard-to-test, load-bearing tenancy logic — worth a targeted test that holds the
transaction open past the first read and revokes membership before the second re-check runs,
mirroring the existing `withMembership`-holding lock test already in the file.

**Group/access-request id and name validation guards — `members/groups.ts:109-110` (mutants 825, 826), `members/groups.ts:183-184` (866, 867), `members/groups.ts:251-252` (902, 903), `members/requests.ts:230-231` (1022, 1023).**
Each is a `boundarySchemas…safeParse` guard (`GROUP_ID`, `GROUP_NAME`, `PERSON_ID`,
`accessRequest.select.shape.id`) whose failure branch is never exercised by any test: every
`groups.ts`/`access-requests.test.ts` test that expects `"malformed"` targets `createGroup`'s
name validation, never the *id*-shaped or membership-target validation on the other five
verbs. If the guard is bypassed, an arbitrary string reaches a parameterised query as a
`GroupId`/`UserId`/`AccessRequestId` instead of being cleanly refused — the exact
"concept/identity validation" seam. `members.test.ts` and `access-requests.test.ts` need one
case per verb (rename/delete/add/remove-from-group; approve/decline) with a malformed id,
asserting `{ ok: false, error: "malformed" }`.

**Acknowledgement masking a real store failure — `members/requests.ts:180` (`if (asked.ok) return ok(ACKNOWLEDGED)`) and `members/requests.ts:185` (`if (typeof refusalFor(...) === "string") return ok(ACKNOWLEDGED)`), mutants 1010 and 1012.**
ADR 0038's anti-enumeration answer is meant to cover exactly four cases (workspace unknown,
already member, already waiting, no scope). Forcing either check to always resolve to the
neutral acknowledgement means a genuine, non-constraint store failure during the insert (a
dropped connection mid-transaction, say) would be reported to the caller as success instead
of propagating the `Error` — masking a real infrastructure fault as "you're all set." The one
existing failure test (`"hands a caller the store's own failure…"`) closes the pool before
`workspaceIdBySlug` even resolves, so it never reaches either of these lines. Needs a test
that fails the *insert* itself (not the slug lookup) and asserts the raw `Error` still comes
back rather than `{ ok: true, value: { acknowledged: true } }`.

## Full table

Grouped by file, in the order mutants were listed. `cov` is `coveredBy`.

### src/concepts/index.ts

| file:line | status | mutator | replacement (truncated) | verdict | why |
| --- | --- | --- | --- | --- | --- |
| index.ts:191 | NoCoverage | MethodExpression | `cased` | worth-killing | `foldKind`'s `-ies→-y` return path; only one test round-trips it, other fold shapes untested |
| index.ts:191 | NoCoverage | UnaryOperator | `+2` | worth-killing | same `-ies` return, slice offset untested in isolation |
| index.ts:194 | NoCoverage | MethodExpression | `cased` | worth-killing | `foldKind`'s generic trailing-`s` strip; no test kind ends in a bare `s` |
| index.ts:194 | NoCoverage | UnaryOperator | `+1` | worth-killing | same generic strip, slice offset untested |
| index.ts:364 | NoCoverage | ArrayDeclaration | `["Stryker was here"]` | worth-killing | `reducedSources`'s non-array fallback; no test gives a non-array `sources` |
| index.ts:367 | NoCoverage | ArrayDeclaration | `["Stryker was here"]` | worth-killing | `reducedSources`'s unparseable-entry fallback; no malformed source entry tested |
| index.ts:415 | NoCoverage | StringLiteral | `""` | worth-killing | `yamlValue` scalar-value rendering; space-prefix untested in isolation |
| index.ts:419 | NoCoverage | StringLiteral | `` ` ` `` | must-kill | primitive array-item YAML template — string-list frontmatter values are wholly unexercised |
| index.ts:572 | NoCoverage | StringLiteral | `""` | must-kill | `"malformed"` word for the mergeKey/evidence guard; see shortlist |
| index.ts:191 | Survived | ConditionalExpression | `false` | worth-killing | `foldKind` `-ies` branch condition |
| index.ts:191 | Survived | Regex | `/(s\|x\|z\|ch\|sh)es/` | worth-killing | `foldKind` `-es`-drop regex, unanchored variant untested |
| index.ts:192 | Survived | ConditionalExpression | `true` | worth-killing | `foldKind` `-es`-drop branch condition |
| index.ts:193 | Survived | Regex | `/(ss\|us\|is)/` | worth-killing | `foldKind` `-ss/-us/-is` retention regex, unanchored variant untested |
| index.ts:192 | Survived | MethodExpression | `cased.startsWith("s")` | worth-killing | `foldKind` `-es`-drop test swapped for an unrelated predicate |
| index.ts:333 | Survived | StringLiteral | `""` | worth-killing | `normalisedBody` CRLF→LF folding untested on its own |
| index.ts:335 | Survived | Regex | `/[ \t]$/` | worth-killing | `normalisedBody` trailing-whitespace-per-line regex (drops the `+`) |
| index.ts:335 | Survived | StringLiteral | `"Stryker was here!"` | worth-killing | `normalisedBody` trailing-whitespace replacement text |
| index.ts:336 | Survived | StringLiteral | `""` | worth-killing | `normalisedBody` line-join separator |
| index.ts:337 | Survived | Regex | `/\n+/` | worth-killing | `normalisedBody` trailing-newline collapse regex |
| index.ts:337 | Survived | Regex | `/\n$/` | worth-killing | `normalisedBody` trailing-newline collapse regex (unanchored variant) |
| index.ts:337 | Survived | StringLiteral | `"Stryker was here!"` | worth-killing | `normalisedBody` trailing-newline replacement text |
| index.ts:364 | Survived | ConditionalExpression | `false` | worth-killing | `reducedSources` non-array guard never actually taken by any test's data |
| index.ts:367 | Survived | ConditionalExpression | `false` | worth-killing | `reducedSources` unparseable-entry ternary never actually taken |
| index.ts:377 | Survived | MethodExpression | `Object.keys(frontmatter).toSorted()` | must-kill | drops the `.filter/.map` chain from `canonicalFrontmatter`; see shortlist |
| index.ts:382 | Survived | ConditionalExpression | `true` | must-kill | `canonicalFrontmatter` always reduces as if every key were `sources`; see shortlist |
| index.ts:385 | Survived | StringLiteral | `""` | must-kill | `canonicalFrontmatter`'s `pairs.join(",")` collapsed; see shortlist |
| index.ts:401 | Survived | StringLiteral | `""` | noise | `digest("hex")` encoding argument; low-confidence real-world effect, self-referential test oracle either way |
| index.ts:415 | Survived | ConditionalExpression | `false` | must-kill | `yamlValue` empty-array branch never taken; see shortlist |
| index.ts:419 | Survived | ConditionalExpression | `true` | must-kill | `yamlValue` object/primitive branch; see shortlist |
| index.ts:419 | Survived | LogicalOperator | `typeof item === "object" \|\| item !== null` | must-kill | same branch, `&&`→`\|\|`; see shortlist |
| index.ts:419 | Survived | ConditionalExpression | `true` | must-kill | duplicate node on the same branch; see shortlist |
| index.ts:419 | Survived | ConditionalExpression | `true` | must-kill | duplicate node on the same branch; see shortlist |
| index.ts:421 | Survived | StringLiteral | `""` | must-kill | `yamlValue` multi-entry join separator; see shortlist |
| index.ts:569 | Survived | LogicalOperator | `piece.contentVersion && null` | worth-killing | evidence `contentVersion ?? null` inverted at the mint site; real strings would be nulled out |
| index.ts:572 | Survived | ConditionalExpression | `false` | must-kill | mergeKey/evidence pre-commit guard; see shortlist |
| index.ts:572 | Survived | LogicalOperator | `!mergeKey.success && !evidence.success` | must-kill | same guard, `\|\|`→`&&`; see shortlist |
| index.ts:597 | Survived | ConditionalExpression | `false` | must-kill | `existing.value.ok` — pre-commit membership/role re-check; see shortlist |
| index.ts:736 | Survived | ConditionalExpression | `true` | worth-killing | `landRows` failure error-word fallback; loses the raw `Error` on a non-constraint failure |
| index.ts:739 | Survived | ConditionalExpression | `false` | must-kill | `landed.value.ok` — post-commit membership re-check, TOCTOU window; see shortlist |
| index.ts:813 | Survived | LogicalOperator | `piece.contentVersion && null` | worth-killing | same `contentVersion` inversion at the `landRows` insert site |
| index.ts:1174 | Survived | ConditionalExpression | `false` | worth-killing | `conceptByIri`'s store-failure passthrough |
| index.ts:1199 | Survived | LogicalOperator | `(checked_by===null\|\|checked_at===null) && !isActorId(...)` | must-kill | `checkOf` fail-closed restructure; see shortlist |
| index.ts:1199 | Survived | ConditionalExpression | `false` | must-kill | `checkOf` guard disabled outright — fail-open; see shortlist |
| index.ts:1199 | Survived | LogicalOperator | `checked_by===null && checked_at===null` | must-kill | `checkOf` partial-row case unguarded; see shortlist |
| index.ts:1199 | Survived | ConditionalExpression | `false` | must-kill | duplicate node, same fail-open; see shortlist |
| index.ts:1199 | Survived | ConditionalExpression | `false` | must-kill | duplicate node, same fail-open; see shortlist |
| index.ts:135 | Survived | StringLiteral | `""` | noise | `CONCEPT_ACTS` family string; `declareActs` validates the family/name pairing at import time |
| index.ts:135 | Survived | StringLiteral | `""` | noise | `CONCEPT_ACTS` act-name string; same self-validating machinery |
| index.ts:322 | Survived | ArrayDeclaration | `[]` | must-kill | `UNHASHED_KEYS` emptied; see shortlist |
| index.ts:324 | Survived | StringLiteral | `""` | must-kill | drops `"generated"` from `UNHASHED_KEYS`; see shortlist |
| index.ts:325 | Survived | StringLiteral | `""` | must-kill | drops `"verified"`; see shortlist |
| index.ts:326 | Survived | StringLiteral | `""` | must-kill | drops `"stale_after"`; see shortlist |
| index.ts:327 | Survived | StringLiteral | `""` | must-kill | drops `"status"`; see shortlist |
| index.ts:328 | Survived | StringLiteral | `""` | must-kill | drops `"iri"`; see shortlist |

### src/members/groups.ts

| file:line | status | mutator | replacement (truncated) | verdict | why |
| --- | --- | --- | --- | --- | --- |
| groups.ts:109 | NoCoverage | StringLiteral | `""` | must-kill | `"malformed"` word for `groupTarget`'s id guard; see shortlist |
| groups.ts:183 | NoCoverage | StringLiteral | `""` | must-kill | `"malformed"` word for `renameGroup`'s name guard; see shortlist |
| groups.ts:251 | NoCoverage | StringLiteral | `""` | must-kill | `"malformed"` word for `membershipTarget`'s userId guard; see shortlist |
| groups.ts:109 | Survived | ConditionalExpression | `false` | must-kill | `groupTarget` id-shape validation bypass; see shortlist |
| groups.ts:132 | Survived | ConditionalExpression | `false` | worth-killing | `nothingChanged`'s store-failure passthrough |
| groups.ts:162 | Survived | ConditionalExpression | `false` | worth-killing | `createGroup`'s INSERT store-failure passthrough |
| groups.ts:183 | Survived | ConditionalExpression | `false` | must-kill | `renameGroup` name-shape validation bypass; see shortlist |
| groups.ts:197 | Survived | ConditionalExpression | `false` | worth-killing | `renameGroup`'s UPDATE store-failure passthrough |
| groups.ts:230 | Survived | ConditionalExpression | `false` | worth-killing | `deleteGroup`'s DELETE store-failure passthrough |
| groups.ts:251 | Survived | ConditionalExpression | `false` | must-kill | `membershipTarget` userId-shape validation bypass; see shortlist |
| groups.ts:275 | Survived | ConditionalExpression | `false` | worth-killing | `addToGroup`'s existence-check store-failure passthrough |
| groups.ts:277 | Survived | OptionalChaining | `row.holds_group` | equivalent | the `SELECT EXISTS(...),EXISTS(...)` (no `FROM`) always returns exactly one row, so `row` can never be `undefined` |
| groups.ts:288 | Survived | ConditionalExpression | `false` | worth-killing | `addToGroup`'s INSERT store-failure passthrough |
| groups.ts:315 | Survived | ConditionalExpression | `false` | worth-killing | `removeFromGroup`'s DELETE store-failure passthrough |
| groups.ts:368 | Survived | ConditionalExpression | `false` | worth-killing | `listGroups`'s store-failure passthrough |
| groups.ts:65 | Survived | StringLiteral | `""` | noise | `GROUP_ACTS.created` name string; self-validating via `declareActs` |
| groups.ts:66 | Survived | StringLiteral | `""` | noise | `GROUP_ACTS.renamed` name string; same |
| groups.ts:67 | Survived | StringLiteral | `""` | noise | `GROUP_ACTS.deleted` name string; same |
| groups.ts:68 | Survived | StringLiteral | `""` | noise | `GROUP_ACTS.memberAdded` name string; same |
| groups.ts:69 | Survived | StringLiteral | `""` | noise | `GROUP_ACTS.memberRemoved` name string; same |
| groups.ts:69 | Survived | StringLiteral | `""` | noise | duplicate node on the same declaration; same |

### src/members/requests.ts

| file:line | status | mutator | replacement (truncated) | verdict | why |
| --- | --- | --- | --- | --- | --- |
| requests.ts:231 | NoCoverage | StringLiteral | `""` | must-kill | `"malformed"` word for `claimForDecision`'s id guard; see shortlist |
| requests.ts:350 | NoCoverage | StringLiteral | `""` | worth-killing | `"malformed"` word for `approveRequest`'s invitation boundary parse |
| requests.ts:180 | Survived | ConditionalExpression | `true` | must-kill | masks a real store failure as the neutral acknowledgement; see shortlist |
| requests.ts:185 | Survived | ConditionalExpression | `true` | must-kill | masks a non-constraint store failure as the neutral acknowledgement; see shortlist |
| requests.ts:231 | Survived | ConditionalExpression | `false` | must-kill | `claimForDecision` id-shape validation bypass; see shortlist |
| requests.ts:291 | Survived | ConditionalExpression | `false` | worth-killing | `landDecision`'s UPDATE store-failure passthrough |
| requests.ts:350 | Survived | ConditionalExpression | `false` | worth-killing | `approveRequest`'s invitation boundary-parse guard (internally constructed input) |
| requests.ts:366 | Survived | ConditionalExpression | `false` | worth-killing | `approveRequest`'s INSERT INTO invitation store-failure passthrough |
| requests.ts:378 | Survived | ConditionalExpression | `false` | worth-killing | `approveRequest`'s `landDecision` result passthrough |
| requests.ts:405 | Survived | ConditionalExpression | `false` | worth-killing | `declineRequest`'s `landDecision` result passthrough |
| requests.ts:451 | Survived | ConditionalExpression | `false` | worth-killing | `listWaitingRequests`'s SELECT store-failure passthrough |
| requests.ts:465 | Survived | ConditionalExpression | `false` | worth-killing | `listWaitingRequests`'s row-parse guard |
| requests.ts:64 | Survived | StringLiteral | `""` | noise | `REQUEST_ACTS.asked` name string; self-validating via `declareActs` |
| requests.ts:65 | Survived | StringLiteral | `""` | noise | `REQUEST_ACTS.approved` name string; same |
| requests.ts:65 | Survived | StringLiteral | `""` | noise | duplicate node on the same declaration; same |
| requests.ts:70 | Survived | StringLiteral | `""` | noise | `REQUEST_ACTS.declined` name string; same |

### Settled by T-103 (2026-09-08)

`src/concepts/index.ts`:
- 135 (the `CONCEPT_ACTS` family and act-name strings, "`declareActs` validates the family/name pairing at import time") — equivalent by construction, no code to touch: a blanked family or name fails `declareActs`'s own check the moment the module loads, before any test runs, so the suite cannot see the mutant as anything but a load failure — the same reading as `groups.ts`'s and `requests.ts`'s act-name rows below (review round, 2026-09-09).

`src/members/groups.ts`:
- 277 (`row?.holds_group` after `SELECT EXISTS(...), EXISTS(...)` with no `FROM`) — proved in a comment, not removed: a `SELECT` of two constant `EXISTS` expressions with no `FROM` clause always answers exactly one row, so `row` is never undefined there; the `?.` is for the type, not a real absent row. Comment at ~276-277.
