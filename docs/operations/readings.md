# Readings

Each measure that the route and its blocks rely on has a section on this page. Each row is one dated reading, newest last. Specs and `docs/operations/RUNBOOK.md` link the section headings, so keep each heading's text unchanged.

A source of "Old route" means that the only record of the figure is `e19cfb9d4^:docs/archive/specs/v01-route-to-2026-10-20.md`, the route spec from before the route was split into briefs. Commit `e19cfb9d4` deleted that file and the other archived spec and ADR that this page cites. This page cites each of them at the parent commit. To read one, run `git show e19cfb9d4^:<path>`.

## Recall at ten on the synthetic sets

Recall is the share of the `Answer`s that each synthetic question names that a ranking returns. The tables read two rankings:

- *`find` at ten* counts the first ten concepts that `find` returns.
- *`ask` at 20* counts the first 20 entry points that the plan step of `ask` returns.

The sets are in `packages/core/test/fixtures/`. `recall-set.json` holds 340 paraphrases of 240 `Answer`s. `buyer-questions.json` holds 86 buyer-worded questions.

The *Set or rule* column names the set and the count:

- *By `Answer` named* counts each `Answer` that a question names. The buyer-worded set names 154.
- *Every `Answer` named* counts the questions whose named `Answer`s all appear.
- *At least one* counts the questions with any named `Answer` in the ranking.
- *None named* asks without the question's collection. *Collection named* and *theirs named* ask within it.

`packages/core/test/budgets/recall.budget.ts` reads both sets. The nightly `budgets` workflow runs it with `pnpm --filter @better-answers/core run budgets`. It reports against a 90 % target and fails no build. An empty cell was not read.

| Date | Release or commit | Set or rule | `find` at ten | `ask` at 20 | Source |
| --- | --- | --- | --- | --- | --- |
| 2026-10-09 | #655 | Paraphrases, by `Answer` named | 249 of 340, 73.2 % | | `docs/archive/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, R23 |
| 2026-10-13 | #721 | Paraphrases, by `Answer` named | 249 of 340, 73.2 % | 265 of 340, 77.9 % | Old route |
| 2026-10-13 | #721 | Paraphrases, each one's collection named | | 276 of 340, 81.2 % | Old route |
| 2026-10-13 | #721 | Buyer-worded, by `Answer` named | 78 of 154, 50.6 % | 92 of 154, 59.7 % | Old route |
| 2026-10-13 | #721 | Buyer-worded, every `Answer` named | 43 of 86, 50.0 % | 50 of 86, 58.1 % | Old route |
| 2026-10-13 | #721 | Buyer-worded, at least one | 60 of 86, 69.8 % | 63 of 86, 73.3 % | Old route |
| 2026-10-13 | #721 | The 72 buyer-worded rows with a collection, none named, by `Answer` named | | 56 of 87, 64.4 % | Old route |
| 2026-10-13 | #721 | The same 72 rows, none named, every `Answer` named | | 44 of 72, 61.1 % | Old route |
| 2026-10-13 | #721 | The same 72 rows, none named, at least one | | 50 of 72, 69.4 % | Old route |
| 2026-10-13 | #721 | The same 72 rows, each one's collection named, by `Answer` named | | 61 of 87, 70.1 % | Old route |
| 2026-10-13 | #721 | The same 72 rows, collection named, every `Answer` named | | 48 of 72, 66.7 % | Old route |
| 2026-10-13 | #721 | The same 72 rows, collection named, at least one | | 55 of 72, 76.4 % | Old route |
| 2026-10-14 | #736 | Paraphrases, by `Answer` named | 247 of 340, 72.6 % | 266 of 340, 78.2 % | `docs/plans/004-rarity-weighted-matching.md` |
| 2026-10-14 | #736 | Paraphrases, collection named | | 276 of 340, 81.2 % | `docs/plans/004-rarity-weighted-matching.md` |
| 2026-10-14 | #736 | Buyer-worded, by `Answer` named | 86 of 154, 55.8 % | 92 of 154, 59.7 % | `docs/plans/004-rarity-weighted-matching.md` |
| 2026-10-14 | #736 | Buyer-worded, every `Answer` named | 45 of 86, 52.3 % | 49 of 86, 57.0 % | `docs/plans/004-rarity-weighted-matching.md` |
| 2026-10-14 | #736 | Buyer-worded, at least one | 60 of 86, 69.8 % | 64 of 86, 74.4 % | `docs/plans/004-rarity-weighted-matching.md` |
| 2026-10-14 | #736 | The 72 buyer-worded rows with a collection, none named, by `Answer` named | | 56 of 87, 64.4 % | `docs/plans/004-rarity-weighted-matching.md` |
| 2026-10-14 | #736 | The same 72 rows, theirs named, by `Answer` named | | 61 of 87, 70.1 % | `docs/plans/004-rarity-weighted-matching.md` |

