import argparse
import time
from typing import Any

import psycopg

from . import queue
from .config import Bootstrap, read_bootstrap
from .ids import ulid
from .kinds import KINDS
from .log import logger
from .schema_view import MIGRATION_ID, MIGRATION_WHEN

IDLE_SLEEP_SECONDS = 5


AUDIT_EVERY_SECONDS = 24 * 60 * 60


def schema_stamp_matches(connection: psycopg.Connection) -> bool:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT created_at FROM drizzle.__drizzle_migrations"
            " ORDER BY created_at DESC LIMIT 1"
        )
        row = cursor.fetchone()
    return row is not None and int(row[0]) == MIGRATION_WHEN


def _due_for_audit(cursor: psycopg.Cursor) -> bool:
    cursor.execute(
        "SELECT max(finished_at)"
        " FILTER (WHERE status IN ('done', 'failed', 'poisoned')),"
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
    bootstrap: Bootstrap,
    job: queue.ClaimedJob,
    heartbeat_every_seconds: float,
) -> dict[str, Any]:
    with queue.keeping_alive(
        bootstrap.database_url,
        job,
        bootstrap.worker_id,
        every_seconds=heartbeat_every_seconds,
    ):
        return KINDS[job.kind](bootstrap, job)


def _serve_workspace(
    connection: psycopg.Connection,
    bootstrap: Bootstrap,
    workspace_id: str,
    heartbeat_every_seconds: float,
) -> bool:
    with queue.scoped(connection, workspace_id) as cursor:
        claimed = queue.claim(cursor, workspace_id, bootstrap.worker_id, list(KINDS))
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
        outcome = _run_claimed(bootstrap, claimed, heartbeat_every_seconds)
    except Exception as failure:
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
    worked = False
    for workspace_id in queue.workspace_ids(connection):
        served = _serve_workspace(
            connection, bootstrap, workspace_id, heartbeat_every_seconds
        )
        worked = served or worked
    return worked


def main() -> int:
    parser = argparse.ArgumentParser(prog="better-answers-worker")
    parser.add_argument(
        "--once",
        action="store_true",
        help="one pass over every workspace, then exit — what a test drives",
    )
    once = parser.parse_args().once

    bootstrap = read_bootstrap()

    # Bare statements before the first scoped block: on a plain connection the first
    # would open a transaction that turns every later block into a savepoint.
    with queue.connected(bootstrap.database_url) as connection:
        stamped = False
        while True:
            if not schema_stamp_matches(connection):
                if not stamped:
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
