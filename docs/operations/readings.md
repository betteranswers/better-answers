# Readings

Every measurement the route and its blocks rely on, one dated row under its measure, newest last. A brief that names a threshold links the measure's heading here. "Old route, archived" means the figure's only record is the route spec as it stood before the route was split into briefs, frozen as `docs/archive/specs/v01-route-to-2026-10-20.md`.

## Recall at ten on the synthetic sets

The share of the `Answer`s each synthetic question names that `find` returns in its first ten, or `ask`'s plan step in its first 20 entry points, over the 340 paraphrases and the 86 buyer-worded rows in `packages/core/test/fixtures/`, read in `check` by `packages/core/test/answering/recall.test.ts` against a 90 % target that is reported and fails no build.

| Date | Release or commit | Set or rule | Figure | Source |
| --- | --- | --- | --- | --- |
| 2026-10-09 | #655 | Paraphrases, `find`, first ten, by `Answer` named | 249 of 340, 73.2 % | `docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, R23 |
| 2026-10-13 | #721 | Paraphrases, `find`, first ten, by `Answer` named | 249 of 340, 73.2 % | Old route, archived |
| 2026-10-13 | #721 | Paraphrases, `ask`'s plan step, first 20, by `Answer` named | 265 of 340, 77.9 % | Old route, archived |
| 2026-10-13 | #721 | Paraphrases, `ask`'s plan step, first 20, each one's collection named | 276 of 340, 81.2 % | Old route, archived |
| 2026-10-13 | #721 | Buyer-worded, `find`, first ten, by `Answer` named | 78 of 154, 50.6 % | Old route, archived |
| 2026-10-13 | #721 | Buyer-worded, `find`, first ten, every `Answer` named | 43 of 86, 50.0 % | Old route, archived |
| 2026-10-13 | #721 | Buyer-worded, `find`, first ten, at least one | 60 of 86, 69.8 % | Old route, archived |
| 2026-10-13 | #721 | Buyer-worded, `ask`'s plan step, first 20, by `Answer` named | 92 of 154, 59.7 % | Old route, archived |
| 2026-10-13 | #721 | Buyer-worded, `ask`'s plan step, first 20, every `Answer` named | 50 of 86, 58.1 % | Old route, archived |
| 2026-10-13 | #721 | Buyer-worded, `ask`'s plan step, first 20, at least one | 63 of 86, 73.3 % | Old route, archived |
| 2026-10-13 | #721 | Buyer-worded, the 72 rows with a collection, `ask`'s plan step, first 20, none named, by `Answer` named | 56 of 87, 64.4 % | Old route, archived |
| 2026-10-13 | #721 | The same 72 rows, none named, every `Answer` named | 44 of 72, 61.1 % | Old route, archived |
| 2026-10-13 | #721 | The same 72 rows, none named, at least one | 50 of 72, 69.4 % | Old route, archived |
| 2026-10-13 | #721 | The same 72 rows, each one's collection named, by `Answer` named | 61 of 87, 70.1 % | Old route, archived |
| 2026-10-13 | #721 | The same 72 rows, collection named, every `Answer` named | 48 of 72, 66.7 % | Old route, archived |
| 2026-10-13 | #721 | The same 72 rows, collection named, at least one | 55 of 72, 76.4 % | Old route, archived |
| 2026-10-13 | A probe not in the tree | Buyer-worded, every match taken, by `Answer` named | 99 of 154, 64.3 % | Old route, archived |
| 2026-10-13 | A probe not in the tree | Buyer-worded, every match taken, every `Answer` named | 56 of 86, 65.1 % | Old route, archived |
| 2026-10-13 | A probe not in the tree | Buyer-worded, namings missed at ten that share no word with their question | 55 of 76 | Old route, archived |
| 2026-10-13 | A probe not in the tree | Buyer-worded, `ask`'s plan step, first 25, by `Answer` named | 59.7 % | Old route, archived |
| 2026-10-13 | A probe not in the tree | Paraphrases, every match taken, by `Answer` named | 276 of 340, 81.2 % | Old route, archived |
| 2026-10-14 | #736 | Paraphrases, `find`, first ten, by `Answer` named | 247 of 340, 72.6 % | `docs/plans/2026-10-14-1845-feat-rarity-weighted-matching-plan.md` |
| 2026-10-14 | #736 | Paraphrases, `ask`, first 20, by `Answer` named | 266 of 340, 78.2 % | `docs/plans/2026-10-14-1845-feat-rarity-weighted-matching-plan.md` |
| 2026-10-14 | #736 | Paraphrases, `ask`, first 20, collection named | 276 of 340, 81.2 % | `docs/plans/2026-10-14-1845-feat-rarity-weighted-matching-plan.md` |
| 2026-10-14 | #736 | Buyer-worded, `find`, first ten, by `Answer` named | 86 of 154, 55.8 % | `docs/plans/2026-10-14-1845-feat-rarity-weighted-matching-plan.md` |
| 2026-10-14 | #736 | Buyer-worded, `find`, first ten, every `Answer` named | 45 of 86, 52.3 % | `docs/plans/2026-10-14-1845-feat-rarity-weighted-matching-plan.md` |
| 2026-10-14 | #736 | Buyer-worded, `find`, first ten, at least one | 60 of 86, 69.8 % | `docs/plans/2026-10-14-1845-feat-rarity-weighted-matching-plan.md` |
| 2026-10-14 | #736 | Buyer-worded, `ask`, first 20, by `Answer` named | 92 of 154, 59.7 % | `docs/plans/2026-10-14-1845-feat-rarity-weighted-matching-plan.md` |
| 2026-10-14 | #736 | Buyer-worded, `ask`, first 20, every `Answer` named | 49 of 86, 57.0 % | `docs/plans/2026-10-14-1845-feat-rarity-weighted-matching-plan.md` |
| 2026-10-14 | #736 | Buyer-worded, `ask`, first 20, at least one | 64 of 86, 74.4 % | `docs/plans/2026-10-14-1845-feat-rarity-weighted-matching-plan.md` |
| 2026-10-14 | #736 | Buyer-worded, the 72 rows with a collection, `ask`, none named, by `Answer` named | 56 of 87, 64.4 % | `docs/plans/2026-10-14-1845-feat-rarity-weighted-matching-plan.md` |
| 2026-10-14 | #736 | The same 72 rows, `ask`, theirs named, by `Answer` named | 61 of 87, 70.1 % | `docs/plans/2026-10-14-1845-feat-rarity-weighted-matching-plan.md` |

