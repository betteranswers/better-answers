# Dynamic — `ask` as plan, draft, record (S2)

The answering action as T-113 re-seamed it — the review's one blocking finding: **an action that calls a model holds no transaction while it does.** Probe 2 (10/09/2026) fixed the wrapper's shape: an async-generator body runs after the resolving transaction committed and released, so the plan runs in the resolver body, the returned iterable closes over no `Tx`, and the record opens its own transaction. The probe ran under `workspaceProcedure`, which the tRPC base has since replaced with three roads — `queryProcedure` in the resolving transaction, `mutationProcedure` under the held read, `ownTransactionProcedure` carrying the doors (`apps/api/src/trpc/base.ts`); the query road's middleware holds the transaction across the resolver body the way the probe's did. **Planned: S2.** `open` by locator landed with S1 (T-134); the unmapped passages are S2's. Today `ask` searches concepts term by term under the predicate and refuses, calling no model.

```mermaid
C4Dynamic
  title Dynamic diagram — ask, from the question to Questions asked

  System_Ext(claude, "Claude, or the SPA", "The question, as the signed-in person")
  Container(transport, "MCP entry or tRPC subscription", "the MCP surface's withPrincipal; tRPC's queryProcedure", "Resolves the Principal; streams the answer, verdict first")

  Container_Boundary(core, "packages/core") {
    Component(plan, "planAnswer", "answering slice, in the resolving transaction", "The full-text matches, the walk from the set, the reuse decision; returns a plan holding no Tx")
    Component(draft, "draftAnswer", "answering slice, async generator", "Calls the model over the plan; holds no transaction")
    Component(record, "recordAnswer", "answering slice, a second short transaction", "questions_asked, llm_call, the reached set and the cut depth")
    Component(mapdoor, "store/map", "walkFrom over a set", "Seeded ANY of the entry uids, one shared cap, statement_timeout per statement, the predicate on every element")
    Component(llm, "llm", "model choice and model client", "The model choice for answering and judging; the fetch-shaped model client; a row per call")
  }

  ContainerDb(postgres, "Postgres", "RLS", "concept_index with its tsvector, the map tables, questions_asked, llm_call")
  System_Ext(models, "Model provider", "Messages-API-shaped", "Local or hosted, one code path")

  Rel(claude, transport, "1. ask with the question", "MCP or tRPC")
  Rel(transport, plan, "2. In the resolver body, with the Principal and the resolving Tx")
  Rel(plan, postgres, "3. Full-text over concept_index's stored tsvector under the predicate, ranked by kind; the same expression find uses", "GIN")
  Rel(plan, mapdoor, "4. walkFrom the set of matches, depth 4 at most")
  Rel(mapdoor, postgres, "5. One set-seeded walk; the reached set and the depth the cap fell at, recorded not chased", "recursive CTE")
  Rel(plan, postgres, "6. conceptsByIris hydrates the reached concepts under the predicate; the Answers among them are the reuse candidates")
  Rel(transport, draft, "7. The transaction has committed; the iterable is returned and iterated")
  Rel(draft, llm, "8. Resolves the answering and judging model choices; the model client at the wire seam")
  Rel(llm, models, "9. The judge over the candidate Answers, then the draft over the walk, or the reuse as it stands", "HTTPS, streamed")
  Rel(draft, transport, "10. Streams the contract: the verdict first, then the cited claims; depth 0 and the map phrase when the map is unavailable")
  Rel(transport, record, "11. On stream close, in a second transaction")
  Rel(record, postgres, "12. questions_asked with the reached uids and the cut depth; one llm_call row per call; the spend reservation settled; a retry a second row")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## What the flow guarantees

- **Entry points are the concept index's own.** A stored, GIN-indexed `tsvector` over title, tags, *Also known as* and body, written in the governed write's transaction and read under the predicate — no vector, no model call to find an entry (ADR 0016, amended 2026-09-09; probe 1). The expression replaces `findConcepts`' ILIKE predicate, so `find` and `ask` match by one rule.
- **The walk takes a set.** One set-seeded walk from forty entries answers in 15 ms against 423 ms for forty walks; the shared cap of 1,000 is about 25 rows per entry, so the walk barely leaves its seeds and the recorded cut is what keeps the answer honest (probe 3; ADR 0023, amended 2026-09-10). The recall measure asserts the master `Answer` was reached, never set equality.
- **No totals, one *not found*.** Absent and withheld are indistinguishable wherever a caller reads (stories 35 and 36); the `map` field carries the phrase, never a count; before anything projects an edge's columns, the target's own predicate is applied — `open`'s relations projection is the first such projection.
- **Every model call is a row and never the prompt.** `llm_call` records model choice, purpose, tokens and price, as ADR 0025's amendment fixes the columns; a retried `ask` is a second audit row and its stale reservation is swept (gate §2, A21).
- **The recall measure decides S8.** Recall at ten of the master `Answer` on a paraphrase, threshold 90 % over a synthetic set in CI; the real reading is the customer's own answer tests in its workspace at C1, and that reading alone — or the unmapped-passage rate on answers flagged *incomplete* — picks the reserve block.

## Left to S2's spec

Which of the two model calls, the judge over candidate `Answer`s, runs where the plan ends and the draft begins is the block spec's line; the route fixes only that no transaction is held across either. The wire shape — the Messages API alone, or a provider registry — is S2's ADR, leaning the Messages API (grill Q9).
