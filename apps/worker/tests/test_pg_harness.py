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
from datetime import UTC, datetime, timedelta
from functools import partial
from pathlib import Path
from urllib.parse import urlsplit

import psycopg
import pytest
from psycopg.sql import SQL, Identifier, Literal
from testcontainers.community.postgres import PostgresContainer

from support.pg_harness import (
    _BUILD_LOCK_KEY,
    LOCATOR,
    PORT_OVERRIDE,
    SHARED,
    _migrated_cluster,
    ensure_template,
    login_in_role,
    migrated_postgres_at,
    on_database,
    pinned_postgres_image,
    shared_address,
    sweep_dead_cases,
)
from support.roots import REPOSITORY_ROOT

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


def _discard(maintenance: str, database: str) -> None:
    row = _row_of(maintenance, database)
    if row is None:
        return
    with _admin(maintenance) as admin:
        is_template, _allows_connections = row
        if is_template:
            with suppress(psycopg.errors.InvalidCatalogName):
                admin.execute(
                    SQL("ALTER DATABASE {} IS_TEMPLATE false").format(
                        Identifier(database)
                    )
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


OTHER_IMAGE = f"other/image:tag@sha256:{'0' * 64}"


@pytest.mark.parametrize("port", [None, "54999"], ids=["derived", "overridden"])
def test_shared_address_matches_the_scripts_uri(
    monkeypatch: pytest.MonkeyPatch, port: str | None
) -> None:
    monkeypatch.delenv("TEST_POSTGRES_IMAGE", raising=False)
    monkeypatch.delenv(PORT_OVERRIDE, raising=False)
    if port is not None:
        monkeypatch.setenv(PORT_OVERRIDE, port)
    printed = subprocess.run(
        ("bash", str(REPOSITORY_ROOT / "deploy" / "test-postgres.sh"), "address"),
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    lines = dict(line.split(" ", 1) for line in printed.splitlines() if " " in line)

    assert shared_address() == lines["uri"]


def test_takes_the_same_build_lock_as_the_typescript_harness() -> None:
    harness = (
        REPOSITORY_ROOT
        / "packages"
        / "schema"
        / "test"
        / "support"
        / "warm-postgres.ts"
    )
    keys = re.findall(
        r'^export const BUILD_LOCK = "([^"]*)";$',
        harness.read_text("utf-8"),
        re.MULTILINE,
    )

    assert keys == [_BUILD_LOCK_KEY]


CHILD_PRINTS_THE_IMAGE_AND_ADDRESS = """
import sys

sys.path.insert(0, {tests!r})

from support.pg_harness import pinned_postgres_image, shared_address

print(pinned_postgres_image())
print(shared_address())
"""


def the_harness_answers_in_a_fresh_process() -> list[str]:
    script = CHILD_PRINTS_THE_IMAGE_AND_ADDRESS.format(tests=str(Path(__file__).parent))
    return subprocess.run(
        (sys.executable, "-c", script), capture_output=True, text=True, check=True
    ).stdout.splitlines()


def test_the_harness_pins_the_image_whatever_the_caller_sets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(PORT_OVERRIDE, raising=False)
    monkeypatch.delenv("TEST_POSTGRES_IMAGE", raising=False)
    unset = the_harness_answers_in_a_fresh_process()

    monkeypatch.setenv("TEST_POSTGRES_IMAGE", OTHER_IMAGE)

    assert the_harness_answers_in_a_fresh_process() == unset
    assert unset == [pinned_postgres_image(), shared_address()]


@contextmanager
def _throwaway_postgres(command: str | None) -> Iterator[int]:
    container = PostgresContainer(
        pinned_postgres_image(), username="postgres", password="postgres"
    )
    if command is not None:
        container.with_command(command)
    container.start()
    try:
        yield int(container.get_exposed_port(5432))
    finally:
        container.stop()


@pytest.fixture(name="unstamped_port", scope="module")
def an_unstamped_server() -> Iterator[int]:
    with _throwaway_postgres(None) as port:
        yield port


@pytest.fixture(name="other_image_port", scope="module")
def a_server_stamped_with_another_image() -> Iterator[int]:
    with _throwaway_postgres(f"postgres -c better_answers.image={OTHER_IMAGE}") as port:
        yield port


def _uri_at(port: int) -> str:
    return f"postgresql://postgres:postgres@127.0.0.1:{port}/postgres"


@pytest.fixture(name="pinned_image_port", scope="module")
def a_server_stamped_with_the_pinned_image() -> Iterator[int]:
    stamp = f"postgres -c better_answers.image={pinned_postgres_image()}"
    with _throwaway_postgres(stamp) as port:
        yield port


@pytest.mark.xdist_group("throwaway-postgres")
def test_shared_accepts_a_server_stamped_with_the_pinned_image(
    pinned_image_port: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(LOCATOR, SHARED)
    monkeypatch.setenv(PORT_OVERRIDE, str(pinned_image_port))

    cluster = _migrated_cluster.__wrapped__()

    assert urlsplit(cluster.conninfo).port == pinned_image_port
    assert cluster.template.startswith("tpl_py_")


@pytest.mark.xdist_group("throwaway-postgres")
def test_shared_refuses_a_server_with_no_image_stamp(
    unstamped_port: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(PORT_OVERRIDE, str(unstamped_port))

    message = _refusal_for(SHARED, monkeypatch)

    _assert_one_line_naming_the_way_out(message)
    assert "no image stamp" in message


@pytest.mark.xdist_group("throwaway-postgres")
@pytest.mark.parametrize("form", ["shared", "explicit"])
def test_refuses_a_server_stamped_with_another_image(
    other_image_port: int, monkeypatch: pytest.MonkeyPatch, form: str
) -> None:
    monkeypatch.setenv(PORT_OVERRIDE, str(other_image_port))
    locator = SHARED if form == "shared" else _uri_at(other_image_port)

    message = _refusal_for(locator, monkeypatch)

    _assert_one_line_naming_the_way_out(message)
    assert f"stamped {OTHER_IMAGE}" in message
    assert pinned_postgres_image() in message


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


LONG_AGO = "2020-01-01T00:00:00.000Z"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _planted(
    maintenance: str, unique: Callable[[str], str], stamp: str | None, prefix: str
) -> str:
    name = unique(prefix)
    with _admin(maintenance) as admin:
        admin.execute(
            SQL(
                "CREATE DATABASE {} WITH IS_TEMPLATE true ALLOW_CONNECTIONS false"
            ).format(Identifier(name))
        )
        if stamp is not None:
            admin.execute(
                SQL("COMMENT ON DATABASE {} IS {}").format(
                    Identifier(name), Literal(stamp)
                )
            )
    return name


def _stamp_of(maintenance: str, database: str) -> datetime | None:
    with _admin(maintenance) as admin:
        row = admin.execute(
            "SELECT shobj_description(oid, 'pg_database') FROM pg_database"
            " WHERE datname = %s",
            (database,),
        ).fetchone()
    return None if row is None or row[0] is None else datetime.fromisoformat(row[0])


def _ensure_another(maintenance: str, unique: Callable[[str], str]) -> None:
    ensure_template(maintenance, unique("tpl_probe"), partial(_mark, table="other"))


def test_drops_a_day_old_template_and_keeps_fresh_ones(
    maintenance: str, unique: Callable[[str], str]
) -> None:
    stale = _planted(maintenance, unique, LONG_AGO, "tpl_py_age")
    fresh = _planted(maintenance, unique, _now(), "tpl_py_age")

    _ensure_another(maintenance, unique)

    assert _row_of(maintenance, stale) is None
    assert _row_of(maintenance, fresh) == (True, False)


def test_stamps_an_unstamped_template_rather_than_dropping_it(
    maintenance: str, unique: Callable[[str], str]
) -> None:
    before = datetime.now(UTC) - timedelta(seconds=1)
    unstamped = _planted(maintenance, unique, None, "tpl_py_age")

    _ensure_another(maintenance, unique)

    stamp = _stamp_of(maintenance, unstamped)
    assert stamp is not None
    assert stamp >= before


def test_leaves_stale_templates_outside_its_prefix_alone(
    maintenance: str, unique: Callable[[str], str]
) -> None:
    a_prefix_no_tier_sweeps = "tpl_probe_age"
    theirs = _planted(maintenance, unique, LONG_AGO, a_prefix_no_tier_sweeps)

    _ensure_another(maintenance, unique)

    assert _row_of(maintenance, theirs) == (True, False)


def test_drops_a_killed_builders_leftover_under_another_name(
    maintenance: str, unique: Callable[[str], str]
) -> None:
    orphan = f"{unique('tpl_py_age')}_building"
    _create(maintenance, orphan)

    _ensure_another(maintenance, unique)

    assert _row_of(maintenance, orphan) is None


def test_stamps_the_ensured_template_with_the_time_of_use(
    maintenance: str, unique: Callable[[str], str]
) -> None:
    name = unique("tpl_probe")
    ensure_template(maintenance, name, partial(_mark, table="used"))
    before = datetime.now(UTC) - timedelta(seconds=1)

    ensure_template(maintenance, name, partial(_mark, table="used"))

    stamp = _stamp_of(maintenance, name)
    assert stamp is not None
    assert stamp >= before


CHILD_OPENS_ONE_CLONE = """
import json
import os
import sys

sys.path.insert(0, {tests!r})

from support.pg_harness import migrated_postgres_at

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


def _gone_or_going(maintenance: str, database: str) -> bool:
    # Postgres marks a database it is dropping with a connection limit of -2.
    with _admin(maintenance) as admin:
        row = admin.execute(
            "SELECT datconnlimit FROM pg_database WHERE datname = %s", (database,)
        ).fetchone()
    return row is None or row[0] == -2


def _held(maintenance: str, database: str, server: str) -> psycopg.Connection | None:
    try:
        return psycopg.connect(on_database(server, database))
    except psycopg.OperationalError:
        # A failed connect carries no SQLSTATE, so the catalog tells a sweep's drop
        # apart from a server that refused.
        if _gone_or_going(maintenance, database):
            return None
        _discard(maintenance, database)
        raise


@contextmanager
def _a_dead_runs_database_held(maintenance: str) -> Iterator[str]:
    for _attempt in range(5):
        dead = f"case_{_a_dead_pid()}_{uuid.uuid4().int % 10**9}"
        _create(maintenance, dead)
        session = _held(maintenance, dead, maintenance)
        if session is None:
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


def test_a_refused_connection_fails_as_itself_and_leaves_no_database(
    maintenance: str, unique: Callable[[str], str]
) -> None:
    made = unique("probe_refused")
    _create(maintenance, made)

    with pytest.raises(psycopg.OperationalError, match="Connection refused"):
        _held(maintenance, made, _uri_at(1))

    assert _row_of(maintenance, made) is None


@pytest.mark.parametrize("drop", ["finished", "interrupted"])
def test_a_database_a_sweep_dropped_is_not_held(
    maintenance: str, unique: Callable[[str], str], drop: str
) -> None:
    dropped = unique("probe_dropped")
    if drop == "interrupted":
        _create(maintenance, dropped)
        with _admin(maintenance) as admin:
            admin.execute(
                "UPDATE pg_database SET datconnlimit = -2 WHERE datname = %s",
                (dropped,),
            )

    assert _held(maintenance, dropped, maintenance) is None


def test_discards_a_database_an_interrupted_drop_left_invalid(
    maintenance: str, unique: Callable[[str], str]
) -> None:
    halted = unique("probe_halted")
    _create(maintenance, halted)
    with _admin(maintenance) as admin:
        admin.execute(
            "UPDATE pg_database SET datconnlimit = -2 WHERE datname = %s", (halted,)
        )

    _discard(maintenance, halted)

    assert _row_of(maintenance, halted) is None
