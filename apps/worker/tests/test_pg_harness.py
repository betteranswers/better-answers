import json
import os
import re
import subprocess
import sys
import threading
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, suppress
from functools import partial
from pathlib import Path
from urllib.parse import urlsplit

import psycopg
import pytest
from psycopg.sql import SQL, Identifier, Literal
from testcontainers.community.postgres import PostgresContainer

from pg_harness import (
    LOCATOR,
    _migrated_cluster,
    ensure_template,
    login_in_role,
    migrated_postgres_at,
    on_database,
    sweep_dead_cases,
)

UP_COMMAND = "deploy/test-postgres.sh up"


class ContainerConstructedError(Exception):
    pass


def _refuse_a_container(*_args: object, **_kwargs: object) -> None:
    raise ContainerConstructedError


@pytest.fixture(name="maintenance")
def this_processes_server() -> str:
    return on_database(_migrated_cluster().conninfo, "postgres")


def _admin(maintenance: str) -> psycopg.Connection:
    return psycopg.connect(maintenance, autocommit=True)


def _row_of(maintenance: str, database: str) -> tuple[bool, bool] | None:
    with _admin(maintenance) as admin:
        row = admin.execute(
            "SELECT datistemplate, datallowconn FROM pg_database WHERE datname = %s",
            (database,),
        ).fetchone()
    return None if row is None else (bool(row[0]), bool(row[1]))


# Another run's sweep may drop a dead-pid database between any two of these statements.
def _discard(maintenance: str, database: str) -> None:
    if _row_of(maintenance, database) is None:
        return
    with _admin(maintenance) as admin:
        with suppress(psycopg.errors.InvalidCatalogName):
            admin.execute(
                SQL("ALTER DATABASE {} IS_TEMPLATE false").format(Identifier(database))
            )
        admin.execute(
            SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(Identifier(database))
        )


def _create(maintenance: str, database: str, template: str = "template1") -> None:
    with _admin(maintenance) as admin:
        admin.execute(
            SQL("CREATE DATABASE {} TEMPLATE {}").format(
                Identifier(database), Identifier(template)
            )
        )


@pytest.fixture(name="unique")
def unique_names(maintenance: str) -> Iterator[Callable[[str], str]]:
    made: list[str] = []

    def unique(prefix: str) -> str:
        name = f"{prefix}_{uuid.uuid4().hex[:12]}"
        made.extend((name, f"{name}_building"))
        return name

    yield unique
    for database in made:
        _discard(maintenance, database)


def _mark(conninfo: str, *, table: str) -> None:
    with psycopg.connect(conninfo) as connection:
        connection.execute(SQL("CREATE TABLE {} ()").format(Identifier(table)))


def _tables_cloned_from(maintenance: str, template: str) -> set[str]:
    clone = f"probe_clone_{uuid.uuid4().hex[:12]}"
    _create(maintenance, clone, template)
    try:
        with psycopg.connect(on_database(maintenance, clone)) as connection:
            rows = connection.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
            ).fetchall()
    finally:
        _discard(maintenance, clone)
    return {str(row[0]) for row in rows}


