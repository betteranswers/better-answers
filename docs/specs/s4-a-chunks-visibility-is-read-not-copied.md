# Ahead of S4 — a chunk's visibility is read, not copied

The build of ADR 0044: a chunk's visibility is read from its *source binding* and its *source document* through the view `index.readable_chunk`, and no tier writes it onto the chunk row. The decisions are ADR 0044's, with the 21/09/2026 amendments to ADR 0023 and ADR 0031 beside it, and the words are `CONTEXT.md`'s (*chunk*, *effective class*, *sensitivity*, *audience*, *cascade*, *narrow these documents*, *finding*, *act*, *step*, *ledger act*); this spec says what is built, in what order, and how it is proved. Read ADR 0044 first. The working papers — three censuses, two staff reviews, the first-principles review and the spike that decided the shape — are under `.scratch/architecture-review-2026-09-21/`.

## Problem Statement

Every `index.chunk` row carries `published_at`, `sensitivity`, `audience` and `audience_groups`, copied from its binding and its document by five writers in two tiers: the publish act, *narrow a binding*, *narrow these documents*, the worker's landing upsert and the worker's re-copy at the end of a run. The fold — the narrower of the binding's class and the document's own — is written four ways over three independent statements of the class ranking, and one of those writers computes no fold at all but argues that it need not. The race is recorded in the worker's own docblock: a run that read the binding before a narrowing committed lands its rows at the old, wider class. The remedy is the re-copy at run end, there is no `try`/`finally`, so a run that fails after landing never reaches it and the wide rows stand until a later run succeeds; and the remedy can itself widen, because a statement that waits on a row lock re-reads that row alone. On a published binding that is an Admin who has revoked access and a reader who still has it, for an unbounded time, with nothing failing and nothing said. The same shape gives *narrow these documents* an `index` run whose only stated purpose is to end in that re-copy, and puts four columns on a partitioned table of a million rows that no index uses and no query needs.

## Solution

A chunk's visibility is a function of two rows the reader can already reach, so it is read and never stored. One view, `index.readable_chunk`, joins the chunk to its binding and its document and presents the four terms; the three statements that read a chunk read the view, and the read predicate's text does not change, because it takes an alias and the alias is the view's. One SQL statement reads one snapshot, so a read cannot see a narrowing half-applied, and a row landed by a run that began before a narrowing is read at the binding as it stands now — whatever the run believed. The race closes with no trigger, no lock order and no second statement anywhere; the safety is the database's own. An Admin who narrows or publishes has readers' answers follow at the commit, through a failed run too. Publishing becomes one write to the binding row. The acts keep their heads, their ledger rows and the *cascade*, and lose their chunk statements; *narrow these documents* loses its queued run, because there is no longer a race for a run to settle. The worker stops knowing that visibility exists. Four columns and one CHECK leave the chunk table. Nothing else changes for a reader.

## User Stories

### The Admin — a bid writer at the first client

1. As an Admin, I want a binding I have narrowed to be narrow for every reader from the instant my act commits, so that revoking access means what it says.
2. As an Admin, I want that narrowing to hold over a binding the worker is indexing, so that a run in flight cannot land rows at the class I have just revoked.
3. As an Admin, I want a run that fails half-way to leave a binding narrower or absent, never wider, so that a fault is never a disclosure.
4. As an Admin, I want a document I narrowed to stay narrow without waiting for a run, so that the screen's answer and the readers' answer are the same.
5. As an Admin, I want publishing to be one decision recorded on the binding, so that every passage of it becomes readable together.
6. As an Admin reviewing a binding before I publish it, I want its chunks listed as they are today, so that the act I already use is unchanged.

### The Editor and the Viewer

7. As a Viewer, I want `find` and `open` to answer inside the second they answer in today, so that how the platform stores this is invisible to me.
8. As a Viewer, I want a passage whose binding has gone to be simply absent, so that a removed source cannot be read through a row that outlived it.
9. As an Editor, I want a document whose own class narrows its binding's to be read at the narrower of the two, so that the seam's verdict is never undone from above.

### A person working from Claude

10. As a person asking through the MCP surface, I want `find` to skip a passage an Admin narrowed a moment ago, so that an agent cannot quote what a person may no longer read.
11. As a person asking through the MCP surface, I want the predicate an entry runs to be the app's, unchanged, so that the two surfaces cannot drift apart.

### The operator and the owner

