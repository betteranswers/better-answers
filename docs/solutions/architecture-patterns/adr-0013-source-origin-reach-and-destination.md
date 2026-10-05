---
title: "A source binding is bound by origin, reach and destination, gated by three permission fields"
date: 2026-09-24
module: packages/core
problem_type: architecture_pattern
component: knowledge-layer
severity: high
applies_when:
  - "Adding a connector, a binding field or a media type's converter"
  - "Writing a read of chunks, source entities or concepts that must apply the permission predicate"
  - "Changing how a binding's or a document's class is narrowed, widened or published"
tags:
  - adr-0013
  - source-binding
  - sensitivity
  - audience
  - publish
  - widen
  - converter
---

# A source binding is bound by origin, reach and destination, gated by three permission fields

## The decision

A source binding is bound by **origin** (company or external; platform origin is an evidence kind with no binding), **reach** (connected or referenced) and **destination** (the chunk index, the bundle, the map; at least one).

It is gated by three permission fields:

- **published** (`published_at`);
- **sensitivity**;
- the **audience** word (*everyone* or *groups*) beside its group ids (`audience_groups`), tied under one CHECK.

The three are applied as one server-side predicate on every read.

- Its destination feeds the chunk index alone until S7.
- A media type has one converter, inside the worker, with no model.
- Its credential class is ADR 0041's.

A document's own class only narrows its binding's.

- It is lifted back only by a dismissal of the special-category findings, and never past the Admin's narrowing.
- The *effective class* of a document is the narrower of the two.

An unpublished binding derives as Restricted until its publish.

- The publish is let through only once the binding's latest index run is done.
- The publish releases the binding's class down the cascade.

An Admin's recorded widen act (`widenBinding`, in the `sources` slice) is the one road by which a binding widens.

- Its audit row carries the class and audience the binding moved from and to.
- It is refused while a special-category finding is unreviewed.
- It never moves a document's own class.

## Why

- The first client's knowledge arrives in four shapes at once: files handed over, a SharePoint site, a public website, and systems it cites but never connects. One binding shape with two axes covers them all without a type per case.
- Indexing is cheap and reversible. Extraction spends money and lands in a permanent history. So the two are gated differently.
- A live read through a credential is the only honest way to cite a system the company has chosen not to copy.
- Publishing is a legal act with confirmations: lawful basis recorded, privacy information updated, a DPIA reference. Sensitivity alone cannot say "not yet" or "for one group only".
- A concept's citation must survive the document it rests on, or trust is a lie.
- The publish reads the latest index job, because publishing says somebody reviewed what the run found.
- A converter's normalised text is the address space every span and every content hash is read against. Swapping a converter's output reprocesses every document of that type and sends every citation into them to citation repair.
- Conversion runs before the redaction seam, so its input is unredacted. A hosted parser is refused.
- A document has no audience of its own, because an audience is a decision about people and a binding is where that decision is made.
- With no widen act, an Admin who published at Restricted could open the binding only by binding the file again: a one-way door, placed where the platform steers Admins.

## Rejected

- Three axes (origin, index, write) or five flat source types: write is constant, so two axes are enough.
- Extracting only under a plan each time, or a standing plan off by default: for a targeted binding the switch is the plan.
- Sensitivity as the only gate, or no gate: neither can say "indexed, not yet released".
- URL-only citations, caching the referenced page, or an evidence snapshot record: a stored copy is a copy the company chose not to make.
- Mirror retention only, or several numeric retention classes: uploads have nothing to mirror, and map-only bindings need transient.
- A customer-hosted worker now, a worker-local folder watch, or a platform drop area: the share agent reaches an on-site folder with nothing of the platform on the client's network.
- Every lifted connector switched on, an OKF-bundle upload binding, or source ACL synchronisation: no first-client case.
- Docling as the converter for layout: on CPU it wants more than twice the worker's 1.5 GB.

## History

The full record, with its amendments (ticket 24, ticket 50, ticket 79 applied by T-001, T-078, T-055, T-128, T-131, T-130, T-184, T-220, T-370, T-371): `docs/archive/adr/0013-source-origin-reach-and-destination.md`.
