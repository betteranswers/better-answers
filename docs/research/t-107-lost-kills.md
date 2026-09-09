# The 14 rows T-107 could not join — what the fresh report lost, and what it never had

**Purpose.** T-107's proof run (**34305361985**, `b2f65a0`, 2026-09-09 02:59Z) compared per mutant
against the previous full run (**34168928594**, `f16baf1f`, 2026-09-07 23:06Z) and set 14 rows
aside: rows the join reads as *Killed then, live now*, where "the line join cannot tell a lost kill
from a changed line". This walks all 14 — 31 live mutants across them — and says for each which it
is. Nothing here changes a file under `src` or `tests`.

## Headline: no kill was lost

**Of 31 live mutants on the 14 lines, none is a genuine lost kill (a), 29 are the join pairing a
survivor with a different mutant (b), and 2 are a baseline kill that was itself false (c).** For 29
of the 31 the *content-identical* mutant — same file, same mutator, same replacement, same source
text at the span — is in the baseline report too, and it was **live there as well**. There was no
kill to lose. The remaining 2 are `auth/auth.ts:363`'s `"auth.consent"` literal and
`mcp/entries/index.ts:141`'s refine message, both static mutants whose only baseline killer was
`tests/health.test.ts` — the undropped `unmigrated` database that commit `9621317` fixed, and which
the ticket already counts as 441 false kills.

And the correction that matters more than the count: **class (b) does not mean "a new gap".** The
ticket frames it as *the line moved, so the survivor is a new gap to triage on its own merits*. Not
one of these 29 is new. Every one of them is a **standing** survivor — live in run 34168928594 and
live now — that the line join surfaced because a *sibling* mutant on the same line, or the mutant
that used to occupy that line number, carried a real kill. Those sibling kills are all still kills:
every mutant the baseline killed on these 14 lines is killed at HEAD too, bar the one health-test
row. The 14 rows are therefore a **false alarm of the join**, not a regression — but the survivors
under them are a real backlog: **twenty of the 31 are must-kill in six tests**, five more are cheap,
five are equivalent and one is unproven.

Two mechanisms produce the noise, and both are worth naming because the nightly summary will hit
them again:

1. **A line is not a mutant.** `auth/auth.ts:363` holds nine mutants — five killed by
   `tests/oauth-flow.test.ts`, four live — and held exactly the same nine, with the same verdicts,
   in the baseline. A join on `file:line` reports it as a lost kill every night.
2. **`byIdentity`'s duplicate pairing is order-dependent.** `packages/devtools/src/mutation-summary.ts`
   groups mutants by `(file, mutator, replacement, span text)` and pairs duplicates *by index in
   report order* (`newSurvivors`, L175–187). Stryker's `mutants` array is not in line order and its
   order is not stable between runs: for `"auth.consent" → ""` the baseline group reads
   `[L363:27 Survived, L130:22 Killed]` and this run's reads `[L130:22 Killed, L363:27 Survived]`,
   so the surviving mutant at L363 was paired with the *other* occurrence's kill. That is the whole
   of row 4 below.

## The 31 mutants

Line numbers are HEAD's (`9940959`; `src` and `tests` are byte-identical to `b2f65a0`, the proof
run's tree). "Baseline row" is the content-identical mutant in run 34168928594. `apps/api/src` unless
the path says otherwise.

