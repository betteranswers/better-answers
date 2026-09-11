"""The one package in this tier that composes the indexing engine (ADR 0036).

Everything named here takes and answers plain types — `str`, `int`, dataclasses of
those, mappings of those — so no type of the engine's ever crosses out of this
directory. The tier-wide ban on importing the engine is lifted for this path and no
other, by a single per-file ignore, and a test holds both halves of that.

What a caller reaches for:

- `index_binding(bootstrap, run) -> IndexOutcome` — one index run, the seam the worker's
  registry dispatches an `index` job through.
- `Host` — what a process holds between runs: the one event loop, one connection pool
  per workspace and the bounded cache of per-binding stores.
- `Table`, `Column` — a table the app created, described for the engine to write rows
  into and never to create, alter or drop.
- `redact_landed_copies(...) -> LandedRun` — a binding's landed copies converted,
  redacted through S0's seam inside the one memoised function, and cut into chunks.
- `split_into_chunks`, `chunk_id_of`, `locator_of` — this tier's half of the
  `document-chunk` agreement: where the rows are cut, what a row's id is and what
  address it carries.
- `LandedCopies` — the object store as this package needs it, two keys and some bytes,
  with `Bucket` the estate's own implementation of it.
"""

from .chunks import (
    CHUNK_SIZE_BYTES,
    Chunk,
    chunk_id_of,
    locator_of,
    split_into_chunks,
)
from .host import ENVIRONMENTS_HELD, Host, IndexRun, open_pool
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
from .run import IndexOutcome, index_binding
from .tables import Column, Table

__all__ = [
    "CHUNK_SIZE_BYTES",
    "ENVIRONMENTS_HELD",
    "MEMO_VERSION",
    "PASSED_THROUGH",
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
    "chunk_id_of",
    "index_binding",
    "locator_of",
    "object_key_of",
    "open_pool",
    "redact_landed_copies",
    "split_into_chunks",
    "suppression_of",
]
