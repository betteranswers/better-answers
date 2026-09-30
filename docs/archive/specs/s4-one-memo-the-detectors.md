# S4 — One memo, the detector's

The build of ADR 0036's amendment of 21/09/2026: one memoised function in the estate, no memo holding text, the findings memo in a store of its own per binding that a wipe spares, a *finding* never rewritten and a *withholding* computed on every run. The decisions are that day's architecture review's and the words are `CONTEXT.md`'s (*finding*, *finding group*, *keep in text*, *redaction seam*, *redaction rule*, *suppression*, *withheld*, *withholding*); this spec says what is built, in what order, and how it is proved. Read ADR 0036's 21/09 amendment first, then ADR 0020's of 20/09 and 21/09.

## Problem Statement

The seam is memoised in the wrong place. One function holds the conversion and the whole of `redact()`, keyed on seven facts: the bytes, the media type, the rules in force, the suppressions, the restores, the seed, and a version string made of the rule version, the detector pin and the converter pin. The detector is what costs — a ceiling of 2,841 ms a page on the worker image, 867 ms after T-177 — and five of those seven are policy it never reads.

So an Admin who keeps a group in text pays the detector a pass over that document for an answer that cannot have moved; so does a suppression, and so does narrowing documents. A rule switch would pay it over a whole binding. A converter bump from Renovate misses every binding in every workspace, though only a document whose normalised text actually moved can answer differently. Worst, a person's erasure request removes the binding's store whole — the stored return is redacted text, which is the only reason the store must go — so the wipe costs a detector pass over every page of the binding, and that wipe has a ticket on the queue in T-178. The seam's own docblock promises a tier switch "without re-detecting anything", and the key breaks the promise.

The store also caches a withholding, so a fix to one reaches no standing entry unless somebody remembers a version: T-145 moved the overlap rule a day after the memo landed and bumped none. And the seam re-derives why on every document because it has nowhere to write it down — a suppression raises a tier by rewriting the finding, so the same policy read is done twice, and `overridden` is the one reason carried out by hand.

## Solution

One memoised function, and it is the detector's. It takes a document's normalised text and a detection key and returns the spans the rules raise — rule, two offsets, score. Conversion, the officers-block raise, the withholding and the hash run unmemoised on every run, so a fix to any of them reaches every document on its next run with no version for anyone to remember. The text is the key, so only a document whose normalised text moved misses. The memo lives in a store of its own per binding, holding neither text nor target-state tracking, so an erasure removes the binding's store and spares it. A finding is never rewritten: what one binding does with one finding on one run is a *withholding*, and the placeholder text, the `overridden` list and the stored row's tier are readings of it. A spike proves the six risky parts first and can amend the record.

## User Stories

### The Admin — a bid writer at the first client

1. As an Admin, I want keeping a finding group in text to cost no detector time, so that reviewing a hundred documents costs review time and not detector hours.
2. As an Admin, I want narrowing named documents to change who may see them and nothing else, so that an act about visibility never queues detector work.
3. As an Admin, I want a fix to how a span is withheld — the overlap rule, a placeholder's wording, a category's tier — to reach every indexed document on its next run, so that I never have to ask whether a standing document got the fix.
4. As an Admin, I want the review to say, beside a group, that a span I kept in text is overridden by an erasure request, so that I can see the keep succeeded and the span is still withheld.
5. As an Admin, I want a span's tier on the review to be the tier it is withheld at on this binding now, so that a name an erasure has since raised reads *always* and I can act on it.
6. As an Admin, I want a reviewer shown no value at any point in this change, so that the review stays groups and counts.
7. As an Admin, I want a second run over an unchanged binding to change no finding row, so that *reviewed* and *restored* mean what they said yesterday.

### A person whose erasure request is carried out

8. As a person who asked to be erased, I want my identifiers out of every derived store by the next run, whatever an Admin kept in text before, so that the request outranks the keep.
9. As a person who asked to be erased, I want no text of mine in any cache the platform does not wipe, so that "the store is disposable" is a fact about text and not a hope.
10. As a person who asked to be erased, I want the routine finished inside its month without re-reading every page of a binding, so that the clock is not spent on work my request did not need.

