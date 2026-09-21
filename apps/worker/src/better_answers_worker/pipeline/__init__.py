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
  redacted through S0's seam inside the one memoised function, and cut into chunks. A
  document it could not read comes back on `LandedRun.quarantined` as a
  `QuarantinedDocument` naming the error, never as a failure of the run.
- `converted(body, media_type) -> str`, `pages_of(body, media_type) -> int` and
  `UnreadableError` — the converter: one per media type, no model, inside the worker.
  `timeout_for(pages)` is the ceiling each document's conversion is given.
- `split_into_chunks`, `chunk_id_of`, `locator_of` — this tier's half of the
  `document-chunk` agreement: where the rows are cut, what a row's id is and what
  address it carries.
- `LandedCopies` — the object store as this package needs it, two keys and some bytes,
  with `Bucket` the estate's own implementation of it.
"""

import os

# Ahead of every import beneath it, and the order is the whole of it: the engine's core
# reads both of these once, as it is imported, and a line anywhere downstream of that
# sets a variable nothing reads again — the record is the docblock on
# `tests/test_pipeline_engine_environment.py`. A package runs before any module beneath
# it and the tier-wide ban keeps every import of the engine beneath this one, so here is
# ahead of all of them, and ahead of the config module ever being asked for anything —
# which is why neither value is that module's, and why the second line is the one look
# at the environment this tier takes outside it.
#
# Without the first the core calls its usage gateway for the life of the process. The
# deploy unit, the image and the CI runner set it for the processes they start; this
# covers the ones they did not, and a box that says otherwise does not win.
#
# Without the second the core installs a tracing subscriber at `info` and writes its own
# non-JSON shape to stdout, and this variable is the only thing that quiets it — so the
# tier that has one logger states the level here as well as in the deploy file, and one
# JSON shape leaves the process. A box that set a louder one is an operator reading the
# engine's own lines, and keeps it; one that set it to nothing has said nothing.
os.environ["COCOINDEX_DISABLE_USAGE_TRACKING"] = "1"
os.environ["RUST_LOG"] = os.environ.get("RUST_LOG") or "warn"

from .chunks import (
    CHUNK_SIZE_BYTES,
    Chunk,
    chunk_id_of,
    locator_of,
    split_into_chunks,
)
from .converter import (
    CONVERTER_PIN,
    CONVERTERS,
    DOCX_MEDIA_TYPE,
    OCR_ANSWER,
    PASSED_THROUGH,
    PDF_MEDIA_TYPE,
    UnreadableError,
    converted,
    converter_pin_of,
    pages_of,
)
from .host import CHUNKS_APP, ENVIRONMENTS_HELD, LANDED_APP, Host, IndexRun, open_pool
from .landed import (
    MEMO_VERSION,
    SEAM_MS_PER_PAGE,
    TIMEOUT_MARGIN_MS,
    LandedDocument,
    LandedRun,
    QuarantinedDocument,
    ReadDocument,
    RedactedDocument,
    Suppression,
    redact_landed_copies,
    suppression_of,
    timeout_for,
)
from .objects import Bucket, LandedCopies, object_key_of
from .rows import CHUNK_TABLE, SENSITIVITY_ORDER, Visibility, chunk_rows, rows_of
from .run import WIPED_REASON, IndexOutcome, index_binding
from .tables import Column, Table

__all__ = [
    "CHUNKS_APP",
    "CHUNK_SIZE_BYTES",
    "CHUNK_TABLE",
    "CONVERTERS",
    "CONVERTER_PIN",
    "DOCX_MEDIA_TYPE",
    "ENVIRONMENTS_HELD",
    "LANDED_APP",
    "MEMO_VERSION",
    "OCR_ANSWER",
    "PASSED_THROUGH",
    "PDF_MEDIA_TYPE",
    "SEAM_MS_PER_PAGE",
    "SENSITIVITY_ORDER",
    "TIMEOUT_MARGIN_MS",
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
    "QuarantinedDocument",
    "ReadDocument",
    "RedactedDocument",
    "Suppression",
    "Table",
    "UnreadableError",
    "Visibility",
    "chunk_id_of",
    "chunk_rows",
    "converted",
    "converter_pin_of",
    "index_binding",
    "locator_of",
    "object_key_of",
    "open_pool",
    "pages_of",
    "redact_landed_copies",
    "rows_of",
    "split_into_chunks",
    "suppression_of",
    "timeout_for",
]
