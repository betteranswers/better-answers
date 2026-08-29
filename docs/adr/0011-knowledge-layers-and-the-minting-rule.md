---
status: accepted
date: 2026-08-26
---

# Three knowledge layers, and a unit of knowledge is minted where a company without the platform would keep it

The platform's knowledge system has three **knowledge layers** — **sources** (evidence: connected or referenced, reviewed for sensitivity, indexed) → **bundles** (OKF concepts: the curated map, graph-shaped through its links, written to the spec) → **graph** (derived from the bundles and the records; queryable, traversable, reasoned over) — and **records**, which are not a layer: what the platform keeps because it runs use cases (guides and their compositions, usage and outcomes, bindings, audit, review), citing concepts by IRI and never restating them. Where a unit of knowledge lives follows one **minting rule**: it is a *concept* when a company with no platform would keep it as knowledge — stated, cited, reused, able to be verified, go stale or change owner; it is a *record* when it exists only because the platform runs a use case; it is *both* only in the derived sense — every concept has an index row, and records may be attached to it by IRI. We decided this because five sessions in a row answered a platform need inside the concept file (`variants`, `tiers`, guide-shaped tags, a `relations` key, `superseded_by`) or in the wrong store (Q&A pairs as records; an enrichment pass "from the guides"), and each time the cause was the same: no surface said what the layers were or where a unit belongs. The bundle-alone test (`[OKF1]`) governs *keys*; this ADR governs *units* and names the layers every surface uses.

Applied at once to the case that exposed it: the first client's **Q&A pairs** are knowledge the company keeps today as markdown with no platform — so they are concepts (`type: Answer`), with usage, submissions and outcomes attached as records (ADR 0004 amendment). A guide section's assembled prose and a response to an opportunity's question exist only because the platform runs a use case — records.

## Considered options

- **Records first** — everything assembled or answer-shaped is a record; the bundle holds only extracted atoms. ADR 0004's first reading; every vendor's shape. Makes the client's most valuable asset (its answer library) unportable and gives one kind of knowledge two trust mechanisms.
- **Bundle first** — guides and answers as narrator concepts in the bundle (research 32/33; ticket 34 rounds 1–2). Rejected in ticket 34: prose over atoms drifts by design and the bundle fills with UI-shaped state.
- **No rule; decide per unit** — what happened; the drift this ADR ends.

## Consequences

- Every new kind of unit is classified by the rule in the ticket that introduces it, and `CONTEXT.md` names the layer it lives in.
- Compositions have two homes (guide section, response); Q&A pairs are `Answer` concepts; a FAQ or Bid Reference section is a view over `Answer` concepts linked to its subject.
- The concept index row is the only "both": derived, rebuilt from the bundle, never edited (ticket 15).
- The graph derives what a spec-pure file cannot state — typed relations, supersession, conflicts, equivalence (`[OKF2]`, `docs/okf-v02.md`).
- A bid or proposal outcome can trigger a producer run over the `Answer` concepts it used — the outcome loop's knowledge-side contract, fixed in v0.1 though the opportunity records are not.

## Amendment — 2026-08-27, source entities (ticket 53)

The graph is derived from **sources**, bundles and records — not from bundles and records alone. A binding whose destination is the graph yields **source entities**: typed nodes and edges derived directly from a source document (a person, a meeting, a task), keyed to that document and carrying its sensitivity; never concepts, never records. The minting rule is unchanged — a producer may later propose a concept from source entities through the ordinary suggestion path, at which point the document becomes cited evidence. Everything else in this ADR stands.

## Amendment — 2026-08-30, a relation is the link (ticket 79, the pre-build gate; applied by T-001)

The consequence "the graph derives what a spec-pure file cannot state — typed relations, supersession, conflicts, equivalence" reads, after ADR 0026: **the graph derives supersession, conflicts and equivalence, and carries every link between concepts as a `LINKS_TO` edge with its two endpoint kinds, its section and its sentence.** A *relation* is that link — there is no typed-relation derivation, no relations list and no predicate matcher; a predicate label, if one is ever wanted, is derived from edge sentences by a later enrichment job and stays in the graph. The layering is untouched: sources → bundles → graph is a statement about what derives from what and about authority (ADR 0023). Likewise the **type vocabulary is derived** from the concept index, never a file in the bundle — where this ADR's consequence says a new kind of unit is classified by the rule and named in `CONTEXT.md`, that stays true; nothing is registered anywhere else.
