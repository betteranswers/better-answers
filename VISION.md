# The platform destination

`docs/specs/v01-route.md` sets out the route to the first release, v0.1.

## In one line

**Better Answers** is a map of a company's own knowledge, built for small and medium-sized businesses that need accurate information about themselves. People and agents rely on the map to run business activities, and every answer it gives is cited, permission-aware, and explainable.

## Why now

A company's knowledge is spread across systems, documents, and people's heads. Much of it is unstructured, duplicated, contradictory, or out of date. An AI tool pointed at that knowledge answers with confidence, often wrongly, and leaves no trail.

The Open Knowledge Framework (OKF) gives that knowledge one portable shape. Any person or AI system can follow the links in that shape and reason across it. The map is an asset that grows with the business. Each new AI use case builds on the same map, so it costs less and carries less risk than the one before. Where a company has no formal governance, the map is the practical way to get some.

## The knowledge system

The system has three layers of knowledge. The platform also keeps records about them.

1. **Sources.** These are the company's systems and documents. The platform copies each source, or reads it live and keeps no copy. It reviews the content for sensitivity and indexes it for search. Sources stay where they are and keep changing.
2. **Bundles.** A bundle holds OKF concepts, the curated body of what the company knows. Each concept is one file and one unit of trust. The file follows the spec, and a person can read it without the platform. It carries its own trust and credibility signals, it is portable, and it belongs to the company. OKF structure is explicit and forms a graph by default. A reader can query it, follow its links, and reason over it before any extraction runs.
3. **Map.** The platform derives the map from the bundles and the records. The map keeps the shape of the company's knowledge current as that knowledge grows. It begins with the things each bundle already names, such as people, teams, products, datasets, systems, and policies, and adds the edges between them.

**Records** are what the platform keeps because it runs use cases. They include guides and their write-ups, usage and outcomes, opportunities and responses, connected sources, audit, and review. A record cites concepts by IRI and never restates them.

The minting rule decides where a unit lives. If a company with no platform would still keep the unit as knowledge, the unit is a concept. By this rule, the customer's question-and-answer pairs are concepts. If the unit exists only because the platform runs a use case, it is a record.

Every layer answers questions, and the question decides the path. Search finds documents. Traversal follows concepts. The map extends the bundles for questions that cross many concepts. Take "What breaks if this policy changes?" Over plain files, the answer needs a recursive grep. With the map, it is one prepared traversal.

## What a consumer sees on every concept

Every concept shows a consumer five things:

- Provenance: what the concept was created from.
- Trust: who checked it, when, and against what.
- Freshness: whether it is still true.
- Lifecycle: whether it is current or deprecated.
- Attestation: whether a figure was produced the way the platform says it was.

A fault is fixed where it starts. If the concept is wrong, edit the concept. If the source is wrong, fix the source. If retrieval is wrong, fix the evals.

Trust never controls who can view a concept. Sensitivity does. The reader's role, and the threshold set for that role, control which actions the reader can take.

## Who uses it

- **People.** Employees with different backgrounds use the platform to run business activities and to curate knowledge. They include Admins, bid and sales writers, and product and technical staff. Admins manage sources, concept types, suggestions, and the Control Centre.
- **Platform agents.** These agents work through the platform's MCP server, plugins, and skills, and run locally or hosted. Producer agents map and enrich the knowledge. Consumer agents answer questions and draft documents.
- **External agents.** The remote MCP server gives read access to agents and assistants on other platforms, for example a user in Claude Desktop, Claude.ai, or Cowork. Those agents take the company's knowledge to wherever the work happens. An Asana task can reference a concept file that needs action. A Notion workspace or a Teams channel can hold a discussion about a concept, the map, or anything else the knowledge covers.

## The outcome loop turns knowledge into action

The outcomes of use cases feed back into the knowledge. A bid outcome starts a review of the answers the bid used. A renewal pack draws on what the company delivered. A dashboard of counts does little for a company. What helps is a pointer to where to focus, grounded in the company's own data, and a pack that is ready for review.

Use cases arrive in this order:

| Stage | Use case | What it needs from the knowledge system |
| --- | --- | --- |
| **v0.1: single source of truth** | Product, service, and sector guides. The bid libraries as `Answer` concepts. Search and cited Q&A. Answers to a question set, such as a bid pack or a proposal document, drawn from the knowledge with citations. A read-only MCP server. The Control Centre, a single Admin area. Sensitivity, roles, and coverage. | The three layers. Bundles that hold only concepts. Write-ups kept as records. Trust and sensitivity. The path that writes concepts. |
| **Next: bids and proposals** | Opportunities, versioned packs, question sets extracted with their constraints, responses, submissions, and outcomes. The outcome loop. | Write-ups that take the question as their prompt. Trust and provenance for Q&A. The promotion gate, which mints an `Answer` concept from a write-up. |
| **Then** | Renewal packs. Intelligence feeds as sources. Actions in connected systems, taken as the user and only after approval. Proposals and prospecting. | Credentials to act with, and the approval layer. Feed entries as sources. |
| **Later** | Meeting notes, support-ticket sentiment, marketing campaigns, and development documentation. Customer-hosted deployment. | Broader connectors. The customer-hosted worker. |

## Principles that do not move

- **Simplicity through OKF.** The concept file stays to the spec. Where the spec says nothing, the map and the records fill the gap. A feature that needs more in the file needs a new design. `docs/okf-v02.md` states the rule.
- **Private by default.** A connected source is restricted until an Admin publishes it. Personal data never enters the bundle. Every call carries a principal, and every answer respects the reader's permissions.
- **Local models first.** Each workspace can prefer a local model for each purpose, because the model choice is keyed by purpose. Local embedding starts when the first workspace asks for it, not on a set date. It needs a separate machine to host the model, and the first deployment has no room for one.
- **A multi-tenant-ready data model on a single deployment.** Hosting in the UK is preferred. Customer-hosted deployment comes later.
- **Repository quality is first-class.** Functional tests run through the interface. Code follows the glossary. ADRs record the decisions that are hard to reverse.
