"""The work loop: what this image runs.

One worker, every workspace in turn, one job at a time. On each tick, for each
workspace: claim, run, heartbeat while running, finish or fail with an outcome. Its two
job kinds are T-006's own obligations — the nightly parser audit and the full rebuild —
and B7 adds kinds to this loop rather than building one.

**The schema stamp comes before everything.** The worker never migrates and holds a
generated, committed view of the app's schema; if the migration that view was generated
from is not the migration the database was last stamped with, the deploy order has
slipped and every read this loop is about to make is against a shape that has moved. It
logs once and claims nothing — it does not exit. A worker that exited would be restarted
by the deploy unit into the same mismatch, and a restart storm reads as an outage rather
than as the ordinary few seconds between `migrate` and `worker` on a release.

**The nightly audit schedules itself.** There is no scheduler here and no cron in the
image: when a workspace has nothing to claim, the loop asks when its last
`nightly-audit` finished, and enqueues one if that was more than a day ago or never. So
the audit is a property of the loop running at all, and a worker that is up is a
workspace that is checked.

One structlog line per claim and one per outcome, and neither carries content, an
address or a name — an outcome is counts and paths.
"""

import argparse
import time
from typing import Any

import psycopg

from . import queue
from .audit import run_audit
from .config import Bootstrap, read_bootstrap
from .ids import ulid
from .log import logger
from .rebuild import run_rebuild
from .schema_view import MIGRATION_ID, MIGRATION_WHEN

#: How long the loop sleeps when it has claimed nothing anywhere. Short enough that an
#: enqueued rebuild starts while somebody is still looking at the screen that asked for
#: it.
IDLE_SLEEP_SECONDS = 5

#: How often a workspace's nightly audit comes round.
AUDIT_EVERY_SECONDS = 24 * 60 * 60


