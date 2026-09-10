# Components — `apps/worker`

Level 3. The Python tier today is a loop and two job kinds; T-113's verdict 2 is that it is **a host** — S1 gives it a registry of kinds and one `pipeline/` module that alone imports cocoindex, and none of that reshapes the loop. Components the route has not built are marked *planned* with their block.

```mermaid
C4Component
  title Component diagram — apps/worker, the loop and the host S1 makes of it

  ContainerDb(postgres, "Postgres", "workspace-scoped role", "The queue, index.chunk, the graph tables, the schema stamp")
  ContainerDb(git, "Git store", "read-only mount", "The bundle at the commit on the run row")
  ContainerDb(objects, "Object store", "Garage, S3", "Landed documents; planned S1")
  ContainerDb(lmdb, "Per-binding LMDB", "cocoindex Environment", "Memo and target state; planned S1")
  System_Ext(models, "Model provider", "The extraction route; planned S7")

  Container_Boundary(worker, "apps/worker") {
    Component(loop, "loop.py", "the image's command", "One pass over every workspace per tick: claim and run one job, or schedule the audit that is due; refuses to claim on a schema-stamp mismatch")
    Component(queue, "queue.py", "the queue agreement", "claim_job, heartbeat, finish, fail; the lease and its heartbeat; S1 passes the kinds this tier can run")
    Component(kinds, "KINDS registry", "planned S1", "KINDS[kind](bootstrap, job) returns an Outcome; each kind opens the stores it needs; the host keeps claim, heartbeat, finish and fail")
    Component(rebuild, "rebuild.py", "full-rebuild kind", "One workspace's graph made again as a new generation, flipped live by one row update; rebuild-equivalence keeps it honest")
    Component(audit, "audit.py", "nightly", "The parser audit over every concept file, due once a day per workspace")
    Component(bundle, "bundle.py, concept_file.py, links.py", "dulwich", "Reads the bundle at a commit; parses a concept file to the canonical text and hash the concept-file agreement pins; resolves links")
    Component(chunker, "chunker.py", "the concept chunker", "Splits a concept's body only, never its frontmatter; S1's document splitter is cocoindex's")
    Component(pipeline, "pipeline/", "planned S1, the one cocoindex importer", "index_binding(bootstrap, run) returns an IndexOutcome; one asyncpg pool per workspace with SET app.workspace_id; Environments in a bounded LRU; every target managed_by user")
    Component(redaction, "the redaction seam", "planned S0", "One memoised function, conversion and the detector inside it, versioned rule_version and detector_pin; suppressions an argument; no memo holds an unredacted span")
    Component(connectors, "connectors/", "planned S4", "Upload today; the website by URL prefix and SharePoint through Graph, each with its converter, the run key and stable ids")
    Component(extraction, "extraction", "planned S7", "Candidate concepts within the plan and the ceiling, proposed as concept_write_request rows; credentials injected per run")
    Component(substrate, "schema_view.py, ids.py, health.py, log.py, config.py", "substrate", "The committed schema view drift-checked both ways; the ULID minter; the process probe; one JSON log shape; the box's limits")
  }

  Rel(loop, queue, "Claims and heartbeats through")
  Rel(queue, postgres, "Calls the queue functions of", "psycopg")
  Rel(loop, kinds, "Dispatches a claimed job to; planned S1")
  Rel(kinds, rebuild, "Runs the full-rebuild kind")
  Rel(kinds, pipeline, "Runs index, with a reason; planned S1. bind and prune are S4's kinds")
  Rel(loop, audit, "Schedules when due")
  Rel(rebuild, bundle, "Reads every concept through")
  Rel(audit, bundle, "Parses every file through")
  Rel(rebuild, chunker, "Chunks bodies through")
  Rel(bundle, git, "Reads at a commit from", "dulwich")
  Rel(rebuild, postgres, "Writes the new generation into", "psycopg")

  Rel(pipeline, connectors, "Enumerates and fetches through; planned S4")
  Rel(pipeline, redaction, "Passes every span through before any store; planned S0")
  Rel(pipeline, objects, "Reads the landed document from", "S3")
  Rel(pipeline, lmdb, "Memoises in and syncs targets from", "cocoindex")
  Rel(pipeline, postgres, "Writes index.chunk rows with the visibility columns into", "asyncpg")
  Rel(extraction, models, "Calls per document within the ceiling", "fetch-shaped fake in tests")
  Rel(extraction, postgres, "Proposes concept_write_request rows into", "the concept-inbox agreement")
  Rel(loop, substrate, "Checks the schema stamp and reports health through")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## What the diagram claims

- **The loop stays the loop.** `tick` serves every workspace in turn: claim one job, run it in one transaction with a heartbeat beside it, or schedule the nightly audit. S1 replaces the body of `_run_claimed` with a registry lookup and nothing else in the loop (T-113, worker-host F3).
- **The worker holds no git credential and writes no bundle.** It reads the bare repository at the commit on the run row over a read-only mount, with dulwich because the runtime image carries no git binary (ADR 0024). A concept it produces reaches the bundle as a `concept_write_request` row an Admin accepts (ADRs 0005, 0012).
- **One module imports cocoindex.** `pipeline/` is the one importer, a ruff `TID251` entry refusing the import elsewhere; the worker composes the engine's blocks — memoisation, stable ids, target sync, `mount_each`, timeouts — and writes only what the engine has no block for: the run key, claim and lease, attempts and poison, the catalogue, retention, outcome rows, the landing (ADR 0036).
- **The flow's rows land outside the job's transaction**, so `index.chunk` under row-level security needs a per-workspace pool with a session-level `SET app.workspace_id` in its connection init, `min_size=0, max_size=2` (probe 4: asyncpg defaults to ten).
- **A wipe is one act in order** — the binding's chunk rows deleted in the app's transaction, the directory removed, an `index` job enqueued — because `app.drop()` on a user-managed table keeps its rows (probe 4; ADR 0036, amended 2026-09-10).

## What each block adds

| Block | Adds to the worker |
| --- | --- |
| S0 | The detector as one memoised function beside conversion; the pytest harness asserting every fixture span back against the text by offset |
| S1 | `KINDS`, `pipeline/`, the per-workspace pool, the Environment LRU with the LMDB size as a signal, `RUST_LOG=warn` bridged into one log shape, the cross-tier document test with the worker as a real process |
| S4 | A connector per provider with its converter, the estate-size probe, `MAX_CONCURRENT_RUNS=1` measured, citation repair on a gone document |
| S7 | Extraction over the accepted plan and the ceiling, the template per document kind, conflicts raised never resolved |
| S8 | *reserve* — the concept unit: the `concept-catch-up` kind, embedding on the fixed route with an `llm_call` per call |
