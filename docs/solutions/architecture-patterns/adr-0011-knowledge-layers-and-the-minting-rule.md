---
title: "Three knowledge layers and the minting rule decide where every unit of knowledge lives"
date: 2026-08-30
module: repository
problem_type: architecture_pattern
component: knowledge-layer
severity: high
applies_when:
  - "Adding a new kind of unit, a record family or a table that holds knowledge"
  - "Deciding whether something belongs in a concept file or in a platform record"
  - "Deriving map nodes or edges from sources, bundles or records"
tags:
  - adr-0011
  - knowledge-layer
  - minting
  - concept
  - record-family
  - source-entity
  - relation
---

# Three knowledge layers and the minting rule decide where every unit of knowledge lives

## The decision

The platform has three knowledge layers: **sources** (evidence) → **bundles** (OKF concepts, curated) → the **map** (derived). Records are not a layer. They are what the platform keeps because it runs use cases: guides and their compositions, usage and outcomes, bindings, audit, review. A record cites concepts by IRI and never restates them.

Where a unit lives follows one minting rule:

- It is a **concept** when a company with no platform would keep it as knowledge: stated, cited, reused, able to be verified, go stale or change owner.
- It is a **record** when it exists only because the platform runs a use case.
- It is **both** only in the derived sense: every concept has a concept index row, and records may attach to it by IRI.

The map derives from sources too:

- A binding whose destination is the map yields **source entities**: typed nodes and edges derived directly from a source document (a person, a meeting, a task), keyed to that document and carrying its sensitivity.
- A source entity is never a concept and never a record. A producer may later propose a concept from source entities through the ordinary suggestion path, and the document then becomes cited evidence.

A relation is a `LINKS_TO` edge between two concepts, carrying its two endpoint kinds, its section and its sentence (ADR 0026). There is no typed-relation derivation, no relations list and no predicate matcher. The map derives supersession, conflicts and equivalence. A predicate label, if one is ever wanted, is derived from edge sentences by a later enrichment job and stays in the map.

What follows from the rule:

- Every new kind of unit is classified by the rule in the ticket that introduces it, and `CONTEXT.md` names the layer it lives in. Nothing is registered anywhere else.
- Q&A pairs are `Answer` concepts. A composition has two homes, a guide section and a response.
- The type vocabulary is derived from the concept index, never a file in the bundle.

## Why

- Five sessions in a row answered a platform need inside the concept file (`variants`, `tiers`, guide-shaped tags, a `relations` key, `superseded_by`) or in the wrong store (Q&A pairs as records, an enrichment pass "from the guides"). Each time the cause was the same: no document said what the layers were or where a unit belongs.
- The bundle-alone test governs keys. This rule governs units, and names the layers the rest of the platform uses.
- The first client's Q&A pairs are knowledge the company keeps today as markdown with no platform, so they are concepts. A guide section's assembled prose, or a response to an opportunity's question, exists only because the platform runs a use case, so it is a record.

## Rejected

- Records first (everything assembled or answer-shaped a record): makes the client's answer library unportable and gives one kind of knowledge two trust mechanisms.
- Bundle first (guides and answers as narrator concepts): prose over atoms drifts by design, and the bundle fills with UI-shaped state.
- No rule, deciding per unit: the drift this rule ends.

## History

The full record, with its two amendments (ticket 53 on source entities; ticket 79, applied by T-001, on relations as links): `docs/archive/adr/0011-knowledge-layers-and-the-minting-rule.md`.
