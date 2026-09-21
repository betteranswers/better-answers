import json
import threading
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import psycopg

from .log import logger

LEASE_SECONDS = 60


HEARTBEAT_SECONDS = 20


@dataclass(frozen=True, slots=True)
class ClaimedJob:
    workspace_id: str
    id: str
    kind: str
    reason: str | None

    subject_id: str | None
    attempts: int


@contextmanager
def scoped(
    connection: psycopg.Connection, workspace_id: str
) -> Iterator[psycopg.Cursor]:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            "SELECT set_config('app.workspace_id', %s, true)", (workspace_id,)
        )
        yield cursor


def connected(database_url: str) -> psycopg.Connection:
    # Autocommit, or psycopg opens a transaction on the first statement and every
    # `scoped` block becomes a savepoint inside one nothing commits.
    return psycopg.connect(database_url, autocommit=True)


def workspace_ids(connection: psycopg.Connection) -> list[str]:
    with connection.cursor() as cursor:
        cursor.execute("SELECT id FROM workspace ORDER BY id")
        return [str(row[0]) for row in cursor.fetchall()]


def claim(
    cursor: psycopg.Cursor, workspace_id: str, worker_id: str, kinds: Sequence[str]
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


def heartbeat(cursor: psycopg.Cursor, job_id: str, worker_id: str) -> bool:
    cursor.execute(
        "SELECT heartbeat_job(%s, %s, %s::interval)",
        (job_id, worker_id, f"{LEASE_SECONDS} seconds"),
    )
    row = cursor.fetchone()
    return bool(row and row[0])


@contextmanager
def keeping_alive(
    database_url: str,
    job: ClaimedJob,
    worker_id: str,
    every_seconds: float = HEARTBEAT_SECONDS,
) -> Iterator[None]:
    stop = threading.Event()

    def beat() -> None:
        try:
            with psycopg.connect(database_url) as connection:
                while not stop.wait(every_seconds):
                    with scoped(connection, job.workspace_id) as cursor:
                        if not heartbeat(cursor, job.id, worker_id):
                            return
        except psycopg.Error:
            logger.warning("the heartbeat stopped", job_id=job.id, worker_id=worker_id)

    thread = threading.Thread(target=beat, name="heartbeat", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=every_seconds)


def finish(
    cursor: psycopg.Cursor, job_id: str, worker_id: str, outcome: Mapping[str, Any]
) -> bool:
    cursor.execute(
        "SELECT finish_job(%s, %s, %s::jsonb)", (job_id, worker_id, json.dumps(outcome))
    )
    row = cursor.fetchone()
    return bool(row and row[0])


def fail(
    cursor: psycopg.Cursor, job_id: str, worker_id: str, outcome: Mapping[str, Any]
) -> bool:
    cursor.execute(
        "SELECT fail_job(%s, %s, %s::jsonb)", (job_id, worker_id, json.dumps(outcome))
    )
    row = cursor.fetchone()
    return bool(row and row[0])


def enqueue(
    cursor: psycopg.Cursor, job_id: str, kind: str, reason: str | None = None
) -> None:
    cursor.execute(
        "INSERT INTO job (workspace_id, id, kind, reason)"
        " VALUES ((SELECT current_workspace_id()), %s, %s, %s)",
        (job_id, kind, reason),
    )
