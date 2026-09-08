# Survivor delta — the T-009 triage re-anchored to run 34165612985

**Purpose.** `docs/research/t-009-survivor-triage.md` walked every surviving `packages/core`
mutant of run **34128668967** (2026-09-07 13:40Z, pre-warm-path). The tree has moved since
(T-054, T-085's warm-path slices T-091–T-094). This is the delta between that report and the
first post-warm-path complete report, run **34165612985** (2026-09-07 22:08Z), so T-086–T-089
know which triage verdicts still describe the code.

Derived from the two runs' `stryker-core` artefacts. Nothing here restates the triage's
per-mutant reasoning — read that document for the verdicts; read this one for what moved.

## Headline: the triage stands

461 live mutants then, 501 now. That is **not** 40 rows of churn — it is 3 resolved and 43
new, and **all 43 new live mutants are in `concepts`**, which is T-089's ticket. Every other
module's live set is byte-identical to what the triage walked.

| module | old total | new total | old live | new live | Δ live | owner |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| access | 5 | 5 | 0 | 0 | +0 | — |
| answering | 354 | 354 | 139 | 139 | **+0** | T-086 |
| audit | 99 | 99 | 23 | 23 | **+0** | T-088 |
| concepts | 262 | 595 | 54 | 96 | **+42** | T-089 |
| kernel | 51 | 56 | 12 | 12 | +0 (1 in, 1 out) | T-088 |
| llm | 25 | 25 | 0 | 0 | +0 | — |
| members | 296 | 296 | 37 | 37 | **+0** | T-089 |
| store | 728 | 728 | 163 | 161 | **−2** | T-087 |
| workspaces | 131 | 131 | 33 | 33 | **+0** | T-088 |
| **total** | **1951** | **2289** | **461** | **501** | +40 | |

One file is new to the report: `src/concepts/inbox.ts` (+333 mutants, +21 live).

**So:** T-086, T-087 and T-088 can work the triage as written. T-089 works the triage **plus**
the 43 rows below.

## Resolved since the triage — do not spend effort here

Live then, not live now. T-087 and T-088 should strike these before planning.

| file | mutator | replacement | note |
| --- | --- | --- | --- |
| `src/kernel/actor.ts` | StringLiteral | `""` | was line 65 |
| `src/store/git/index.ts` | ArrayDeclaration | `[]` | one of the three at old lines 202–204 |
| `src/store/git/index.ts` | StringLiteral | `""` | one of eight occurrences |

T-087's fourth acceptance criterion already asks for the flagged likely-stale verdicts (the git
door trailer, `supersedes()`, the paths/iris Set construction) to be confirmed against a fresh
narrowed run before test effort is spent. This table is that confirmation for two of them; run
the narrowed check for the rest.

## New live since the triage — T-089's addition

43 rows, all `concepts` except one in `kernel`. `inbox.ts` did not exist in the triaged report
at all, so none of it has been walked.

