# The platform destination

The v0.1 map (`.scratch/v01-spec/map.md`) is the foundation of this; nothing here widens v0.1.

## In one line

**Better Answers** — for SMBs who need accurate information about their business: a living company knowledge map that humans and agents use confidently to run business activities — every answer cited, permission-aware and explainable.

## Why now

A company's knowledge lives scattered across systems, documents and people's heads — unstructured, duplicated, contradictory, often stale. Point an AI tool at that and it answers confidently, wrongly and without a trail. The Open Knowledge Framework (OKF) introduces a unified, portable shape which enables any human or AI system to traverse and reason across a company's knowledge. The map is an asset that grows with the business: each new AI use case is cheaper and safer than the last, and where no formal governance exists the map is the practical path to it.

## The knowledge system

Three knowledge layers, and the platform's records over them:

1. **Sources** — the company's systems and documents, connected (or referenced without connection), reviewed for sensitivity, indexed for search. Sources stay where they are and keep evolving.
2. **Bundles** — the OKF concepts: the curated map of what the company knows, one trust-bearing unit per file, written to the spec and readable without the platform. OKF's structure is explicit, graph-shaped by default, providing rich queryable, traversable context, able to be reasoned over even before any extraction has taken place. Each concept file holds it's own trust and credibility signals; portable; the company's asset.
3. **Graph** — derived from the bundles and the records: It keeps the map's shape standing as knowledge grows, and grows itself — from what each bundle already holds (people, teams, products, datasets, systems, policies) to the edges between them. 

**Records** are what the platform keeps because it runs use cases: guides and their compositions, usage and outcomes, opportunities and responses, bindings, audit, review. They cite concepts by IRI and never restate them. Where a unit lives is decided by the minting rule (ADR 0011): a concept when a company with no platform would keep it as knowledge — the client's Q&A pairs are concepts — a record when it exists only because the platform runs a use case.

Every layer answers questions; the route depends on the question — search over documents, traversal over concepts and the graph as a tool that extends the bundles - "What breaks if this policy changes?" a recursive grep over files becomes a one-line variable-length path pattern in Cypher.

## What a consumer sees on every concept

Provenance (what it was created from), trust (who checked it, when, against what), freshness (is it still true), lifecycle (is it current or deprecated), attestation (was a figure produced the way we said). Errors are fixed at the right level: concept wrong → edit the concept; source wrong → fix the source; retrieval wrong → fix the evals. Trust never gates viewing; sensitivity does; actions are gated by the reader's role and its threshold.

## Who uses it

- **People** — employees of different backgrounds using the platform to run business activities and to curate knowledge: Admins (sources, kinds, suggestions, Control Centre), bid and sales writers, product and technical staff.
- **Platform Agents** — through the platform's MCP server, plugins and skills; local or hosted; producer agents that map and enrich the knowledge, consumer agents that answer and draft. The differentiator - a high quality read surface that enables
- **External Agents** — the remote MCP server provides an exceptional read surface that enables agents from other platforms, or assistants (e.g., a user in Claude Desktop/AI/Cowork) to carry our knowledge anywhere it's needed - a task in Asana that references a concept file that needs an action, a workspace in Notion or a Channel on Teams where users want to discuss a concept, the map, or anything knowledge-shaped. 

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

- **Simplicity through OKF.** The concept file stays to spec; the spec's silences are met in the graph and records. If a feature needs more in the file, the approach is re-evaluated.
- **Private by default.** A connected source starts restricted; personal data never enters the bundle; every call carries a principal; every answer is permission-aware.
- **Local models are a requirement**, per purpose, per workspace — the route record keyed by purpose is what delivers it. Local *embedding* is a named precondition, triggered by the first workspace that asks for it and not by a date: it needs a model-host box the first estate has no room for (ADR 0024).
- **Multi-tenant-ready data model, single deployment**, UK-preferred hosting, customer-hosted later.
- **Repo quality is first-class**: functional tests through the interface, a glossary that code obeys, ADRs for what is hard to reverse.