12. As the operator, I want the migration that drops the four columns to be catalogue-only, so that a release does not rewrite a million-row heap.
13. As the operator, I want that drop to land in a release after both tiers stopped writing the columns, so that an in-flight run cannot fail on a column that is gone.
14. As the operator, I want a restore to come back readable with no replay of a copy and no backfill, so that a restore drill is a restore and nothing else.
15. As the owner, I want this built before S4's connectors and before the first client's data, so that the race is closed before there is anything to disclose.
16. As the owner, I want the reopening condition written down, so that a later block measuring a need for these columns knows what it would re-add and what it must not change.

### The platform acting as itself

17. As the worker's run, I want to declare no visibility on a chunk row, so that I cannot land a row at a class that has moved since I read it.
18. As the worker's run, I want my catalogue writes committed before I land the binding's chunks, so that a document's special-category class is on its row before any chunk of it can be read.
19. As the worker's run, I want one SQL statement of the class ranking to fold my verdict into the document's class, so that the verdict can only ever narrow.
20. As the erasure routine, I want a wipe and reprocess to need no re-copy step, so that removing a binding's rows is the whole of what it does.

### The builder and the reviewer

21. As the agent building this, I want the read predicate's text untouched, so that the change is one word in three statements and nothing in `access`.
22. As the agent building this, I want the view and its function to merge first, while the copies still stand, so that each later step can merge on its own.
23. As a reviewer, I want a test that lands rows during an uncommitted narrowing and reads them after it commits, so that I can see the race closed rather than argued.
24. As a reviewer, I want the view's answer asserted for every pair in the class ranking as `app_rt` under RLS, so that the fold is checked where it now lives.
25. As a reviewer, I want every way the view could be written wrongly to have a case that fails for it, so that SQL being outside the mutation tool does not mean it is unheld.

## Implementation Decisions

### The migration — one function, one view, four columns fewer

`narrower_class(a text, b text) returns text` is the one SQL statement of the class ranking: the narrower of two words by *Restricted* → *Internal* → *Public*, taking the first where the second is NULL. `IMMUTABLE`, search path pinned, `EXECUTE` revoked from `PUBLIC` and granted to `app_rt` and `worker_rt` on the schema's pattern for a runtime function. A word outside the set cannot reach it — both source columns carry the class CHECK — and if one did it answers NULL, which makes the predicate's class arm NULL and the row unreadable.

`index.readable_chunk` is a view, `security_invoker = true` so the base tables' RLS and the caller's own privileges apply rather than the view owner's, over the chunk joined to `source_binding` (inner) and `source_document` (left), both joins keyed on `workspace_id` as well as the id so the partition still prunes. It carries every remaining column of `index.chunk` and, beside them, `published_at`, `audience` and `audience_groups` from the binding, and `sensitivity` as `narrower_class(binding, document)` — the document's *effective class*. `security_barrier` is **not** set: nothing needs it, and it would stop the planner reordering through the view and lose the GIN scan. The inner join to the binding is the closed direction — **a chunk whose binding row is absent is unreadable** — so no withdrawal act, now or later, has to remember the chunks; the left join keeps the old subquery's reading, that a row whose document has gone is still its binding's. `SELECT` is granted to `app_rt` alone: no described worker behaviour reads under the predicate (ADR 0031), so under deny-by-default `worker_rt` has no grant line for it.

The four columns and `chunk_audience_check` leave `index.chunk`, the CHECK dropped first or the `DROP COLUMN` fails; `chunk_embedding_pair_check` is untouched. Both statements are catalogue-only and instant at a million rows. **There is no backfill**: nothing is copied, so there is nothing to make consistent. The child partitions' `REVOKE ALL` stands and the read still goes through the policied parent.

### The three reading statements

`passageAt`, `findPassages` and `previewChunks` in the `sources` slice's passages module point their chunk alias at `index.readable_chunk`. The predicate builders in `access` do not change: both take a bare alias and two positional placeholders, so the same `readableClause` text serves the view, and `findPassages`' second alias — the concept index — is untouched. `passageAt` and `findPassages` keep their existing join to `source_document` for the document's title, so the plan reads that row twice, once inside the view and once for the title, which is how the spike measured it, and both keep selecting the class, which is now the view's. `previewChunks` keeps its deliberate omission of the published arm (T-133), so an Admin still lists an unpublished binding's chunks.

### The acts lose their chunk statements, and keep everything else

Publishing a binding writes the binding row and nothing else; its chunks follow at the commit. `BindingPublished.chunks` was that statement's row count and goes with it — counting a binding's chunks is `previewChunks`' business.