A probe that is not in the tree read these figures on 2026-10-13. Their source is the old route.

| Set or rule | Figure |
| --- | --- |
| Buyer-worded, every match taken, by `Answer` named | 99 of 154, 64.3 % |
| Buyer-worded, every match taken, every `Answer` named | 56 of 86, 65.1 % |
| Buyer-worded, namings missed at ten that share no word with their question | 55 of 76 |
| Buyer-worded, `ask` at 25, by `Answer` named | 59.7 % |
| Paraphrases, every match taken, by `Answer` named | 276 of 340, 81.2 % |

## The production readings of ask

This measure counts how often a G-Cloud row of the buyer-worded set reaches an `Answer` that answers it. Each row is asked word for word on the first customer's workspace, with no collection named. The reading is taken by hand, as S2b's plan in `docs/archive/plans/2026-10-11-2309-feat-s2b-ask-plan.md` sets out.

The gate is at least one answering `Answer` in the first ten for 70 % of the rows that the bundle answers. The readings differ in method:

- Reading 1 asked through `find`. A session that held the rankings counted the results against titles.
- Reading 2 asked through `ask`. The count used a list fixed blind before the reading.
- The owner read AE1, AE2, and AE14.

| Date | Release or commit | Set or rule | Figure | Source |
| --- | --- | --- | --- | --- |
| 2026-10-13 | Not recorded | Reading 1, at least one in the first ten, the 47 rows the bundle answers by title | 36 of 47, 76.6 % | `docs/archive/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, Risks |
| 2026-10-13 | Not recorded | Reading 1, at least one in the first ten, all 60 rows asked | 36 of 60, 60.0 % | `docs/archive/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, Risks |
| 2026-10-13 | Not recorded | Reading 1, at least one in the first 20, the 47 rows | 42 of 47, 89.4 % | Old route |
| 2026-10-13 | Not recorded | Reading 1, every answering `Answer` in the first ten, the 47 rows | 12 of 47, 25.5 % | Old route |
| 2026-10-13 | Not recorded | Reading 1, every answering `Answer` in the first 20, the 47 rows | 27 of 47, 57.4 % | Old route |
| 2026-10-14 | `release/20261014T184033Z-8d0a501` | Reading 2, at least one in the first ten, the 54 rows the list answers and checklist row 45 | 43 of 55, 78.2 %, or 41 of 55, 74.5 %, at worst | Old route |
| 2026-10-14 | `release/20261014T184033Z-8d0a501` | Reading 2, at least one in the first ten, all 60 G-Cloud rows | 42 of 60, 70.0 % | Old route |
| 2026-10-14 | `release/20261014T184033Z-8d0a501` | Reading 2, at least one in the first 20, the 55 rows | 47 of 55 | Old route |
| 2026-10-14 | `release/20261014T184033Z-8d0a501` | Reading 2, every answering `Answer` in the first ten, the 54 rows | 20 of 54 | Old route |
| 2026-10-14 | `release/20261014T184033Z-8d0a501` | Reading 2, every answering `Answer` in the first 20, the 54 rows | 27 of 54 | Old route |
| 2026-10-21 | `release/20261021T141344Z-5ed685a` | AE1: checklist row 45 through `ask` from claude.ai, `audits` named, judged by Claude Sonnet 5.5 | Pass. Both `audits` `Answer`s fit, word for word with who verified them, and none from `lms` or `website`. Record `01M5FN3X9NRPK3A0R47H6GWV8J` | S2b's plan, *Acceptance Examples* |
| 2026-10-21 | `release/20261021T141344Z-5ed685a` | AE2: the same row, no collection named | Pass. AE1's two `Answer`s under `audits` and two under `website`, *Audit Logs & Buyer Audit Access* among them, with no one retention period stated for every product. No `lms` `Answer` reached the result, though AE14's judge takes one (BA-177). Record `01M5FP1EZS5C1ABP3HDBBVVF3K` | S2b's plan, *Acceptance Examples* |
| 2026-10-21 | `release/20261021T141344Z-5ed685a` | AE14: the same row, `lms` named | Pass. *Buyer audit of user actions* and *Supplier audit trail* fit under `lms`. Record `01M5FP9EY1RDKP9G6DGQ9Y8Q3T` | S2b's plan, *Acceptance Examples* |