def test_shares_the_located_server_and_constructs_no_container(
    maintenance: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    dead = f"case_{_a_dead_pid()}_{uuid.uuid4().int % 10**9}"
    _create(maintenance, dead)
    monkeypatch.setattr(PostgresContainer, "__init__", _refuse_a_container)
    monkeypatch.setitem(os.environ, LOCATOR, on_database(maintenance, "nowhere"))

    cluster = _migrated_cluster.__wrapped__()

    assert cluster.conninfo == maintenance
    assert re.fullmatch(r"tpl_py_[0-9a-f]{12}", cluster.template)
    assert _row_of(maintenance, cluster.template) == (True, False)
    assert dead not in _case_names(maintenance)


def test_constructs_a_container_when_the_locator_is_blank(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(PostgresContainer, "__init__", _refuse_a_container)
    monkeypatch.setitem(os.environ, LOCATOR, "   ")

    with pytest.raises(ContainerConstructedError):
        _migrated_cluster.__wrapped__()


def _refusal_for(locator: str, monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setattr(PostgresContainer, "__init__", _refuse_a_container)
    monkeypatch.setitem(os.environ, LOCATOR, locator)
    with pytest.raises(RuntimeError) as raised:
        _migrated_cluster.__wrapped__()
    return str(raised.value)


def _assert_one_line_naming_the_way_out(message: str) -> None:
    assert "\n" not in message
    assert LOCATOR in message
    assert UP_COMMAND in message


def test_refuses_an_unreachable_locator_in_one_line(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    message = _refusal_for(
        "postgresql://nobody:nothing@127.0.0.1:1/postgres", monkeypatch
    )

    _assert_one_line_naming_the_way_out(message)


def test_refuses_a_locator_signed_in_as_no_superuser(
    maintenance: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    login = f"probe_{uuid.uuid4().hex[:12]}"
    with _admin(maintenance) as admin:
        admin.execute(
            SQL("CREATE ROLE {} LOGIN NOSUPERUSER PASSWORD {}").format(
                Identifier(login), Literal("probe")
            )
        )
    parts = urlsplit(maintenance)
    locator = parts._replace(
        netloc=f"{login}:probe@{parts.hostname}:{parts.port}"
    ).geturl()
    try:
        message = _refusal_for(locator, monkeypatch)
    finally:
        with _admin(maintenance) as admin:
            admin.execute(SQL("DROP ROLE {}").format(Identifier(login)))

    _assert_one_line_naming_the_way_out(message)


def test_two_racing_callers_build_one_template_once(
    maintenance: str, unique: Callable[[str], str]
) -> None:
    name = unique("tpl_probe")
    builds: list[str] = []
    barrier = threading.Barrier(2)

    def build(conninfo: str) -> None:
        builds.append(conninfo)
        _mark(conninfo, table="built")

    def race() -> str:
        barrier.wait()
        return ensure_template(maintenance, name, build)

    with ThreadPoolExecutor(2) as pool:
        racers = [pool.submit(race) for _ in range(2)]
        results = [racer.result() for racer in racers]

    assert results == [name, name]
    assert len(builds) == 1
    assert _row_of(maintenance, name) == (True, False)
    assert _tables_cloned_from(maintenance, name) == {"built"}


def test_templates_with_different_builds_hold_only_their_own(
    maintenance: str, unique: Callable[[str], str]
) -> None:
    first, second = unique("tpl_probe"), unique("tpl_probe")

    with ThreadPoolExecutor(2) as pool:
        built = [
            pool.submit(ensure_template, maintenance, first, partial(_mark, table="a")),
            pool.submit(
                ensure_template, maintenance, second, partial(_mark, table="b")
            ),
        ]
        assert [future.result() for future in built] == [first, second]

    assert _tables_cloned_from(maintenance, first) == {"a"}
    assert _tables_cloned_from(maintenance, second) == {"b"}


@pytest.mark.parametrize("sealed", [False, True], ids=["open", "sealed"])
def test_drops_a_killed_builders_leftover_and_publishes(
    maintenance: str, unique: Callable[[str], str], sealed: bool
) -> None:
    name = unique("tpl_probe")
    leftover = f"{name}_building"
    _create(maintenance, leftover)
    _mark(on_database(maintenance, leftover), table="stale")
    if sealed:
        with _admin(maintenance) as admin:
            for clause in ("ALLOW_CONNECTIONS false", "IS_TEMPLATE true"):
                admin.execute(
                    SQL("ALTER DATABASE {} ").format(Identifier(leftover)) + SQL(clause)
                )

    assert ensure_template(maintenance, name, partial(_mark, table="fresh")) == name

    assert _row_of(maintenance, leftover) is None
    assert _row_of(maintenance, name) == (True, False)
    assert _tables_cloned_from(maintenance, name) == {"fresh"}


CHILD_OPENS_ONE_CLONE = """
import json
import os
import sys

sys.path.insert(0, {tests!r})

from pg_harness import migrated_postgres_at

with migrated_postgres_at() as (connection, _conninfo):
    row = connection.execute("SELECT current_database()").fetchone()

print(json.dumps({{"pid": os.getpid(), "database": row[0]}}))
"""


def test_two_processes_clone_under_names_that_never_collide(
    maintenance: str,
) -> None:
    script = CHILD_OPENS_ONE_CLONE.format(tests=str(Path(__file__).parent))
    environment = os.environ | {LOCATOR: maintenance}
    children = [
        subprocess.Popen(
            (sys.executable, "-c", script),
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        for _ in range(2)
    ]
    outputs = [child.communicate(timeout=300) for child in children]

    assert [child.returncode for child in children] == [0, 0], outputs
    opened = [json.loads(stdout.strip().splitlines()[-1]) for stdout, _ in outputs]
    assert [seen["database"] for seen in opened] == [
        f"case_{seen['pid']}_0" for seen in opened
    ]
    assert opened[0]["database"] != opened[1]["database"]


def test_two_sessions_create_one_login_at_once() -> None:
    login = f"probe_{uuid.uuid4().hex[:12]}"
    barrier = threading.Barrier(2)

    def sign_up(connection: psycopg.Connection) -> None:
        barrier.wait()
        login_in_role(connection, login=login, password="probe", role="worker_rt")

    with migrated_postgres_at() as (connection, conninfo):
        try:
            with psycopg.connect(conninfo) as other, ThreadPoolExecutor(2) as pool:
                for signed in [pool.submit(sign_up, c) for c in (connection, other)]:
                    signed.result()
            member = connection.execute(
                "SELECT 1 FROM pg_auth_members m"
                " JOIN pg_roles r ON r.oid = m.roleid"
                " JOIN pg_roles l ON l.oid = m.member"
                " WHERE r.rolname = 'worker_rt' AND l.rolname = %s",
                (login,),
            ).fetchone()
        finally:
            connection.rollback()
            connection.execute(SQL("DROP ROLE IF EXISTS {}").format(Identifier(login)))
            connection.commit()

    assert member == (1,)


def _a_dead_pid() -> int:
    child = subprocess.Popen((sys.executable, "-c", ""))
    child.wait()
    return child.pid


def _case_names(maintenance: str) -> set[str]:
    with _admin(maintenance) as admin:
        rows = admin.execute(
            "SELECT datname FROM pg_database WHERE datname ~ '^case_[0-9]+_[0-9]+$'"
        ).fetchall()
    return {str(row[0]) for row in rows}


def test_sweeps_a_dead_runs_database_and_keeps_a_live_ones(
    maintenance: str,
) -> None:
    tag = uuid.uuid4().int % 10**9
    dead, alive = f"case_{_a_dead_pid()}_{tag}", f"case_{os.getppid()}_{tag}"
    for database in (dead, alive):
        _create(maintenance, database)
    try:
        sweep_dead_cases(maintenance)

        assert {dead, alive} & _case_names(maintenance) == {alive}
    finally:
        for database in (dead, alive):
            _discard(maintenance, database)


# Another run's sweep may drop it before this session connects, so retry.
@contextmanager
def _a_dead_runs_database_held(maintenance: str) -> Iterator[str]:
    for _attempt in range(5):
        dead = f"case_{_a_dead_pid()}_{uuid.uuid4().int % 10**9}"
        _create(maintenance, dead)
        try:
            session = psycopg.connect(on_database(maintenance, dead))
        except psycopg.errors.InvalidCatalogName:
            continue
        try:
            with session:
                yield dead
                return
        finally:
            _discard(maintenance, dead)
    pytest.fail("another run's sweep dropped every database before it was held")


def test_sweep_skips_a_dead_runs_database_still_in_use(maintenance: str) -> None:
    with _a_dead_runs_database_held(maintenance) as dead:
        sweep_dead_cases(maintenance)

        assert dead in _case_names(maintenance)