*Narrow a binding* loses `NARROW_CHUNK_COPIES` and the `noWiderThan` membership list built for it, and reads its binding through the same named read the other binding acts use. *Narrow these documents* loses its inline chunk `UPDATE` and its `enqueueJobIn`, and `DocumentsNarrowed` loses `jobId`. Both keep their head, their `FOR UPDATE` on the binding, the widening refusal computed over the document's *effective class* before anything moves, their ledger rows — one for a binding, one per document — and `cascadeOverEvidence`. The app's own rank stays in `access` for those refusals, held equal to the live `narrower_class` by the core suite. "Level zero of the cascade" leaves both docblocks: the *cascade* is two levels and the chunk was never one of them.

### The word *narrowed*, in a last ticket of its own

The run reason retires after every other piece has landed, because until the enqueue is gone a job row can still carry it. It sits in `INDEX_REASONS`, in a CHECK generated from that list which validates standing rows, in the queue fixture's example and in the worker's `IndexRun.reason` docstring and tests. Its migration says what becomes of job rows already carrying the word, and the fixture's example moves to another reason.

### The worker declares no visibility

`CHUNK_TABLE`'s `TableSchema` loses the four columns; `Visibility`, `narrowed_by`, `SENSITIVITY_ORDER`, `BindingRun.own_class` and `recopy_visibility` go, and the binding read stops selecting the four while still reading `rules_in_force`. The engine accepts the shorter schema under `ManagedBy.USER`: the transition resolver answers nothing for a user-managed desired state, the row builder iterates the schema's columns alone, and the `DO UPDATE` arm is taken while one non-key column remains, as seven do. One consequence to expect rather than discover: every row's fingerprint changes, so each binding's next run re-upserts all its rows once. `reconcile_catalogue` folds the seam's special-category verdict into `source_document.sensitivity` through `narrower_class` rather than its own `array_position` expression, so "only narrows" is the database's.

**The run commits its catalogue writes before it lands its chunks, per run.** The scoped catalogue transaction — verdict, findings, quarantine — moves ahead of `land_rows`, so a document's class is on its row before any chunk of it can be read. Per run and not per document, because the landing converges the whole binding's rows in one engine update. The accepted cost: a run that dies between the two leaves findings recorded for chunks not yet landed, until the retry — findings are idempotent, a run that is not *done* blocks a publish, and findings without chunks is the safe direction where chunks without findings was not. *Converted* now means the text was read, not that its chunks stand, and S4's unchanged-document check must not skip a landing on the hash alone. The docblock that gave the re-copy as the reason the records come last goes with the re-copy.

### The schema boundary, the contract and the glossary

The Drizzle mirror of `index.chunk` loses the four columns and the comment above them; `readableUnitColumns` is untouched, the chunk having always declared its own, and `AUDIENCE_CHECK`'s docblock and the migration-ownership test that reads its copy back lose the chunk and keep the graph tables. The generated worker schema view regenerates without the four entries and with its migration stamp moved; its drift test is what holds it.

The chunk leaves the `visibility-columns` agreement: its cases leave the fixture and the halves of both suites that read them, and what remains is what the worker will land on graph elements, S6's to settle with ADR 0044 read first. If nothing is left to agree the agreement retires and the set is ten. With Root C's digest landed this is a commit to the fixture and both tiers and to no number; if it is not, the same commit bumps `contract_version`. In `CONTEXT.md`, *narrow these documents* loses both "its chunk copies are rewritten" and "the run that puts the binding back through the index is queued with them"; *chunk* and *effective class* already read correctly.

### The order the pieces merge in

Edges first: after T-232 and T-236, which edit the same acts' tails; after Root C's privileges snapshot, so the worker's surface on the chunk table is a diff to a generated file from the day this merges; before S4, where connectors multiply runs, and before the first client's data. Then five tracer bullets, each mergeable on its own:

1. **The function and the view**, with the schema suite's cases. Additive: the copies still stand and nothing reads the view yet.
2. **The readers move to the view**, with the core suite's race tests. From this commit a narrowing is right at the commit and the copies are dead weight.
3. **The writers stop** — the three acts' chunk statements, the enqueue, `jobId`, the docblocks, the glossary; and the worker's ticket, being the shorter schema, the fold and the re-copy deleted, the catalogue-before-landing reorder and the verdict through `narrower_class`.
4. **The columns go**, with the CHECK, the Drizzle mirror, the generated worker view and the fixture's chunk cases. **A later release than 3**: `migrate` runs before the app and the worker, so a drop landing while an old image still names the columns fails that image's statement.
5. **The word leaves.**