### The operator and the owner

11. As the operator, I want a wipe to remove one store and leave the other, so that an erasure costs the run it is queued for and not a re-read of the binding.
12. As the operator, I want the per-binding disk cap and the outcome's size reading to go on meaning the whole of what a binding holds, so that the number I size the volume against does not quietly halve.
13. As the operator, I want a converter upgrade to land as an ordinary dependency bump, so that Renovate's pull request does not set off detector work across every workspace.
14. As the owner, I want the detector's memo settled before the first client's documents, so that its key, its name, its home and its store are chosen once rather than moved at the price of re-reading every page the estate holds.
15. As the owner, I want the spike's findings before the tickets are cut, so that a slow-converting media type is known while the spec can still change.
16. As the owner, I want a chosen reprocess to be chosen, so that no rename or refactor silently sets the detector over the whole estate.

### The platform acting as itself

17. As a run, I want to convert and withhold every document every time, so that what a binding shows is this run's answer under this binding's policy and never a cached one.
18. As a run, I want each document's catalogue writes committed before its chunks land, so that a row may say *always* before the chunk text does and never the other way round.
19. As a run, I want a detector pass that overruns its ceiling discarded, stored nowhere and the document quarantined, so that a timeout is the outcome it is today.
20. As a run, I want to say which documents the detector read afresh, per document, so that a restore that detected nothing reads as nothing.
21. As the erasure routine, I want the suppression I pass to reach the withholding as a plain argument, so that a request naming a span withholds it whatever restore stands on its row.

### The builder and the reviewer

22. As the agent building this, I want the seam to answer one withholding per finding — withheld or left in, the tier, one reason of five in order — and beside them the written spans, so that the text, the `overridden` list and the row's tier are three readings of one record rather than three computations.
23. As the agent building this, I want policy to be one plain record that crosses no key, so that no field needs ordering discipline to stay fingerprint-stable.
24. As the agent building this, I want the memoised function's identity held as a literal in the suite, so that moving its module, name, version, mount path, app or directory fails a test rather than a client's estate.
25. As a reviewer, I want core's two tests over the stored tier to pass unedited, so that I can see the finding row did not move.
26. As a reviewer, I want one test to read the raw bytes of both stores and find no planted value, with a control that is caught, so that "no memo holds text" is proved both ways.

## Implementation Decisions

### The spike — first, and throwaway

Six probes, in order, on the worker image, under `.scratch/`, independent of S1 — each with what it would change (ADR 0036, 21/09):

1. A sync memoised `detected` called inside the sync `landed` component under `mount_each`, more than one component in flight, fifty documents: no deadlock on the host's loop. Decides whether the shape runs here at all.
2. A run; a restore on one document; the rules in force flipped; the detection key moved — the detector runs N, nought, nought, N times, and ten policy flips leave the store's size flat. Confirms hit, reuse and collection on cocoindex 1.0.22, whose engine source was read at `aee7b27d`.
3. Every file of the findings memo's directory, raw bytes: no planted value, no run of the normalised sentence, no placeholder word. The control is a memoised function built to return its own text, which the same scan must catch.
4. The memoised body edited, then renamed; then both again with `version=1`. Settles the freeze rule and what the suite's literal must cover.
5. The binding's own store removed, then a run: the detector runs nought times and every chunk row is re-landed.
6. Conversion plus the withholding per document, median and p95 by media type, and a thousand-document no-op run end to end.

**Probe 6 is the decision rule.** Conversion plus withholding at a few percent of the detector's cost a page → the one memo as specified. A media type converting at hundreds of milliseconds a page → that type alone keeps an outer memo over a separate detection app, which still spares the detector a wipe. T-137's owed question — whether a *rule-change* reprocess re-upserts an unchanged document's chunk rows — rides with these, the same throwaway tree answering it. The code is discarded, the findings written to the ticket, and a finding that amends ADR 0036 or ADR 0020 is an amendment in the same pull request as the finding.

### The memoised function