## The reuse reading

This measure counts how many of the reuse set's 32 fits the judge takes, and how many of its 36 hard negatives it wrongly takes. Each row also gives the run's spend and the judge's latency. The set is `packages/core/test/fixtures/reuse-set.json`. The procedure is *Read the judge on the reuse set* in `docs/operations/RUNBOOK.md`, which runs `pnpm reading:reuse` from `packages/core`. No threshold is set. Spend is in pounds at £0.747 to the dollar. Every row's source is `pnpm reading:reuse`.

| Date | Release or commit | Model and effort | Fits of 32 | Hard negatives taken of 36 | Other `Answer`s taken | Answered of 34 | Spend | Latency median, worst |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-21 | `76513a867` | Claude Sonnet 5.5, high, its default | 28 | 0 | 0 | 34, 0 never sent | £0.123 | 2,195 ms, 5,849 ms |
| 2026-10-21 | `76513a867` | Claude Sonnet 5.5, low | 28 | 0 | 0 | 34, 0 never sent | £0.123 | 1,674 ms, 8,834 ms |
| 2026-10-21 | `76513a867` | Claude Haiku 5.5, medium, its default | 28 | 0 | 0 | 34, 0 never sent | £0.0079 | 2,385 ms, 8,212 ms |
| 2026-10-21 | `76513a867` | Claude Haiku 5.5, low | 26 | 0 | 0 | 34, 0 never sent | £0.0065 | 1,469 ms, 5,212 ms |

The three runs at 28 of 32 miss the same four fits. Each of the four is a two-part question whose `Answer` answers one part. Two ask about encryption at rest and in transit. Two ask about each module's audit log. Claude Haiku 5.5 at effort low misses the two audit-log fits and four one-part fits.

## The decision reading

This measure reads Clef-flash and Clef in two roles. On the reuse set, each is the judge's decision backend at thresholds 0.3, 0.5, 0.7, and 0.9. At the entry step, each reorders the first 20 entry points, and the reading is recall in the first ten. The procedure is *Read the decision models* in `docs/operations/RUNBOOK.md`, which runs `pnpm reading:decision` from `packages/core`. The reading exists to choose a threshold. None is set. Spend is in pounds at £0.747 to the dollar. Every row's source is `pnpm reading:decision`.

