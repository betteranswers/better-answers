---
status: accepted
date: 2026-09-21
amends: 0023, 0031
---

# A chunk's visibility is read from its binding and its document, never copied onto its row

**Where this came from.** An architecture review on 21/09/2026 found that every `index.chunk` row carries four columns — `published_at`, `sensitivity`, `audience`, `audience_groups` — copied from the chunk's binding and its document by **five writers in two tiers**: the publish act, `narrowBinding`, `narrowDocuments`, the worker's landing upsert and the worker's re-copy at the end of a run. The fold — the narrower of the binding's class and the document's own — was written four ways over three statements of the class ranking, one of them an argument in a docblock in place of a computation. The worker's own docblock names the race: a run that read the binding before a narrowing committed lands its rows at the old, wider class. The remedy was the re-copy at run end, and a run that fails after landing never reaches it, so the wide rows stand until some later run succeeds; read closely, the re-copy itself can write a pre-narrowing class over a narrowing that has just committed, because a statement that waits on a row lock re-reads that row alone. The owner's ruling: on a published binding that is not acceptable. The working papers — three censuses, two staff reviews, the first-principles review this record follows and the spike it cites — are under `.scratch/architecture-review-2026-09-21/`.

**The decision.** A chunk's visibility is a function of two rows the reader can already reach, so it is read and not stored. `index.readable_chunk` is a view, `security_invoker`, over the chunk, its `source_binding` (inner) and its `source_document` (left): `published_at`, `audience` and `audience_groups` are the binding's, and `sensitivity` is `narrower_class(binding, document)` — the document's *effective class*. The four columns and `chunk_audience_check` leave `index.chunk`. The three statements that read a chunk — `passageAt`, `findPassages`, `previewChunks` — read the view, and the predicate's text does not change: it takes an alias, and the alias is the view's. A chunk whose binding row is gone is unreadable, which is the closed direction. **No tier writes a chunk's visibility.** The worker's chunk row declares none of it, and its fold, its copy of the ranking and `recopy_visibility` go; publishing a binding and narrowing a binding or its documents are writes to the source row, the ledger and the cascade (ADR 0023), and lose their chunk statements. A narrowing queues no run: there is no race left for a run to settle, and the run reason *narrowed* retires in a last ticket of its own, because the word sits in a generated CHECK, the queue's fixture and an act's answer.

**Why the race closes.** One SQL statement reads one snapshot. A read that joins the chunk to its binding and its document cannot see a narrowing half-applied, and a row landed by a run that began before the narrowing is read at the binding as it stands now, whatever the run believed. The safety is the database's own, and needs no lock we order by rule.

**The ranking has one SQL statement.** `narrower_class(a, b)` is what the view calls and what the worker's special-category verdict is folded into `source_document.sensitivity` with. The app's rank stays for the widening refusals an act makes before it writes, held equal to the live function by the core suite.

**A run fails closed.** The run commits its catalogue writes — the verdict, the findings, the quarantine — before it lands the binding's chunk rows, so a document's special-category class is on its row before any chunk of it can be read. It is per run and not per document, because the landing converges the whole binding's rows in one update. The accepted cost: a run that dies between the two leaves findings recorded for chunks not yet landed, until the retry.

**Measured** (a throwaway spike, one machine, the pinned image, 1,000,000 chunk rows in one workspace, as `app_rt` under RLS). `find` through the view: p50 45 ms, p95 235 ms, inside ADR 0037's one second, and no slower than the copies; on a selective term the plan is a GIN bitmap scan on the pruned partition, an 18-row hash join to `source_binding` and primary-key lookups into `source_document`, 2.6 ms. `passageAt` is a wash at half a millisecond. Rows landed during an uncommitted narrowing are unreadable through the view once it commits, with no other statement; the same rows stay readable at the revoked class through the copies. Dropping the columns is catalogue-only and instant at that size, and only `chunk_audience_check` objects. The spike also found that **neither shape** uses the GIN index today — the full-text match is not leakproof, so the planner may not push it beneath the RLS qual — and that `previewChunks` has no index covering `binding_id`; both are HEAD's, independent of this record, and are T-240.

**What stays a column.** A concept's class and a composition's are derivations over many rows, recomputed by the cascade, and stay on `concept_index` and `composition` as ADR 0023 and ADR 0039 put them. The graph elements the worker will land are S6's to settle, with this record read first: a source-derived element carries its `binding_id`.

## Considered options

- **Copies the database keeps, by trigger** — where the design conversation first settled, and sound as the staff review amended it: a definer function under a share lock on the binding, the schema's first rewriting trigger, source-side triggers, a lock order of binding, document, chunk, and eight probes before a build. Rejected: it guards a mechanism the view deletes. Its one argument over the view is that reserve block S8 might want per-class partial indexes on the chunk row — a guess about a block that may never run. If S8 measures that need, copies are added then, by whoever holds the measurement, and the predicate's text does not change.
- **Copies every writer re-copies through one function.** Rejected: an ordering duty on every caller is the five-writers problem restated, and a writer that forgets leaves rows wider than their source.
- **A guard trigger that refuses a wrong value.** Rejected: every writer still computes the fold, and a race becomes a failed run.
- **Leave the re-copy at run end.** Rejected: the failure case is unbounded, and the remedy can itself widen.

## Consequences

- The build lands after T-232 and T-236, which edit the same acts' tails; after ADR 0032's privileges snapshot, so the worker's narrower surface on the chunk table is held from the day it merges; before S4, where connectors multiply runs, and before the first client's data.
- The chunk leaves the `visibility-columns` agreement (ADR 0031, amended today).
- `CONTEXT.md`: **chunk** says what it is read at; **effective class** is the word for the fold; **narrow these documents** loses its queued run when the build lands, with the code.
- The narrowing flow in `docs/architecture/` is redrawn when the build lands.
- ADR 0013's sentence stands: a document may carry a class of its own that only narrows its binding's, and the read takes the narrower.
- Reopening condition: S8 measuring a filtered vector search that needs the filter columns on the indexed table.
