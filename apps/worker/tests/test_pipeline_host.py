"""The pipeline's host: one pool per workspace, Environments in a bounded cache
(`[TEST1]`, `[TEST2]`, `[TEST4]`, `[TEST7]`, `[TEST9]`).

Driven through `better_answers_worker.pipeline`'s own interface, against a real Postgres
on the pinned image, because everything these cases are about is what the database does
to a statement the engine ran on a connection the host handed it.

**The role matters more here than anywhere else in this suite.** `index`.`chunk` forces
row-level security, and a superuser bypasses that by design — so a case that proved the
pool's scope as the container's superuser would pass with the scope removed. Every pool
these cases open therefore connects as a login role that is a member of ``worker_rt``
and is nothing else, which is the shape the deploy unit gives the worker: the runtime
role, never the owner.
"""

import asyncio
import os
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import asyncpg
import psycopg
import pytest

from better_answers_worker.config import Bootstrap, Engine, ObjectStore
from better_answers_worker.pipeline import (
    CHUNK_TABLE,
    ENVIRONMENTS_HELD,
    Host,
    IndexRun,
    index_binding,
    open_pool,
)
from factories import seed_workspace
from pg_harness import migrated_postgres_at

#: The login role the cases connect as. `worker_rt` is NOLOGIN — roles are cluster-wide
#: and LOGIN is the estate's provisioning act, never a migration's (migration 0000) — so
#: the case provisions the login half itself and inherits the runtime role's privileges
#: through membership, exactly as `WORKER_DATABASE_URL` does in the compose file.
WORKER_LOGIN = "worker_login_under_test"
WORKER_PASSWORD = "worker-login-under-test"


def chunk_row(
    *,
    workspace_id: str,
    binding_id: str,
    chunk_id: str,
    content: str = "Expenses are claimed within sixty days.",
    ordinal: int = 0,
) -> dict[str, Any]:
    """One chunk row, carrying every column `CHUNK_TABLE` declares.

    The table these cases land into is the shipping one, not a description of it
    written here, because nothing in this suite is about the chunk table's shape. What
    is under test is the pool's scope, the cache's bound and what a drop leaves behind,
    and each of those needs a real row in the real table and nothing more. The row's own
    derivation (`rows.py`'s `chunk_rows`) is held to the `document-chunk` agreement in
    its own suite, so the values here are only what makes a row legal: a fixture, never
    an expected value the cases below read back.
    """
    return {
        "id": chunk_id,
        "workspace_id": workspace_id,
        "content": content,
        "published_at": None,
        "sensitivity": "Internal",
        "audience": "everyone",
        "audience_groups": None,
        "binding_id": binding_id,
        "source_document_id": None,
        "locator": f"doc-{binding_id}/chars:0-{len(content)}",
        "ordinal": ordinal,
        "char_start": 0,
        "char_end": len(content),
    }


@pytest.fixture(name="database")
def a_migrated_database() -> Iterator[tuple[psycopg.Connection, str]]:
    """A migrated throwaway Postgres, and a DSN on it for the worker's runtime role."""
    with migrated_postgres_at() as (connection, conninfo):
        # `CREATE ROLE` takes no parameters, so the two names are spelled into the
        # statement; both are constants of this module and neither comes from a row.
        connection.execute(
            f"CREATE ROLE \"{WORKER_LOGIN}\" LOGIN PASSWORD '{WORKER_PASSWORD}'"
            " IN ROLE worker_rt"
        )
        connection.commit()
        yield connection, as_role(conninfo, WORKER_LOGIN, WORKER_PASSWORD)


def as_role(conninfo: str, role: str, password: str) -> str:
    """The same address, reached as another role.

    Testcontainers hands back a URL carrying the superuser's own credentials, and a pool
    that connected with them would bypass row-level security — which is the one thing
    these cases exist to hold. So the user info is replaced rather than appended: a URL
    with two sets of credentials is not a URL.
    """
    replaced, count = re.subn(r"//[^@/]*@", f"//{role}:{password}@", conninfo, count=1)
    if count != 1:
        message = f"expected credentials in the harness's conninfo, found {count}"
        raise RuntimeError(message)
    return replaced


def seed_partitioned_workspace(connection: psycopg.Connection) -> str:
    """A workspace with its chunk partition, as the app's own provisioning leaves it.

    The partition is the lifecycle function's and the function refuses a transaction
    that is not scoped to the workspace it names, so the scope is set here for the same
    reason the app sets it.
    """
    workspace_id = str(seed_workspace(connection.cursor())["id"])
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT set_config('app.workspace_id', %s, true)", (workspace_id,)
        )
        cursor.execute("SELECT create_workspace_partition(%s)", (workspace_id,))
    connection.commit()
    return workspace_id


