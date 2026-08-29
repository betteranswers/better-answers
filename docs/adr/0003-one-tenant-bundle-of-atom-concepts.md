---
status: accepted
date: 2026-08-25
---

# One knowledge bundle per tenant, concepts sized to trust state, guides as an assembly layer

A tenant's knowledge is one OKF bundle whose concepts are trust-bearing atoms — an entity or a fact that can be verified, go stale, or change owner independently — organised domain-first (`company/`, `products/<x>/`, `sectors/<y>/`) with `type` carrying the class. Guides and their subsections are an assembly layer over atoms, never the unit of trust. We chose this over concept-per-subsection pages (one-to-one with the first client's requirements, ~100 files) and over bundle-per-domain (ownership for free) because the platform's value is trust per fact reviewed en masse against sources: a changed retention figure must have its own `verified`/`stale_after`, which a page hides; and because tenant-configurable guides cannot be the concept unit if every business defines its own. Domain directories are declared future bundle boundaries so bundle-per-domain stays a promotion; OKF has no cross-bundle link, so splitting now would make every sector↔product reference a platform extension in v0.1.

## Atom-boundary rule

Must split when trust state can differ independently (verifier, `stale_after`, owner, tier, status). Only mint a separate atom when it is nameable, citable in one sentence and reused by two or more places; otherwise it is a section of its parent.

## Consequences

- ~150–350 files for a 35k-word corpus; extraction and enrichment need the rule above as their target, plus a merge-by-identity step.
- Per-fact trust needs no sidecar; per-subsection trust, if wanted, is a property of the assembly layer (ticket 34).
- Splitting pages into atoms later would re-key every link and `verified` event — the reason this is decided first.

## Amendment — 2026-08-25, architecture review pass 1 (ticket 38)

"Merge by identity" has a key: `(workspace, bundle, type, normalised label)`, held in a `concept_identity` resolution table the app consults at write time; a write request carries a resolved `iri` (an update) or none (a mint). A source binding names the domain directory its knowledge lands in, and extraction proposes only within it. Contradictory values found at extraction (the first corpus has 23) are recorded as `conflict` records, never resolved by the pipeline.
