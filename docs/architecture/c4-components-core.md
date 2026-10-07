# Components — `packages/core`

Level 3. The business logic every transport calls: capability slices over four store doors, with the import direction a lint rule (ADR 0029). This is where most of the route lands; a block spec's seam sketch names one of these slices first.

```mermaid
C4Component
  title Component diagram — packages/core, the slices over the doors

  Container(api, "apps/api", "Hono", "Transports: tRPC, the MCP surface, runOps, the head check, the sweep pass")

  Container_Boundary(core, "packages/core") {
    Component(kernel, "kernel", "types and pure functions", "Principal — a user or the platform — branded ids, admission, the refusal vocabulary, Result, Clock; imports nothing else")
    Component(access, "access", "the read predicate as data", "published, sensitivity, audience by intersection; rendered to SQL once")
    Component(pgdoor, "store/postgres", "pg", "The handle, the transaction helpers, SET LOCAL app.workspace_id from the Principal, session locks, the rate-limit counters")
    Component(gitdoor, "store/git", "git binary", "The governed write: per-repository lock, hash precondition, one commit per action, the Audit trailer; checks GIT_STORE_DIR once at open")
    Component(mapdoor, "store/map", "recursive CTEs", "The delta builder and the walk templates; the one door that imports access, so no traversal exists without the predicate")
    Component(objdoor, "store/objects", "S3", "put, get, list and remove under the per-workspace prefix; the platform prefix for erasure replay copies")
    Component(llm, "llm", "model choice rows", "listModelChoices over model_choice; the llm_call ledger and the fetch-shaped model client planned S2")
    Component(audit, "audit", "insert-only audit log", "The one append-only audit log: the typed event vocabulary, two doors, four families")

    Component(sources, "sources", "slice", "Connect, publish, narrow, widen; the review actions; reprocess; the DPIA input; passages; the upload sweep")
    Component(concepts, "concepts", "slice", "The write path, the suggestions, the loader, the reconciler, visibility and the cascade's first level, map maintenance")
    Component(answering, "answering", "slice", "find, ask, open, give_feedback; S2 re-seams ask as plan, draft, record")
    Component(guides, "guides", "slice", "Write-ups and includes, recomputed as the cascade's second level; definitions and sections at S3")
    Component(erasure, "erasure", "slice", "Subject requests, the erasure map, suppressions, the routine, replay on restore, the rehearsal; the top of the slice graph")
    Component(runs, "runs", "slice", "enqueueJobIn in the action's transaction, one queued index job per connected source; the job views")
    Component(workspaces, "workspaces", "slice", "Provisioning and first member under the platform principal, the picker's read, the workspace list")
    Component(members, "members", "slice", "Groups and their members, access requests; the People actions at P1")
    Component(sweeps, "sweeps", "slice", "The daily sweep pass over every workspace under session lock 42; one sweep_pass row a pass")
  }

  Rel(api, sources, "Calls")
  Rel(api, concepts, "Calls")
  Rel(api, answering, "Calls")
  Rel(api, erasure, "Calls")
  Rel(api, runs, "Calls")
  Rel(api, workspaces, "Calls")
  Rel(api, llm, "Lists model choices through")
  Rel(api, sweeps, "Runs the pass through")

  Rel(erasure, concepts, "Moves bundle commits and verifications through")
  Rel(erasure, sources, "Wipes the connected sources holding found documents through")
  Rel(erasure, runs, "Queues the map's full rebuild through")
  Rel(erasure, gitdoor, "Rewrites history through")
  Rel(erasure, objdoor, "Writes replay copies through")
  Rel(sweeps, sources, "Sweeps orphaned uploads through")
  Rel(sweeps, concepts, "Sweeps old map generations through")

  Rel(sources, objdoor, "Lands originals through")
  Rel(sources, runs, "Queues syncs through, in the action's transaction")
  Rel(sources, concepts, "Runs the cascade through")
  Rel(concepts, guides, "Recomputes write-ups through")
  Rel(answering, concepts, "Finds and opens concepts through")
  Rel(answering, sources, "Finds and opens passages through")
  Rel(answering, mapdoor, "Walks through; planned S2")
  Rel(answering, llm, "Resolves a model choice and records a call through; planned S2")

  Rel(concepts, gitdoor, "Commits through")
  Rel(concepts, mapdoor, "Writes the delta through")
  Rel(concepts, pgdoor, "Writes the index and identity through")
  Rel(runs, pgdoor, "Calls the queue functions through")
  Rel(mapdoor, access, "Renders the predicate from")
  Rel(llm, pgdoor, "Reads model choices through")
  Rel(audit, pgdoor, "Inserts through")

  UpdateLayoutConfig($c4ShapeInRow="4", $c4BoundaryInRow="1")
```

The stores themselves are on `c4-containers.md`; each door reaches exactly one. Arrows drawn are the load-bearing ones. Every slice also imports `kernel`, calls `audit` for its audit event and reaches Postgres through `store/postgres`; `erasure`, `sweeps` and `concepts` read the workspace list through `workspaces`, and `sources` and `concepts` check group holding through `members`. Drawing all of those would hide the ones that matter. The full rule set is the table below.