| # | file:line | mutator | replacement | baseline row | killed there by | verdict | reason |
| --- | --- | --- | --- | --- | --- | :---: | --- |
| 1 | `auth/auth.ts:363` c17 | ConditionalExpression | `false` | L363:17 **Survived** (tc 59) | — | **b** | Live in both runs; the join took the same line's `→ true`, a different mutant, still killed by the audit test |
| 2 | `auth/auth.ts:363` c17 | ConditionalExpression | `true` (on `event === "auth.consent"`) | L363:17 **Survived** | — | **b** | As above — the left operand's mutant, live in both runs |
| 3 | `auth/auth.ts:363` c17 | EqualityOperator | `event !== "auth.consent"` | L363:17 **Survived** | — | **b** | Live in both runs |
| 4 | `auth/auth.ts:363` c27 | StringLiteral | `""` (of `"auth.consent"`) | L363:27 **Survived**; paired with L130:22 Killed | `tests/health.test.ts` | **c** | The paired kill is the *other* `"auth.consent"` in `AUDITED_PATHS`, a static mutant killed only by the undropped-database failure (`9621317`); the mutant itself survived in the baseline at the same line and column |
| 5 | `auth/routes.ts:124` c7 | ConditionalExpression | `true` (the whole `sameOrigin`) | L122:7 **Survived** (tc 36) | — | **b** | The file moved two lines under `4876a62` (the Clock, ADR 0040); baseline L124 was `if (!sameOrigin)`, whose kill is still a kill at HEAD L126 |
| 6 | `auth/routes.ts:278` c20 | MethodExpression | drop `.filter(...)` | L275:20 **Survived** | — | **b** | Moved three lines under `4876a62`; baseline L278 was `if (claims === undefined)`, killed then and killed now at L281 |
| 7 | `auth/routes.ts:278` c43 | StringLiteral | `"Stryker was here!"` (the `?? ""` default) | L275:43 **Survived** (tc 2) | — | **b** | Same move; live in both runs |
| 8 | `auth/routes.ts:278` c76 | ConditionalExpression | `true` (of `scope !== ""`) | L275:76 **Survived** | — | **b** | Same move; live in both runs |
| 9 | `auth/routes.ts:278` c86 | StringLiteral | `"Stryker was here!"` (the filter's `""`) | L275:86 **Survived** | — | **b** | Same move; live in both runs |
| 10 | `ingress/spa.ts:48` c49 | ConditionalExpression | `true` (whole `isReadOnly` body) | L48:49 **Survived** (tc 9) | — | **b** | The file was not touched in the range; the same line's six other mutants were killed then and are killed now |
| 11 | `ingress/spa.ts:48` c69 | ConditionalExpression | `false` (of `method === "HEAD"`) | L48:69 **NoCoverage** | — | **b** | Uncovered in both runs |
| 12 | `ingress/spa.ts:48` c69 | EqualityOperator | `method !== "HEAD"` | L48:69 **NoCoverage** | — | **b** | Uncovered in both runs |
| 13 | `ingress/spa.ts:48` c80 | StringLiteral | `""` (of `"HEAD"`) | L48:80 **NoCoverage** | — | **b** | Uncovered in both runs |
| 14 | `mcp/entries/index.ts:141` c24 | ConditionalExpression | `true` (the whole refine) | L141:24 **Survived** (tc 1) | — | **b** | Live in both runs; the line's seven other mutants were killed then and are killed now |
| 15 | `mcp/entries/index.ts:141` c25 | ConditionalExpression | `false` (of `value.iri === undefined`) | L141:25 **Survived** | — | **b** | Live in both runs |
| 16 | `mcp/entries/index.ts:141` c55 | ConditionalExpression | `true` (of `value.locator === undefined`) | L141:55 **Survived** | — | **b** | Live in both runs |
| 17 | `mcp/entries/index.ts:141` c85 | ObjectLiteral | `{}` (the refine's message) | L141:85 **Killed** (tc 3, static) | `tests/health.test.ts` | **c** | The only baseline killer was the health test's `CREATE DATABASE unmigrated` failure; with the drop added in `9621317` 157 tests now run it and none asserts the refusal sentence |
| 18 | `mcp/entries/index.ts:185` c9 | ConditionalExpression | `false` (of `args.iri === undefined`) | L185:9 **Survived** (tc 1) | — | **b** | Live in both runs; the line's three other mutants were killed then and are killed now |
| 19 | `mcp/entries/index.ts:185` c34 | ObjectLiteral | `{}` (the locator arm) | L185:34 **NoCoverage** | — | **b** | Uncovered in both runs |
| 20 | `mcp/entries/index.ts:185` c45 | LogicalOperator | `args.locator && ""` | L185:45 **NoCoverage** | — | **b** | Uncovered in both runs |
| 21 | `mcp/entries/index.ts:185` c61 | StringLiteral | `"Stryker was here!"` | L185:61 **NoCoverage** | — | **b** | Uncovered in both runs |
| 22 | `mcp/surface.ts:90` c23 | ObjectLiteral | `{}` (of `{ tools: {} }`) | L87:23 **Survived** (tc 14) | — | **b** | Moved three lines under `4876a62`; baseline L90 was the `cacheHints` object, killed then and killed now at L93 |
| 23 | `mcp/surface.ts:124` c34 | StringLiteral | `""` (the refusal sentence) | L121:34 **NoCoverage** | — | **b** | Same move; baseline L124 was the `content: [{ type: "text", … }]` line, whose three kills are all still kills at L127 |
| 24 | `ops/index.ts:182` c7 | ConditionalExpression | `false` (of `url === undefined`) | L132:7 **Survived** (tc 3) | — | **b** | `ops/index.ts` gained ~50 lines above this point (`003cf34`, `428d1e6`, `0b88418`, `a1d0be8`); baseline L182 was the smoke check's `401` guard, whose five kills are all still kills at L232 |
| 25 | `ops/index.ts:182` c26 | BlockStatement | `{}` (the usage refusal) | L132:26 **NoCoverage** | — | **b** | Same move; uncovered in both runs |
| 26 | `ops/index.ts:255` c7 | ConditionalExpression | `false` (of `tokens.length === 0`) | L205:7 **Survived** (tc 1) | — | **b** | Same growth; baseline L255 was the `--` separator line, now L525, whose five kills are all still kills |
| 27 | `ops/index.ts:255` c28 | BlockStatement | `{}` (the usage refusal) | L205:28 **NoCoverage** | — | **b** | Same move; uncovered in both runs |
| 28 | `packages/core/src/answering/index.ts:310` c5 | LogicalOperator | `A \|\| B` for `A && B` | L261:5 **Survived** (tc 7) | — | **b** | The file moved 49 lines (`d4d054d`, `bd37574`, `79976f0`); baseline L310 was `if (cited === undefined) return []`, killed then and killed now at L369 |
| 29 | `answering/index.ts:310` c5 | ConditionalExpression | `true` (of the year clause) | L261:5 **Survived** | — | **b** | Same move; live in both runs |
| 30 | `answering/index.ts:310` c37 | ConditionalExpression | `true` (of the month clause) | L261:37 **Survived** | — | **b** | Same move; live in both runs |
| 31 | `answering/index.ts:310` c71 | ConditionalExpression | `true` (of the day clause) | L261:71 **Survived** (tc 6) | — | **b** | Same move; live in both runs |

No test named as a baseline killer was weakened, deleted or moved. All nine of them —
`the audit logs (Q12) …`, `era-independent lists exactly the four entries …`,
`era-independent answers open with structured content …`, `the 2026-07-28 leg returns tools/list …`,
`the api serves the shell on app. (ADR 0006) …` (three), `pnpm ops … smoke …` (three),
`pnpm ops … reads through the -- separator …`, `the pages, as a person walks them …` and
`opening a concept by IRI …` — are present at HEAD under the same names, and both suites grew
(api 183 → 212 tests, core 213 → 468).

No probe was run. Docker was available, so this is not a capability gap: the two artefacts plus the
history decide every one of the 31 rows, and `docs/agents/mutation-triage.md` says to probe only
where they cannot. A probe's `survived` would have added nothing a `Survived` row in both reports
does not already say, and cannot by itself separate a gap from an equivalence.

## What the survivors say about the code

These are platform-behaviour findings, not test-hygiene ones. Each was already true in the baseline;
the join is what made them visible.

**`open` by locator has never been driven through the MCP surface.** Seven of the 31 say it at once.
`mcp/entries/index.ts:185`'s locator arm — `{ locator: args.locator ?? "" }` — is `NoCoverage` in
both runs (rows 19–21), and `args.iri === undefined → false`, which forces the IRI arm always, is
live (row 18). The refine at L141 agrees: mutants 15 and 16 change the answer only for a
locator-only call, and both survive. The entry's own description offers "a concept by its IRI … **or
the passage a citation rests on, by its locator**", and CONTEXT.md defines *open (an MCP entry)* as
exactly that pair. Half of that entry has no test behind it.

**The MCP surface's refusal path is unreached.** `mcp/surface.ts:124` — the
`refusedResult("Your credentials were refused. Sign in again.")` the surface returns when
`withPrincipal` refuses — is `NoCoverage` in both runs (row 23). No test makes a principal refusal
happen behind an MCP entry, so neither the branch nor the sentence a reader sees is held down.

**A declined consent produces no audit event anybody has checked.** At `auth/auth.ts:363` the ledger
writes `outcome: "declined"` only for `event === "auth.consent" && fields.accept === false`. Rows 1,
3 and 4 each change the answer *only* on a decline, and all three survive: the suite drives consent
acceptance (the `→ true` mutants on the same line die at 21–28 tests) and never a refusal. The
*people*-family audit event for a person saying no is unproven.

**The same-origin fence's refusal is never provoked.** `auth/routes.ts:124` computes `sameOrigin`;
forcing it `true` — every request treated as same-origin — survives (row 5), and at L126 both
`if (!sameOrigin) → false` and the refusal block emptied to `{}` are live too. The fence is a
security boundary on the auth routes; the suite exercises only the side that passes.

**The consent page's token scopes are read from an unconstrained string.** `auth/routes.ts:278`
splits `scope` on a space and drops empties. Dropping the `.filter` entirely (row 6), making its
predicate always true (row 8) and rewriting its `""` (row 9) all survive, so no test sends a scope
string with a double or trailing space; rewriting the `?? ""` default (row 7) survives, so no test
loads `/consent` with no `scope` at all. The scopes are what a person is shown in their own words
before they connect a client.

**The SPA seam is only ever driven with GET.** `ingress/spa.ts:48`'s `method === "HEAD"` arm is
uncovered in both runs (rows 11–13), and making `isReadOnly` always true survives (row 10). No test
sends HEAD, and none sends a write method the shell should decline to answer.

**Two `pnpm ops` commands refuse without a flag and nothing reads the refusal.** `smoke` without
`--url` (rows 24–25) and `dump-grep` without `--tokens` (rows 26–27) each say a line and return
`USAGE`; the guard's `false` mutant survives and the block emptied to `{}` is uncovered, in both
runs. Beside them, found on the way: `ops/index.ts:90`'s `argument.startsWith("--") → startsWith("")`
is live at 32 tests — with it, every argument is read as a flag. That row is outside these 14 and
belongs to the nightly's own list.

**One survivor is the code being deliberately redundant, and says so.**
`packages/core/src/answering/index.ts:310` compares all three calendar fields to decide whether a
shelf life names a day that exists. Its own comment (L305–308) explains that a rollover of an
impossible date moves more than one field at once, so the three together are the statement. That is
why rows 28–31 survive, and it is a property of the code, not of the suite — see below.

## Recommended next step

**Must-kill — twenty mutants, six tests.** Every one is reachable through the interface `[TEST1]`
names, and each expected value is a literal `[TEST9]`:

| test to write | kills | where |
| --- | --- | --- |
| `open` an MCP entry **by locator** and assert the passage it answers | 15, 16, 18, 19, 20, 21 | `tests/mcp-surface.test.ts` |
| `open` with **both** an iri and a locator, asserting the refusal sentence `give an iri or a locator, not both and not neither` verbatim | 14, 17 | `tests/mcp-surface.test.ts` |
| a **declined** consent, asserting the audit event's `outcome: "declined"` | 1, 3, 4 | `tests/oauth-flow.test.ts` |
| a POST to an auth route with a foreign `origin`, asserting 403 and the refusal page | 5 | `tests/oauth-flow.test.ts` |
| `/consent` with `scope` doubled-spaced, and a second call with `scope` absent, asserting the scopes named | 6, 7, 8, 9 | `tests/oauth-flow.test.ts` |
| `pnpm ops smoke` with no `--url` and `dump-grep` with no `--tokens`, asserting the line and `USAGE` | 24, 25, 26, 27 | `tests/ops.test.ts` |

Row 17 is the one row of the 14 whose status genuinely changed, and it is the clearest `[TEST9]`
shape in the set: a refusal sentence that was "killed" only by a broken fixture, and that no test
writes down. Row 23 (`mcp/surface.ts:124`) belongs in the same class but needs a principal refusal
staged behind an entry first; it is the largest of these and worth its own ticket rather than a line
in someone else's.

The SPA rows (10–13) are cheap and low-value: one `HEAD /` and one `POST /` against the served build
kill all four. Take them when `apps/web`'s suite is next open, not before.

**Equivalent — five mutants.**

- Rows 28–31, `answering/index.ts:310`, are **class 1 — behaviourally identical, argued from the
  code**. `CALENDAR_DATE` and `OFFSET_DATETIME` are `/^(\d{4})-(\d{2})-(\d{2})…/`, so `month` and
  `day` reach `utcMidnight` as integers in `0…99`. For every such input, if the year shifts then
  `getUTCMonth()` can never equal `month - 1` (a shift needs `month - 1` outside `0…11`, or a day
  roll past December, and `day ≤ 99` cannot span twelve months), and if the year and month land as
  asked then `getUTCDate()` equals `day`. So no input makes exactly one clause false: setting any
  single clause `true`, or turning the first `&&` into `||`, cannot change the result. **No test
  should be written for these** — one could only be written with a call that bypasses the two
  regexes, which is the report inverting the rule.
- Row 2, `auth/auth.ts:363`'s `event === "auth.consent" → true`, is **class 2 — nothing observable
  at this seam**. It differs only when an audited path that is not `/oauth2/consent` carries
  `accept: false`, and `AUDITED_PATHS` names five paths of which only consent has that field. Label
  it as class 2, not class 1: the two functions do differ, and no driver in this tree reaches the
  difference.
- Row 22, `mcp/surface.ts:90`'s `{ tools: {} } → {}`, is **probably class 2 and unproven**: the MCP
  SDK may advertise the tools capability from `registerTool` regardless. Read the SDK before
  spending a test on it; do not write one to move the number.

**False alarms — all 14 rows, as rows.** None is a regression in the suite, and the nightly summary
should stop producing them. Two changes to `packages/devtools/src/mutation-summary.ts` would do it,
and both are `[TEST6]` work rather than triage work:

1. Sort each identity group by `(line, column)` before pairing, so a duplicate span pairs with the
   same occurrence run to run. Stryker's `mutants` array order is not stable, and row 4 is what that
   costs — a survivor reported as a lost kill because two occurrences of `"auth.consent"` swapped
   places between runs.
2. Say in the summary that a `file:line` with both a kill and a survivor is not a delta. The 14 rows
   here were read off a line join, and eleven of them are lines where nothing changed at all.

Both are small, and the second is what T-106 (nightly) needs: a nightly report that names a row a
reader must look at is only useful while a row it names is real.

## Re-deriving this

```
gh run download 34168928594 -R betteranswers/better-answers -D /tmp/mut-baseline   # f16baf1f
gh run download 34305361985 -R betteranswers/better-answers -D /tmp/mut-art        # b2f65a0
```

Mutants are matched on `(file, mutatorName, replacement, span text)` — `spanText` as
`mutation-summary.ts` computes it — and, where a file holds several identical spans, disambiguated by
the mutant's own line and column rather than by group order. Every one of the 31 matched
unambiguously at the same column, at either the same line or a line whose shift a commit in the table
above accounts for.
