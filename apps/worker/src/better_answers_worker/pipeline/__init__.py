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
"""

from .host import ENVIRONMENTS_HELD, Host, IndexRun, open_pool
from .run import IndexOutcome, index_binding
from .tables import Column, Table

__all__ = [
    "ENVIRONMENTS_HELD",
    "Column",
    "Host",
    "IndexOutcome",
    "IndexRun",
    "Table",
    "index_binding",
    "open_pool",
]