`detected(normalised_text, detection_key)` returns the spans the rules raise — a rule id, two offsets in Unicode code points into the normalised text, a score — and nothing else. It is the only memoised function in the estate. Category and tier are attached outside it from the declared descriptor, both being pure functions of the rule id, so caching them would cache a lookup and put the category table in the key. The officers-block raise runs outside too, on the finding side: it reads the text for the block, is cheap, and a fix to it then re-detects nothing. `version=1` replaces the body's syntax tree in the engine's fingerprint, so a body edit is a non-event and a bump is a reprocess somebody chose rather than a drift nobody saw.

### The detection key

What the detector reads and nothing else — the recognisers and their pins, the thresholds, the context lemmas, the consumer-domain list and the window rule — carried as its own digest.

Not `VERSION_STRING`: `RULE_VERSION` welds policy-as-code to detecting, moving for the category table, a placeholder's wording or a category's `narrows_to` as readily as for a recogniser, none of which the detector reads; keyed on it, moving a category to default-on re-reads every page in every binding, this root's own cost reached through code instead of data. `RULE_VERSION` stays what a finding row and a document's `redaction_version` carry, and a detection-key move implies a `RULE_VERSION` move. Split it in this build: a later split is another full pass. Not `CONVERTER_PIN` either, which governs the conversion that *produces* the text; the text is the key. `MEMO_VERSION` goes with the decorator it keyed.

### The frozen identity

The engine invalidates an entry when the memoised function's body, module, qualified name or version moves, and a mounted component's stable path derives from its functions' names — so the app name and the store's directory are in the identity too. No file said so before ADR 0036's amendment. The suite holds all six as one literal: module, qualified name, version, mount path, app name, directory. After the first client's documents each is a re-read of every page held, and the literal is what makes a rename a chosen reprocess; `version=1` is what takes the body out of the set.

### The two stores

A binding's directory splits. The binding's own store holds the `chunks` app — the chunk index's rows and the target-state tracking that says which of a binding's rows have gone — and a wipe removes it exactly as the amendments of 10/09 and 11/09 say. A second store holds the `landed` app and the findings memo. The `landed` app declares no target at all, so its store holds no target-state tracking and no text: a fingerprint of each document's text, and the rule, offsets and score of each span — what a marked finding row and `content_hash` already keep.

The change is `Host`'s and little else: a second `Environment` per binding at a sibling path; the binding's removal narrowed to the first store; the disk reading the per-binding cap and the outcome's signal are taken from left as the whole directory's, so the operator's number does not change meaning; and an Environment cache now holding two handles a binding, so its bound counts half as many bindings unless raised. Decided here and not deferred, because after the first client's documents moving this store re-reads every page held.

### `landed`, unmemoised

`landed` loses `memo=True` and keeps everything else — the per-document component under `mount_each`, the ceiling's home, the reading of the original. Its body, in order: convert; call `detected`; attach category and tier; raise by the officers-block rule; withhold; hash. The content hash is computed over the normalised text every run, one SHA-256, and the memo's key is a second, 16-byte hash of the same text — accepted on the footing the content hash was accepted on 11/09, not claimed to hold nothing.

The constraint dropped is *a run over an unchanged binding converts nothing*. Every run now converts and withholds every document, beside the original it already reads, the chunks it already splits and the normalised copy it already writes outside the memo today; the run is already O(binding), and probe 6 measures the rest. Policy — the rules in force, the suppressions, the restores, the seed — is one plain record handed to the withholding. It crosses no key, so no field needs sorting or any other discipline to stay fingerprint-stable.

### The seam's interface

`redact()` answers a *withholding* per finding beside the findings and the text: whether the finding was withheld or left in the text; the tier it was withheld at; and one **reason**, the first of five that holds — *overridden by the erasure*, *erasure*, *restored*, *switched off*, *in force*. Beside the withholdings it answers the **written spans**, one per placeholder written, each an offset pair naming the withholding it writes for; a loser of an overlap gives up only the characters the winner takes and keeps its own placeholder over the rest. How a finding was **written** — under its own placeholder, under another finding's, or not at all — is a reading of those spans, per character, and never a field of the withholding.

