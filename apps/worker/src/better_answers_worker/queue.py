"""The claim protocol, as this tier calls it.

The app↔worker control plane is rows and never HTTP (ADR 0005), so this module is the
whole of what "talking to the app" means here: claim a job, keep its lease alive, say
what it found. Every one of the four calls is a SQL function the app migrated
(`0022_the-queue-substrate.sql`, the claim replaced by
`0033_the-job-subject-and-the-run-key-substrate.sql`), and every one is SECURITY INVOKER
— so what fences a call is this connection's role and the workspace the transaction is
scoped to, and there is no workspace argument anywhere for a caller to get wrong.

**Every statement runs inside a transaction scoped to one workspace.** `scoped` is the
one place that sets `app.workspace_id`, transaction-local, so the scope cannot outlive
the work or reach a pooled connection's next caller — the same shape the app's Postgres
door takes.

The workspaces themselves are read unscoped from `workspace`, which is the identity
set's last member and carries no policy (ADR 0009): the list of tenants is nobody's
tenant data, and iterating it is how one worker serves every workspace on a 4 GB box.
"""

import json
import threading
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import psycopg

from .log import logger

#: How long a claim holds its job before another worker may take it. Long enough that a
#: heartbeat can be missed once without losing the run, short enough that a worker
#: killed mid-job hands the work back within a minute rather than within a shift.
LEASE_SECONDS = 60

#: How often the claimant says it is alive. A third of the lease, so two heartbeats have
#: to be missed in a row before the lease lapses — a tick of ordinary jitter loses
#: nothing.
HEARTBEAT_SECONDS = 20


@dataclass(frozen=True, slots=True)
class ClaimedJob:
    """A job this worker holds, and everything running it needs to know."""

    workspace_id: str
    id: str
    kind: str
    reason: str | None
    attempts: int


@contextmanager
def scoped(
    connection: psycopg.Connection, workspace_id: str
) -> Iterator[psycopg.Cursor]:
    """One transaction scoped to one workspace, committed on the way out.

    Transaction-local (`set_config(..., true)`), so the scope ends with the transaction:
    a scope that outlived one would be the next statement on this connection reading a
    workspace nobody asked about.
    """
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            "SELECT set_config('app.workspace_id', %s, true)", (workspace_id,)
        )
        yield cursor


def connected(database_url: str) -> psycopg.Connection:
    """A connection for this tier's processes, **in autocommit** — so each `scoped`
    block is a transaction of its own, begun and committed where the block says, and a
    bare statement outside one commits on its own.

    psycopg opens a transaction on the first statement of a connection that is not in
    autocommit, and every `transaction()` block entered after that is a savepoint inside
    it, released and never committed. The loop reads the schema stamp and the workspace
    list before its first scoped block, so on a plain connection it claimed, ran and
    finished every job inside one transaction nobody committed until the process exited:
    no other connection saw a claim, a finish or a self-scheduled audit while the worker
    lived — a `--wait` polling from the app would never have seen the row move; the
    heartbeat, on its connection of its own, found no *claimed* row to refresh and
    stopped after one beat; a crash mid-tick rolled the claim back with the work, so
    `attempts` never rose and poison never fired; and `now()` stamped `claimed_at` and
    `finished_at` with one frozen instant. `--once` hid all of it, because leaving the
    connection's block commits. The heartbeat's own connection never met this — `scoped`
    is its first statement — and the healthcheck's only reads, but both open the same
    way so the shape is one.
    """
    return psycopg.connect(database_url, autocommit=True)


def workspace_ids(connection: psycopg.Connection) -> list[str]:
    """Every workspace the platform holds, oldest id first — the loop's own round."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT id FROM workspace ORDER BY id")
        return [str(row[0]) for row in cursor.fetchall()]


def claim(
    cursor: psycopg.Cursor, workspace_id: str, worker_id: str, kinds: Sequence[str]
) -> ClaimedJob | None:
    """The oldest claimable job of a kind this caller runs, in this scope, or nothing.

    A job whose attempts are spent is poisoned by this very call rather than handed out
    again; that is the database's rule, not this module's, so there is nothing to
    remember here.

    `kinds` is what the caller can run, and the database filters both arms of the claim
    by it — so a job of a kind this process has no handler for is neither claimed nor
    poisoned by it, and stays where it is for whoever does. The caller says which kinds
    rather than this module knowing them: what a process can run is the process's fact,
    and a queue helper that answered it would have to be edited every time a handler
    landed.
    """
    cursor.execute(
        "SELECT id, kind, reason, attempts FROM claim_job(%s, %s::interval, %s)",
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
        attempts=int(row[3]),
    )


def heartbeat(cursor: psycopg.Cursor, job_id: str, worker_id: str) -> bool:
    """Push this worker's lease out. `False` means the lease is no longer this worker's:
    somebody else holds the job, or the lease lapsed — which alone revokes the claimant,
    whether or not anybody has claimed since.
    """
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
    """Say this worker is alive, on a connection of its own, while a job runs.

    **A heartbeat needs its own connection, and that is the whole reason this exists.**
    A job runs in one transaction, so its rows land or roll back together — which means
    a heartbeat written on that connection is invisible to every other worker until the
    job commits, and a lease that lapsed halfway through a long rebuild would be handed
    out while the first worker was still building it. A heartbeat that nobody can read
    is not a heartbeat, so this one commits on its own.

    The thread is a daemon and stops with the block, so a job that raises takes its
    heartbeat down with it and the lease lapses in its own time — which is exactly what
    should happen to a run that died.

    It stops early the moment the database says the lease is somebody else's: pushing a
    lease out after losing it would be this worker taking back a job another one is
    already running.
    """
    stop = threading.Event()

    def beat() -> None:
        try:
            with psycopg.connect(database_url) as connection:
                while not stop.wait(every_seconds):
                    with scoped(connection, job.workspace_id) as cursor:
                        if not heartbeat(cursor, job.id, worker_id):
                            return
        except psycopg.Error:
            # The lease lapses on its own and the job is claimed again; there is nothing
            # here worth ending the run for, and the line is what an operator reads.
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
    """Record what the job found and end it. `False`: the lease had already lapsed, and
    the job is the queue's to hand out again — the loop logs the finish as unrecorded.
    """
    cursor.execute(
        "SELECT finish_job(%s, %s, %s::jsonb)", (job_id, worker_id, json.dumps(outcome))
    )
    row = cursor.fetchone()
    return bool(row and row[0])


def fail(
    cursor: psycopg.Cursor, job_id: str, worker_id: str, outcome: Mapping[str, Any]
) -> bool:
    """Record what went wrong and end it. A failure is terminal: the queue retries a
    lost lease, never a run that reported.
    """
    cursor.execute(
        "SELECT fail_job(%s, %s, %s::jsonb)", (job_id, worker_id, json.dumps(outcome))
    )
    row = cursor.fetchone()
    return bool(row and row[0])


def enqueue(
    cursor: psycopg.Cursor, job_id: str, kind: str, reason: str | None = None
) -> None:
    """Put a job on the queue in the scope this transaction already names.

    The worker enqueues one thing and one thing only: its own nightly audit, which is
    self-scheduled (`loop.py`). Everything else on this queue is put there by the app.
    """
    cursor.execute(
        "INSERT INTO job (workspace_id, id, kind, reason)"
        " VALUES ((SELECT current_workspace_id()), %s, %s, %s)",
        (job_id, kind, reason),
    )
