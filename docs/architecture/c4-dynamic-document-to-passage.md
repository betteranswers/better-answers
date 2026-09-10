# Dynamic — one uploaded document to a cited passage (S1)

The route's one new seam: the document-shaped cross-tier test, modelled on rebuild-equivalence — the Admin's acts through the sources slice over real Postgres and a real object store, the worker run as a real process against the same stores, then `find` and `open` by locator through the core interface and the MCP surface, the passage asserted as a literal. **Planned: S0 lands the redaction seam, S1 the rest.** Nothing here calls a model and nothing embeds.

```mermaid
C4Dynamic
  title Dynamic diagram — bind, publish, index, open by locator

  Person(admin, "Admin", "Binds, reviews, publishes on the Sources screen")
  Container(trpc, "tRPC mutation", "splitLink on isNonJsonSerializable", "The upload streams to the object door; no second HTTP route")

  Container_Boundary(app, "api and packages/core") {
    Component(sources, "sources slice", "bind, review, publish, passageAt", "Owns the binding, its gates, the chunk's read")
    Component(runs, "runs slice", "enqueueJobIn", "The index job in the publish act's own transaction")
    Component(mcp, "MCP surface", "find, open", "The same predicate and audit as the web")
  }

  Container_Boundary(worker, "apps/worker") {
    Component(loop, "loop and KINDS", "claim_job by kind", "The host: claim, heartbeat, finish, fail")
    Component(pipeline, "pipeline/", "cocoindex host", "index_binding: convert, redact, chunk, write")
    Component(redaction, "the redaction seam", "S0", "One memoised function: conversion plus the detector")
  }

  ContainerDb(objects, "Object store", "Garage", "The landed document")
  ContainerDb(postgres, "Postgres", "RLS", "source_binding, source_document, job, index.chunk")
  ContainerDb(lmdb, "Per-binding LMDB", "cocoindex", "Memo and target state")

  Rel(admin, trpc, "1. Uploads the file with its binding fields", "FormData or octet stream")
  Rel(trpc, sources, "2. Calls bind with the Principal and a Tx")
  Rel(sources, objects, "3. Streams the document to the object door under the workspace prefix", "S3")
  Rel(sources, postgres, "4. Writes source_binding and source_document, Restricted by default, audience everyone")
  Rel(admin, sources, "5. Reviews the findings by category and rule, the class, the audience; then publishes")
  Rel(sources, runs, "6. In the publish transaction: the binding's state, the ledger row with the DPIA hash, and the index job with subject_id the binding")
  Rel(loop, postgres, "7. claim_job with the kinds this tier runs; a lease with a heartbeat", "SKIP LOCKED")
  Rel(loop, pipeline, "8. KINDS index dispatches index_binding with the run")
  Rel(pipeline, objects, "9. Reads the landed document", "S3")
  Rel(pipeline, redaction, "10. Every span through the seam before any store; output versioned by rule and detector pin; suppressions an argument")
  Rel(pipeline, lmdb, "11. Memoises the redacted output; syncs the target state", "cocoindex")
  Rel(pipeline, postgres, "12. Writes index.chunk rows: text, source_document_id, locator, the three visibility columns; the tsvector a generated column", "asyncpg, SET app.workspace_id")
  Rel(loop, postgres, "13. Finishes with the outcome row; the LMDB size as a signal")
  Rel(mcp, postgres, "14. find: full-text over the chunks under the predicate; the hit marked Not company knowledge")
  Rel(mcp, sources, "15. open by locator calls passageAt, the predicate applied there once; the passage verbatim")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="2")
```

## What the flow guarantees

- **Nothing is embedded.** `index.chunk.embedding` and `embedding_route_id` go nullable together under one CHECK; the full-text vector is a generated column neither tier writes; the embedding route row stays fixed and unread until S8's trigger (ADRs 0016 and 0020, amended 2026-09-09; probe 1 proved the ALTER on the partitioned parent).
- **Every binding starts Restricted and every widening is the Admin's recorded act** (story 2; ADR 0013). A special-category finding narrows the document to Restricted on landing; widening is blocked while it is unreviewed (S0).
- **No memo ever holds an unredacted span.** Conversion and the detector are inside one memoised function, so the LMDB's memo is redacted text; the seam's output is versioned by `rule_version:detector_pin` and the suppressions are an argument, never a `detect_change` key (ADR 0020, ADR 0036 amended 2026-09-10).
- **The publish act is one transaction.** The binding, its ledger row and the index job land together through `enqueueJobIn(principal, tx, input)`; the job's `subject_id` names the binding under a per-kind CHECK, so an index job is never about nothing (T-113, owner D3).
- **The read is one door.** `passageAt(principal, tx, locator)` on the sources slice applies the chunk's predicate once; `open` by locator, S2's unmapped passages and S4's citation repair all take it. A binding's drop is blocked while cited evidence stands (owner D5).

## What the test asserts

The Admin's three acts and their refusals through seam 1; the worker as a real process against the same stores (seam 8); the passage as a literal through the core interface and the MCP surface (seam 2); the Sources screen through the browser suite with its ADR 0037 budget (seam 3); the four probe measurements the gate turned into tests — the LMDB holds no personal data in the clear, `drop` on one binding cannot take the shared table, the `detect_change` blast radius stays per document, the LMDB size per binding is a signal (gate §4). The cascade ceiling is measured: 995 ms for a narrowing over a binding 300 concepts cite (probe 3).
