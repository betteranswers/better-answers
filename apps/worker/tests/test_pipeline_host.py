import asyncio
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
from factories import land_chunk, seed_workspace
from pg_harness import migrated_postgres_at

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


# jscpd:ignore-start
@pytest.fixture(name="database")
def a_migrated_database() -> Iterator[tuple[psycopg.Connection, str]]:
    with migrated_postgres_at() as (connection, conninfo):
        # `CREATE ROLE` takes no parameters, so the names are spelled into the
        # statement; both are constants here and neither comes from a row.
        connection.execute(
            f"CREATE ROLE \"{WORKER_LOGIN}\" LOGIN PASSWORD '{WORKER_PASSWORD}'"
            " IN ROLE worker_rt"
        )
        connection.commit()
        yield connection, as_role(conninfo, WORKER_LOGIN, WORKER_PASSWORD)


# jscpd:ignore-end


def as_role(conninfo: str, role: str, password: str) -> str:
    replaced, count = re.subn(r"//[^@/]*@", f"//{role}:{password}@", conninfo, count=1)
    if count != 1:
        message = f"expected credentials in the harness's conninfo, found {count}"
        raise RuntimeError(message)
    return replaced


def seed_partitioned_workspace(connection: psycopg.Connection) -> str:
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
    connection, dsn = database
    workspace_id = seed_partitioned_workspace(connection)
    row = chunk_row(
        workspace_id=workspace_id, binding_id="binding-one", chunk_id="chunk-one"
    )

    async def served() -> None:
        pool = await open_pool(dsn, workspace_id, max_size=1)
        try:
            async with pool.acquire() as held:
                await land_chunk(held, row)

            async with pool.acquire() as again:
                await land_chunk(again, {**row, "id": "chunk-two"})
        finally:
            await pool.close()

    async def refused() -> None:
        pool = await asyncpg.create_pool(dsn, min_size=0, max_size=2)
        assert pool is not None
        try:
            async with pool.acquire() as held:
                await land_chunk(held, row)
        finally:
            await pool.close()

    asyncio.run(served())
    assert chunk_ids(connection, workspace_id) == ["chunk-one", "chunk-two"]

    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        asyncio.run(refused())


def test_dropping_one_bindings_state_leaves_the_table_its_indexes_and_every_row(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
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

        assert host.held_bindings() == ("binding-one", "binding-three")


def test_the_bound_the_host_holds_by_default_is_the_one_the_module_states() -> None:
    assert ENVIRONMENTS_HELD == 4


def test_the_seam_answers_an_outcome_of_plain_numbers_and_opens_the_bindings_store(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_partitioned_workspace(connection)
    run = IndexRun(workspace_id=workspace_id, binding_id="binding-one", reason="bound")

    outcome = index_binding(bootstrap_for(dsn, tmp_path), run)

    assert outcome.as_row() == {
        "documents": 0,
        "chunks": 0,
        "lmdb_bytes": outcome.lmdb_bytes,
        "restores_overridden_by_erasure": [],
    }
    assert outcome.lmdb_bytes > 0
    assert (tmp_path / workspace_id / "binding-one").is_dir()


def test_a_bindings_lmdb_size_is_readable_after_its_run(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
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