No entry calls `guides` or `members` yet: `guides` is reached as the cascade's second level, from `concepts` and `sources`, and `members` by the slices that check a group. `answering` reaches neither the map door nor `llm` today — `find` is `findConcepts` plus `findPassages`, `open` takes an IRI or a locator (T-134), and `ask` searches concepts term by term under the predicate and refuses, calling no model.

## The import direction (ADR 0029, rules 1 to 5)

| From | May import | Never |
| --- | --- | --- |
| `kernel` | nothing in core | — |
| `access` | `kernel` | a door, a slice |
| `store/*` | `kernel`; `store/map` also `access` | another door, a slice |
| `llm`, `audit` | `kernel`, `access`, the doors | a slice, each other |
| a slice | `kernel`, `access`, the doors, `llm`, `audit`, another slice's face (`index.ts`) | another slice's internals or `*.store.ts`; the slice graph is acyclic |
| `erasure` | every slice's face | — nothing in core imports erasure; only a test reaches it |
| anything in core | — | a transport or a transport's dependency (rule 5) |

Enforced by one plugin rule, `better-answers/import-direction` (`packages/devtools/lint-rules/rules/import-direction.ts`), which places both ends of an import in a zone by their position under `packages/core` and applies the table above with the rule number in its message, and by `import/no-cycle` for the acyclic clause (ADR 0029; T-113's finding F10, landed by T-114 and T-117). The rule walks `packages/core` alone: `apps/api` reaches a slice through `@better-answers/core/<slice>`, and a door's face where it composes (`doors.ts`), resolves a Principal (the tRPC base) or runs an ops command. The failure no linter sees — one slice writing SQL against another's tables — is caught by `packages/schema/src/table-ownership.ts`, the checked-in slice-to-tables map with its cross-owner exceptions, reviewed like an export list.

## Who owns which tables

| Owner | Tables |
| --- | --- |
| Better Auth, `apps/api/src/auth` | `user`, `session`, `account`, `verification`, `jwks`, `workspace`, `member`, `invitation`, the `oauth_*` set, `rate_limit` |
| the journal's migrator, `apps/api/src` | `contract_stamp` |
| `store/postgres` | `ingress_counter`, `mcp_call_counter`, `invitation_email_counter` |
| `workspaces` | `workspace_config` |
| `members` | `group`, `group_member`, `access_request` |
| `llm` | `model_choice`; `llm_call` at S2 |
| `audit` | `audit_event` |
| `sources` | `connected_source`, `source_document`, `finding`, `index.passage` |
| `concepts` | `concept_identity`, `concept_index`, `bundle_commit`, `evidence`, `concept_evidence`, `concept_verification`, `concept_sensitivity_override`, `suggestion`, `concept_write_request`, `map_generation`, `map_node`, `map_edge`; `concept_owner` at S3 |
| `guides` | `write_up`, `write_up_include`; definitions, sections and versions at S3 |
| `erasure` | `subject_request`, `erasure_request`, `suppression` |
| `runs` | `job` |
| `sweeps` | `sweep_pass` |
| `answering` | `usage`, `questions_asked`, `question_set`, `question` — from S2, S3 and S6 |

The map is the TypeScript tier's. The worker is in no row: it writes `finding` rows, the catalogue columns of `source_document` and `index.passage` rows under its own database role, and the `redaction` and `document-passage` agreements pin what both tiers read of them.

## What the route changes here

- **S2 splits `ask` into three functions**: `planAnswer(principal, tx, question)` in the resolving transaction, `draftAnswer(plan, model)` an async generator holding no transaction, `recordAnswer(principal, tx, plan, drafted)` in a second short transaction — the review's one blocking finding. The map door's `walkFrom` takes a set with one shared cap and a per-statement timeout (ADR 0023, amended 2026-09-10).
- **S3 makes `concept_owner` a table on `concepts`**, keyed against `concept_identity` with a per-collection default; exports `attachedByIri()` and `versionColumns()` from `packages/schema`; declares `WRITE_UP_HOMES = ["section", "response"]` so S6 adds a writer and never a migration (ADR 0014, amended 2026-09-10).
- **The sensitivity at publish (T-370) and the widen action (T-371)**, as the owner ruled on 24/09/2026. The connected source stores the sensitivity the Admin typed at connect (Restricted and everyone when none is typed); every derivation counts an unpublished connected source as Restricted, so the concepts citing it land Restricted; `publishConnectedSource` records the sensitivity and audience it releases on its audit event and cascades that sensitivity to the citing concepts and their write-ups, keeping a concept the reconciler pinned Restricted where it is (T-370). `widenConnectedSource` moves a connected source, published or not, to a wider sensitivity, audience or both: it records the pair it moved from and to on its audit event, runs the same cascade, refuses `not-wider` and, while a special-category finding the last sync raised is unreviewed, `special-category-unreviewed`, and never moves a document's own narrower sensitivity (T-371).
- **T-366 gives `erasure` its documents.** Since T-375 a suppression is the workspace's, one row per request holding the request's identifiers and the person's sign-in addresses, and recording refuses an identifier too broad to withhold (`identifier-too-broad`). Since T-376 the seam withholds every exact, case-folded occurrence of a suppression's identifiers, and recording measures an identifier against the floor by the `erasure-match` agreement both tiers read. Since T-377 the erasure map's `source-document` finder names the live documents whose indexed text holds one of the identifiers the suppression holds, probing the full-text index and checking each candidate under that agreement, so the routine wipes and re-indexes their connected sources now.
