from collections.abc import Callable
from typing import Any

from . import queue
from .audit import run_audit
from .config import Bootstrap
from .pipeline import IndexRun, index_binding
from .rebuild import run_rebuild

type Handler = Callable[[Bootstrap, queue.ClaimedJob], dict[str, Any]]


def nightly_audit(bootstrap: Bootstrap, job: queue.ClaimedJob) -> dict[str, Any]:
    with (
        queue.connected(bootstrap.database_url) as connection,
        queue.scoped(connection, job.workspace_id) as cursor,
    ):
        return run_audit(cursor, bootstrap.git_store_dir, job.workspace_id).as_row()


def full_rebuild(bootstrap: Bootstrap, job: queue.ClaimedJob) -> dict[str, Any]:
    with (
        queue.connected(bootstrap.database_url) as connection,
        queue.scoped(connection, job.workspace_id) as cursor,
    ):
        return run_rebuild(cursor, bootstrap.git_store_dir, job.workspace_id).as_row()


def index_run(bootstrap: Bootstrap, job: queue.ClaimedJob) -> dict[str, Any]:
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


KINDS: dict[str, Handler] = {
    "nightly-audit": nightly_audit,
    "full-rebuild": full_rebuild,
    "index": index_run,
}