| Date | Release or commit | Model on reuse, threshold | Fits of 32 | Hard negatives taken of 36 | Other `Answer`s taken | Spend | Latency median |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-21 | `76513a867` | Clef-flash, 0.3 | 29 | 16 | 257 | £0.0020 | 715 ms |
| 2026-10-21 | `76513a867` | Clef-flash, 0.5 | 26 | 12 | 234 | £0.0020 | 759 ms |
| 2026-10-21 | `76513a867` | Clef-flash, 0.7 | 25 | 7 | 210 | £0.0020 | 875 ms |
| 2026-10-21 | `76513a867` | Clef-flash, 0.9 | 14 | 2 | 113 | £0.0020 | 755 ms |
| 2026-10-21 | `76513a867` | Clef, 0.3 | 30 | 1 | 160 | £0.0126 | 380 ms |
| 2026-10-21 | `76513a867` | Clef, 0.5 | 29 | 0 | 103 | £0.0126 | 357 ms |
| 2026-10-21 | `76513a867` | Clef, 0.7 | 27 | 0 | 53 | £0.0126 | 362 ms |
| 2026-10-21 | `76513a867` | Clef, 0.9 | 20 | 0 | 11 | £0.0126 | 382 ms |

The entry-step rows give recall in the first ten after reordering. Without reordering, recall is 72.6 % for paraphrases and 55.8 % for buyer-worded rows.

| Date | Release or commit | Model at the entry step | Paraphrases, reordered | Buyer-worded, reordered | Tokens in |
| --- | --- | --- | --- | --- | --- |
| 2026-10-21 | `76513a867` | Clef-flash | 77.9 %, 8 unscored | 53.9 %, 1 unscored | 835,709 |
| 2026-10-21 | `76513a867` | Clef | 77.9 %, 8 unscored | 55.8 %, 1 unscored | 835,709 |

A hand check of the first twelve other `Answer`s that Clef took at threshold 0.7 found that each answers a different question. For example, an uptime question took an `Answer` about whether contractors are background checked. Claude Sonnet 5.5 and Claude Haiku 5.5 take no other `Answer`s, as *The reuse reading* shows. No threshold makes either Clef model a judge on this set. A threshold that keeps out the hard negatives still takes unrelated `Answer`s. At the entry step, reordering by either Clef model lifts paraphrase recall by 5.3 points and leaves buyer-worded recall level or lower.

**The owner's choice, 2026-10-21.** Phew's workspace judges with Claude Sonnet 5.5 at its default effort. No decision model has a threshold. On the reuse set, Sonnet 5.5 took 28 of 32 fits, with no hard negative and no unrelated `Answer`. Clef and Clef-flash took unrelated `Answer`s at every threshold read. Claude Haiku 5.5 at its default effort matched Sonnet 5.5 at about a fifteenth of the cost. The set's 34 questions cannot tell the two models apart, so Haiku waits for a larger set.

## The governed write at 3,000 concepts

This measure times one governed concept write through the core interface as the workspace grows to 3,000 concepts. It also times the part of the write that the creation-time backfill takes. The probe is `packages/core/test/budgets/write-budget.budget.ts`. The nightly `budgets` workflow runs it with `pnpm --filter @better-answers/core run budgets`. S3's plan must keep or beat the write's own time.

| Date | Release or commit | Set or rule | Figure | Source |
| --- | --- | --- | --- | --- |
| 2026-09-10 | A probe branch, never merged | One governed write, from 250 to 3,000 concepts | About 0.9 s, flat | Old route |
| 2026-09-10 | A probe branch, never merged | The backfill scan inside one write, at 3,000 concepts | 31 to 42 ms of about 960 ms | Old route |
| 2026-10-22 | `0ca741960` with the probe commit | One governed write landing a concept three seeded bodies link, at 3,000 concepts, median of five runs' medians of 74.5, 123.5, 73.4, 71.3 and 72.4 ms, interleaved with the head runs on a machine at a one-minute load of 3 to 12 | 73.4 ms | `packages/core/test/budgets/write-budget.budget.ts` |
| 2026-10-22 | `0ca741960` with the probe commit | The backfill scan inside one delta at 3,000 concepts, median of five runs' medians of 22.3, 41.8, 23.0, 22.1 and 21.9 ms | 22.3 ms | `packages/core/test/budgets/write-budget.budget.ts` |
| 2026-10-22 | BA-233's branch (#890), the keyed lookup | One governed write as above, median of five runs' medians of 144.7, 118.3, 58.6, 54.9 and 55.8 ms | 58.6 ms | `packages/core/test/budgets/write-budget.budget.ts` |
| 2026-10-22 | BA-233's branch (#890), the keyed lookup | The keyed lookup and re-derivation inside one delta, as above, median of five runs' medians of 5.6, 14.4, 6.4, 6.3 and 5.8 ms | 6.3 ms | `packages/core/test/budgets/write-budget.budget.ts` |

