# The platform destination

Accepted on ticket 47 (26/08/2026) from `.planning/draft-docs/draft-vision.md` and every decision since; Liam edits it directly. The v0.1 map (`.scratch/v01-spec/map.md`) is the foundation of this; nothing here widens v0.1.

## In one line

**Better Answers** — for SMBs who need accurate information about their business: a living company knowledge map that humans and agents use confidently to run business activities — every answer cited, permission-aware and explainable.

## Why now

A company's knowledge lives scattered across systems, documents and people's heads — unstructured, duplicated, contradictory, often stale. Point an AI tool at that and it answers confidently, wrongly and without a trail. OKF gives knowledge a portable shape any AI system can read and write; open tooling lets a platform go from zero to one quickly by lifting, stitching and configuring rather than building every part. The map is an asset that grows with the business: each new AI use case is cheaper and safer than the last, and where no formal governance exists the map is the practical path to it.

## The knowledge system

Three knowledge layers, and the platform's records over them:

1. **Sources** — the company's systems and documents, connected (or referenced without connection), reviewed for sensitivity, indexed for search. Sources stay where they are and keep evolving.
2. **Bundles** — the OKF concepts: the curated map of what the company knows, one trust-bearing unit per file, written to the spec and readable without the platform. Graph-shaped through its links; portable; the company's asset.
3. **Graph** — derived from the bundles and the records: queryable, traversable, reasoned over. It keeps the map's shape standing as knowledge grows, and grows itself — from what the bundle already holds (people, teams, products, datasets, systems, policies) to the edges between them.

**Records** are what the platform keeps because it runs use cases: guides and their compositions, usage and outcomes, opportunities and responses, bindings, audit, review. They cite concepts by IRI and never restate them. Where a unit lives is decided by the minting rule (ADR 0011): a concept when a company with no platform would keep it as knowledge — the client's Q&A pairs are concepts — a record when it exists only because the platform runs a use case.

Every layer answers questions; the route depends on the question — search over documents, traversal over concepts and the graph to review a guide or draft a response.

## What a consumer sees on every concept

Provenance (what it was created from), trust (who checked it, when, against what), freshness (is it still true), lifecycle (is it current or superseded), attestation (was a figure produced the way we said). Errors are fixed at the right level: concept wrong → edit the concept; source wrong → fix the source; retrieval wrong → fix the evals. Trust never gates viewing; sensitivity does; actions are gated by the reader's role and its threshold.

## Who uses it

- **People** — employees of different backgrounds using the platform to run business activities and to curate knowledge: Admins (sources, kinds, suggestions, Control Centre), bid and sales writers, product and technical staff.
- **Agents** — through the platform's MCP server (Claude Teams first), plugins and skills; local or hosted; producer agents that map and enrich the knowledge, consumer agents that answer and draft.

## Turning knowledge into action — the outcome loop

Use-case outcomes drive the knowledge: a bid outcome triggers a review of the answers it used; a renewal pack draws on what was delivered. A company does not want a dashboard of counts; it wants "here is where to focus, grounded in your data" and "here is the pack, ready for review".

Use cases, in the order they land:

| Stage | Use case | What it needs from the knowledge system |
| --- | --- | --- |
| **v0.1 — single source of truth** (this map) | Product, service and sector guides; the bid libraries as `Answer` concepts; search and cited Q&A; answering a question set (a bid pack or proposal document) from the knowledge with citations; a read-only MCP surface; Control Centre (one Admin surface; its sections are named in ticket 37 — no client release without it, 15 D5); sensitivity, roles, coverage | The three layers; concepts-only bundle; compositions as records; trust and sensitivity; the concept write path |
| **Next — bids and proposals** | Opportunities, versioned packs, extracted question sets with constraints, responses, submissions, outcomes; the outcome loop | The composition primitive with prompt = question; Q&A trust and provenance; the promotion gate |
| **Then** | Renewal packs; intelligence feeds as sources; take-action in connected systems as the user, approval-gated; proposals and prospecting | Acting credentials and the approval layer; feed entries as sources |
| **Later** | Meeting notes, support-ticket sentiment, marketing campaigns, development documentation; customer-hosted deployment | Broader connectors; the customer-hosted worker |

## Principles that do not move

- **Simplicity through OKF.** The file stays to spec; the spec's silences are met in the graph and records. If a feature needs more in the file, the approach is re-evaluated.
- **Private by default.** A connected source starts restricted; personal data never enters the bundle; every call carries a principal; every answer is permission-aware.
- **Local models are a requirement**, per purpose, per workspace — the route record keyed by purpose is what delivers it. Local *embedding* is a named precondition, triggered by the first workspace that asks for it and not by a date: it needs a model-host box the first estate has no room for (ADR 0024).
- **Lift, stitch, configure** — third-party parts by contract, pinned and documented, never forked.
- **Multi-tenant-ready data model, single deployment**, UK-preferred hosting, customer-hosted later.
- **Repo quality is first-class**: functional tests through the interface, a glossary that code obeys, ADRs for what is hard to reverse.