A finding is never rewritten. The suppression's tier raise moves into the withholding, so the pass that rewrote findings goes and the second read of the suppressions goes with it — today that policy read is done twice because the first answer is discarded into the rewrite. `overridden` becomes a reading of the withholdings whose reason is *overridden by the erasure*, not a second computation. The withholding takes the text, because matching a suppression's identifiers reads the span's characters; it never leaves the process, which is why a policy change always pays a conversion.

**Which side each thing sits on.** The counts and the verdict are read off the *findings*, never the withholdings: a special-category finding an Admin restored, and one on a switched-off tier, both still narrow their document, and a verdict read off the withholdings would be a widening. The pseudonym letters sit beside the withholding and must not read it — they are drawn over every person-name finding whatever tier it ended at, so that a suppression moves one person's output and nobody else's letter. Each side is held by a test rather than a note: the letters by the standing test that a suppressed name is withheld while every other name in the document keeps the letter it had, and the verdict by the one added below.

### The finding row

The stored row's tier stays the tier the finding is withheld at on its binding now, written from the withholding rather than from a rewritten finding. The three readers are untouched: the review's group key, the per-span restore's refusal of anything but the always set, and the database's own check admitting a restore only on an always row.

The reason stays off the row. Four of the five the app already derives — a restore from `restored_at`, a switched-off tier against the binding's rules in force, as the DPIA input does — and only the erasure's naming is the worker's alone, whose road was settled on 20/09: no new grant and no new column. `restores_overridden_by_erasure` stays on the run's outcome and becomes a reading of the withholdings; it moves onto the row only if Root B's catalogue-before-landing order shows the lag in T-137's joined test — the rows committing before the run's chunks land, the outcome when the run ends. "Which documents were detected afresh" is answered per document where the detector runs, replacing the process-global count of `landed` bodies — which after this build counts conversions, and would report one reading for a restore that detected nothing.

### The ceiling

Unchanged: a ceiling and not a budget, its margin still covering the one-off model load, still per document at the seam's milliseconds a page times the pages plus the margin, because the document that misses is the case it exists to cover. A pass that overruns is discarded before it is stored and the document quarantined again next run, as today. It gains one benefit: the analyser is lazy, so a run the memo answers whole never loads the model.

### Sequencing

After S1, which moves the seam this edits, and before C1 — the last block before the first client's documents. Every merge before C1 that edits `landed`'s body is a free invalidation, so "one bump" means the last state C1 finds, not one ticket. The gate is the worker's own LMDB-bytes test extended to the findings memo, with T-137 confirming across tiers once it lands in S1; T-137's own line is amended to name both stores. Root B's ruling stands over it (ADR 0044): a run commits its catalogue writes before it lands its chunks — per run, because the landing converges the whole binding's rows at once — so a row can say *always* before the chunk text does; fail-closed, the cost accepted there. T-178 is independent of this build and gets cheaper by it.

Tracer bullets, in order: **the spike**, findings on the ticket and code discarded; **the withholding** — the seam answers withholdings, the tier rewrite and the duplicate policy read go, the text, `overridden` and the row's tier become readings, `record_findings` takes the tier from the withholding, and ADR 0020's line about a suppression raising a tier is amended in the same commit; **the findings memo** — `detected` with `version=1` and the detection key, `landed` unmemoised, the second store and the wipe that spares it, the identity literal and the per-document count, with ADR 0036's amendment and its index row in the same commit; and **the detection version**, if it did not fold into the third as small.

## Testing Decisions

A good test drives the seam, the pipeline or an act through the interface its caller uses and asserts what that caller can observe — the text, a withholding, a row, a count, the bytes on disk — and never an internal. Every store the platform runs is the real one: Postgres, the object store, the git repository and the graph, with a raw INSERT appearing only inside a test factory. A pair is checked both ways. Highest seam first, and no new seam:

1. **The redaction seam's interface** (prior art: the seam's own suite, seventeen tests over the withholding side with its five binding fixtures). Two are hard, and both are rewritten rather than moved. *A signatory named inside a home address* keeps every assertion it has — the name at the always tier, losing the partial overlap to the address containing it, absent from the text — and gains one on how it was **written**: the written spans put it under another finding's placeholder. That assertion is what makes the reading testable, and it is the half a bare precedence move breaks. *A suppression raises the named person to the always tier* is rewritten against the withholding's tier, because a finding is no longer rewritten; the stored row's tier is asserted where it is now written, in the catalogue's suite. Added: the verdict under a restore, which nothing pins today though the counts do; and a property over coverage — each character of a withheld finding lies under exactly one written span — which the partial-overlap case is what it is there to find.
2. **The pipeline seam** (prior art: the landed suite's memoised-function section and its harness that re-runs a binding's copies). A keep, a suppression and a changed rule in force each re-detect nothing; a changed normalised text re-detects that one document and no other; a converter bump over unmoved text re-detects nothing; a wipe removes the binding's store, re-lands every chunk row and leaves the findings memo, so the detector runs nought times. The LMDB's bytes hold no canary, **both stores**: no planted value in either, and no sentence of the document and no placeholder word in the findings memo's. The scan reads raw file bytes so freed pages are read, and a suppressed identifier is asserted absent after the wiped run and never after an ordinary one.
3. **The frozen identity** — one literal over the memoised function's module, qualified name and version, its mount path, the app name and the store's directory. It fails the moment any of them moves, which is where the chosen reprocess gets chosen.
4. **Core's review tests, unedited** (prior art: the review suite). The two that turn on the stored tier — a keep refused while the row read default-off and admitted once a run had read the span at the always tier; an officer's name restorable at the always tier while the same rule's default-off names in that document are not — pass without a line changed, and that is the proof the row did not move. The database's restore check is likewise untouched, and so are the redaction contract cases, which carry nothing about the memo.

## Out of Scope

- The rule-switch act itself. No act writes a binding's rules in force at HEAD; this build makes the switch cheap and does not make it.
- The `finding` table as the detection cache — rejected: a wipe deletes the binding's unmarked rows, so the table holds a partial set that reads as complete, and that failure is a document silently un-redacted.
- Per-entry purge of the findings memo. The engine offers none; collection happens at the flush, and the store is dropped whole or not at all.
- Moving the withholding's reason onto the finding row, and any grant or column for it.
- The converter's media-type table — done in T-165, and independent of this.
- What becomes of a document's findings when its content hash moves: ADR 0020 left it open to S4, the block that first moves a hash decides it, and this build moves none.
- T-178's wipe itself, which this build makes cheaper and does not change.

## Further Notes

**If the spike fails a probe**, one part of the shape gives way and the rest stands:

| Probe | What gives way |
| --- | --- |
| 1 | The memoised call cannot be made from the sync `landed` body here, so detecting becomes a separate app whose answer `landed` takes as an argument — the fallback, with the outer memo and its costs. |
| 2 | The engine facts ADR 0036's amendment records are wrong for 1.0.22, and the amendment is corrected in the same pull request as the finding. |
| 3 | The second store is not safe to spare: the wipe takes both and costs what it costs today. |
| 4 | `version=1` does not replace the body, so the literal covers the body too and a body edit is itself a chosen reprocess. |
| 5 | The wipe cannot be narrowed; the one memo, the detection key and the withholding stand without the spared store. |
| 6 | The slow media type alone keeps an outer memo over a separate detection app, sparing the detector a wipe all the same. |

**The deadline's reason.** C1 flips `worker_rt` to deny-by-default and is the last block before the first client's documents land; after it, every move of the detector's memo is a re-read of every page the estate holds. That is why the identity literal is written before the memo has anything in it.

**The working papers** are under `.scratch/architecture-review-2026-09-21/`: two censuses (the seam and `landed`'s memo; the finding row's tier and its readers), the staff review of Root D (section 2 is the four shapes against the deletion test, section 3 the engine read in its own terms, section 5 what the decisions missed) and the decisions log, whose FP3 supersedes D2 and D3 as first stated. The numbers to argue from are the ceiling's 2,841 ms a page, taken on the worker image as a ceiling and not a budget, and the seam's 867 ms a page after T-177; conversion is a docblock's "milliseconds" and unmeasured, which is the whole reason probe 6 exists.