## The cascade ceiling

This measure times a narrowing over one connected source inside the workspace's cascade lock. The workspace holds 3,000 concepts written through the core interface, and the number in each row cite the source's documents. A probe that is not in the tree takes the reading. No threshold is set. S4's cost estimate and O1's threshold are priced from this figure. Every row's source is `e19cfb9d4^:docs/archive/specs/s1-one-uploaded-document-to-a-cited-passage.md`.

| Date | Release or commit | Set or rule | Figure |
| --- | --- | --- | --- |
| 2026-09-10 | A probe branch, never merged | Narrowing, 300 citing concepts | 995 ms, 3.3 ms per citing concept |
| 2026-09-27 | `ac4f5c8d` | Narrowing, 300 citing concepts, median of three runs of 1,028, 1,106 and 1,116 ms on an Apple M4 Pro | 1,106 ms, 3.7 ms per citing concept |
| 2026-09-27 | `ac4f5c8d` | Narrowing, 600 citing concepts, one run | 2,110 ms, 3.5 ms per citing concept |
| 2026-09-27 | `ac4f5c8d` | Widening, 300 citing concepts, median of three runs | 1,057 ms |

## The worker's box figures

This measure is the worker's memory and swap at the container's cgroup. The deploy unit caps memory at 1.5 GB with 1.5 GB of spill. Readings are taken by hand over the seam's fixture page and both converters' fixtures. The signal for step A is swap-in above 4 MB/s for five minutes during a first index. S4 reads that signal next, on the first customer's first index. Every row's source is `e19cfb9d4^:docs/archive/adr/0024-forge-is-bare-git-repositories.md`.

| Date | Release or commit | Set or rule | Figure |
| --- | --- | --- | --- |
| 2026-09-23 | The tree's image, emulated `linux/amd64` on an Apple M4 Pro | The weights loaded twice, `memory.peak`, three capped runs | 1,536 MB in all three, the cap |
| 2026-09-23 | The same | The weights loaded twice, `memory.swap.peak`, three capped runs | 1,474, 1,456 and 1,473 MB |
| 2026-09-23 | The same | Swap-in during detection, three pages | 3.8 to 4.6 MB/s |
| 2026-09-23 | The same | The seam, ms per page under the limit | 5,579, 6,453 and 5,273 |
| 2026-09-23 | Image `e95f0c16` on VPC 1 | The weights loaded twice, `memory.peak`, three capped runs | 1,536 MB in all three, the cap |
| 2026-09-23 | The same | The weights loaded twice, `memory.swap.peak` | 1,401, 1,509 and 1,302 MB |
| 2026-09-23 | Image `1587e0c1` on VPC 1, the detector patched | The weights held once, `memory.peak`, three capped runs and one uncapped | 1,032, 712 and 758 MB, uncapped 718 MB |
| 2026-09-23 | The same | The weights held once, `memory.swap.peak` | 0 in all four |
| 2026-09-23 | The same | The weights held once, settled 30 s after the last page | 650 to 656 MB anonymous plus 4 to 324 MB of file-backed weights |
| 2026-09-23 | The same | The weights held once, swap-in | 5 to 7 pages per run |
| 2026-09-23 | The same | The weights held once, the seam, median of three, ms per page | 3,209, 3,016 and 3,254, uncapped 3,119 |