| file | line | status | mutator | replacement |
| --- | ---: | --- | --- | --- |
| concepts/inbox.ts | 63 | Survived | StringLiteral | `""` |
| concepts/inbox.ts | 64 | Survived | StringLiteral | `""` |
| concepts/inbox.ts | 65 | Survived | StringLiteral | `""` |
| concepts/inbox.ts | 112 | NoCoverage | StringLiteral | `` ` ` `` |
| concepts/inbox.ts | 112 | Survived | ConditionalExpression | `false` |
| concepts/inbox.ts | 118 | Survived | BooleanLiteral | `false` |
| concepts/inbox.ts | 118 | Survived | BooleanLiteral | `false` |
| concepts/inbox.ts | 118 | Survived | ObjectLiteral | `{}` |
| concepts/inbox.ts | 125 | Survived | ConditionalExpression | `true` |
| concepts/inbox.ts | 183 | Survived | ConditionalExpression | `false` |
| concepts/inbox.ts | 188 | Survived | MethodExpression | `found.value.rows.every(row => row.proposer !== …)` |
| concepts/inbox.ts | 314 | Survived | ConditionalExpression | `false` |
| concepts/inbox.ts | 315 | Survived | ConditionalExpression | `false` |
| concepts/inbox.ts | 390 | Survived | ConditionalExpression | `false` |
| concepts/inbox.ts | 400 | Survived | ConditionalExpression | `false` |
| concepts/inbox.ts | 430 | NoCoverage | BlockStatement | `{}` |
| concepts/inbox.ts | 430 | Survived | ConditionalExpression | `false` |
| concepts/inbox.ts | 431 | NoCoverage | StringLiteral | `""` |
| concepts/inbox.ts | 437 | Survived | ConditionalExpression | `false` |
| concepts/inbox.ts | 438 | Survived | ConditionalExpression | `false` |
| concepts/inbox.ts | 559 | Survived | OptionalChaining | `found.rows[0].status` |
| concepts/index.ts | 192 | Survived | ConditionalExpression | `false` |
| concepts/index.ts | 193 | Survived | ConditionalExpression | `true` |
| concepts/index.ts | 333 | Survived | StringLiteral | `""` |
| concepts/index.ts | 336 | Survived | StringLiteral | `""` |
| concepts/index.ts | 364 | Survived | ConditionalExpression | `false` |
| concepts/index.ts | 367 | Survived | ConditionalExpression | `false` |
| concepts/index.ts | 416 | NoCoverage | StringLiteral | `""` |
| concepts/index.ts | 416 | Survived | ConditionalExpression | `false` |
| concepts/index.ts | 572 | NoCoverage | StringLiteral | `""` |
| concepts/index.ts | 572 | Survived | ConditionalExpression | `false` |
| concepts/index.ts | 596 | Survived | ConditionalExpression | `false` |
| concepts/index.ts | 739 | Survived | ConditionalExpression | `false` |
| concepts/index.ts | 857 | NoCoverage | BlockStatement | `{}` |
| concepts/index.ts | 857 | Survived | ConditionalExpression | `false` |
| concepts/index.ts | 858 | NoCoverage | StringLiteral | `""` |
| concepts/index.ts | 975 | Survived | MethodExpression | `title.replaceAll(/\s+/gu, " ")` |
| concepts/index.ts | 975 | Survived | Regex | `/\S+/gu` |
| concepts/index.ts | 975 | Survived | Regex | `/\s/gu` |
| concepts/index.ts | 1093 | NoCoverage | BlockStatement | `{}` |
| concepts/index.ts | 1093 | Survived | LogicalOperator | `written.error === "merge-key-taken" && …` |
| concepts/index.ts | 1094 | NoCoverage | StringLiteral | `""` |
| kernel/actor.ts | 81 | Survived | ConditionalExpression | `false` |

Line numbers are run 34165612985's, i.e. the tree at `main` as of 2026-09-07 22:08Z.

The `975` cluster (a `MethodExpression` and two `Regex` mutants on one `title.replaceAll`) and
the `1093` `LogicalOperator` on `merge-key-taken` are the ones worth reading first: they are
normalisation and error-discrimination, which is the class T-089 already calls out as store
failures masked into a neutral answer.

## Matching method, and its one limitation

Mutants are matched on `(file, mutatorName, replacement)` as a multiset per file, never on raw
line number — T-054 moved `src/store/git/index.ts` under the triaged report and line-based
matching would have read the whole file as new. The limitation of a multiset match is that
where a key repeats in a file (`StringLiteral → ""` occurs eight times in the git door), a
count that drops by one says *one of them* resolved, not which. That is why the resolved table
above names an occurrence rather than a line. This is the same limitation T-090's third
acceptance criterion asks the weekly summary to either solve or state.

Re-derive with the two artefacts:

```
gh run download 34128668967 -D old && gh run download 34165612985 -D new
```

## apps/api — new information, not in these four tickets' scope

Run 34165612985 produced **the api tier's first complete mutation report**: 1,812 mutants,
72.63% (1,312 Killed + 4 Timeout, 352 Survived, 144 NoCoverage). Every prior api leg was
cancelled at the job timeout, so the triage has nothing for it. T-086–T-089 are `packages/core`
tickets and should not widen to it — the api survivor backlog wants its own triage and its own
ticket, sequenced by the owner.
