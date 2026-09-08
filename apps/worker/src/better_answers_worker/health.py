"""The healthcheck: `python -m better_answers_worker.health`, exit 0 when healthy.

**A process-level check, and deliberately.** This tier exposes no HTTP surface at all —
no server, no port, no `/health` — because the app↔worker control plane is rows in
Postgres and never HTTP (ADR 0005). So there is nothing to GET, and what can be checked
without inventing a surface is the rows the loop leaves behind.

The spec's line for this is "a query for a claimed lease with a fresh heartbeat", and it
is right about the busy case and silent about the other one. **Most of the time a
healthy worker holds no lease at all**: two job kinds, one of them nightly, is a queue
that is empty far more often than it is not. A check that demanded a live claim would
report a perfectly well worker as unhealthy for twenty-three hours a day, and the deploy
unit would restart it.

So the check is the two halves of what "working" means, and the wrinkle is resolved the
way the queue itself resolves it — by the lease:

- **Busy and healthy**: this worker holds a `claimed` job whose `heartbeat_at` is within
  two heartbeat intervals. One missed heartbeat is jitter; two is a run that has stopped
  saying anything, and its lease is about to lapse anyway.
- **Idle and healthy**: nothing anywhere is claimable and has been waiting for longer
  than one lease interval. An empty queue is a well worker with nothing to do. A job
  left waiting past a lease while nothing heartbeats is not idleness — it is a worker
  that has stopped claiming, which is the failure this check exists to catch and the one
  an HTTP probe could never see.

**One worker in the estate, by decision** (`MAX_CONCURRENT_RUNS=1`, ADR 0024): the idle
half of the check reads the whole queue as this worker's, which is true while this is
the only worker there is. A second replica draining the queue would let a worker whose
loop had stopped read as healthy on the other's work; the day a second replica exists,
the idle half asks for this worker's own liveness rather than the queue's emptiness.

It asks the question **per workspace**, because `job` is a tenant table under RLS: an
unscoped transaction sees no rows at all, so a check written as one query over the whole
table would answer *healthy* by seeing nothing, every time, for ever. The workspaces
themselves are read unscoped from `workspace`, which carries no policy (ADR 0009). That
is one round trip per workspace on a probe that runs every fifteen seconds, which is the
cost of the guarantee and is nothing against a handful of tenants on one box.
"""

import sys

import psycopg

from .config import read_bootstrap
from .queue import HEARTBEAT_SECONDS, LEASE_SECONDS, connected, scoped, workspace_ids

#: How stale a claimant's heartbeat may be before its worker is not answering. Two
#: intervals, so one missed beat is jitter and two is a run that has stopped.
STALE_HEARTBEAT_SECONDS = HEARTBEAT_SECONDS * 2

#: This worker's fresh leases, and the jobs left waiting longer than a lease, in this
#: transaction's workspace. One statement, because the two counts are one question: is
#: this worker working, or is there nothing for it to work on?
_STATE = """
SELECT count(*) FILTER (
         WHERE claimed_by = %s AND status = 'claimed'
           AND heartbeat_at > now() - %s::interval
       ),
       count(*) FILTER (
         WHERE attempts < max_attempts
           AND (status = 'queued'
                OR (status = 'claimed' AND lease_expires_at < now()))
           AND enqueued_at < now() - %s::interval
       )
  FROM job
"""


def is_healthy(connection: psycopg.Connection, worker_id: str) -> bool:
    """Whether this worker is doing its job — holding a fresh lease, or idle with
    nothing left waiting.
    """
    stale = f"{STALE_HEARTBEAT_SECONDS} seconds"
    lease = f"{LEASE_SECONDS} seconds"
    waiting = 0
    for workspace_id in workspace_ids(connection):
        with scoped(connection, workspace_id) as cursor:
            cursor.execute(_STATE, (worker_id, stale, lease))
            row = cursor.fetchone()
        if row is None:
            continue
        if int(row[0]) > 0:
            return True
        waiting += int(row[1])
    return waiting == 0


def main() -> int:
    bootstrap = read_bootstrap()
    with connected(bootstrap.database_url) as connection:
        return 0 if is_healthy(connection, bootstrap.worker_id) else 1


if __name__ == "__main__":
    sys.exit(main())
