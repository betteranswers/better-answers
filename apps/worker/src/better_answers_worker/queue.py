import json
import threading
import time
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, NewType

import psycopg

from .log import logger

LEASE_SECONDS = 60


HEARTBEAT_SECONDS = 20


HEARTBEAT_CONNECT_SECONDS = 5
HEARTBEAT_STATEMENT_SECONDS = 5
JOB_DEADLINE_SECONDS = 36 * 60 * 60
IDLE_IN_TRANSACTION_SECONDS = 60 * 60


@dataclass(frozen=True, slots=True)
class ClaimedJob:
    workspace_id: str
    id: str
    kind: str
    reason: str | None

    subject_id: str | None
    attempts: int


class ClaimLostError(RuntimeError): ...


ScopedCursor = NewType("ScopedCursor", psycopg.Cursor)


@contextmanager
def scoped(connection: psycopg.Connection, workspace_id: str) -> Iterator[ScopedCursor]:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            "SELECT set_config('app.workspace_id', %s, true)", (workspace_id,)
        )
        yield ScopedCursor(cursor)


def connected(
    database_url: str,
    *,
    idle_in_transaction_seconds: float = IDLE_IN_TRANSACTION_SECONDS,
) -> psycopg.Connection:
    connection = psycopg.connect(database_url, autocommit=True)
    connection.execute(
        "SELECT set_config('idle_in_transaction_session_timeout', %s, false)",
        (f"{round(idle_in_transaction_seconds * 1000)}ms",),
    )
    return connection


def workspace_ids(connection: psycopg.Connection) -> list[str]:
    with connection.cursor() as cursor:
        cursor.execute("SELECT id FROM workspace ORDER BY id")
        return [str(row[0]) for row in cursor.fetchall()]


def claim(
    cursor: ScopedCursor, workspace_id: str, worker_id: str, kinds: Sequence[str]
) -> ClaimedJob | None:
    cursor.execute(
        "SELECT id, kind, reason, subject_id, attempts"
        " FROM claim_job(%s, %s::interval, %s)",
        (worker_id, f"{LEASE_SECONDS} seconds", list(kinds)),
    )
    row = cursor.fetchone()
    if row is None:
        return None
    return ClaimedJob(
        workspace_id=workspace_id,
        id=str(row[0]),
        kind=str(row[1]),
        reason=None if row[2] is None else str(row[2]),
        subject_id=None if row[3] is None else str(row[3]),
        attempts=int(row[4]),
    )


def hold_the_claim(cursor: ScopedCursor, job_id: str, worker_id: str) -> None:
    cursor.execute(
        "SELECT 1 FROM job WHERE id = %s AND claimed_by = %s AND status = 'claimed'"
        " AND lease_expires_at > clock_timestamp() FOR KEY SHARE",
        (job_id, worker_id),
    )
    if cursor.fetchone() is None:
        raise ClaimLostError(job_id)


def heartbeat(
    cursor: ScopedCursor,
    job_id: str,
    worker_id: str,
    *,
    lease_seconds: float = LEASE_SECONDS,
) -> bool:
    cursor.execute(
        "SELECT heartbeat_job(%s, %s, %s::interval)",
        (job_id, worker_id, f"{round(lease_seconds * 1000)} milliseconds"),
    )
    row = cursor.fetchone()
    return bool(row and row[0])


def _the_claim_ended(
    job: ClaimedJob, worker_id: str, ends_at: float, deadline_seconds: float
) -> None:
    if time.monotonic() < ends_at:
        logger.warning("the claim was lost", job_id=job.id, worker_id=worker_id)
        return
    logger.error(
        "the job outlived its deadline",
        job_id=job.id,
        worker_id=worker_id,
        deadline_seconds=deadline_seconds,
    )


@contextmanager
def keeping_alive(
    database_url: str,
    job: ClaimedJob,
    worker_id: str,
    every_seconds: float = HEARTBEAT_SECONDS,
    *,
    deadline_seconds: float = JOB_DEADLINE_SECONDS,
    statement_seconds: float = HEARTBEAT_STATEMENT_SECONDS,
) -> Iterator[None]:
    stop = threading.Event()
    ends_at = time.monotonic() + deadline_seconds
    statement_timeout = f"-c statement_timeout={round(statement_seconds * 1000)}ms"

    def beat() -> None:
        connection: psycopg.Connection | None = None
        try:
            while not stop.wait(
                min(every_seconds, max(ends_at - time.monotonic(), 0.0))
            ):
                remaining = ends_at - time.monotonic()
                if remaining <= 0:
                    _the_claim_ended(job, worker_id, ends_at, deadline_seconds)
                    return
                try:
                    connection = connection or psycopg.connect(
                        database_url,
                        connect_timeout=HEARTBEAT_CONNECT_SECONDS,
                        options=statement_timeout,
                    )
                    with scoped(connection, job.workspace_id) as cursor:
                        held = heartbeat(
                            cursor,
                            job.id,
                            worker_id,
                            lease_seconds=min(LEASE_SECONDS, remaining),
                        )
                except psycopg.Error as failure:
                    logger.warning(
                        "a heartbeat failed",
                        job_id=job.id,
                        worker_id=worker_id,
                        error=type(failure).__name__,
                    )
                    if connection is not None:
                        connection.close()
                    connection = None
                    continue
                if not held:
                    _the_claim_ended(job, worker_id, ends_at, deadline_seconds)
                    return
        finally:
            if connection is not None:
                connection.close()

    thread = threading.Thread(target=beat, name="heartbeat", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=HEARTBEAT_CONNECT_SECONDS + 2 * statement_seconds)


def finish(
    cursor: ScopedCursor, job_id: str, worker_id: str, outcome: Mapping[str, Any]
) -> bool:
    cursor.execute(
        "SELECT finish_job(%s, %s, %s::jsonb)", (job_id, worker_id, json.dumps(outcome))
    )
    row = cursor.fetchone()
    return bool(row and row[0])


def fail(
    cursor: ScopedCursor, job_id: str, worker_id: str, outcome: Mapping[str, Any]
) -> bool:
    cursor.execute(
        "SELECT fail_job(%s, %s, %s::jsonb)", (job_id, worker_id, json.dumps(outcome))
    )
    row = cursor.fetchone()
    return bool(row and row[0])


def enqueue(
    cursor: ScopedCursor, job_id: str, kind: str, reason: str | None = None
) -> None:
    cursor.execute(
        "INSERT INTO job (workspace_id, id, kind, reason)"
        " VALUES ((SELECT current_workspace_id()), %s, %s, %s)",
        (job_id, kind, reason),
    )
