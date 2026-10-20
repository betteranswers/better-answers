---
title: "A connected source is defined by origin, reach and destination, gated by three permission fields"
date: 2026-09-24
module: packages/core
problem_type: architecture_pattern
component: knowledge-layer
severity: high
applies_when:
  - "Adding a connector, a connected source field or a media type's converter"
  - "Writing a read of passages, source entities or concepts that must apply the permission predicate"
  - "Changing how a connected source's or a document's sensitivity is narrowed, widened or published"
tags:
  - adr-0013
  - connected-source
  - sensitivity
  - audience
  - publish
  - widen
  - converter
---

# A connected source is defined by origin, reach and destination, gated by three permission fields

## The decision

A connected source is defined by **origin** (company or external), **reach** (copied or read live) and **destination** (the passage index, the bundle, the map; at least one). Platform origin is an evidence kind with no connected source.

It is gated by three permission fields:

- **published** (`published_at`);
- **sensitivity**;
- the **audience** word (*everyone* or *groups*) beside its group ids (`audience_groups`), tied under one CHECK.

The three are applied as one server-side predicate on every read the api serves. The worker's reads are a producer's and are not filtered by it (ADR 0031).

- Its destination is recorded when the connected source is made, never inferred later, and defaults to the passage index and the bundle. It feeds the passage index alone until S7.
- Its scope is a typed include list and exclude list, and an exclusion wins.
- Its credential class is ADR 0041's, and the credential is injected per sync.
- The v0.1 connectors are upload, website and SharePoint, with no feed connector. A website is connected per URL prefix and read in sitemap mode under an allowed-host policy, never crawled recursively in v0.1.

A sync lands each original in the object store before it writes the document's row. Every object-store key starts with its workspace's prefix.

An Admin accepts a connected source's cost estimate once, at its review. The estimate is priced from a slim enumeration of the source and from measured rates per extraction template and per model choice. From then on every sync of a targeted connected source extracts as it indexes, within the workspace's spending limit. A sync that would reprocess more than a set share of the connected source waits for re-acceptance, with the price shown. Extraction runs whenever the destination includes the bundle or the map. Until the estimate is accepted, the connected source shows its unextracted backlog.

A media type has one converter, inside the worker, with no model. The upload's four media types are its whole allow-list:

- Markdown and plain text pass through as the normalised text.
- `.docx` converts to Markdown through `anydoc`.
- PDF converts to Markdown through `pdf-inspector` alone.

HTML is no upload type. Each later media type names its converter under the same rule. `anydoc`'s `ocr` stays `"reject"`, and a test holds it. A page with no text layer makes its whole document *unreadable*.

Under *mirror* retention, a document gone at source is flagged and keeps its passages through a 28-day grace period, and a grace sweep then removes them. Disconnecting a connected source removes its passages within a day. In every retention class, cited evidence outlives its source.

A document's own sensitivity only narrows its connected source's.

- It is lifted back only by a dismissal of the special-category findings, and never past the Admin's narrowing.
- The *effective class* of a document is the narrower of the two.
- A re-detection re-baselines evidence as a platform action and never raises *source moved on*.

An unpublished connected source derives as Restricted until its publish.

- The publish is let through only once the connected source's latest sync is done. It refuses `not-indexed` before then, `confirmation-missing` unless the Admin confirms all three of lawful basis recorded, privacy information updated and a DPIA reference, and `already-published`.
- Its audit row carries those confirmations, the finding totals, the DPIA input's hash, and the connected source's sensitivity and audience as fields of their own.
- The publish releases the connected source's sensitivity down the cascade.
- The stored state word is *received* until the publish and *published* after it. *Indexing* and *indexed* are rendered from the latest index job, because the worker holds only `SELECT` on `connected_source` and records its progress on the job's own row.

A connected source widens only through an Admin's recorded widen action (`widenConnectedSource`, in the `sources` slice).

- Its audit event is `sources.binding.widened`. The row carries the connected source's id and the sensitivity and audience it moved from and to. It holds the audience word and not the group ids, because a detail field holds no list.
- It refuses `role-forbids`, `no-such-binding`, `no-such-group` for a group the workspace does not hold, `not-wider`, and `special-category-unreviewed` while a special-category finding is unreviewed.
- It never moves a document's own sensitivity.

Decided and not yet in the tree:

