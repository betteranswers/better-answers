"""The kinds this worker runs, and a handler for each — the loop's dispatch as a table.

The work loop is the **host**: it claims a job, keeps its lease alive on a connection of
its own, and finishes or fails it with an outcome. What it does not know is what any one
kind of job *means*. That is here, one record per kind, so the dispatch is a lookup
rather than a chain of `if`s — and a kind lands by adding a record to this table, with
the host left exactly as it was.

**The kinds this table holds are the kinds the loop claims.** `claim_job` takes the
array (`queue.claim`), and it filters both arms of the claim by it, so a job whose
handler has not landed is neither claimed nor poisoned by this worker: it stays queued
for the process that can run it. `index` is that kind today.

**A handler opens the stores and the transaction it needs.** It is given the bootstrap
and the job this worker holds, and nothing else — not the host's connection, because
what a kind reaches for is the kind's own business. The two kinds here each want one
scoped transaction over Postgres and the bundle at the workspace's head; S1's index run
wants a pool the host has never heard of. So each opens Postgres from the bootstrap's
url and closes it when the run ends, and the host's one connection stays free for the
claim, the finish and the fail it is there for.
"""

from collections.abc import Callable
from typing import Any

from . import queue
from .audit import run_audit
from .config import Bootstrap
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


#: One handler per kind this worker runs — the loop's whole dispatch, and the array it
#: claims with. The two here are T-006's own obligations; S1's `index` joins them with
#: the pipeline that runs it, and S4's connector kinds after that.
KINDS: dict[str, Handler] = {
    "nightly-audit": nightly_audit,
    "full-rebuild": full_rebuild,
}
