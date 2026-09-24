# Dynamic — the review acts and the index runs they queue

What happens between a binding's first run and its publish, and after: the Admin's review acts over *finding groups*, the erasure routine's wipe, and the index run each act queues, named by its reason. Five reasons exist (`INDEX_REASONS`, `packages/schema/src/job-tables.ts`): `bound` from the bind (`c4-dynamic-document-to-passage.md`), and the four drawn here. Every act is one transaction, and a run it queues is queued in it. What the queued run does is `c4-dynamic-index-run.md`.

```mermaid
C4Dynamic
  title Dynamic diagram — review, wipe and the runs they queue

  Person(admin, "Admin", "Reviews a binding's finding groups on the Sources screen, never a span or a value")
  Container(trpc, "tRPC sources router", "queryProcedure; mutationProcedure", "findings, keepInText, dismissAsNotSpecialCategory, narrowDocuments, narrow")
  Container(erasure, "erasure routine", "runErasure, platform principal", "Run by erasure-rehearsal and replay-erasures today; no entry records a real request yet")

  Container_Boundary(core, "packages/core") {
    Component(review, "sources — review.ts and findings.ts", "the review acts", "findingsOf, keepInText over restoreFinding, dismissAsNotSpecialCategory, narrowDocuments")
    Component(binding, "sources — narrowBinding, reprocessBinding", "binding acts", "Narrow a binding's class; empty a binding and queue its run")
    Component(cascade, "cascade", "concepts, then guides", "Concepts citing the moved evidence, then compositions including them; two levels")
    Component(runs, "runs — enqueueJobIn", "the act's transaction", "One queued index job per binding; an emptying reason takes it over")
  }

  ContainerDb(postgres, "Postgres", "RLS", "finding, source_document, source_binding, index.chunk, job, audit_event")
  Container(worker, "worker", "the index run", "Empties binding/ on wiped or rule-change, then indexes")

  Rel(admin, trpc, "1. Opens the review: the finding groups the last run raised, by document, category, rule and tier")
  Rel(trpc, review, "2. keepInText over always-set groups with one reason")
  Rel(review, postgres, "3. restoreFinding per span — restored_at and one ledger row each — reviewed kept-in-text")
  Rel(review, runs, "4. Queues the run with reason restored, so the spans are back in the text")
  Rel(trpc, review, "5. dismissAsNotSpecialCategory over special-category groups with one reason")
  Rel(review, runs, "6. Reviewed dismissed, a ledger row per document; queues reason dismissed, so the verdict can lift")
  Rel(trpc, review, "7. narrowDocuments: each named document takes a class of its own, only narrower")
  Rel(review, cascade, "8. Re-derives the concepts citing those documents, then their compositions; queues no run")
  Rel(trpc, binding, "9. narrow: the binding's class and audience, only narrower; the same cascade; queues no run")
  Rel(erasure, binding, "10. reprocessBinding with reason wiped, per binding holding a document the map found")
  Rel(binding, postgres, "11. Deletes the binding's index.chunk rows and its unreviewed, unrestored findings")
  Rel(binding, runs, "12. Queues reason wiped; rule-change is admitted and no entry asks for it yet")
  Rel(runs, postgres, "13. One queued index job per binding: a later act adds no second job; an emptying reason takes over a queued one and stays")
  Rel(worker, postgres, "14. Claims the job and runs it with its reason")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## The reasons

| Reason | Queued by | Empties the binding | What the run changes |
| --- | --- | --- | --- |
| `bound` | `bindUpload` | no | The first run: findings, the catalogue, the chunks |
| `restored` | `keepInText` | no | The kept spans back in the normalised copy and the chunks; an erasure still outranks them |
| `dismissed` | `dismissAsNotSpecialCategory` | no | A document every one of whose special-category findings is dismissed has the seam's verdict lifted, back to the Admin's own narrowing or the binding's class; the spans stay withheld |
| `wiped` | `reprocessBinding`, from the erasure routine's `rederiveAfterErasure` | yes | `binding/` removed, then every chunk landed again under the new suppressions; `findings/` spared, so nothing is detected afresh |
| `rule-change` | `reprocessBinding`; no entry asks for it yet | yes | As `wiped` |

## What the flow guarantees

- **The review names no span.** A finding group is one document's findings of one category, raised by one rule at one tier; the three bulk acts take groups, and a finding the last run did not raise is not shown, acted on or counted at a publish (`CONTEXT.md`, *finding group*).
- **Only a dismissal widens a document, and never past the Admin.** `narrowDocuments` and `narrow` refuse `widening-refused`; a keep lets a span back into the text and lifts no class. No act widens a published binding today; T-371 plans one, over the cascade publish runs since T-370 (`c4-dynamic-document-to-passage.md`).
- **A narrowing is a write to the source row.** The chunk's class is read through `index.readable_chunk`, so a narrowing queues no run and takes effect at its commit; the cascade re-derives the concepts citing the evidence and then the compositions including them, inside the same act (ADR 0044; `CONTEXT.md`, *cascade*).
- **The two halves of emptying go together.** `reprocessBinding` deletes the chunk rows in the act's transaction and queues a reason the worker empties `binding/` on; the `emptying-a-binding` agreement holds both tiers to the same two reasons.
- **An erasure reaches a document only through the map.** The routine suppresses and wipes the documents its map found, and the `source-document` finder answers none, so step 10 runs for no binding on a real request today. The suppression is already the workspace's (T-375). **Planned**: the seam's exact case-folded erasure match (T-376), and the finder finding the documents that name the subject (T-377).
