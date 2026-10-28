import argparse
import signal
import sys
import threading
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from types import FrameType
from typing import Any

import psycopg

from . import queue
from .config import Bootstrap, read_bootstrap
from .contract_stamp import CONTRACT_DIGEST
from .ids import ulid
from .kinds import KINDS
from .log import logger
from .pipeline import DocumentFailedError
from .schema_view import MIGRATION_ID, MIGRATION_WHEN

IDLE_SLEEP_SECONDS = 5

FINISH_WITHIN_SECONDS = 10


AUDIT_EVERY_SECONDS = 24 * 60 * 60

MATCHES = "matches"
DIFFERS = "differs"


# psycopg cancels an interrupted query only on SystemExit or KeyboardInterrupt.
class StopRequested(SystemExit): ...


class _Stop:
    def __init__(self) -> None:
        self.requested = threading.Event()
        self._job_running = False
        self._finish_within_seconds: float = FINISH_WITHIN_SECONDS

    def install(self, finish_within_seconds: float) -> None:
        self._finish_within_seconds = finish_within_seconds
        for stop_signal in (signal.SIGTERM, signal.SIGINT):
            signal.signal(stop_signal, self._request)
        signal.signal(signal.SIGALRM, self._interrupt)

    def _request(self, _signal: int, _frame: FrameType | None) -> None:
        if not self.requested.is_set():
            self.requested.set()
            signal.setitimer(signal.ITIMER_REAL, self._finish_within_seconds)

    def _interrupt(self, _signal: int, _frame: FrameType | None) -> None:
        if self._job_running:
            raise StopRequested

    @contextmanager
    def interruptible(self) -> Iterator[None]:
        self._job_running = True
        try:
            yield
        finally:
            self._job_running = False


STOP = _Stop()


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
    deadline_seconds: float,
) -> dict[str, Any]:
    with (
        queue.keeping_alive(
            bootstrap.database_url,
            job,
            bootstrap.worker_id,
            every_seconds=heartbeat_every_seconds,
            deadline_seconds=deadline_seconds,
        ),
        STOP.interruptible(),
    ):
        return KINDS[job.kind](bootstrap, job)


def _serve_workspace(
    connection: psycopg.Connection,
    bootstrap: Bootstrap,
    workspace_id: str,
    heartbeat_every_seconds: float,
    deadline_seconds: float,
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
        outcome = _run_claimed(
            bootstrap, claimed, heartbeat_every_seconds, deadline_seconds
        )
    except StopRequested:
        with queue.scoped(connection, claimed.workspace_id) as cursor:
            handed_back = queue.hand_back(cursor, claimed.id, bootstrap.worker_id)
        logger.info(
            "job handed back",
            workspace_id=claimed.workspace_id,
            job_id=claimed.id,
            kind=claimed.kind,
            handed_back=handed_back,
            worker_id=bootstrap.worker_id,
        )
        return True
    except Exception as failure:
        document_id = (
            failure.source_document_id
            if isinstance(failure, DocumentFailedError)
            else None
        )
        with queue.scoped(connection, claimed.workspace_id) as cursor:
            queue.fail(
                cursor,
                claimed.id,
                bootstrap.worker_id,
                {
                    "error": type(failure).__name__,
                    **({"source_document_id": document_id} if document_id else {}),
                },
            )
        logger.error(
            "job failed",
            workspace_id=claimed.workspace_id,
            job_id=claimed.id,
            kind=claimed.kind,
            error=type(failure).__name__,
            **({"source_document_id": document_id} if document_id else {}),
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
    deadline_seconds: float = queue.JOB_DEADLINE_SECONDS,
) -> bool:
    worked = False
    for workspace_id in queue.workspace_ids(connection):
        if STOP.requested.is_set():
            break
        served = _serve_workspace(
            connection,
            bootstrap,
            workspace_id,
            heartbeat_every_seconds,
            deadline_seconds,
        )
        worked = served or worked
    return worked


def warm_the_detectors_stack(worker_id: str) -> None:
    from .redaction import detector
    from .redaction.pins import VERSION_STRING

    logger.info(
        "the detector's stack is loaded",
        worker_id=worker_id,
        redaction_version=VERSION_STRING,
        rules=len(detector.RECOGNISERS),
    )


def run(bootstrap: Bootstrap, *, once: bool) -> int:
    if not once:
        warm_the_detectors_stack(bootstrap.worker_id)
    with queue.connected(bootstrap.database_url) as connection:
        said: dict[str, str] | None = None
        while not STOP.requested.is_set():
            stamps = deploy_stamps(connection)
            if DIFFERS in stamps.values():
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
                STOP.requested.wait(IDLE_SLEEP_SECONDS)
                continue
            said = None
            worked = tick(connection, bootstrap)
            if once:
                return 0
            if not worked:
                STOP.requested.wait(IDLE_SLEEP_SECONDS)
    logger.info("the worker stopped", worker_id=bootstrap.worker_id)
    return 0


def run_ticks(bootstrap: Bootstrap, ticks: Iterable[str]) -> int:
    with queue.connected(bootstrap.database_url) as connection:
        for _ in ticks:
            stamps = deploy_stamps(connection)
            worked = DIFFERS not in stamps.values() and tick(connection, bootstrap)
            logger.info(
                "tick done", worked=worked, worker_id=bootstrap.worker_id, **stamps
            )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="better-answers-worker")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--once",
        action="store_true",
        help="one pass over every workspace, then exit — what a test drives",
    )
    mode.add_argument(
        "--ticks",
        action="store_true",
        help="one pass per line on standard input, each answered with a done line,"
        " then exit at its end (what a test file drives)",
    )
    arguments = parser.parse_args()

    if arguments.ticks:
        return run_ticks(read_bootstrap(), sys.stdin)
    return serve(once=arguments.once)


def serve(
    *, once: bool = False, finish_within_seconds: float = FINISH_WITHIN_SECONDS
) -> int:
    STOP.install(finish_within_seconds)
    return run(read_bootstrap(), once=once)
