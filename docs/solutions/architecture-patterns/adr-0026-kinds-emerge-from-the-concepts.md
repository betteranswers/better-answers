---
title: "Kinds emerge from the concepts; a link is the relation and is never named"
date: 2026-08-30
module: packages/core
problem_type: architecture_pattern
component: knowledge-layer
severity: medium
applies_when:
  - "Adding a field, a table or a check that lists or validates concept types"
  - "Adding an edge label to the map, or a relation between concepts"
  - "Renaming or merging a kind, or changing how concept identity is keyed"
  - "Handling an alias, a tag or the definition of a company word"
tags:
  - adr-0026
  - kind
  - kinds-list
  - relation
  - links-to
  - company-language
---

# Kinds emerge from the concepts; a link is the relation and is never named

## The decision

A concept's `type`, its kind, is the short string its producer chose, folded at write for case and plural only (*customer*, *Customers* → *Customer*). There is no vocabulary file.

- The Kinds list is the set of kinds in use, derived from the concept index with counts per kind and per domain. It is never a file in the bundle, never a table an Admin curates, and never checked closed-world.
- A new kind arrives with the concepts that carry it. The suggestion set's summary names it, and accepting the concepts accepts the kind.
- An Admin renames or merges a kind from the Kinds list on Knowledge. That is one bulk commit that rewrites every affected `type` and re-keys `concept_identity` in the same transaction, because `type` is inside the merge key.
- A kind's definition is a `Term` concept in a glossary domain. Tags stay free strings.
- An alias is knowledge: a confirmed alias lands as an *Also known as* line in the concept body, and `concept_identity` derives its merge-key names from that line and the `title`.

A relation between concepts is the link, and it is never named. Every markdown link between concepts is a `LINKS_TO` edge carrying the two endpoint kinds, the section and the sentence around it. There is no relations list, no predicate matcher and no `RELATES_TO` matrix. An agent that wants the predicate reads the sentence.

The map carries five named edges, and none is a relation a company asserts in a link:

- `SUPERSEDES`, `CITES` and `IS_CONCEPT`, about concepts.
- `DERIVED_FROM` (trust lineage) and `SAME_AS` (a contribution to a canonical entity), about the platform's own bookkeeping. They are records in graph shape.

A kind is an indexed property on the one `Concept` label, never a label of its own (ADR 0023).

## Why

- OKF's first non-goal is a fixed taxonomy of concept types, and its one required key is "not registered centrally". A producer mints a concept so it need not fit anywhere yet.
- The driver is simplicity for companies of one to five hundred people. Categories emerge from evidence and a person approves, which the suggestion gate already does.
- A typed relation would be an edge label on the map and nothing on the answer path: the walk filters by the target's kind, and the drafting model reads the sentence anyway.
- A label is a registry, so labels by kind would rebuild the vocabulary file inside the Postgres catalogue, and a rename would become a schema migration.

## Rejected

- A per-tenant vocabulary file, authoritative and checked closed-world (ADR 0001): a list restating the concept files, and an Admin tending a registry.
- An optional `types:`-only file for definitions: a definition is knowledge, and a `Term` concept holds it.
- Typed relations from a relations list with sentence matching: silently wrong on shared kind pairs, and a registry someone maintains.
- Closed-world tags with a platform-written tier tag: a rule with no act.
- A concept alias as a `concept_identity` row only: the alias leaves with nothing on export.
- The two bookkeeping edges as properties: a supersession or lineage walk becomes a property scan.

## History

The full record, with its one amendment (ticket 79, applied by T-001): `docs/archive/adr/0026-kinds-emerge-from-the-concepts.md`.

It superseded ADR 0001, which made a per-tenant SKOS-shaped vocabulary file in the bundle authoritative and checked every `type` against it closed-world. It went because OKF registers no kind centrally, and without a second file a rename is already one commit.