## Testing Decisions

A good test drives an act or a statement through the interface its caller uses and asserts what that caller can observe — rows returned, a class, a refusal, a row count — never internals. Every store the platform runs is the real one, and Postgres is migrated by the journal; a raw `INSERT` appears only inside a test factory. A provoked failure asserts the outcome the failure leaves behind, and a pair is checked both ways. No new seam.

1. **The core slice interface, against a migrated database** (prior art: the sources and passages suites). A reader's `find` and `open` before and after an Admin narrows a binding, narrows documents, and publishes — each asserted both ways, so a widening restores what a narrowing removed. **The two-connection test** is the one that matters: one connection holds an uncommitted narrowing while a second lands chunk rows copying the binding it can still see; before the commit the rows read, after it they do not, with no other statement run by anybody. Its control is the assertion the copy shape cannot satisfy — rows landed *during* the uncommitted narrowing are unreadable on the same terms as rows landed long before it. The spike's cases (a)–(d) are the model and its verbatim SQL is in the working papers. Beside them: an absent binding row makes its chunks unreadable while a neighbour under a live binding still reads.
2. **The schema suite as `app_rt` under RLS** (prior art: the RLS and chunk-column suites). The `visibility-columns` cases re-homed as table-driven rows against the view: every pair in the class ranking, the document's NULL included, asserting the class the view reports and whether the reader sees the row; the audience pair — *everyone*, a held group, an unheld group — and the published arm; workspace isolation through the view, where a second workspace's rows never appear; an absent binding row; a partition created after the migration reading as the others do; and the grants, `app_rt` selecting the view where `worker_rt` cannot.
3. **The worker's pipeline seam** (prior art: the index-pipeline suite on the migrated harness). A run lands rows that carry no visibility. A provoked failure between the catalogue commit and the landing leaves the verdict on the document and **no readable wider chunk**. A second run over unchanged text re-upserts once and then writes nothing. `reconcile_catalogue` through `narrower_class` narrows and never widens, checked both ways.
4. **End to end across both tiers**: T-137's cross-tier mid-run narrowing is the proof — a narrowing committed while a run is in flight, and every row that run lands afterwards unreadable at the revoked class, with no second statement in either tier.

**SQL is outside mutation testing** — no tool in `packages/devtools` mutates migration SQL. What holds it instead is coverage by direction: the cases above are chosen so that every way the function or the view could be written wrongly has a case that fails for it — the two arguments of `narrower_class` swapped or the wider word returned (the class-ranking pairs), a left join to the binding (the absent-binding case), `security_invoker` dropped or a `workspace_id` missing from a join condition (workspace isolation as `app_rt`), the `EXECUTE` revoke dropped (the grants case). No latency assertion enters CI: the spike's numbers are the record, and the next measurement is S8's if it comes.

## Out of Scope

- A concept's class and a composition's stay columns on their own rows: each is a derivation over many rows with floors, overrides and an audience intersection, recomputed by the *cascade*, which is what a stored column is for.
- S6's graph elements. A source-derived element carries its `binding_id`, so it can be read the same way; S6 settles it with this record read first.
- The GIN index defect — the full-text match operator is not leakproof, so the planner may not push it beneath the RLS qual — and `previewChunks`' missing `binding_id` index. Both are HEAD's, affect the copies exactly as they affect the view, and are T-240.
- `conceptVisibilityFrom`'s stale joined read, the same family of bug one level up: T-239.
- S8, and any per-class or partial index on the chunk table.
- Unpublish and withdrawal: no such act exists at HEAD, and this build leaves them nothing to do about chunks when they arrive.

## Further Notes

**Reopening condition.** S8 measuring a filtered vector search that needs the filter columns on the indexed table. If that measurement is taken, copies are added then, by whoever holds it, and the predicate's text does not change.

**The fallback**, if the view ever fails its budget on real data, is shape A as the staff review amended it: a `SECURITY DEFINER` chunk-side trigger that locks the binding and then reads the document in a second statement, source-side touches, and the lock order binding → document → chunk. It is written out in `staff-review-root-b-20260921.md` with its eight probes, and it guards a mechanism this record deletes, which is why it lost.

The measured ground is `spike-root-b-view-20260921.md`: a million chunk rows in one workspace as `app_rt` under RLS, `find` through the view at p50 45 ms and p95 235 ms — inside ADR 0037's one second and no slower than the copies — `passageAt` a wash, all three race cases passing through the view and failing through the copies.

`/c4-architecture` redraws the narrowing flow when the build lands.
