# Dynamic — the governed write and its reconciler

One act that changes the bundle — a concept typed on Knowledge, an acceptance in Suggestions, a verification, a conflict's resolution — lands as **one commit and one transaction, in that order, under one lock** (ADR 0012). Every records block on the route goes through this flow; S2 adds the `tsvector`, S3 the owner arm and the unresolved-reference row, S5 the by-run revert.

```mermaid
C4Dynamic
  title Dynamic diagram — one governed write, then the reconciler's tick

  Person(person, "Editor or Admin", "The git author of the act")
  Container(trpc, "tRPC procedure", "workspaceProcedure", "Resolves the Principal, opens the transaction, calls the slice")

  Container_Boundary(core, "packages/core") {
    Component(concepts, "concepts slice", "the act", "Authoring, acceptance, verification, revert; owns the transaction and the lock")
    Component(audit, "audit", "ledger", "Mints the event id before the commit")
    Component(gitdoor, "store/git", "git binary", "Lock, precondition, commit with the Audit trailer")
    Component(pgdoor, "store/postgres", "pg", "The one transaction the rows land in")
    Component(graphdoor, "store/graph", "delta builder", "The map's delta under the predicate")
    Component(reconciler, "reconcile", "the concepts slice, called by the api every 30 s", "Head against watermark; replay through the live handler")
  }

  ContainerDb(git, "Git store", "bare repository", "One per workspace")
  ContainerDb(postgres, "Postgres", "RLS", "concept_index, concept_identity, evidence, bundle_commit, the graph, audit_event")

  Rel(person, trpc, "1. Submits the act", "tRPC")
  Rel(trpc, concepts, "2. Calls the act with the Principal and a Tx")
  Rel(concepts, gitdoor, "3. Takes the per-repository lock; checks the hash precondition against the ref")
  Rel(concepts, audit, "4. Mints the audit_event id for the trailer")
  Rel(gitdoor, git, "5. Writes one commit: the person as author, the platform bot as committer, the Audit trailer", "git")
  Rel(concepts, pgdoor, "6. Writes concept_index and its tsvector, concept_identity, evidence, bundle_commit; runs the audience cascade")
  Rel(concepts, graphdoor, "7. Writes the delta into the same transaction, under the predicate")
  Rel(concepts, audit, "8. Books the ledger row, insert-only, under the id from step 4")
  Rel(pgdoor, postgres, "9. COMMIT; the lock releases after it, so bundle_commit is a prefix of git history", "pg")
  Rel(reconciler, git, "10. Every 30 s reads each workspace's head", "git")
  Rel(reconciler, postgres, "11. Reads the watermark; replays any missed commit oldest-first through steps 6 to 9, idempotent on the trailer id; a commit the index refuses stops the replay, reported", "pg")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## What the flow guarantees

- **Authorization is judged at time of act**, against the instant the acting credential was issued at, under a shared lock on the member and person rows — so rows after a revocation are impossible by construction, and a bare commit inside the window is the replay case (ADR 0012, T-052).
- **The map is never behind for an edit.** The delta joins the commit transaction; a full rebuild writes beside the live generation and flips in one row update. The reader's two phrases are *map as of* and *map unavailable since*; the third is retired (ADR 0023, `CONTEXT.md` *map*).
- **A replay is fail-closed on what a commit does not carry.** The merge key, class and evidence are recovered; a file whose `sources[]` are not the standing citations lands Restricted with a ledger row saying so; the replay's ledger row is the reconciler's under the commit's `Audit:` id (ADR 0012, amendments of 2026-09-07 and 2026-09-08).
- **Unwanted content is undone by a forward revert, never a history rewrite.** The one rewrite the platform performs is the erasure routine's, on author lines, to the erasure pseudonym (ADRs 0012, 0035).

## Measured

Probe 3 (10/09/2026, seam 1 over 3,000 concepts): the write is flat at about 0.9 s from 250 to 3,000 concepts; the creation-time backfill scan is 31 to 42 ms of it. S3 replaces that scan with the unresolved-reference row before S7 and C1 multiply the creations.
