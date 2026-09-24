# Dynamic — the worker's index run

One `index` job as `pipeline/run.py`'s `index_binding` runs it, for one binding, whatever reason queued it. The order is the guarantee: **convert outside every memo, detect under the one memo, withhold, then write** — the normalised copy, the findings and the catalogue, and only then the chunks. A document the run cannot read is quarantined and the run goes on. No model is called and nothing embeds. The acts that queue a run, and the reason each carries, are `c4-dynamic-review-and-reindex.md`.

```mermaid
C4Dynamic
  title Dynamic diagram — one index run, from the claim to the chunks

  Container(loop, "loop.py and KINDS", "Python 3.13", "claim_job with the three kinds; the heartbeat beside the run")

  Container_Boundary(pipeline, "apps/worker — pipeline/ and redaction/") {
    Component(run, "run.py — index_binding", "the host", "Opens the binding's two stores and the workspace's pool")
    Component(catalogue, "catalogue.py", "psycopg", "read_binding, record_findings, reconcile_catalogue, quarantine_catalogue")
    Component(landed, "landed.py — landed", "coco.fn, unmemoised, one component per document", "Converts, asks for spans, redacts, splits into chunks")
    Component(converter, "converter.py", "anydoc 0.2.4, pdf-inspector 1.24.0", "docx and PDF to normalised text, text passed through; UnreadableError otherwise")
    Component(detected, "detected.py — detected", "coco.fn, memo=True, version 1", "Spans for one normalised text under one detection key")
    Component(redaction, "redaction/", "Presidio, GLiNER, spaCy", "spans_detected; redact — the block rule, pseudonyms, withholdings, written spans")
    Component(rows, "rows.py and host.land_rows", "cocoindex chunks app, managed_by user", "index.chunk rows keyed by document and ordinal")
  }

  ContainerDb(postgres, "Postgres", "workspace-scoped role", "job, source_binding, source_document, suppression, finding, index.chunk")
  ContainerDb(objects, "Object store", "Garage, S3", "The original; the normalised redacted copy")
  ContainerDb(lmdb, "Per-binding LMDB", "binding/ and findings/", "Target-state tracking; the detector's memo")

  Rel(loop, postgres, "1. claim_job for nightly-audit, full-rebuild and index; a lease kept alive by heartbeat", "SKIP LOCKED")
  Rel(loop, run, "2. KINDS[index] calls index_binding with the workspace, the binding and the reason")
  Rel(run, lmdb, "3. Reason wiped or rule-change: removes binding/ before anything else; findings/ is spared")
  Rel(catalogue, postgres, "4. read_binding: the rules in force; the workspace's suppressions; each document not gone, with its restores and dismissals", "psycopg, SET app.workspace_id")
  Rel(landed, objects, "5. Reads each original", "boto3")
  Rel(landed, converter, "6. Counts pages, then converts, outside every memo; an unreadable document, or one past its ceiling, is quarantined")
  Rel(landed, detected, "7. Asks for the spans of the normalised text under the detection key")
  Rel(detected, lmdb, "8. A hit answers from findings/ — rule id, offsets, score; a miss runs the body")
  Rel(detected, redaction, "9. On a miss only: spans_detected over the whole normalised text")
  Rel(landed, redaction, "10. redact: findings raised by the block rule, withheld or left by reason, placeholders written; the text split into chunks")
  Rel(landed, objects, "11. Writes each document's normalised redacted copy", "boto3")
  Rel(catalogue, postgres, "12. One transaction: finding rows; source_document's hash, normalised key, redaction version, converted and a narrowed class; quarantined rows with their error", "psycopg")
  Rel(rows, postgres, "13. Lands index.chunk rows, tracked in binding/", "asyncpg, SET app.workspace_id on every acquisition")
  Rel(loop, postgres, "14. Finishes with the outcome: documents, chunks, lmdb_bytes, restores overridden by an erasure")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## What the run guarantees

- **No memo holds text.** `detected(normalised_text, detection_key)` is the one memoised function, its value spans — rule id, offsets, score. The worker's suite holds both stores to holding neither the text nor a withheld span, nor an erased person's name after a wipe (ADR 0036, amended 2026-09-23).
- **A fix reaches every document with no version to bump.** Conversion, the block rule, pseudonyms and the withholding run outside the memo on every run, and `CONVERTER_PIN` is in no memo key: a converter upgrade re-detects only the documents whose normalised text it changed. The memo moves with the *detection key* — the digest of what the detector reads: recognisers and pins, thresholds, context lemmas, the consumer-domain list, the window rule. The version a finding carries, `rule_version:detector_pin`, is the seam's output and never the memo's key (`CONTEXT.md`, *detection key*).
- **A document's class is on its row before any chunk of it lands.** Step 12 commits before step 13: the seam's special-category verdict only narrows the document, through `narrower_class`, and a verdict every one of whose findings an Admin dismissed is lifted back to the Admin's own narrowing or the binding's class (ADR 0044). No chunk row carries visibility.
- **Quarantine is an outcome, never a failure.** A page with no text layer, an encrypted file, a truncated upload, a type with no converter and a conversion past its ceiling — 6,453 ms a page plus 93 s — all land as *quarantined* with a *quarantine error* naming what refused it; the run lands the binding's other documents and finishes (`CONTEXT.md`, *quarantined*).
- **Emptying a binding is two halves.** The act that queued a `wiped` or `rule-change` run deleted the binding's chunk rows in its own transaction; step 3 removes `binding/`, the engine's record of what it landed, so step 13 lands every row again (the `emptying-a-binding` agreement).
- **An erasure outranks an Admin's keep.** A suppression names identifiers the seam withholds whatever the review said, and a kept span it names is *overridden by the erasure* and counted in the outcome. Since T-375 a suppression is the workspace's, one row per request, read for every document; today the seam withholds a detected span equal to one of its identifiers. **Planned**: the exact case-folded erasure match of every identifier, detected or not (T-376).
