"""The kinds this worker runs, and a handler for each — the loop's dispatch as a table.

The work loop is the **host**: it claims a job, keeps its lease alive on a connection of
its own, and finishes or fails it with an outcome. What it does not know is what any one
kind of job *means*. That is here, one record per kind, so the dispatch is a lookup
rather than a chain of `if`s — and a kind lands by adding a record to this table, with
the host left exactly as it was.

**The kinds this table holds are the kinds the loop claims.** `claim_job` takes the
array (`queue.claim`), and it filters both arms of the claim by it, so a job whose
handler has not landed is neither claimed nor poisoned by this worker: it stays queued
for the process that can run it. That is what the pair of cases in the work-loop suite
holds, at the claim itself, now that every kind the queue declares has a handler here.

**A handler opens the stores and the transaction it needs.** It is given the bootstrap
and the job this worker holds, and nothing else — not the host's connection, because
what a kind reaches for is the kind's own business. The first two each want one scoped
transaction over Postgres and the bundle at the workspace's head; the index run wants a
connection pool, an object store and a store on disk that the host has never heard of.
So each opens what it needs from the bootstrap and closes it when the run ends, and the
host's one connection stays free for the claim, the finish and the fail it is there for.
"""

from collections.abc import Callable
from typing import Any

from . import queue
from .audit import run_audit
from .config import Bootstrap
from .pipeline import IndexRun, index_binding
from .rebuild import run_rebuild

#: What running one job amounts to: the bootstrap the deploy unit gave this process and
#: the job it holds, answering the outcome row the host records when the job ends.
type Handler = Callable[[Bootstrap, queue.ClaimedJob], dict[str, Any]]


def nightly_audit(bootstrap: Bootstrap, job: queue.ClaimedJob) -> dict[str, Any]:
    """The two parsers checked against each other over the workspace's bundle, hash by
    hash (ADR 0012, ADR 0023). It refuses nothing: a mismatch is a state the outcome
    carries.
    """
    with (
        queue.connected(bootstrap.database_url) as connection,
        queue.scoped(connection, job.workspace_id) as cursor,
    ):
        return run_audit(cursor, bootstrap.git_store_dir, job.workspace_id).as_row()


def full_rebuild(bootstrap: Bootstrap, job: queue.ClaimedJob) -> dict[str, Any]:
    """The whole map derived again beside the live one and flipped, **in one
    transaction**, because the generation it writes and the flip that makes it live are
    one act: a rebuild that died halfway leaves the live generation where it was.
    """
    with (
        queue.connected(bootstrap.database_url) as connection,
        queue.scoped(connection, job.workspace_id) as cursor,
    ):
        return run_rebuild(cursor, bootstrap.git_store_dir, job.workspace_id).as_row()


def index_run(bootstrap: Bootstrap, job: queue.ClaimedJob) -> dict[str, Any]:
    """One binding's landed copies through the seam and into the chunk index.

    The binding is read off the job rather than looked up again: the row names what it
    is about and the claim carries it, under a CHECK that refuses an index job naming
    nothing — so the absence below is a row the database says cannot exist, and a
    handler that invented a binding for it would index the wrong thing rather than say
    so. The reason is on the row for the same reason, and the run behaves differently
    for exactly one of its five words (`pipeline.WIPED_REASON`).

    This handler opens no transaction of its own. Everything Postgres-shaped a run does
    — the binding and its documents read, the findings and the catalogue written, and
    the last statement that re-copies the visibility — happens inside the seam, in
    scoped transactions of its own, because the order those come in is the run's
    business and not the registry's.
    """
    if job.subject_id is None or job.reason is None:
        message = (
            "an index job naming no "
            f"{'binding' if job.subject_id is None else 'reason'}: {job.id}"
        )
        raise ValueError(message)
    run = IndexRun(
        workspace_id=job.workspace_id, binding_id=job.subject_id, reason=job.reason
    )
    return index_binding(bootstrap, run).as_row()


#: One handler per kind this worker runs — the loop's whole dispatch, and the array it
#: claims with. The first two are T-006's own obligations; `index` is S1's, and S4's
#: connector kinds come after it.
KINDS: dict[str, Handler] = {
    "nightly-audit": nightly_audit,
    "full-rebuild": full_rebuild,
    "index": index_run,
}
