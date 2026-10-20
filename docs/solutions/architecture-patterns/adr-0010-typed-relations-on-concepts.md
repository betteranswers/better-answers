---
title: "Concepts carry no typed relations; a link is the relation"
date: 2026-08-26
module: packages/core
problem_type: architecture_pattern
component: knowledge-layer
severity: medium
applies_when:
  - "Adding a key to a concept file that names how two concepts relate"
  - "Adding a predicate list, a relation schema or a new named edge to the map"
  - "Selecting concepts for a guide section by their relation to its subject"
tags:
  - adr-0010
  - relation
  - links-to
  - map-edge-labels
  - predicate
  - concept-file
---

# Concepts carry no typed relations; a link is the relation

## The decision

A concept file carries no `relations` key and no typed link. It carries only the link, in its body.

- There is no relation schema either: no predicate list with from and to kinds, in the bundle or in a platform table.
- A relation on the map is the link, the sentence around it and the two endpoint kinds, held as a `LINKS_TO` edge. Its kind is read from the sentence, never from a predicate (ADR 0026).
- `SUPERSEDES` between concepts, `CITES` from a write-up and `IS_CONCEPT` from a source entity are the only named edges about concepts. `DERIVED_FROM` and `SAME_AS` are the platform's own bookkeeping and are not relations. That is six edge labels in all: `LINKS_TO` and five named edges. They are `MAP_EDGE_LABELS` in `packages/schema/src/map-tables.ts`. A source entity's own edges carry labels that start `source-entity:` (ADR 0011).
- A link to a concept not yet written is legal, as OKF allows, and the platform shows it as a concept not yet written. That display is not built. The concept page lists only links whose target exists.
- Product tiers are concepts, each in its product's collection at `products/<x>/tiers/<tier>.md`, and a guide's tier axis reads the map.
- A guide's expectation may select by type and company-language tags. It may also select by relation to the subject, as the map holds that relation. It never selects by directory, or by a tag that names a guide section.

## Why

- The owner's word: OKF is two knowledge layers for us, the bundle with its concepts and any map built on top. What the platform makes of a link belongs to the map, and the file carries only the link.
- The proposal rested on one claim: a consumer rebuilding the map from the bundle alone cannot recover the kind of a relation from an untyped link plus prose. That cost is accepted. Such a consumer sees untyped links plus prose, not the platform's map.
- OKF itself leaves a link untyped: the kind is carried by the surrounding prose, not by the link. Reading the kind from the sentence keeps the file as OKF defines it.

## Rejected

- A `relations` extension key, a list of `{predicate, target}` pairs beside the body link: the proposal itself, rejected on 26/08/2026.
- Predicates as a term list in the bundle or a platform table, checked closed-world: a relation schema anywhere is refused.
- DataBook-style typed fenced blocks (Turtle, SHACL) in the body: a second syntax for every author and agent to learn.
- Predicates as a fixed platform list: platform vocabulary in every workspace's bundle.

## History

The full record, proposed and rejected the same day (ticket 47) and read strictly on 29/08/2026 (ticket 50, ADR 0026): `docs/archive/adr/0010-typed-relations-on-concepts.md`.

The record's "nothing is on the map that the bundle does not state" fell to ADR 0011's amendment of 27/08/2026, which derives source entities on the map from source documents. The not-yet-written link and the tier's path were missing from this doc until 20/10/2026 (BA-215).
