"""The one package in this tier that composes the indexing engine (ADR 0036).

Everything named here takes and answers plain types — `str`, `int`, dataclasses of
those, mappings of those — so no type of the engine's ever crosses out of this
directory. The tier-wide ban on importing the engine is lifted for this path and no
other, by a single per-file ignore, and a test holds both halves of that.

What a caller reaches for:

- `index_binding(bootstrap, run) -> IndexOutcome` — one index run, the seam the worker's
  registry dispatches an `index` job through.
- `Host` — what one index run holds: the one event loop, its workspace's connection pool
  and its binding's store, opened and closed around the job `index_binding` is handed.
- `Table`, `Column` — a table the app created, described for the engine to write rows
  into and never to create, alter or drop; `CHUNK_TABLE` is the one this tier writes.
- `SENSITIVITY_ORDER` — the class words from the narrowest outwards, which is the order
  the visibility fold and the run's last statement both read.
- `redact_landed_copies(...) -> LandedRun` — a binding's landed copies converted,
  redacted through S0's seam inside the one memoised function, and cut into chunks.
- `split_into_chunks`, `chunk_id_of`, `locator_of` — this tier's half of the
  `document-chunk` agreement: where the rows are cut, what a row's id is and what
  address it carries.
- `LandedCopies` — the object store as this package needs it, two keys and some bytes,
  with `Bucket` the estate's own implementation of it.
"""

import os

# Ahead of every import beneath it, and the order is the whole of it: the engine's core
# looks for this once, as it is imported, and calls its usage gateway for the life of
# the process if it was not there — the record is the docblock on
# `tests/test_pipeline_usage_tracking.py`. A package runs before any module beneath it
# and the tier-wide ban keeps every import of the engine beneath this one, so here is
# ahead of all of them. It covers the process the image, the deploy unit and the CI
# runner did not start. Written and never read, so it is not the config module's.
os.environ["COCOINDEX_DISABLE_USAGE_TRACKING"] = "1"

from .chunks import (
    CHUNK_SIZE_BYTES,
    Chunk,
    chunk_id_of,
    locator_of,
    split_into_chunks,
)
from .host import CHUNKS_APP, ENVIRONMENTS_HELD, LANDED_APP, Host, IndexRun, open_pool
from .landed import (
    MEMO_VERSION,
    PASSED_THROUGH,
    LandedDocument,
    LandedRun,
    ReadDocument,
    RedactedDocument,
    Suppression,
    redact_landed_copies,
    suppression_of,
)
from .objects import Bucket, LandedCopies, object_key_of
from .rows import CHUNK_TABLE, SENSITIVITY_ORDER, Visibility, chunk_rows, rows_of
from .run import WIPED_REASON, IndexOutcome, index_binding
from .tables import Column, Table

__all__ = [
    "CHUNKS_APP",
    "CHUNK_SIZE_BYTES",
    "CHUNK_TABLE",
    "ENVIRONMENTS_HELD",
    "LANDED_APP",
    "MEMO_VERSION",
    "PASSED_THROUGH",
    "SENSITIVITY_ORDER",
    "WIPED_REASON",
    "Bucket",
    "Chunk",
    "Column",
    "Host",
    "IndexOutcome",
    "IndexRun",
    "LandedCopies",
    "LandedDocument",
    "LandedRun",
    "ReadDocument",
    "RedactedDocument",
    "Suppression",
    "Table",
    "Visibility",
    "chunk_id_of",
    "chunk_rows",
    "index_binding",
    "locator_of",
    "object_key_of",
    "open_pool",
    "redact_landed_copies",
    "rows_of",
    "split_into_chunks",
    "suppression_of",
]
