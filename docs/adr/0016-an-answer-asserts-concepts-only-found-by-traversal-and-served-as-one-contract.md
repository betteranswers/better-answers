---
status: accepted
date: 2026-08-27
---

# An answer asserts concepts only, is found by traversal before it is drafted, and is served as one contract whose first event is the verdict

An **answer** — to a typed question, over MCP, or for one question of a question set — asserts only what a **concept** states. It is made in this order: the question's entities and the `Answer` concepts whose title or alternate questions match are found as **entry points** (embedding and full-text over concepts only); the graph is **traversed** from them — subject → relations → concepts of the types the question implies — reading status, supersession, conflicts and trust as it goes (the governed context of ticket 34 §4); an `Answer` concept on that walk that **answers the question as asked** — judged by one call on the workspace's judging route over that shortlist, never over the whole index — is **reused as it stands**, shown with the question it answered and its own trust; otherwise prose is **drafted over the concepts the walk collected**, citing a passage per claim with the citation marker of ADR 0015, and that draft is the promotion gate's candidate `Answer`. Embeddings supply entry points and candidates; the graph supplies the reasoning; nothing is asserted that the walk did not reach. Where no concept answers, the page says **"Not answered from the company's knowledge"** — the one sentence for absent, unpublished and withheld alike — and shows the closest document passages as **unmapped passages** (source, locator, sensitivity word), with two acts: *suggest a concept from this*, or write your own answer, which the gate treats as uncited. No prose is ever generated from a document. Search is one query over **one index of three unit kinds** — concept, guide section or response, document — in one workspace-partitioned table, fused per kind by reciprocal-rank fusion in one SQL statement with the predicate (published · sensitivity · audience · role) applied before ranking, one hit per unit; on the page **a hit is the concept**, its guide sections and its documents nested under it, and a document or a section stands alone only when no concept covers it — a document nothing rests on is marked *Not company knowledge*. The answer is **one contract** for the UI, MCP and the `response` record: an event stream — `verdict` first (ok · warn · refuse for the caller's role, in first-person words; *refuse* ends the stream with no prose), then text, citations, conflicts (both values with their evidence), structured coverage, done — with one pure fold in `packages/` to the object; tRPC streams the events, MCP folds and returns the object with progress notifications. Nothing withheld is ever counted, hinted at or explained on any surface; the answer's context is one header line in badge words, never the model's reasoning or the route's name.

We decided this because the platform's value is that concepts can be reasoned over in a way embeddings cannot, and Q&A sits inside OKF: an agent traverses the knowledge to find whether an answer already exists, which makes minting a new one straightforward (Liam, 27/08/2026); because a sentence generated from document chunks belongs to no knowledge layer — not a concept, not a record about one, not a source — so none of the trust words can describe it and, once pasted into a tender, it cannot be walked back; because the same fact shown three times (concept, section, document) is noise on a Sales screen, and the gap — a document nothing covers — is the one thing worth seeing on its own; because a verdict that arrives after three streamed sentences has already shown them; and because MCP cannot stream a partial tool result, so a contract defined as an object with a streamed field would drift between the two transports.

## Considered options

- **Search first, reason never** — hybrid retrieval over everything with the answer drafted from the top hits: the vendor default the vision names; the graph unused; a reused answer never found because it was never looked for.
- **Draft from documents when no concept answers, marked below threshold** — text now for the bid writer; fluent prose nobody owns wearing the response's frame; readers cannot tell it from sourced text (research 43).
- **A platform-prepared candidate concept from the passages, automatically** — honest, but extraction spend per unanswered question and the Admin holding the writer's clock; the person raises the suggestion instead (the gate may revisit — ticket 37).
- **Every matching unit as its own hit, ranked flat** — the same fact three times.
- **Reuse judged by similarity plus keyword agreement** — within the budget with no model on the path, but "uptime SLA" and "support SLA" sit 0.02 apart and paraphrases are missed; the judging route was chosen.
- **A cross-encoder reranker in v0.1** — seconds per query on a CPU for a marginal gain at this size; Onyx removed its own. The route record reserves a *reranking* purpose.
- **Two contracts, one per transport** — the drift ADR 0015's one renderer exists to prevent.
- **Telling the caller that hits were withheld** — an existence leak.

## Consequences

- `index.chunk` is migration-owned (`managed_by="user"`, ADR 0007) with kind-prefixed ids, a stored `tsvector` with a GIN index and an HNSW index per partition; concepts and composition versions reach it by a **catch-up run** the app enqueues after a commit or a save — cocoindex's Postgres source has no change detection — read from a latest-version view; the word on screen is *searchable within a minute*, never *at commit* (ADR 0005's control plane; `[PIPE1]`). Ticket 41 carries the schema, the fusion statement, K and k defaults and the embedding-time measurement.
- Prompt matching, the graph walk, unmapped passages and IRI lookups all run over the predicate-filtered set; no totals anywhere (cursor pagination, `has_more` only); a concept or guide looked up by IRI returns one *not found* for absent and withheld alike; coverage is rendered by template over the question's own parts (`[LOG1]`, `[SEC2]`).
- The answer audit records the predicate that applied, what was reused and the judge's verdict, so a wrong reuse can be seen (ticket 37); "cited in N answers" counts only answers the caller could have received.
- A question set is extracted as a suggestion — the list confirmed in a table before any answer is drafted (`question.ordinal`, `source_span`) — answered as a background job streamed per question; unanswered questions sort to the top; the output is a **response-set document** through the one renderer, recorded as one `usage` row per response, not an `export`. A `.docx` with real footnotes stays beyond v0.1.
- `CONTEXT.md` gains *hit*, *unmapped passage*, *answer*, *answer contract*; ADR 0004 (compositions indexed for retrieval) is read through this ADR — a section is a hit only when no concept covers it; the *reranking* and *judging* purposes join the route record (ticket 29); nothing in ADRs 0001–0003, 0005–0015 reopens.

## Amendment — 2026-08-27, the question set over MCP (ticket 21, ADR 0018)

"The question set is also an MCP tool" (ticket 47 Q10; this ADR's question-set flow) no longer holds for v0.1: the question set is the web's background job; the MCP `ask` entry links to it. The MCP form returns as a headless agent's job in the agentic layer, never as a human entry. Everything else stands.

## Amendment — 2026-08-28, answering when the map is unavailable (ticket 39, ADR 0021)

"Answering traverses the map before drafting" holds at depth 0 when the map is unavailable: entry points are still found, the judge still runs, an `Answer` that answers as asked is still reused, and the draft asserts only what was reached; the verdict is computed as usual and the context header line says *Answered from search only · map unavailable since <time>*; MCP carries a `map` field (live · as_of · unavailable_since), never a count. Everything else stands.

## Amendment — 2026-08-28, the map inside Postgres (ticket 73, ADR 0023)

The depth-0 fallback and the three `map` phrases stand unchanged. With the graph inside the platform Postgres, *map unavailable* is reachable only when the database itself is; the day-to-day degraded state is *map as of <time> · updating* during a workspace's rebuild. The traversal's predicate is applied in `WHERE` on every element of a bounded path (depth ≤ 4 in the template) rather than inline in the pattern — the same predicate, once, from the same builder. Everything else stands.

## Amendment — 2026-08-30, roles are levels (ticket 79, the pre-build gate; applied by T-001)

ADR 0019 made roles **levels — Admin · Editor · Viewer — never job titles**, and that rename never reached this file. Where this ADR's reasoning says "the same fact shown three times … is noise on a Sales screen", read **a Viewer's screen**. Everything else stands.
