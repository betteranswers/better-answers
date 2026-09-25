import sys

import psycopg

from .config import read_bootstrap
from .queue import HEARTBEAT_SECONDS, LEASE_SECONDS, connected, scoped, workspace_ids

STALE_HEARTBEAT_SECONDS = HEARTBEAT_SECONDS * 2


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
    """Healthy while this worker holds a claimed job with a fresh
    heartbeat, or while no claimable job has waited longer than a lease."""
    stale = f"{STALE_HEARTBEAT_SECONDS} seconds"
    lease = f"{LEASE_SECONDS} seconds"
    waiting = 0
    # Per workspace, because `job` is under row-level security: one unscoped query over
    # the table sees no rows at all and would answer healthy for ever.
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
