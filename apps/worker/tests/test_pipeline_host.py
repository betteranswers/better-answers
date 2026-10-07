import asyncio
import gc
import re
import threading
import time
from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any

import asyncpg
import psycopg
import pytest
from structlog.testing import capture_logs

from better_answers_worker.config import Bootstrap, Engine, ObjectStore
from better_answers_worker.pipeline import (
    CONNECTED_SOURCE_STORE,
    ENVIRONMENTS_HELD,
    FINDINGS_STORE,
    PASSAGE_TABLE,
    PASSAGES_APP,
    STORES_A_CONNECTED_SOURCE_HOLDS,
    Host,
    IndexRun,
    index_connected_source,
    open_pool,
)
from factories import land_passage, seed_workspace
from pg_harness import login_in_role, migrated_postgres_at

WORKER_LOGIN = "worker_login_under_test"
WORKER_PASSWORD = "worker-login-under-test"


def passage_row(
    *,
    workspace_id: str,
    connected_source_id: str,
    passage_id: str,
    content: str = "Expenses are claimed within sixty days.",
    ordinal: int = 0,
) -> dict[str, Any]:
    return {
        "id": passage_id,
        "workspace_id": workspace_id,
        "content": content,
        "connected_source_id": connected_source_id,
        "source_document_id": None,
        "locator": f"doc-{connected_source_id}/chars:0-{len(content)}",
        "ordinal": ordinal,
        "char_start": 0,
        "char_end": len(content),
    }


# jscpd:ignore-start
@pytest.fixture(name="database")
def a_migrated_database() -> Iterator[tuple[psycopg.Connection, str]]:
    with migrated_postgres_at() as (connection, conninfo):
        login_in_role(
            connection, login=WORKER_LOGIN, password=WORKER_PASSWORD, role="worker_rt"
        )
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


def passage_ids(connection: psycopg.Connection, workspace_id: str) -> list[str]:
    with connection.cursor() as cursor:
        cursor.execute(
            'SELECT id FROM "index".passage WHERE workspace_id = %s ORDER BY id',
            (workspace_id,),
        )
        return [str(row[0]) for row in cursor.fetchall()]


def passage_indexes(connection: psycopg.Connection, workspace_id: str) -> list[str]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT indexname FROM pg_indexes"
            " WHERE schemaname = 'index' AND tablename = %s ORDER BY indexname",
            (f"passage_{workspace_id}",),
        )
        return [str(row[0]) for row in cursor.fetchall()]


