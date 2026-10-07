---
title: "A passage's visibility is read from its connected source and its document, never copied onto its row"
date: 2026-09-23
module: packages/schema
problem_type: architecture_pattern
component: stores
severity: high
applies_when:
  - "Writing a query that reads passages, or adding a column to index.passage"
  - "Publishing or narrowing a connected source or its documents"
  - "Changing the order of a sync's catalogue writes and its passage landing"
  - "Adding filter columns for a vector search over passages"
tags:
  - adr-0044
  - passage
  - readable-passage
  - effective-class
  - narrower-class
  - visibility
  - narrowing
---

# A passage's visibility is read from its connected source and its document, never copied onto its row

## The decision

A passage's visibility is read, not carried. `index.readable_passage` is a `security_invoker` view that joins the passage to its connected source and its document (`packages/schema/migrations/0044_the-readable-chunk.sql`).

- `published_at`, `audience` and `audience_groups` are the connected source's.
- `sensitivity` is the narrower of the connected source's class and the document's, by `narrower_class`. That is the document's *effective class*.
- `narrower_class` is the class ranking's one SQL statement.
- `passageAt`, `findPassages` and `previewPassages` (`packages/core/src/sources/passages.ts`) read the view.
- A passage whose connected source row is gone is unreadable.

What follows from it:

- The four columns are off `index.passage`. No tier writes a passage's visibility.
- A narrowing or a publish is a write to the source row, and queues no sync.
- A sync commits its catalogue writes (the verdict, the findings, the quarantine) before it lands its passages.
- A concept's class and a composition's stay columns, because they are derivations over many rows.

The view takes two trade-offs:

- `security_barrier` is deliberately unset, so the planner keeps the GIN scan.
- `narrower_class` pins its `search_path` at the cost of inlining: it stays one call per row of the join's output.

Only S8 measuring a need for the filter columns on the indexed table reopens this.

## Why

- Five writers in two tiers copied the four columns, and the fold was written four ways. A sync that read the connected source before a narrowing committed landed its rows at the old, wider class. The re-copy at sync end never ran if the sync failed, and could itself write a pre-narrowing class over a narrowing that had just committed.
- One SQL statement reads one snapshot. A read that joins the passage to its connected source and its document cannot see a narrowing half-applied, whatever the sync believed. The safety is the database's own, and needs no lock order.
- Committing the catalogue writes first puts a document's special-category class on its row before any passage of it can be read. It is per sync, because the landing converges the whole connected source's rows in one update. A sync that dies between the two leaves findings for passages not yet landed, until the retry.
- Measured on 1,000,000 passage rows under RLS, `find` through the view ran at p50 45 ms and p95 235 ms. That is inside ADR 0037's one second and no slower than the copies.
- `security_invoker` makes the base tables' policies and the caller's privileges decide. A barrier would stop the planner reordering through the view.
- The joins carry `workspace_id` beside the id, so the read prunes to one tenant's partition.
- The pinned `search_path`, with a schema-qualified `array_position`, stops a caller's `pg_temp` object shadowing what the fold counts with. The call per row runs over the small set the index scan already produced.

## Rejected

- Copies the database keeps by trigger: it guards a mechanism the view deletes, and its one argument, per-class partial indexes for S8, is a guess.
- Copies every writer re-copies through one function: the five-writers problem restated.
- A guard trigger that refuses a wrong value: every writer still computes the fold, and a race becomes a failed sync.
- Leaving the re-copy at sync end: the failure is unbounded, and the remedy can itself widen.

## History

The full record, with its one amendment (T-324): `docs/archive/adr/0044-chunk-visibility-is-read-not-copied.md`.
