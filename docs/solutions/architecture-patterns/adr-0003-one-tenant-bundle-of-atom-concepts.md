---
title: "A workspace keeps one bundle of atom concepts, organised domain-first, in v0.1"
date: 2026-08-25
module: packages/core
problem_type: architecture_pattern
component: knowledge-layer
severity: high
applies_when:
  - "Deciding whether a piece of knowledge is one concept, two, or a section of its parent"
  - "Writing extraction or enrichment that proposes concepts"
  - "Resolving whether an incoming concept is new or one the workspace already holds"
  - "Proposing a second bundle per workspace, or a bundle per domain"
tags:
  - adr-0003
  - atom
  - bundle
  - domain
  - merge-key
  - concept-identity
  - atom-boundary
---

# A workspace keeps one bundle of atom concepts, organised domain-first, in v0.1

## The decision

A workspace's knowledge is one OKF bundle in v0.1. Its concepts are trust-bearing atoms: each an entity or a fact that can be verified, go stale or change owner on its own.

- The bundle is organised domain-first (`company/`, `products/<x>/`, `sectors/<y>/`), with `type` carrying the kind.
- A domain directory is a future bundle boundary, so a bundle per domain stays a promotion rather than a rewrite.
- Guides and their sections are assembled over atoms and are never the unit of trust.
- Merge by identity is keyed `(workspace, bundle, type, normalised label)` in `concept_identity`. In the tree the key is one `merge_key` column: the folded kind, a colon, then the title trimmed, its whitespace collapsed and lower-cased (`mergeKeyOf`, `packages/core/src/concepts/landing.ts`). It is unique per workspace, and the bundle is implicit because a workspace holds one.
- A source binding names the domain its knowledge lands in, and extraction proposes only within it.
- Contradictory values found at extraction are recorded as `conflict` records. The pipeline never resolves them; a person does.

The atom-boundary rule:

- Split when trust state can differ independently: verifier, `stale_after`, owner, tier, status.
- Mint a separate atom only when it is nameable, citable in one sentence and reused in two or more places. Otherwise it is a section of its parent.

## Why

- The platform's value is trust per fact, reviewed in bulk against sources. A changed retention figure must carry its own `verified` and `stale_after`, which a page would hide.
- Guides are configured per company. If every business defines its own, a guide cannot be the concept unit.
- OKF has no cross-bundle link. Splitting by domain now would make every sector-to-product reference a platform extension in v0.1.
- Per-fact trust needs no sidecar. Per-section trust, where wanted, belongs to the guide.
- Splitting pages into atoms later would re-key every link and every `verified` event. That is why this was decided first.
- The cost is size: about 150 to 350 files for a 35k-word corpus. Extraction and enrichment take the atom-boundary rule as their target, and need the merge step so the same entity is not minted twice.

## Rejected

- A concept per guide subsection (one-to-one with the first client's requirements, about 100 files): a page hides per-fact trust, and a guide cannot be the unit when every company defines its own.
- A bundle per domain (ownership for free): every cross-domain reference would need a platform extension, since OKF has no cross-bundle link.

## History

The full record, with its one amendment (ticket 38): `docs/archive/adr/0003-one-tenant-bundle-of-atom-concepts.md`.