def bootstrap_for(dsn: str, lmdb_dir: Path) -> Bootstrap:
    return Bootstrap(
        database_url=dsn,
        git_store_dir=str(lmdb_dir / "git"),
        worker_id="worker-under-test",
        object_store=ObjectStore(
            endpoint="http://objectstore:3900",
            access_key="key-under-test",
            secret_key="secret-under-test",
            bucket="better-answers",
            region="garage",
        ),
        engine=Engine(lmdb_dir=str(lmdb_dir)),
    )


def chunk_ids(connection: psycopg.Connection, workspace_id: str) -> list[str]:
    """Every chunk id the workspace holds, read as the owner so the read itself proves
    nothing about the scope — only the write under test does."""
    with connection.cursor() as cursor:
        cursor.execute(
            'SELECT id FROM "index".chunk WHERE workspace_id = %s ORDER BY id',
            (workspace_id,),
        )
        return [str(row[0]) for row in cursor.fetchall()]


def chunk_indexes(connection: psycopg.Connection, workspace_id: str) -> list[str]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT indexname FROM pg_indexes"
            " WHERE schemaname = 'index' AND tablename = %s ORDER BY indexname",
            (f"chunk_{workspace_id}",),
        )
        return [str(row[0]) for row in cursor.fetchall()]


