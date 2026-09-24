# Architecture — the C4 diagrams

The shape of Better Answers as `origin/main` holds it on 24 September 2026, with S0 and S1 landed, the daily sweeps and the dead-man pings running in the api, and the owner's rulings of the same day on the bind class and on erasure over documents drawn as planned. Drawn from the tree, the compose files and scripts under `deploy/`, the workflows under `.github/workflows/`, `CONTEXT.md` and the ADR index (`docs/adr/README.md`). Where a diagram shows something not built yet, the element names the block or the ticket that lands it.

**Authority.** These diagrams are a reading of the tree, never a source: the ADR index wins over a diagram, the ADR body over the index, `CONTEXT.md` over both for a word, and the tree over every document (the route spec's authority order). A diagram that disagrees with the tree is wrong and is redrawn — a `/c4-architecture` pass after any architecture review that moves the shape (`AGENTS.md`, *Skills*).

## The diagrams

| File | Level | Shows | Read it when |
| --- | --- | --- | --- |
| `c4-context.md` | 1 · Context | The platform, the people who use it, the systems it talks to | Orienting; explaining the product to someone outside the build |
| `c4-containers.md` | 2 · Container | The two runtime tiers, the four stores, the worker's two LMDB stores, the twelve agreements | Placing a change: which process, which store |
| `c4-components-core.md` | 3 · Component | `packages/core` — kernel, access, the four store doors, `llm`, `audit`, the nine slices, the import direction, table ownership | Adding an act, a table or a slice |
| `c4-components-api.md` | 3 · Component | `apps/api` — `createServer`'s mounts behind the hostname fence, Better Auth, tRPC, the MCP surface, the twelve ops commands, the head check, the sweep pass and its pings, `migrate` | Adding a procedure, an entry, an ops command or a schedule |
| `c4-components-worker.md` | 3 · Component | `apps/worker` — the loop, the three kinds, the `pipeline/` host, the converter, the detector's memo, the `redaction/` package | Working the worker, the seam, S4, S7 or S8 |
| `c4-deployment.md` | Deployment | Two boxes, the stores stack, the platform stack, the edge, the off-host buckets, the release workflow | Deploying, releasing, restoring, the drill |
| `c4-dynamic-governed-write.md` | Dynamic | One concept write: lock → commit → rows in one transaction → the head check's replay | Touching the write path or the reconciler |
| `c4-dynamic-document-to-passage.md` | Dynamic | S1's cross-tier flow: bind → index run → review → publish → `find` and `open` by locator | Working the Sources screen, a class act (T-370, T-371) or S4 |
| `c4-dynamic-index-run.md` | Dynamic | The worker's `index` run: convert (unmemoised) → detect (memoised) → withhold → the normalised copy, the findings and catalogue, the chunks, quarantine | Touching the converter, the seam, the memo or erasure over documents (T-366) |
| `c4-dynamic-review-and-reindex.md` | Dynamic | The Admin's review acts and the erasure's wipe, and the index run each queues by reason: `bound`, `restored`, `dismissed`, `wiped`, `rule-change` | Adding a review act or a reason, or touching the cascade |
| `c4-dynamic-scheduled-work.md` | Dynamic | Scheduled work and its watchers: the head check, the sweep pass, the nightly audit, the backup cron, the drill, the uptime probe, the dead-man checks | Adding a schedule, a ping or an alert |
| `c4-dynamic-ask.md` | Dynamic | S2's answering act as T-113 re-seamed it: plan · draft · record | Working S2, S6 or S8 |

Context and Container are the two every reader needs. The component diagrams exist because the route lands almost all of its code inside three containers and a block spec has to say *where*. The dynamic diagrams draw the flows the route's seam sketches name most: the governed write every records block goes through; S1's document-shaped cross-tier seam, split in three because one diagram could not carry the bind, the worker's run and the review under twenty elements; the plan · draft · record split S2 is built to; and the scheduled work whose silence is an alert.

## Where each block lands

The route's status table says what a block is and what blocks it. This table says which containers and components it touches, so a block spec's seam sketch can be checked against a diagram. A component in *italics* does not exist in the tree yet.

| Block | Containers touched | Components landed or changed |
| --- | --- | --- |
| S0 | worker · api · Postgres · object store · git store | The redaction seam: the `redaction/` package in the worker and the detector's one memo, `pipeline/detected.py`; the `erasure` slice — subject requests, the erasure map, suppressions, the routine under `pg_advisory_lock(41)`, the replay copy, the rehearsal; `runOps` `replay-erasures` and `erasure-rehearsal` answer *done*, run by `restore-drill.sh` and `restore-production.sh`. The erasure map's `source-document` finder answers none; *a workspace-wide suppression the seam applies by exact case-folded match of the subject's identifiers* is planned (T-366) |
| S1 | api · web · worker · Postgres · object store · LMDB | The `sources` slice — `bindUpload`, `publishBinding`, `narrowBinding`, `findingsOf`, the review acts (`keepInText`, `narrowDocuments`, `dismissAsNotSpecialCategory`, `restoreFinding`), `reprocessBinding`, `dpiaInputFor`, `passageAt`, `findPassages`, `previewChunks`, `listBindings`, `sweepOrphanedUploads`; `runs` — `enqueueJobIn`, `runsOfSubject`; the object door exported; `job` gains `subject_id`, the reason and the kinds, `claim_job` filters by kind; the worker's `pipeline/` (the one cocoindex importer), `KINDS` and the two LMDB stores; `index.chunk` gains its locator and generated full-text column and loses its visibility columns to `index.readable_chunk` (ADR 0044; T-282, T-283); the tRPC upload over `octetInputParser`; the Sources screen; the `redaction`, `document-chunk`, `upload-media-types` and `emptying-a-binding` agreements. *An unpublished binding derived as Restricted, and publish cascading the class it releases* (T-370); *an Admin's widen act that cascades* (T-371), before C1 |
| Ops, off the route | api · Postgres · object store · healthchecks.io | The `sweeps` slice and its `sweep_pass` table (T-236, T-336); `apps/api/src/sweeps.ts`, the daily sweep pass; `dead-man-ping.ts`, pinging the `scheduler` check from the head check and the `sweeps` check from the pass (T-359); `object-store-orphans` and `graph-sweep` by hand under the same lock |
| S2 | api · web · Postgres · a model provider | `answering` slice re-seamed as `planAnswer` · `draftAnswer` · `recordAnswer`; the `concept_index` `tsvector` (second `customType`); the graph door's set-seeded `walkFrom` with one shared cap and a per-statement timeout; `llm` slice's *fetch-shaped model client* and *`llm_call` ledger*; `open`'s edge projection; the concept page and the Questions screen |
| S3 | api · web · Postgres · git store | `concepts` slice — concept authoring, the *edit* suggestion, `concept_owner` table, the unresolved-reference row; `guides` slice — definitions, sections, compositions with two homes, versions, includes, the skeleton projection; `recordUsage` on `answering`; the Knowledge screen |
| S4 | worker · api · web · Postgres · object store · client website · Microsoft Graph | *connectors* per provider in the worker, each beside the converter; the extraction plan and ceiling on `sources`; citation repair; the Sources screen's runs |
| S5 | api · web · Postgres · git store | `concepts` slice — the promotion gate, the by-run revert, the stuck-ref act; `runOps` for T-108; the Suggestions screen |
| S6 | api · web · Postgres | `answering` slice — question sets, the api-claimed job, the response-set document; the deferred principal in `kernel`; the question-set page |
| S7 | worker · api · Postgres · a model provider | *extraction* in the worker over S2's model client; `concept_write_request` sets; the Kinds rename on `concepts` |
| S8 | worker · api · Postgres · an embedding provider | *reserve* — `index.chunk` gains a concept unit and its vector; the `concept-catch-up` job; the embedding route first read |
| P1 | api · web · Postgres · Microsoft Entra · SMTP | `members` slice — the People acts; Better Auth's Microsoft provider; the Account page and *personal tokens*; `rls-exemptions.ts` |
| P2 | api · Postgres | `workspaces` slice — provisioning at the `runOps` seam landed as T-329 (`provision-workspace`, `add-member`, 22/09/2026); the console's remainder — *the operator principal kind*, the admin plugin reduced, the identity-set ledger — stays P2's |
| O1 | api · web · Postgres · backup | *the signal module* (a query per line, thresholds as rows); *`backup_run`*, *`platform_event`*; the System screen's cards |
| V1 | api · web · Postgres · git store | `concepts` slice — verification requests, the cadence, the four conflict resolutions; the Knowledge screen's saved filters |
| C1 | every container | `importBundle` on the `concepts` slice behind `runOps` `import-bundle` (T-307, landed 22/09/2026) — a governed write per imported `Answer`, run by the operator as a named member; `provision-workspace` and `add-member` at the `runOps` seam over the `workspaces` slice landed ahead of the block (T-329, 22/09/2026); the rest of the block adds no component |

## Conventions

- Mermaid's C4 syntax (`C4Context`, `C4Container`, `C4Component`, `C4Deployment`, `C4Dynamic`), one diagram per file, under twenty elements each; an element carries its technology and a one-line description; every arrow is one-way and labelled with a verb.
- The names are the glossary's (`CONTEXT.md`): *store door*, *slice*, *governed write*, *head check*, *sweep pass*, *dead-man ping*, *redaction seam*, *detection key*, *finding*, *withholding*, *landed copy*, *quarantined*, *emptying a binding*, *job*, *claimant*, *MCP surface*, *Control Centre*, *the map*. A component is named as its directory or its export is.
- Something not built yet is marked *planned* in its description with the block or ticket that lands it, so the diagram is checked against the status table and the board, never trusted for what exists.