- The website and SharePoint connectors, with their scope and their credentials (S4). They are lifted narrowly from Onyx: the utility layer plus `file`, `web` and `sharepoint`. The snapshot is refreshed deliberately once a quarter, behind a contract test against a real SharePoint site.
- The cost estimate, its slim enumeration, re-acceptance and the unextracted backlog. Findings are shown on the enumeration sample and at the estimate's review, grouped by category and rule.
- The 28-day grace sweep and the removal on disconnection. Control Centre's list of a deletion's impact: each concept, whether the cited span's hash matches the one last seen, and the citations on the concept. A gone document that nothing cites appears nowhere.
- An Admin's reprocess, the road out when the latest index job failed or was poisoned.
- A DPIA precedes the first customer's ingest. Today only the publish asks for a DPIA reference.
- The source signals: the unextracted backlog, connected sources indexed and not published, parked syncs, unreadable documents, credential expiry, grace expiries and gone-at-source evidence.
- Each document's `external_access` shape (`is_public = true`), a no-op term of the predicate until a connector reads one.
- Two questions left open: whether choosing Public at the publish needs a confirmation of its own, and whether a widen after the publish must first review the findings raised since then.

## Why

- The first customer's knowledge arrives in four shapes at once: files handed over, a SharePoint site, a public website, and systems it cites but never connects. One connected source shape with two axes covers them all without a type per case.
- Indexing is cheap and reversible. Extraction spends money and lands in a permanent history. So the two are gated differently.
- A live read through a credential is the only honest way to cite a system the company has chosen not to copy.
- Publishing is a legal action with confirmations: lawful basis recorded, privacy information updated, a DPIA reference. Sensitivity alone cannot say "not yet" or "for one group only".
- A concept's citation must survive the document it rests on, or trust is a lie.
- The publish reads the latest index job, because publishing says somebody reviewed what the sync found.
- A converter's normalised text is the address space every span and every content hash is read against. Swapping a converter's output reprocesses every document of that type. It also sends every citation into those documents to a citation fix.
- Conversion runs before the redaction seam, so its input is unredacted. A hosted parser is refused.
- A document has no audience of its own, because an audience is a decision about people and a connected source is where that decision is made.
- With no widen action, an Admin who published at Restricted could open the connected source only by connecting the file again. That is a one-way door, placed where the platform steers Admins.

## Rejected

- Three axes (origin, index, write) or five flat source types: write is constant, so two axes are enough.
- Extracting only under a plan each time, or a standing plan off by default: for a targeted connected source the switch is the plan.
- Sensitivity as the only gate, or no gate: neither can say "indexed, not yet released".
- URL-only citations, caching the cited page, or an evidence snapshot record: a stored copy is a copy the company chose not to make.
- Mirror retention only, or several numeric retention classes: uploads have nothing to mirror, and map-only connected sources need transient.
- A customer-hosted worker now, a worker-local folder watch, or a platform drop area: the share agent reaches an on-site folder with nothing of the platform on the customer's network.
- Every lifted connector switched on, an OKF-bundle upload connected source, or source ACL synchronisation: no first-customer case.
- Docling as the converter for layout: on CPU it wants more than twice the worker's 1.5 GB. OCR or a layout model is reached for only when an Admin will not accept the share of a connected source's documents left unreadable for want of OCR. The answer then starts at ADR 0024's precondition for a model host.
- `anydoc` for PDF as well: it bundles its own build of `pdf-inspector`, and the two outputs differ, which one converter per media type forbids.
- Converters in pure Python: that was a proxy for "no model". A Rust extension carries neither the memory cost nor the crash it answered.

## History

The full record, with its amendments (ticket 24, ticket 50, ticket 79 applied by T-001, T-078, T-055, T-128, T-131, T-130, T-184, T-220, T-370, T-371): `docs/archive/adr/0013-source-origin-reach-and-destination.md`.

Later decisions overturned these rules of the archived record:

- Deriving and syncing the map from the bundle was a `graph_sync_run` job. ADR 0023 and ADR 0032 land the map's delta in the api's commit transaction, and only a full rebuild is a job.
- A sync was a `connector_run` with outcome rows. ADR 0031's `queue` agreement makes a sync one `job` row.
- *Gone at source* was a trust state. ADR 0019 makes it the rider *source moved on*.
- Every sync embedded its passages. ADR 0016 and ADR 0032 leave vectors to S8.
- The roster held sources read live and the file share through the share agent. The route spec's *Not in v0.1* (`docs/specs/v01-route.md`) moved both out of v0.1, with the HubSpot and Asana connectors.
- The map was S8's destination. The route's rewrite of 20/10/2026 gives source entities to S7.

These rules of the record were missing from this doc until 20/10/2026 (BA-215): the connectors, scope and credential, landing before the row, the cost estimate, the upload's converters, the 28-day grace, the re-detection, the publish's refusals and audit row, the state word, the widen's audit event and refusals, and what is not yet built.