def test_the_pools_scope_lets_a_chunk_row_land_and_a_pool_without_it_is_refused(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    """The engine's Postgres target takes its own connections out of the pool and runs
    the upsert on them bare, outside any transaction the worker opened — so what carries
    the workspace past `index`.`chunk`'s `WITH CHECK` is a setting on the *session*, and
    a transaction-local one would be gone before the statement ran.

    The pair is held both ways (`[TEST7]`): the host's pool lands the row, and a pool of
    the same size and the same role without the scope is refused by the policy.

    **The served half takes two connections in turn and not one**, because a scope
    applied once when a connection opens is wiped by the reset asyncpg runs when that
    connection goes back to the pool. A run lands many rows over many checkouts, so a
    case that acquired once would pass against a pool whose second row is refused.
    """
    connection, dsn = database
    workspace_id = seed_partitioned_workspace(connection)
    row = chunk_row(
        workspace_id=workspace_id, binding_id="binding-one", chunk_id="chunk-one"
    )
    statement = (
        'INSERT INTO "index".chunk'
        " (id, workspace_id, content, sensitivity, audience, binding_id)"
        " VALUES ($1, $2, $3, $4, $5, $6)"
    )
    values = (
        row["id"],
        row["workspace_id"],
        row["content"],
        row["sensitivity"],
        row["audience"],
        row["binding_id"],
    )

    async def served() -> None:
        pool = await open_pool(dsn, workspace_id, max_size=1)
        try:
            async with pool.acquire() as held:
                await held.execute(statement, *values)
            # Back to the pool and out again — the same connection, reset in between.
            async with pool.acquire() as again:
                await again.execute(statement, *_second(values))
        finally:
            await pool.close()

    async def refused() -> None:
        pool = await asyncpg.create_pool(dsn, min_size=0, max_size=2)
        assert pool is not None
        try:
            async with pool.acquire() as held:
                await held.execute(statement, *values)
        finally:
            await pool.close()

    asyncio.run(served())
    assert chunk_ids(connection, workspace_id) == ["chunk-one", "chunk-two"]

    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        asyncio.run(refused())


def _second(values: tuple[Any, ...]) -> tuple[Any, ...]:
    """The same row under a second id, for the second checkout."""
    return ("chunk-two", *values[1:])


def test_dropping_one_bindings_state_leaves_the_table_its_indexes_and_every_row(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    """Every target the pipeline declares is user-managed, so the engine owns the rows
    it wrote and never the table (ADR 0007, ADR 0036) — and dropping one binding's state
    reverts nothing in Postgres at all, not even the rows that binding's own run landed.

    That is why the wipe is two acts across two tiers: the app deletes the binding's
    chunk rows in its own transaction and the worker removes the binding's directory.
    A drop that had deleted its own rows would make the pairing prudent; this case is
    what says it is necessary.
    """
    connection, dsn = database
    workspace_id = seed_partitioned_workspace(connection)

    with Host(bootstrap_for(dsn, tmp_path)) as host:
        first = IndexRun(
            workspace_id=workspace_id, binding_id="binding-one", reason="bound"
        )
        second = IndexRun(
            workspace_id=workspace_id, binding_id="binding-two", reason="bound"
        )
        host.land_rows(
            first,
            CHUNK_TABLE,
            [
                chunk_row(
                    workspace_id=workspace_id,
                    binding_id=first.binding_id,
                    chunk_id="chunk-one",
                )
            ],
        )
        host.land_rows(
            second,
            CHUNK_TABLE,
            [
                chunk_row(
                    workspace_id=workspace_id,
                    binding_id=second.binding_id,
                    chunk_id="chunk-two",
                )
            ],
        )
        assert chunk_ids(connection, workspace_id) == ["chunk-one", "chunk-two"]
        indexes_before = chunk_indexes(connection, workspace_id)
        assert indexes_before != []

        host.drop_binding(first)

    assert chunk_ids(connection, workspace_id) == ["chunk-one", "chunk-two"]
    assert chunk_indexes(connection, workspace_id) == indexes_before


def test_the_environment_cache_holds_its_bound_and_drops_the_oldest_binding(
    tmp_path: Path,
) -> None:
    """An Environment is an open LMDB handle and a named one has no close of its own, so
    a host that kept one per binding it ever saw would accumulate handles for the life
    of the process. The cache is bounded and the least recently used binding goes first.

    No database: opening a binding opens its LMDB and nothing else, and the pool is not
    built until a run asks for one.
    """
    workspace_id = "01M2Q3R4S5T6V7W8X9YZAB0000"
    touched = ("binding-one", "binding-two", "binding-one", "binding-three")

    with Host(
        bootstrap_for("postgresql://unreached/unreached", tmp_path),
        environments_held=2,
    ) as host:
        for binding_id in touched:
            host.open_binding(
                IndexRun(
                    workspace_id=workspace_id, binding_id=binding_id, reason="bound"
                )
            )
        # `binding-two` is the oldest touch, so it is the one that left.
        assert host.held_bindings() == ("binding-one", "binding-three")


def test_the_bound_the_host_holds_by_default_is_the_one_the_module_states() -> None:
    """Written down rather than read back off the host (`[TEST9]`): a bound that moved
    by accident would agree with a case that asked the host what its bound was.
    """
    assert ENVIRONMENTS_HELD == 4


def test_the_seam_answers_an_outcome_of_plain_numbers_and_opens_the_bindings_store(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    """`index_binding` is the whole of what the rest of the tier sees of the engine: a
    run of plain fields in, three numbers out, and the binding's store opened on the
    way. The documents and the chunks are what the waves after this one fill in; the
    shape they fill is settled here, because the registry and the job row both bind
    to it.
    """
    connection, dsn = database
    workspace_id = seed_partitioned_workspace(connection)
    run = IndexRun(workspace_id=workspace_id, binding_id="binding-one", reason="bound")

    outcome = index_binding(bootstrap_for(dsn, tmp_path), run)

    assert outcome.as_row() == {
        "documents": 0,
        "chunks": 0,
        "lmdb_bytes": outcome.lmdb_bytes,
    }
    assert outcome.lmdb_bytes > 0
    assert (tmp_path / workspace_id / "binding-one").is_dir()


def test_a_bindings_lmdb_size_is_readable_after_its_run(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    """The size of a binding's LMDB is the signal the outcome row carries (ADR 0025) and
    the number the 4 GB per-binding cap is read against, so it is read off the binding's
    own directory after the run rather than estimated from what the run did.
    """
    connection, dsn = database
    workspace_id = seed_partitioned_workspace(connection)
    run = IndexRun(workspace_id=workspace_id, binding_id="binding-one", reason="bound")

    with Host(bootstrap_for(dsn, tmp_path)) as host:
        assert host.lmdb_bytes(run) == 0
        host.land_rows(
            run,
            CHUNK_TABLE,
            [
                chunk_row(
                    workspace_id=workspace_id,
                    binding_id=run.binding_id,
                    chunk_id="chunk-one",
                )
            ],
        )
        after = host.lmdb_bytes(run)

    assert after > 0
    assert Path(host.binding_directory(run)).is_dir()


def test_the_host_tells_the_engines_rust_core_to_log_warnings_and_no_lower(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The engine's core installs a global tracing subscriber at `info` on first use and
    prints its own non-JSON shape to stdout; it reads `RUST_LOG` to decide, from the
    process environment and nowhere else. The deploy unit sets it, and the host sets it
    too from the value the config module read — so one shape leaves the process even
    when the box forgot, and the box still wins when it did not.
    """
    monkeypatch.delenv("RUST_LOG", raising=False)

    with Host(bootstrap_for("postgresql://unreached/unreached", tmp_path)):
        assert os.environ["RUST_LOG"] == "warn"

    louder = bootstrap_for("postgresql://unreached/unreached", tmp_path / "second")
    with Host(
        Bootstrap(
            database_url=louder.database_url,
            git_store_dir=louder.git_store_dir,
            worker_id=louder.worker_id,
            object_store=louder.object_store,
            engine=Engine(lmdb_dir=louder.engine.lmdb_dir, rust_log="debug"),
        )
    ):
        assert os.environ["RUST_LOG"] == "debug"
