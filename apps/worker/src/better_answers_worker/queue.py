"""The claim protocol, as this tier calls it.

The app↔worker control plane is rows and never HTTP (ADR 0005), so this module is the
whole of what "talking to the app" means here: claim a job, keep its lease alive, say
what it found. Every one of the four calls is a SQL function the app migrated
(`0022_the-queue-substrate.sql`), and every one is SECURITY INVOKER — so what fences a
call is this connection's role and the workspace the transaction is scoped to, and there
is no workspace argument anywhere for a caller to get wrong.

**Every statement runs inside a transaction scoped to one workspace.** `scoped` is the
one place that sets `app.workspace_id`, transaction-local, so the scope cannot outlive
the work or reach a pooled connection's next caller — the same shape the app's Postgres
door takes.

The workspaces themselves are read unscoped from `workspace`, which is the identity
set's last member and carries no policy (ADR 0009): the list of tenants is nobody's
tenant data, and iterating it is how one worker serves every workspace on a 4 GB box.
"""

import json
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import psycopg

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


def workspace_ids(connection: psycopg.Connection) -> list[str]:
    """Every workspace the platform holds, oldest id first — the loop's own round."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT id FROM workspace ORDER BY id")
        return [str(row[0]) for row in cursor.fetchall()]


def claim(
    cursor: psycopg.Cursor, workspace_id: str, worker_id: str
) -> ClaimedJob | None:
    """The oldest claimable job in this scope, or nothing.

    A job whose attempts are spent is poisoned by this very call rather than handed out
    again; that is the database's rule, not this module's, so there is nothing to
    remember here.
    """
    cursor.execute(
        "SELECT id, kind, reason, attempts FROM claim_job(%s, %s::interval)",
        (worker_id, f"{LEASE_SECONDS} seconds"),
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
    """Push this worker's lease out. `False` means the lease is somebody else's now."""
    cursor.execute(
        "SELECT heartbeat_job(%s, %s, %s::interval)",
        (job_id, worker_id, f"{LEASE_SECONDS} seconds"),
    )
    row = cursor.fetchone()
    return bool(row and row[0])


def finish(
    cursor: psycopg.Cursor, job_id: str, worker_id: str, outcome: Mapping[str, Any]
) -> bool:
    """Record what the job found and end it. `False`: the lease had already lapsed."""
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
