---
title: "An audience is a word and a group-id array, combined by intersection and failing closed"
date: 2026-09-07
module: packages/core
problem_type: architecture_pattern
component: identity
severity: high
applies_when:
  - "Adding a readable unit, or a table whose rows a reader's audience must filter"
  - "Writing or changing the read predicate or the visibility derivation"
  - "Narrowing a connected source, or anything that re-derives a concept's or a composition's visibility"
  - "Minting a group for a Restricted connected source's named people"
tags:
  - adr-0039
  - audience
  - audience-groups
  - group
  - visibility
  - narrowing
  - restricted
---

# An audience is a word and a group-id array, combined by intersection and failing closed

## The decision

**The representation.** Every readable unit and the connected source carry a pair: `concept_index`, `composition`, `connected_source`, `concept_class_override`, `map_node` and `map_edge`.

- `audience` is *everyone* or *groups*, narrowed at the boundary.
- `audience_groups text[]` holds ADR 0038's group ids.
- One CHECK ties them, `AUDIENCE_CHECK` in `packages/schema/src/readable-columns.ts`. *Everyone* holds no array. *Groups* holds a non-empty array with no NULL element.

A chunk carries no pair of its own. It reads its connected source's through `index.readable_chunk` (ADR 0044).

**The predicate's third term** is `audience = 'everyone' OR audience_groups && $groups`. The caller's group ids are resolved on each call by the Principal resolver.

- It fails closed. An empty caller list, a NULL array and a deleted group's dangling id all overlap nothing.
- It is conjoined with the other two terms. An audience narrows a Restricted unit's Admins exactly as it narrows an Internal unit's members. The Admin arm is the class's alone.

**Audiences combine by intersection, with *everyone* the identity.** The class combines beside it by ADR 0023's most-restrictive rule. One derivation does both: `derivedVisibility` in `packages/core/src/access`.

- A recorded Admin override outranks everything, then the combination. A unit resting on nothing takes its fallback. The per-kind floor narrows the class and never widens it.
- It runs at write time: the governed write derives the row it lands.
- A narrowing re-derives synchronously two levels down, in the narrowing act's own transaction: every concept citing the connected source's documents, then every composition including them.
- The map's copies of the columns are rewritten in that same transaction.

**An empty intersection forces the unit Restricted, and is never stored.** It becomes *Restricted* for *everyone*, which the predicate reads as Admins alone. It is never stored as *groups* over an empty list.

**A Restricted connected source's named people are a `group` row** of ADR 0038's implicit origin, whose id `audience_groups` names. Nothing here mints one. Minting it is an act of connected source management.

## Why

- The word beside the array is the one representation that is at once fail-closed, a plain column on every readable unit, a one-line term in the one predicate, and an UPDATE for the two-level cascade.
- Intersection is the only combination under which a reader who passes a derived unit passes every unit it rests on. That is what makes *derived* mean *no wider than the evidence*.
- An empty list is the natural zero value. A shape that means *nobody* today is the shape a bug writes tomorrow, and a bug must narrow. Restricted for *everyone* is the one value the predicate already reads as nobody but Admins, so the CHECK need not loosen.
- If Admins bypassed the audience, it would be a term about Viewers and Editors only. The glossary says it is about who may see.
- Two grouping shapes are two cascades to keep honest (ADR 0038).

## Rejected

- One nullable array, NULL meaning everyone: the widest grant is the absent value, so a row a bug leaves unwritten is visible to the whole workspace. `'{}'` meaning everyone is worse.
- A join table per readable unit: the predicate stops being a column, *everyone* needs a sentinel row, and the cascade becomes deletes and inserts across side tables.
- The empty intersection stored as *groups* over an empty list: the zero value would mean *nobody* on purpose and *everyone was forgotten* by accident.
- Combining by union: a concept minted from HR's document and Sales's would be wider than either piece of evidence.
- An Admin arm on the audience term: an Admin outside a Restricted connected source's group would see what the connected source withholds.
- A second table for a connected source's named people: refused by ADR 0038.

## History

The full record, with no amendments: `docs/archive/adr/0039-audience-word-and-group-ids.md`.
