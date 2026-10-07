---
title: "One read predicate guards every map element, and a unit's sensitivity is derived most-restrictive"
date: 2026-09-21
module: packages/core
problem_type: architecture_pattern
component: map
severity: high
applies_when:
  - "Writing a query that walks the map or reads a concept, a write-up or a passage"
  - "Adding a node, an edge or a column to the map tables"
  - "Changing how a concept's or a write-up's sensitivity and audience are derived"
  - "Adding a citation path to the governed write"
tags:
  - adr-0023
  - read-predicate
  - map
  - generation
  - sensitivity
  - audience
  - cascade
---

# One read predicate guards every map element, and a unit's sensitivity is derived most-restrictive

## The decision

The engine is ADR 0032's: plain Postgres tables under RLS. This record holds the write model, which stands.

- Every node and edge carries `workspace_id` and the three visibility terms. `workspace_id` is a term of the `WHERE` on every element of every path, beside the read predicate.
- The bundle-and-record delta lands in the api's commit transaction, beside the concept index row, the `bundle_commit` and the audit event. The map is never behind for an edit.
- Generations survive only for full rebuilds. A rebuild writes the next generation beside the live one and swaps with one row update.
- Keys are never text: concepts by IRI, sections by `(IRI, slug)`, source entities by `(document, type, normalised-text hash)`, actors by `(workspace, actor id)`, write-ups by `(record id, version)`.
- A confirmed alias merge makes a canonical entity, each contribution hanging off it by `SAME_AS` under its own connected source, sensitivity and audience.
- The label set is closed and owned by the migrations. A concept's kind is a property, never a label.
- A `Person` concept starts Restricted whatever its evidence says. Only a recorded Admin override widens it.

The read predicate (published · sensitivity · audience) lives once, as `readableClause` in `packages/core/src/access/index.ts`. It is tested against columns: `published_at`, `sensitivity`, `audience` and `audience_groups` on `concept_index`, `write_up`, `map_node` and `map_edge`. For a passage it is tested against `index.readable_passage`'s columns, because a passage's visibility is read from its connected source and document and not carried (ADR 0044). The map door, `packages/core/src/store/map/index.ts`, applies it to every node and edge of a walk, and the template caps depth at 4.

A sensitivity is derived:

- Most restrictive among the connected sources of the evidence a concept cites, and among a write-up's includes.
- Re-derived synchronously inside the narrowing act, two levels down: connected source, then concept, then write-up.
- Audiences combine by intersection, with *everyone* the identity. An empty intersection forces Restricted (ADR 0039).
- A unit resting on nothing takes its fallback: the writer's word on a creation, what the row holds on anything else.

The walk's timeout is set per statement, never on a role. Entry is by key, never by a map-side index, and admits a set of keys. The governed write refuses a citation of a document the workspace's catalogue does not hold (`no-such-document`), so only a concept citing nothing takes the fallback.

## Why

- A label is a registry: a schema object created, named, indexed and granted before any row can wear it. Labels by kind would rebuild the vocabulary file ADR 0001 died for, and nothing on the write path could create one.
- Every other store in the estate has two isolation controls. `workspace_id` in every `WHERE` gives the map its second.
- A sensitivity is a record, not knowledge: a company marks documents confidential, not each unit of what it knows. So a sensitivity may be derived and recomputed.
- A queued recompute reopens the leak for the length of the queue. One level only lets the guide-footnote leak survive.
- Generations, the debounce and the watermark bridged a second store the api could not write transactionally. That store is gone. Rebuild-equivalence and the nightly second parser keep the map derived.
- A refusal after the commit would be the reconciler's finding, and the reconciler is for crashes.
- A carried passage visibility was a copy five writers in two tiers kept equal by racing.
- One walk per full-text match multiplies the cost and the row cap's reach by the number of matches.

## Rejected

- Clearing and rebuilding in one transaction per workspace: write locks held for the run's length.
- Deltas only, with no generations: a model choice change, an erasure re-derive and the reconciler need a safe "rewrite everything".
- The canonical entity as the target contribution's node: it wears one connected source's predicate and gates the whole person.
- Rewriting merged entities into one node: it loses the per-contribution predicate and cannot be undone.

## History

The full record, with its seven amendments (among them T-055, T-078, T-113 and T-128): `docs/archive/adr/0023-graph-is-apache-age.md`. Its engine, Apache AGE with one map per workspace, is superseded by ADR 0032.

It superseded ADR 0021, which put the map on one shared Neo4j Community instance, rebuilt rather than backed up. That went because a JVM reserving about 3 GB for a map of tens of megabytes, a second stateful service that could not be backed up without stopping it, cost more than the port.
