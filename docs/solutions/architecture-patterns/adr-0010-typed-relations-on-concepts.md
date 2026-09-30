---
title: "Concepts carry no typed relations; a link is the relation"
date: 2026-08-26
module: packages/core
problem_type: architecture_pattern
component: knowledge-layer
severity: medium
applies_when:
  - "Adding a key to a concept file that names how two concepts relate"
  - "Adding a predicate list, a relation schema or a new named edge to the graph"
  - "Selecting concepts for a guide section by their relation to its subject"
tags:
  - adr-0010
  - relation
  - links-to
  - graph-edge-labels
  - predicate
  - concept-file
---

# Concepts carry no typed relations; a link is the relation

## The decision

A concept file carries no `relations` key and no typed link. It carries only the link, in its body.

- There is no relation schema either: no predicate list with from and to kinds, in the bundle or in a platform table.
- A relation on the map is the link, the sentence around it and the two endpoint kinds, held as a `LINKS_TO` edge. Its kind is read from the sentence, never from a predicate (ADR 0026).
- `SUPERSEDES`, `CITES` and `IS_CONCEPT` are the only named edges between concepts. `DERIVED_FROM` and `SAME_AS` are the platform's own bookkeeping and are not relations. That is six edge labels in all, `GRAPH_EDGE_LABELS` in `packages/schema/src/graph-tables.ts`: `LINKS_TO` and five named edges.
- Product tiers are concepts, and a guide's tier axis reads the graph.
- A guide's expectation may select by relation to the subject as the graph holds it, as well as by type and company-language tags. It never selects by directory, or by a tag that names a guide section.

## Why

- The owner's word: OKF is two knowledge layers for us, the bundle with its concepts and any graph built on top. What the platform makes of a link belongs to the graph, and the file carries only the link.
- The proposal rested on one claim: a consumer rebuilding the map from the bundle alone cannot recover the kind of a relation from an untyped link plus prose. That cost is accepted. Such a consumer sees untyped links plus prose, not the platform's map.
- OKF itself leaves a link untyped: the kind is carried by the surrounding prose, not by the link. Reading the kind from the sentence keeps the file as OKF defines it.

## Rejected

- A `relations` extension key, a list of `{predicate, target}` pairs beside the body link: the proposal itself, rejected on 26/08/2026.
- Predicates as a term list in the bundle or a platform table, checked closed-world: a relation schema anywhere is refused.
- DataBook-style typed fenced blocks (Turtle, SHACL) in the body: a second syntax for every author and agent to learn.
- Predicates as a fixed platform list: platform vocabulary in every workspace's bundle.

## History

The full record, proposed and rejected the same day (ticket 47) and read strictly on 29/08/2026 (ticket 50, ADR 0026): `docs/archive/adr/0010-typed-relations-on-concepts.md`.
