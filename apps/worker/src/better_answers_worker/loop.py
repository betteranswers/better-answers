import argparse
import time
from typing import Any

import psycopg

from . import queue
from .config import Bootstrap, read_bootstrap
from .contract_stamp import CONTRACT_DIGEST
from .ids import ulid
from .kinds import KINDS
from .log import logger
from .schema_view import MIGRATION_ID, MIGRATION_WHEN

IDLE_SLEEP_SECONDS = 5


AUDIT_EVERY_SECONDS = 24 * 60 * 60

MATCHES = "matches"
DIFFERS = "differs"


def schema_stamp_matches(connection: psycopg.Connection) -> bool:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT created_at FROM drizzle.__drizzle_migrations"
            " ORDER BY created_at DESC LIMIT 1"
        )
        row = cursor.fetchone()
    return row is not None and int(row[0]) == MIGRATION_WHEN


def contract_stamp_matches(connection: psycopg.Connection) -> bool:
    with connection.cursor() as cursor:
        cursor.execute("SELECT digest FROM contract_stamp")
        row = cursor.fetchone()
    return row is not None and str(row[0]) == CONTRACT_DIGEST


# One line must tell an operator which of the two disagreed, so the words are the log's.
def deploy_stamps(connection: psycopg.Connection) -> dict[str, str]:
    return {
        "schema_stamp": MATCHES if schema_stamp_matches(connection) else DIFFERS,
        "contract_stamp": MATCHES if contract_stamp_matches(connection) else DIFFERS,
    }


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


def run(bootstrap: Bootstrap, *, once: bool) -> int:
    # In autocommit: the bare stamp reads and workspace list below would, on a plain
    # connection, open a transaction turning every scoped block into a savepoint.
    with queue.connected(bootstrap.database_url) as connection:
        said: dict[str, str] | None = None
        while True:
            stamps = deploy_stamps(connection)
            if DIFFERS in stamps.values():
                # Once rather than once a tick; again only when the disagreement moves.
                if stamps != said:
                    logger.error(
                        "a deploy stamp does not match; claiming nothing",
                        migration_id=MIGRATION_ID,
                        contract_digest=CONTRACT_DIGEST,
                        worker_id=bootstrap.worker_id,
                        **stamps,
                    )
                    said = stamps
                if once:
                    return 1
                # Re-checked rather than exited, so the refusal lifts by itself when the
                # rest of the deploy lands.
                time.sleep(IDLE_SLEEP_SECONDS)
                continue
            said = None
            worked = tick(connection, bootstrap)
            if once:
                return 0
            if not worked:
                time.sleep(IDLE_SLEEP_SECONDS)


def main() -> int:
    parser = argparse.ArgumentParser(prog="better-answers-worker")
    parser.add_argument(
        "--once",
        action="store_true",
        help="one pass over every workspace, then exit — what a test drives",
    )

    return run(read_bootstrap(), once=parser.parse_args().once)
