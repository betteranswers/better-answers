---
title: "An answer asserts concepts only, found by traversal and served as one verdict-first contract"
date: 2026-09-09
module: packages/core
problem_type: architecture_pattern
component: answering
severity: high
applies_when:
  - "Changing how an answer finds, reuses or drafts from concepts"
  - "Adding an endpoint or a transport that returns an answer"
  - "Changing the entry step's search or adding embeddings to it"
tags:
  - adr-0016
  - answer
  - answer-contract
  - verdict
  - traversal
  - unmapped-passage
  - full-text
---

# An answer asserts concepts only, found by traversal and served as one verdict-first contract

## The decision

An answer asserts only what a concept states. It is found by traversal before it is drafted.

- Entry points are found first. The map is then walked from them, reading status, supersession, conflicts and trust.
- An `Answer` concept on the walk that answers the question as asked is reused as it stands. One call on the judging model choice decides that, over the walk's shortlist.
- Otherwise prose is drafted over the concepts the walk collected, with a footnote per claim (ADR 0015).
- No prose is ever generated from a document. Where no concept answers, the page says "Not answered from the company's knowledge" and shows unmapped passages.
- Nothing withheld is counted, hinted at or explained anywhere.

An answer is served as one answer contract for the UI, MCP and the response record: an event stream, verdict first, folded by one pure function into one object. The verdict is ok, warn or refuse for the caller's role. A refusal ends the stream with no prose.

When the map is unavailable, the answer runs at depth 0. Entry points, the judge and reuse still run, and the context header line says the map is unavailable.

In v0.1 the entry step is full-text over the concept index alone. The S2 block builds it, and the tree does not hold it yet.

- A stored `tsvector` on the concept index, written in the governed write's transaction, so a concept is searchable at commit.
- Title weighted first, tags and *Also known as* second, body third.
- No model call on the entry step.

The concept unit of the one index, with its vectors and its catch-up run, is the reserve block S8. It lands only when the answer tests' recall on the first customer's context wordings falls below the threshold S2 sets. When it lands, the worker writes the vector on a job whose row the governed write inserts, never inline and never at read.

## Why

- The platform's value is that concepts can be reasoned over in a way embeddings cannot. An agent traverses the knowledge to find whether an answer already exists.
- A sentence generated from document passages belongs to no knowledge layer. No trust word can describe it, and once pasted into a tender it cannot be walked back.
- A verdict that arrives after three streamed sentences has already shown them.
- MCP cannot stream a partial tool result, so a contract defined as an object with a streamed field would drift between the two transports.
- The embedding half of the entry step was decided while the estate carried a local embedding server. ADR 0024 removed that server the next day, and the need was never measured.

## Rejected

- Search first, reason never: the map unused.
- Drafting from documents when no concept answers: fluent prose nobody owns.
- A candidate concept prepared automatically from the passages: extraction spend per unanswered question.
- Every matching unit as its own match, ranked flat: the same fact three times.
- Reuse judged by similarity plus keyword agreement: "uptime SLA" and "support SLA" sit 0.02 apart.
- A cross-encoder reranker in v0.1: seconds per query on a CPU for a marginal gain.
- Two contracts, one per transport: the drift one renderer exists to prevent.
- Telling the caller that matches were withheld: an existence leak.

## History

The full record, with its amendments (ticket 21, ticket 39, ticket 73, ticket 79 applied by T-001, and the route spec's Q1 spike of 09/09/2026): `docs/archive/adr/0016-answers-assert-concepts-only.md`.
