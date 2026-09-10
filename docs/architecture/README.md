# Architecture — the C4 diagrams

The shape of Better Answers as the tree holds it on 10 September 2026, after T-113's four verdicts were folded into the route spec (`apps/docs-site/specs/v01-route.md`, Further Notes). Drawn from the tree, the compose files under `deploy/`, `CONTEXT.md` and the ADR index (`docs/adr/README.md`); where a diagram shows something the route has not built yet, the element says which block lands it.

**Authority.** These diagrams are a reading of the tree, never a source: the ADR index wins over a diagram, the ADR body over the index, `CONTEXT.md` over both for a word, and the tree over every document (the route spec's authority order). A diagram that disagrees with the tree is wrong and is redrawn — a `/c4-architecture` pass after any architecture review that moves the shape (`AGENTS.md`, *Skills*).

## The diagrams

| File | Level | Shows | Read it when |
| --- | --- | --- | --- |
| `c4-context.md` | 1 · Context | The platform, the people who use it, the systems it talks to | Orienting; explaining the product to someone outside the build |
| `c4-containers.md` | 2 · Container | The two runtime tiers, the four stores, the worker's own state, the edge | Placing a change: which process, which store |
| `c4-components-core.md` | 3 · Component | `packages/core` — kernel, access, the four store doors, `llm`, `audit`, the eight slices, the import direction | Adding an act, a table or a slice |
| `c4-components-api.md` | 3 · Component | `apps/api` — the hostname fence, Better Auth, tRPC, the MCP surface, `runOps`, the reconciler, `migrate` | Adding a procedure, an entry or an ops command |
| `c4-components-worker.md` | 3 · Component | `apps/worker` — the loop, the two job kinds today, and the host S0 and S1 make of it | Working S0, S1, S4, S7 or S8 |
| `c4-deployment.md` | Deployment | Two boxes, the stores stack, the platform stack, the edge, the off-host buckets | Deploying, restoring, the drill |
| `c4-dynamic-governed-write.md` | Dynamic | One concept write: lock → commit → rows in one transaction → the reconciler's replay | Touching the write path or the reconciler |
| `c4-dynamic-document-to-passage.md` | Dynamic | S1's cross-tier flow: bind → publish → job → index → `find` and `open` by locator | Working S0, S1 or S4 |
| `c4-dynamic-ask.md` | Dynamic | S2's answering act as T-113 re-seamed it: plan · draft · record | Working S2, S6 or S8 |

Context and Container are the two every reader needs. The component diagrams exist because the route lands almost all of its code inside three containers and a block spec has to say *where*. The dynamic diagrams draw the three flows the route's seam sketches name most — the governed write every records block goes through, the one new seam (S1's document-shaped cross-tier test) and the plan · draft · record split S2 is built to.

## Where each block lands

The route's status table says what a block is and what blocks it. This table says which containers and components it touches, so a block spec's seam sketch can be checked against a diagram. A component in *italics* does not exist in the tree yet.

| Block | Containers touched | Components landed or changed |
| --- | --- | --- |
| S0 | worker · api · Postgres · git store | *the redaction seam* (worker, one memoised function beside conversion); `erasure` slice filled — the request, the routine, the replay; `runOps` `replay-erasures` and `erasure-rehearsal` answer *done* |
| S1 | api · web · worker · Postgres · object store · LMDB | `sources` slice — bind, review, publish, `passageAt`, `enqueueJobIn`; the object door exported; `job` gains `subject_id` and kinds, `claim_job` filters by kind; *`pipeline/`* (the one cocoindex importer) and the *`KINDS` registry* in the worker; `index.chunk` gains its locator and generated full-text column; the Sources screen; the first document-shaped `contracts/` agreement |
| S2 | api · web · Postgres · a model provider | `answering` slice re-seamed as `planAnswer` · `draftAnswer` · `recordAnswer`; the `concept_index` `tsvector` (second `customType`); the graph door's set-seeded `walkFrom` with one shared cap and a per-statement timeout; `llm` slice's *fetch-shaped model client*; `open`'s edge projection; the concept page and the Questions screen |
| S3 | api · web · Postgres · git store | `concepts` slice — concept authoring, the *edit* suggestion, `concept_owner` table, the unresolved-reference row; `guides` slice — definitions, sections, compositions with two homes, versions, includes, the skeleton projection; `recordUsage` on `answering`; the Knowledge screen |
| S4 | worker · api · web · Postgres · object store · client website · Microsoft Graph | *connectors* per provider in the worker; the extraction plan and ceiling on `sources`; citation repair; the Sources screen's runs |
| S5 | api · web · Postgres · git store | `concepts` slice — the promotion gate, the by-run revert, the stuck-ref act; `runOps` for T-108; the Suggestions screen |
| S6 | api · web · Postgres | `answering` slice — question sets, the api-claimed job, the response-set document; the deferred principal in `kernel`; the question-set page |
| S7 | worker · api · Postgres · a model provider | *extraction* in the worker over S2's model client; `concept_write_request` sets; the Kinds rename on `concepts` |
| S8 | worker · api · Postgres · an embedding provider | *reserve* — `index.chunk` gains a concept unit and its vector; the `concept-catch-up` job; the embedding route first read |
| P1 | api · web · Postgres · Microsoft Entra · SMTP | `members` slice — the People acts; Better Auth's Microsoft provider; the Account page and personal tokens; `rls-exemptions.ts` |
| P2 | api · Postgres | `workspaces` slice — provisioning at the `runOps` seam; the admin plugin reduced |
| O1 | api · web · Postgres · backup | *the signal module* (a query per line, thresholds as rows); `backup_run`, `platform_event`; the System screen's cards |
| V1 | api · web · Postgres · git store | `concepts` slice — verification requests, the cadence, the four conflict resolutions; the Knowledge screen's saved filters |
| C1 | every container | No new component: a governed write per imported `Answer`, run by the operator |

## Conventions

- Mermaid's C4 syntax (`C4Context`, `C4Container`, `C4Component`, `C4Deployment`, `C4Dynamic`), one diagram per file, under twenty elements each; an element carries its technology and a one-line description; every arrow is one-way and labelled with a verb.
- The names are the glossary's (`CONTEXT.md`): *store door*, *slice*, *governed write*, *reconciler*, *job*, *claimant*, *MCP surface*, *Control Centre*, *the map*. A component is named as its directory or its export is.
- Something the route has not built yet is marked *planned* in its description with the block that lands it, so the diagram is checked against the status table, never trusted for what exists.