def schema_stamp_matches(connection: psycopg.Connection) -> bool:
    """Whether the schema this worker was built against is the schema in front of it.

    The stamp table holds a hash and an instant, never the migration's tag, so the
    journal instant the schema view was generated with (`MIGRATION_WHEN`) is what there
    is to compare — and the generator emits it beside `MIGRATION_ID` for exactly this.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT created_at FROM drizzle.__drizzle_migrations"
            " ORDER BY created_at DESC LIMIT 1"
        )
        row = cursor.fetchone()
    return row is not None and int(row[0]) == MIGRATION_WHEN


def _due_for_audit(cursor: psycopg.Cursor) -> bool:
    """Whether this workspace's nightly audit is due — more than a day since the last
    one finished, or never run at all. A job already waiting is not a second one to
    enqueue.
    """
    cursor.execute(
        "SELECT max(finished_at) FILTER (WHERE status = 'done'),"
        " count(*) FILTER (WHERE status IN ('queued', 'claimed'))"
        " FROM job WHERE kind = 'nightly-audit'"
    )
    row = cursor.fetchone()
    if row is None:
        return True
    last_done, in_flight = row[0], int(row[1])
    if in_flight > 0:
        return False
    if last_done is None:
        return True
    cursor.execute("SELECT now() - %s > %s::interval", (last_done, "24 hours"))
    due = cursor.fetchone()
    return bool(due and due[0])


def _run_claimed(
    connection: psycopg.Connection,
    bootstrap: Bootstrap,
    job: queue.ClaimedJob,
    heartbeat_every_seconds: float,
) -> dict[str, Any]:
    """Do the work the job names, in one transaction, a heartbeat running beside it.

    **One transaction, because a rebuild's whole point is that it lands or does not**:
    the generation it writes and the flip that makes it live are one act. The heartbeat
    therefore cannot share that transaction — nothing it wrote there would be readable
    by another worker until the job committed — so it runs on a connection of its own
    (`queue.keeping_alive`), which is what makes a lease survive a long rebuild.
    """
    with (
        queue.keeping_alive(
            bootstrap.database_url,
            job,
            bootstrap.worker_id,
            every_seconds=heartbeat_every_seconds,
        ),
        queue.scoped(connection, job.workspace_id) as cursor,
    ):
        if job.kind == "nightly-audit":
            return run_audit(cursor, bootstrap.git_store_dir, job.workspace_id).as_row()
        return run_rebuild(cursor, bootstrap.git_store_dir, job.workspace_id).as_row()


def _serve_workspace(
    connection: psycopg.Connection,
    bootstrap: Bootstrap,
    workspace_id: str,
    heartbeat_every_seconds: float,
) -> bool:
    """One workspace's turn: claim and run one job, or schedule the audit that is due.

    Answers whether it did any work, which is what tells the loop whether to sleep.
    """
    with queue.scoped(connection, workspace_id) as cursor:
        claimed = queue.claim(cursor, workspace_id, bootstrap.worker_id)
        if claimed is None:
            if _due_for_audit(cursor):
                queue.enqueue(cursor, ulid(), "nightly-audit")
                logger.info(
                    "nightly audit enqueued",
                    workspace_id=workspace_id,
                    worker_id=bootstrap.worker_id,
                )
            return False
    logger.info(
        "job claimed",
        workspace_id=claimed.workspace_id,
        job_id=claimed.id,
        kind=claimed.kind,
        reason=claimed.reason,
        attempts=claimed.attempts,
        worker_id=bootstrap.worker_id,
    )

    try:
        outcome = _run_claimed(connection, bootstrap, claimed, heartbeat_every_seconds)
    except Exception as failure:
        # One job's failure is that job's fact and never a reason to leave the other
        # workspaces behind. The message is the exception's type and its text, which is
        # ours and the driver's — never a row, a file or a concept's content.
        with queue.scoped(connection, claimed.workspace_id) as cursor:
            queue.fail(
                cursor,
                claimed.id,
                bootstrap.worker_id,
                {"error": type(failure).__name__},
            )
        logger.error(
            "job failed",
            workspace_id=claimed.workspace_id,
            job_id=claimed.id,
            kind=claimed.kind,
            error=type(failure).__name__,
            worker_id=bootstrap.worker_id,
        )
        return True

    with queue.scoped(connection, claimed.workspace_id) as cursor:
        recorded = queue.finish(cursor, claimed.id, bootstrap.worker_id, outcome)
    logger.info(
        "job finished",
        workspace_id=claimed.workspace_id,
        job_id=claimed.id,
        kind=claimed.kind,
        recorded=recorded,
        worker_id=bootstrap.worker_id,
        **outcome_counts(outcome),
    )
    return True


def outcome_counts(outcome: dict[str, Any]) -> dict[str, int]:
    """An outcome as a log line carries it: how many of each thing, never which.

    The row keeps the paths, because an operator putting a mismatch right needs to know
    which file; the log line keeps the counts, because a log is shipped and a bundle
    path is a company's own words for its own knowledge.
    """
    return {
        key: len(value) if isinstance(value, list) else value
        for key, value in outcome.items()
        if isinstance(value, list | int)
    }


def tick(
    connection: psycopg.Connection,
    bootstrap: Bootstrap,
    *,
    heartbeat_every_seconds: float = queue.HEARTBEAT_SECONDS,
) -> bool:
    """One pass over every workspace. Answers whether any work was done.

    The heartbeat's interval is an argument so a test can drive a job that outlives it
    through this pass — the image's own cadence never has a job run twenty seconds in a
    suite, and a heartbeat nobody has seen beat is a heartbeat nobody has proved.
    """
    worked = False
    for workspace_id in queue.workspace_ids(connection):
        served = _serve_workspace(
            connection, bootstrap, workspace_id, heartbeat_every_seconds
        )
        worked = served or worked
    return worked


def main() -> int:
    """`better-answers-worker` — the image's command, and the loop itself."""
    parser = argparse.ArgumentParser(prog="better-answers-worker")
    parser.add_argument(
        "--once",
        action="store_true",
        help="one pass over every workspace, then exit — what a test drives",
    )
    once = parser.parse_args().once

    bootstrap = read_bootstrap()
    # In autocommit (`queue.connected`): the stamp read and the workspace list below are
    # bare statements, and on a plain connection the first of them would have opened a
    # transaction that turned every scoped block of every tick into a savepoint.
    with queue.connected(bootstrap.database_url) as connection:
        stamped = False
        while True:
            if not schema_stamp_matches(connection):
                if not stamped:
                    # Once, not once a tick: a mismatch lasts as long as a deploy takes,
                    # and a line a second would bury the release it is about.
                    logger.error(
                        "schema stamp does not match; claiming nothing",
                        migration_id=MIGRATION_ID,
                        worker_id=bootstrap.worker_id,
                    )
                    stamped = True
                if once:
                    return 1
                time.sleep(IDLE_SLEEP_SECONDS)
                continue
            stamped = False
            worked = tick(connection, bootstrap)
            if once:
                return 0
            if not worked:
                time.sleep(IDLE_SLEEP_SECONDS)