## The production readings of ask

How often a G-Cloud row of the buyer-worded set, asked word for word with no collection named on the first customer's workspace, reaches an `Answer` that answers it, taken by hand as S2b's plan sets out in `docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, with a gate of at least one answering `Answer` in the first ten for 70 % of the rows the bundle answers.

| Date | Release or commit | Set or rule | Figure | Source |
| --- | --- | --- | --- | --- |
| 2026-10-13 | Not recorded | Reading 1 through `find`, counted against titles by a session that held the rankings, at least one in the first ten, the 47 rows the bundle answers by title | 36 of 47, 76.6 % | `docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, Risks |
| 2026-10-13 | Not recorded | Reading 1 through `find`, counted against titles by a session that held the rankings, at least one in the first ten, all 60 rows asked | 36 of 60, 60.0 % | `docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, Risks |
| 2026-10-13 | Not recorded | Reading 1 through `find`, counted against titles by a session that held the rankings, at least one in the first 20, the 47 rows | 42 of 47, 89.4 % | Old route, archived |
| 2026-10-13 | Not recorded | Reading 1 through `find`, counted against titles by a session that held the rankings, every answering `Answer` in the first ten, the 47 rows | 12 of 47, 25.5 % | Old route, archived |
| 2026-10-13 | Not recorded | Reading 1 through `find`, counted against titles by a session that held the rankings, every answering `Answer` in the first 20, the 47 rows | 27 of 47, 57.4 % | Old route, archived |
| 2026-10-14 | `release/20261014T184033Z-8d0a501` | Reading 2 through `ask`, counted against a list fixed blind beforehand, at least one in the first ten, the 54 rows the list answers and checklist row 45 | 43 of 55, 78.2 %, or 41 of 55, 74.5 %, at worst | Old route, archived |
| 2026-10-14 | `release/20261014T184033Z-8d0a501` | Reading 2 through `ask`, counted against a list fixed blind beforehand, at least one in the first ten, all 60 G-Cloud rows | 42 of 60, 70.0 % | Old route, archived |
| 2026-10-14 | `release/20261014T184033Z-8d0a501` | Reading 2 through `ask`, counted against a list fixed blind beforehand, at least one in the first 20, the 55 rows | 47 of 55 | Old route, archived |
| 2026-10-14 | `release/20261014T184033Z-8d0a501` | Reading 2 through `ask`, counted against a list fixed blind beforehand, every answering `Answer` in the first ten, the 54 rows | 20 of 54 | Old route, archived |
| 2026-10-14 | `release/20261014T184033Z-8d0a501` | Reading 2 through `ask`, counted against a list fixed blind beforehand, every answering `Answer` in the first 20, the 54 rows | 27 of 54 | Old route, archived |
| 2026-10-21 | `release/20261021T141344Z-5ed685a` | AE1: checklist row 45 through `ask` from claude.ai, `audits` named, judged by Claude Sonnet 5.5 | Pass, read by the owner. Both `audits` `Answer`s fit, word for word with who verified them, and none from `lms` or `website`. Record `01M5FN3X9NRPK3A0R47H6GWV8J` | S2b's plan, *Acceptance Examples* |
| 2026-10-21 | `release/20261021T141344Z-5ed685a` | AE2: the same row, no collection named | Pass, read by the owner. AE1's two `Answer`s under `audits` and two under `website`, *Audit Logs & Buyer Audit Access* among them, with no one retention period stated for every product. No `lms` `Answer` reached the result, though AE14's judge takes one (BA-177). Record `01M5FP1EZS5C1ABP3HDBBVVF3K` | S2b's plan, *Acceptance Examples* |
| 2026-10-21 | `release/20261021T141344Z-5ed685a` | AE14: the same row, `lms` named | Pass, read by the owner. *Buyer audit of user actions* and *Supplier audit trail* fit under `lms`. Record `01M5FP9EY1RDKP9G6DGQ9Y8Q3T` | S2b's plan, *Acceptance Examples* |

## The reuse reading

How many of the reuse set's 32 fits the judge takes, and how many of its 36 hard negatives it wrongly takes, with the run's spend and the judge's latency, run by the owner with `pnpm reading:reuse` from `packages/core` as `docs/operations/RUNBOOK.md` sets out under *Read the judge on the reuse set*, with no threshold set.

| Date | Release or commit | Set or rule | Figure | Source |
| --- | --- | --- | --- | --- |
| 2026-10-21 | `76513a867` | Claude Sonnet 5.5 at effort high, its default, at £0.747 to the dollar | Fits 28 of 32, hard negatives wrongly taken 0 of 36, other `Answer`s taken 0, 34 of 34 answered, none never sent; £0.123; latency median 2,195 ms, worst 5,849 ms | `pnpm reading:reuse` |
| 2026-10-21 | `76513a867` | Claude Sonnet 5.5 at effort low, at £0.747 to the dollar | Fits 28 of 32, hard negatives wrongly taken 0 of 36, other `Answer`s taken 0, 34 of 34 answered, none never sent; £0.123; latency median 1,674 ms, worst 8,834 ms | `pnpm reading:reuse` |
| 2026-10-21 | `76513a867` | Claude Haiku 5.5 at effort medium, its default, at £0.747 to the dollar | Fits 28 of 32, hard negatives wrongly taken 0 of 36, other `Answer`s taken 0, 34 of 34 answered, none never sent; £0.0079; latency median 2,385 ms, worst 8,212 ms | `pnpm reading:reuse` |
| 2026-10-21 | `76513a867` | Claude Haiku 5.5 at effort low, at £0.747 to the dollar | Fits 26 of 32, hard negatives wrongly taken 0 of 36, other `Answer`s taken 0, 34 of 34 answered, none never sent; £0.0065; latency median 1,469 ms, worst 5,212 ms | `pnpm reading:reuse` |

The three runs at 28 of 32 miss the same four fits. Each is a question in two parts, and the `Answer` answers one of them. Two ask about encryption at rest and in transit, and two about each module's audit log. Effort low on Haiku 5.5 misses the two audit-log fits and four fits whose question has one part.

## The decision reading

How Clef-flash and Clef do as the judge's decision backend on the reuse set at thresholds 0.3, 0.5, 0.7 and 0.9, and as a reordering of the entry step's first 20 points read as recall in the first ten, run by the owner with `pnpm reading:decision` from `packages/core` as `docs/operations/RUNBOOK.md` sets out under *Read the decision models*, and read to choose a threshold, since none is set.

| Date | Release or commit | Set or rule | Figure | Source |
| --- | --- | --- | --- | --- |
| 2026-10-21 | `76513a867` | Clef-flash on reuse at threshold 0.3, at £0.747 to the dollar | Fits 29 of 32, hard negatives wrongly taken 16 of 36, other `Answer`s taken 257; £0.0020; latency median 715 ms | `pnpm reading:decision` |
| 2026-10-21 | `76513a867` | Clef-flash on reuse at threshold 0.5 | Fits 26 of 32, hard negatives wrongly taken 12 of 36, other `Answer`s taken 234; £0.0020; latency median 759 ms | `pnpm reading:decision` |
| 2026-10-21 | `76513a867` | Clef-flash on reuse at threshold 0.7 | Fits 25 of 32, hard negatives wrongly taken 7 of 36, other `Answer`s taken 210; £0.0020; latency median 875 ms | `pnpm reading:decision` |
| 2026-10-21 | `76513a867` | Clef-flash on reuse at threshold 0.9 | Fits 14 of 32, hard negatives wrongly taken 2 of 36, other `Answer`s taken 113; £0.0020; latency median 755 ms | `pnpm reading:decision` |
| 2026-10-21 | `76513a867` | Clef on reuse at threshold 0.3 | Fits 30 of 32, hard negatives wrongly taken 1 of 36, other `Answer`s taken 160; £0.0126; latency median 380 ms | `pnpm reading:decision` |
| 2026-10-21 | `76513a867` | Clef on reuse at threshold 0.5 | Fits 29 of 32, hard negatives wrongly taken 0 of 36, other `Answer`s taken 103; £0.0126; latency median 357 ms | `pnpm reading:decision` |
| 2026-10-21 | `76513a867` | Clef on reuse at threshold 0.7 | Fits 27 of 32, hard negatives wrongly taken 0 of 36, other `Answer`s taken 53; £0.0126; latency median 362 ms | `pnpm reading:decision` |
| 2026-10-21 | `76513a867` | Clef on reuse at threshold 0.9 | Fits 20 of 32, hard negatives wrongly taken 0 of 36, other `Answer`s taken 11; £0.0126; latency median 382 ms | `pnpm reading:decision` |
| 2026-10-21 | `76513a867` | Clef-flash at the entry step, recall in the first ten | Paraphrases 77.9 % reordered against 72.6 % for `find` and the entry step, 8 unscored; buyer-worded 53.9 % against 55.8 %, 1 unscored; 835,709 tokens in | `pnpm reading:decision` |
| 2026-10-21 | `76513a867` | Clef at the entry step, recall in the first ten | Paraphrases 77.9 % reordered against 72.6 %, 8 unscored; buyer-worded 55.8 % against 55.8 %, 1 unscored; 835,709 tokens in | `pnpm reading:decision` |

The first twelve other `Answer`s Clef took at threshold 0.7, read by hand, each answer a different question from the one asked, such as an uptime question taking whether contractors are background checked. Claude Sonnet 5.5 and Claude Haiku 5.5 take none (§ The reuse reading). So no threshold makes either model a judge on this set: one that keeps out the hard negatives still takes unrelated `Answer`s, and at 0.9 Clef finds 20 of 32 fits. At the entry step, reordering by either model lifts paraphrase recall by 5.3 points and leaves buyer-worded recall level or lower.

**The owner's choice from the two readings (21/10/2026).** Phew's workspace judges with Claude Sonnet 5.5 at its default effort, and no decision model has a threshold. Sonnet 5.5 took 28 of 32 fits on the reuse set, with no hard negative and no unrelated `Answer`. Clef and Clef-flash took unrelated `Answer`s at every threshold read. Claude Haiku 5.5 at its default effort matched Sonnet 5.5 at about a fifteenth of the cost, but 34 questions cannot tell the two apart, so Haiku waits for a larger set.

## The governed write at 3,000 concepts

How long one governed concept write takes as the workspace grows to 3,000 concepts, and how much of it the creation-time backfill takes, read through the core interface. The rows of 2026-09-10 came from a probe that was never merged. Since 2026-10-21 the probe is `packages/core/test/budgets/write-budget.budget.ts`, and the write's own time is the figure S3's plan keeps or beats.

| Date | Release or commit | Set or rule | Figure | Source |
| --- | --- | --- | --- | --- |
| 2026-09-10 | A probe branch, never merged | One governed write, from 250 to 3,000 concepts | About 0.9 s, flat | Old route, archived |
| 2026-09-10 | A probe branch, never merged | The backfill scan inside one write, at 3,000 concepts | 31 to 42 ms of about 960 ms | Old route, archived |
| 2026-10-22 | `0ca741960` with the probe commit | One governed write landing a concept three seeded bodies link, at 3,000 concepts, median of five runs' medians of 74.5, 123.5, 73.4, 71.3 and 72.4 ms, interleaved with the head runs on a machine at a one-minute load of 3 to 12 | 73.4 ms | `packages/core/test/budgets/write-budget.budget.ts` |
| 2026-10-22 | `0ca741960` with the probe commit | The backfill scan inside one delta at 3,000 concepts, median of five runs' medians of 22.3, 41.8, 23.0, 22.1 and 21.9 ms | 22.3 ms | `packages/core/test/budgets/write-budget.budget.ts` |
| 2026-10-22 | BA-233's branch (#890), the keyed lookup | One governed write as above, median of five runs' medians of 144.7, 118.3, 58.6, 54.9 and 55.8 ms | 58.6 ms | `packages/core/test/budgets/write-budget.budget.ts` |
| 2026-10-22 | BA-233's branch (#890), the keyed lookup | The keyed lookup and re-derivation inside one delta, as above, median of five runs' medians of 5.6, 14.4, 6.4, 6.3 and 5.8 ms | 6.3 ms | `packages/core/test/budgets/write-budget.budget.ts` |

## The cascade ceiling

How long a narrowing over one connected source takes when a number of concepts cite its documents, inside the workspace's cascade lock, over 3,000 concepts written through the core interface and timed by a probe that is not in the tree, with no threshold set and S4's cost estimate and O1's threshold priced from the figure.

| Date | Release or commit | Set or rule | Figure | Source |
| --- | --- | --- | --- | --- |
| 2026-09-10 | A probe branch, never merged | Narrowing, 300 citing concepts | 995 ms, 3.3 ms per citing concept | `docs/archive/specs/s1-one-uploaded-document-to-a-cited-passage.md` |
| 2026-09-27 | `ac4f5c8d` | Narrowing, 300 citing concepts, median of three runs of 1,028, 1,106 and 1,116 ms on an Apple M4 Pro | 1,106 ms, 3.7 ms per citing concept | `docs/archive/specs/s1-one-uploaded-document-to-a-cited-passage.md` |
| 2026-09-27 | `ac4f5c8d` | Narrowing, 600 citing concepts, one run | 2,110 ms, 3.5 ms per citing concept | `docs/archive/specs/s1-one-uploaded-document-to-a-cited-passage.md` |
| 2026-09-27 | `ac4f5c8d` | Widening, 300 citing concepts, median of three runs | 1,057 ms | `docs/archive/specs/s1-one-uploaded-document-to-a-cited-passage.md` |

## The worker's box figures

The worker's memory and swap at the container's cgroup under the deploy unit's 1.5 GB cap and 1.5 GB of spill, over the seam's fixture page and both converters' fixtures, read by hand, with ADR 0025's step-A signal at swap-in above 4 MB/s for five minutes during a first index, which S4's first index reads next.

| Date | Release or commit | Set or rule | Figure | Source |
| --- | --- | --- | --- | --- |
| 2026-09-23 | The tree's image, emulated `linux/amd64` on an Apple M4 Pro | The weights loaded twice, `memory.peak`, three capped runs | 1,536 MB in all three, the cap | `docs/archive/adr/0024-forge-is-bare-git-repositories.md` |
| 2026-09-23 | The same | The weights loaded twice, `memory.swap.peak`, three capped runs | 1,474, 1,456 and 1,473 MB | `docs/archive/adr/0024-forge-is-bare-git-repositories.md` |
| 2026-09-23 | The same | Swap-in during detection, three pages | 3.8 to 4.6 MB/s | `docs/archive/adr/0024-forge-is-bare-git-repositories.md` |
| 2026-09-23 | The same | The seam, ms per page under the limit | 5,579, 6,453 and 5,273 | `docs/archive/adr/0024-forge-is-bare-git-repositories.md` |
| 2026-09-23 | Image `e95f0c16` on VPC 1 | The weights loaded twice, `memory.peak`, three capped runs | 1,536 MB in all three, the cap | `docs/archive/adr/0024-forge-is-bare-git-repositories.md` |
| 2026-09-23 | Image `e95f0c16` on VPC 1 | The weights loaded twice, `memory.swap.peak` | 1,401, 1,509 and 1,302 MB | `docs/archive/adr/0024-forge-is-bare-git-repositories.md` |
| 2026-09-23 | Image `1587e0c1` on VPC 1, the detector patched | The weights held once, `memory.peak`, three capped runs and one uncapped | 1,032, 712 and 758 MB, uncapped 718 MB | `docs/archive/adr/0024-forge-is-bare-git-repositories.md` |
| 2026-09-23 | Image `1587e0c1` on VPC 1, the detector patched | The weights held once, `memory.swap.peak` | 0 in all four | `docs/archive/adr/0024-forge-is-bare-git-repositories.md` |
| 2026-09-23 | Image `1587e0c1` on VPC 1, the detector patched | The weights held once, settled 30 s after the last page | 650 to 656 MB anonymous plus 4 to 324 MB of file-backed weights | `docs/archive/adr/0024-forge-is-bare-git-repositories.md` |
| 2026-09-23 | Image `1587e0c1` on VPC 1, the detector patched | The weights held once, swap-in | 5 to 7 pages per run | `docs/archive/adr/0024-forge-is-bare-git-repositories.md` |
| 2026-09-23 | Image `1587e0c1` on VPC 1, the detector patched | The weights held once, the seam, median of three, ms per page | 3,209, 3,016 and 3,254, uncapped 3,119 | `docs/archive/adr/0024-forge-is-bare-git-repositories.md` |
