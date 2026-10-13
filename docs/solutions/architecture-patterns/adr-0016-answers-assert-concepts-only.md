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
  - related-knowledge
  - judge
  - collection
  - traversal
  - unmapped-passage
  - full-text
---

# An answer asserts concepts only, found by traversal and served as one verdict-first contract

## The decision

An answer asserts only what a concept states. It is found by traversal before any prose is written.

- Entry points are found first. The map is then walked from them, reading status, supersession, conflicts and trust.
- Every `Answer` concept among the entry points and the walk that answers the question as asked is returned as it stands: word for word, under its collection, with the question it answered, its sources, and who verified it and when. `Answer`s that fit and say different things are returned side by side, never blended and never reduced to one.
- One call on the judging model choice decides what fits, over the shortlist. It answers yes or no for each candidate and never ranks one against another. A call that fails returns its candidates as related knowledge. It never refuses, and it never calls another model.
- Where no `Answer` is a judged fit and concepts bear on the question, the answer holds those concepts under a verdict of its own, *related knowledge*. A concept bears on a question when it is an entry point or the walk reaches it from one. An `Answer` with no judge's yes is among them and is never shown as a fit.
- Prose is written over the returned concepts alone, with a footnote per claim (ADR 0015). Over MCP the platform writes none: the assistant writes it, told to quote an `Answer` unchanged and to assert only what the returned concepts state. On the Ask page the platform drafts it over a *related knowledge* result, one part per collection.
- No prose is ever generated from a document. Where nothing the reader can read matches, the answer is the one sentence "Not answered from the company's knowledge", with unmapped passages. The sentence is kept for that case alone.
- A caller may name collections. The entry step, the walk and the judge then stay inside them. Unmapped passages are not narrowed, because a passage no concept rests on belongs to no collection.
- Nothing withheld is counted, hinted at or explained anywhere.

An answer is served as one answer contract for the UI, MCP and the response record: an event stream, verdict first, folded by one pure function into one object. The verdict is ok, related, warn or refuse for the caller's role. It is ok when at least one `Answer` is a judged fit, and related when concepts bear on the question and none is. Nothing in v0.1 produces warn. The object says how its judge stood: *not judged*, *judged* or *judging failed*. MCP returns the object alone. On the web the object is the stream's first event and drafted sentences follow it. A refusal ends the stream with no prose.

A concept's collection, `ask`'s `collections` argument, the narrowing of the walk and the *related knowledge* verdict are in the tree. Until the judge is built, no `Answer` is a judged fit: every answer says *not judged*, and every `Answer` among its concepts is related knowledge. S2b builds the judge, and the tree does not hold it yet.

When the map is unavailable, the answer runs at depth 0. Entry points, the judge and reuse still run, and the context header line says the map is unavailable. A walk that passes its timeout is the map unavailable for that answer.

In v0.1 the entry step is full-text over the concept index alone.

- A stored `tsvector` on the concept index, written in the governed write's transaction, so a concept is searchable at commit.
- Title weighted first, tags and *Also known as* second, body third.
- A concept that shares any of the question's words is an entry point, ranked first by how many of them it holds (owner, 09/10/2026). A question asked in plain words rarely repeats a concept's every word.
- No model call on the entry step.

The concept unit of the one index, with its vectors and its catch-up run, is the reserve block S8. It lands only when the answer tests' recall on the first customer's context wordings falls below the threshold S2b sets. When it lands, the worker writes the vector on a job whose row the governed write inserts, never inline and never at read.

## Why

- The platform's value is that concepts can be reasoned over in a way embeddings cannot. An agent traverses the knowledge to find whether an answer already exists.
- A sentence generated from document passages belongs to no knowledge layer. No trust word can describe it, and once pasted into a tender it cannot be walked back.
- A verdict that arrives after three streamed sentences has already shown them.
- MCP cannot stream a partial tool result, so a contract defined as an object with a streamed field would drift between the two transports.
- An assistant rewrites the platform's prose for the person anyway, so a second model call over MCP buys no guarantee there.
- A bundle's `Answer`s differ by product, and one form row can reach several whose figures differ. A drafter handed all of them blends the figures or lists every product, so each `Answer` is returned unchanged under its collection and the caller chooses.
- The embedding half of the entry step was decided while the estate carried a local embedding server. ADR 0024 removed that server the next day, and the need was never measured.

## Rejected

- Search first, reason never: the map unused.
- Drafting from documents when no concept answers: fluent prose nobody owns.
- A suggested concept prepared automatically from the passages: extraction spend per unanswered question.
- Every matching unit as its own match, ranked flat: the same fact three times.
- Reuse judged by similarity plus keyword agreement: "uptime SLA" and "support SLA" sit 0.02 apart.
- A cross-encoder reranker in v0.1: seconds per query on a CPU for a marginal gain.
- Two contracts, one per transport: the drift one renderer exists to prevent. The contract stays one now that only the Ask page drafts, because drafting is a second step over the same result. What is given up is one prose: what a person reads through an assistant and on the Ask page will differ.
- The platform drafting on every transport, or no drafting in v0.1: a model call an assistant then rewrites, or an Ask page with no prose.
- Asking which collection a question concerns, or picking the likeliest `Answer`: the first blocks a plain question, and the second is wrong without notice.
- A narrowing finer than a collection, by tier or by product concept: it waits for S6.
- Telling the caller that matches were withheld: an existence leak.

## History

The full record, with its amendments (ticket 21, ticket 39, ticket 73, ticket 79 applied by T-001, and the route spec's Q1 spike of 09/09/2026): `docs/archive/adr/0016-answers-assert-concepts-only.md`.

Amended 13/10/2026 on the owner's decisions of 11/10 and 12/10/2026, by the S2b ask plan (`docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, R28, with R1 to R5 and R8). An answer was one reused `Answer` or prose the platform drafted, on every transport. It is now every `Answer` that fits, returned unchanged, or the concepts that bear on the question under a fourth verdict, and over MCP the assistant writes the prose. The judge answers per candidate, and a caller may name collections. The refusal sentence is kept for a question nothing matches. The *Two contracts, one per transport* entry stands, and it now says what is given up.

Amended 13/10/2026 by the same plan (KTD4). A walk that passed its timeout had no stated outcome. It now counts as the map unavailable: the answer stands on its entry points and says so.