def test_lands_a_passage_row_only_through_a_scoped_pool(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_partitioned_workspace(connection)
    row = passage_row(
        workspace_id=workspace_id,
        connected_source_id="connected-source-one",
        passage_id="passage-one",
    )

    async def served() -> None:
        pool = await open_pool(dsn, workspace_id, max_size=1)
        try:
            async with pool.acquire() as held:
                await land_passage(held, row)

            async with pool.acquire() as again:
                await land_passage(again, {**row, "id": "passage-two"})
        finally:
            await pool.close()

    async def refused() -> None:
        pool = await asyncpg.create_pool(dsn, min_size=0, max_size=2)
        assert pool is not None
        try:
            async with pool.acquire() as held:
                await land_passage(held, row)
        finally:
            await pool.close()

    asyncio.run(served())
    assert passage_ids(connection, workspace_id) == ["passage-one", "passage-two"]

    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        asyncio.run(refused())


def test_dropping_a_sources_state_keeps_the_table_indexes_and_rows(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_partitioned_workspace(connection)

    with Host(bootstrap_for(dsn, tmp_path)) as host:
        first = IndexRun(
            workspace_id=workspace_id,
            connected_source_id="connected-source-one",
            reason="connected",
        )
        second = IndexRun(
            workspace_id=workspace_id,
            connected_source_id="connected-source-two",
            reason="connected",
        )
        host.land_rows(
            first,
            PASSAGE_TABLE,
            [
                passage_row(
                    workspace_id=workspace_id,
                    connected_source_id=first.connected_source_id,
                    passage_id="passage-one",
                )
            ],
        )
        host.land_rows(
            second,
            PASSAGE_TABLE,
            [
                passage_row(
                    workspace_id=workspace_id,
                    connected_source_id=second.connected_source_id,
                    passage_id="passage-two",
                )
            ],
        )
        assert passage_ids(connection, workspace_id) == ["passage-one", "passage-two"]
        indexes_before = passage_indexes(connection, workspace_id)
        assert indexes_before != []

    # Its own Host, as a run's would be: the engine can still hold the name the
    # landing Host registered.
    with Host(bootstrap_for(dsn, tmp_path)) as host:
        host.drop_connected_source(first)

    assert passage_ids(connection, workspace_id) == ["passage-one", "passage-two"]
    assert passage_indexes(connection, workspace_id) == indexes_before


def a_run_on(connected_source_id: str) -> IndexRun:
    return IndexRun(
        workspace_id="01M2Q3R4S5T6V7W8X9YZAB0000",
        connected_source_id=connected_source_id,
        reason="connected",
    )


def test_the_environment_cache_drops_the_oldest_source_at_its_bound(
    tmp_path: Path,
) -> None:
    touched = (
        "connected-source-one",
        "connected-source-two",
        "connected-source-one",
        "connected-source-three",
    )

    with Host(
        bootstrap_for("postgresql://unreached/unreached", tmp_path),
        environments_held=4,
    ) as host:
        for connected_source_id in touched:
            host.open_connected_source(a_run_on(connected_source_id))

        assert host.held_connected_sources() == (
            "connected-source-one",
            "connected-source-three",
        )


def test_the_default_bound_holds_eight_handles_and_sheds_whole_sources(
    tmp_path: Path,
) -> None:
    whole = bootstrap_for("postgresql://unreached/unreached", tmp_path / "whole")
    with Host(whole) as host:
        for n in range(1, 5):
            host.open_connected_source(a_run_on(f"connected-source-{n}"))
        host.app_config(a_run_on("connected-source-5"), PASSAGES_APP)
        held_whole = host.held_connected_sources()

    half_open = bootstrap_for("postgresql://unreached/unreached", tmp_path / "half")
    with Host(half_open) as host:
        for n in range(1, 10):
            host.app_config(a_run_on(f"connected-source-{n}"), PASSAGES_APP)
        held_half_open = host.held_connected_sources()

    assert ENVIRONMENTS_HELD == 8
    assert held_whole == (
        "connected-source-2",
        "connected-source-3",
        "connected-source-4",
        "connected-source-5",
    )
    assert held_half_open == (
        "connected-source-2",
        "connected-source-3",
        "connected-source-4",
        "connected-source-5",
        "connected-source-6",
        "connected-source-7",
        "connected-source-8",
        "connected-source-9",
    )


def test_refuses_a_bound_below_one_connected_sources_two_handles(
    tmp_path: Path,
) -> None:
    bootstrap = bootstrap_for("postgresql://unreached/unreached", tmp_path)

    with pytest.raises(
        ValueError, match="a connected source's 2 handles and was bounded at 1"
    ):
        Host(bootstrap, environments_held=1)

    with Host(bootstrap, environments_held=2) as host:
        host.open_connected_source(a_run_on("connected-source-one"))

        assert host.held_connected_sources() == ("connected-source-one",)


def test_the_seam_answers_plain_numbers_and_opens_the_passage_store(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_partitioned_workspace(connection)
    run = IndexRun(
        workspace_id=workspace_id,
        connected_source_id="connected-source-one",
        reason="connected",
    )

    outcome = index_connected_source(bootstrap_for(dsn, tmp_path), run)

    assert outcome.as_row() == {
        "documents": 0,
        "passages": 0,
        "lmdb_bytes": outcome.lmdb_bytes,
        "restores_overridden_by_erasure": [],
    }
    assert outcome.lmdb_bytes > 0
    assert (tmp_path / workspace_id / "connected-source-one").is_dir()


def test_a_connected_sources_two_stores_share_the_operators_cap(
    tmp_path: Path,
) -> None:
    bootstrap = bootstrap_for("postgresql://unreached/unreached", tmp_path)

    with Host(bootstrap) as host:
        each = host.store_map_bytes()

    assert (
        each * len(STORES_A_CONNECTED_SOURCE_HOLDS) == bootstrap.engine.lmdb_map_bytes
    )
    assert len(STORES_A_CONNECTED_SOURCE_HOLDS) == 2


def test_a_sources_stores_sit_at_sibling_paths_in_its_directory(
    tmp_path: Path,
) -> None:
    run = IndexRun(
        workspace_id="01M2Q3R4S5T6V7W8X9YZAB0000",
        connected_source_id="connected-source-one",
        reason="connected",
    )

    with Host(bootstrap_for("postgresql://unreached/unreached", tmp_path)) as host:
        host.open_connected_source(run)

        passage_store = host.store_directory(run, CONNECTED_SOURCE_STORE)
        findings = host.store_directory(run, FINDINGS_STORE)

    assert (
        passage_store.parent == findings.parent == host.connected_source_directory(run)
    )
    assert passage_store != findings
    assert passage_store.is_dir() and findings.is_dir()


def test_a_connected_sources_lmdb_size_is_readable_after_its_run(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_partitioned_workspace(connection)
    run = IndexRun(
        workspace_id=workspace_id,
        connected_source_id="connected-source-one",
        reason="connected",
    )

    with Host(bootstrap_for(dsn, tmp_path)) as host:
        assert host.lmdb_bytes(run) == 0
        host.land_rows(
            run,
            PASSAGE_TABLE,
            [
                passage_row(
                    workspace_id=workspace_id,
                    connected_source_id=run.connected_source_id,
                    passage_id="passage-one",
                )
            ],
        )
        after = host.lmdb_bytes(run)

    assert after > 0
    assert Path(host.connected_source_directory(run)).is_dir()


STILL_OPEN = (
    "environment already open in this program;"
    " close it to be able to open it again with different options"
)

WAITS = "the engine still holds the store, so its open waits for it to let go"

HOLDS_AT_MOST_SECONDS = 10


def waits_in(written: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    return [entry for entry in written if entry["event"] == WAITS]


def hold_until_waited_on(store: object, written: Sequence[Mapping[str, Any]]) -> None:
    """Holding `store` keeps the engine's handle open until this returns, as an
    engine task does after its update."""
    deadline = time.monotonic() + HOLDS_AT_MOST_SECONDS
    while not waits_in(written) and time.monotonic() < deadline:
        time.sleep(0.05)


def test_a_held_store_opens_once_the_engine_lets_go(tmp_path: Path) -> None:
    bootstrap = bootstrap_for("postgresql://unreached/unreached", tmp_path)
    run = a_run_on("connected-source-one")

    with capture_logs() as written:
        with Host(bootstrap) as first:
            holder = threading.Thread(
                target=hold_until_waited_on,
                args=(first.app_config(run, PASSAGES_APP), written),
            )
        holder.start()
        try:
            with Host(bootstrap) as second:
                second.app_config(run, PASSAGES_APP)
                opened = second.held_connected_sources()
        finally:
            holder.join()

    assert opened == ("connected-source-one",)
    assert waits_in(written) == [
        {
            "event": WAITS,
            "log_level": "info",
            "connected_source_id": "connected-source-one",
            "store": "connected_source",
            "wait_seconds": 5.0,
        }
    ]


def test_a_store_held_in_a_cycle_opens_after_a_collection(tmp_path: Path) -> None:
    bootstrap = bootstrap_for("postgresql://unreached/unreached", tmp_path)
    run = a_run_on("connected-source-one")

    # Off, so that only the open's own collection can free the cycle.
    gc.disable()
    try:
        with Host(bootstrap) as first:
            cycle: list[object] = [first.app_config(run, PASSAGES_APP)]
            cycle.append(cycle)
        del cycle
        with (
            capture_logs() as written,
            Host(bootstrap, release_wait_seconds=0.2) as second,
        ):
            second.app_config(run, PASSAGES_APP)
            opened = second.held_connected_sources()
    finally:
        gc.enable()

    assert opened == ("connected-source-one",)
    assert waits_in(written) == [
        {
            "event": WAITS,
            "log_level": "info",
            "connected_source_id": "connected-source-one",
            "store": "connected_source",
            "wait_seconds": 0.2,
        }
    ]


def test_a_store_never_let_go_raises_after_the_wait(tmp_path: Path) -> None:
    bootstrap = bootstrap_for("postgresql://unreached/unreached", tmp_path)
    run = a_run_on("connected-source-one")

    with Host(bootstrap) as first, capture_logs() as written:
        first.app_config(run, PASSAGES_APP)
        started = time.monotonic()
        with (
            pytest.raises(RuntimeError) as raised,
            Host(bootstrap, release_wait_seconds=0.2) as second,
        ):
            second.app_config(run, PASSAGES_APP)
        waited = time.monotonic() - started

    assert str(raised.value) == STILL_OPEN
    assert waited >= 0.2
    assert waits_in(written) == [
        {
            "event": WAITS,
            "log_level": "info",
            "connected_source_id": "connected-source-one",
            "store": "connected_source",
            "wait_seconds": 0.2,
        }
    ]


def test_an_unreadable_store_raises_without_waiting(tmp_path: Path) -> None:
    run = a_run_on("connected-source-one")

    with (
        Host(bootstrap_for("postgresql://unreached/unreached", tmp_path)) as host,
        capture_logs() as written,
    ):
        directory = host.store_directory(run, CONNECTED_SOURCE_STORE)
        directory.mkdir(parents=True)
        (directory / "data.mdb").write_bytes(b"not an lmdb file" * 1000)
        with pytest.raises(RuntimeError) as raised:
            host.app_config(run, PASSAGES_APP)

    assert str(raised.value) == "MDB_INVALID: File is not an LMDB file"
    assert waits_in(written) == []
