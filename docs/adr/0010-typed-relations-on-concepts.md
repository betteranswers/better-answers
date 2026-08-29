---
status: rejected
date: 2026-08-26
rejected: 2026-08-26 — typed relations are derived in the graph, never written to the file (Liam, ticket 47; `[OKF2]`)
---

# Concepts carry typed relations as a `relations` extension key, with predicates from the company language

An OKF link asserts an untyped relationship: "the specific kind is conveyed by the surrounding prose, not by the link itself" (SPEC §links). A company's knowledge is relational before any platform reads it: research 44 found that the first client's public website alone yields certifications that *apply to* products, clients who *use* products, products that *serve* sectors and tiers that *belong to* a product — 62 of 123 candidate concepts were entities related to other entities. A consumer rebuilding the map from the bundle alone cannot recover those kinds from untyped links plus prose. That is the only justification this ADR rests on; the fact that guide expectations could select by relation is a consequence, not a reason (`[OKF1]`). The proposal: a concept MAY carry a `relations` extension key — a list of `{predicate, target}` where `predicate` is a term from the tenant's company language (the same vocabulary file ADR 0001 makes authoritative in-bundle) and `target` is a bundle-absolute path or a concept IRI. The body link stays the human-readable form; `relations` is the machine-readable one; the governed write keeps them consistent. This is the smallest typed-link design: no RDF, no SHACL, no fenced Turtle blocks. Ticket 30 deferred typed links to a later slice; this ADR is **proposed** until that slice accepts or rejects it, and nothing in v0.1 depends on it.

## Considered options

- **Untyped links only; the graph infers the kind from link plus target type** — spec-pure and zero format cost, but ambiguous the moment two relations point at the same type (a product *replaces* a product vs *integrates with* a product), and the bundle cannot describe its own structure.
- **Typed relations in the graph only, never in the file** — portability loses the relation; a consumer rebuilding from the bundle gets a different map than the platform shows.
- **DataBook-style typed fenced blocks (Turtle/SHACL) in the body** — the full semantic-web profile; far more than v0.1 needs and a second syntax for every author and agent to learn. Kept as the possible future ticket 30 already noted.
- **Predicates as a fixed platform list** — would put platform vocabulary in every tenant's bundle; the predicate list is company language, corrected by the company's people, like every other term.

## Consequences

- `vocabulary.yaml` (or its settled name) gains a `predicates` section beside `types`; a predicate not in it fails the closed-world check the same way an unknown `type` does.
- Product tiers become concepts (`products/<x>/tiers/<tier>.md`) that atoms relate to with `applies_to`; a guide's tier axis is derived from the product concept, never defined in the guide (ticket 45 E3). The prototype's `tiers:` list survives only as a projection the platform may write.
- If accepted, guide expectations may select by relation to the subject as well as by type and company-language tags — never by directory and never by a tag that names a guide section (ADR 0004 amendment). Until then they select by type and company-language tags.
- Extraction and enrichment propose relations like any other field; a relation to a concept that does not exist is a broken link the consumer tolerates (SPEC) and the platform shows as a stub.
- The derive-and-sync job (ADR 0005 lineage) materialises `relations` as typed edges alongside the untyped link edges; nothing in the graph exists that the bundle does not state.

## Rejected — 2026-08-26 (ticket 47)

Liam, feedback on ticket 15: "we don't add `relations` to the concept files — OKF is two knowledge layers for us: the bundle and concepts, and any knowledge graph we build on top." Typed relations are **derived in the graph** from a concept's links, the target's `type` and the company language, and from Admin-confirmed entity resolution; the file carries only the link (`[OKF2]`). The accepted cost is the one this ADR named: a consumer rebuilding from the bundle alone sees untyped links plus prose, not the platform's typed map. Product tiers stay concepts (ADR 0004 amendment); a guide's tier axis reads the graph. Ticket 30's slice (now ticket 50) owns the derivation.

## Read strictly — 2026-08-29 (ticket 50, ADR 0026)

The rejection covers a relation *schema* as well as a relation key: no predicate list with from/to kinds in the bundle or in a platform table. A relation on the map is the link, its sentence and the two endpoint kinds (`LINKS_TO`); `SUPERSEDES`, `CITES` and `IS_CONCEPT` are the only named edges **between concepts**. `DERIVED_FROM` and `SAME_AS` are platform-derived bookkeeping edges and are not relations at all — five named edges in total, three about concepts and two about the platform's own records (ADR 0026's 2026-08-30 amendment).
