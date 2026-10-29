import atexit
import hashlib
import json
import os
import re
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager, suppress
from datetime import UTC, datetime
from functools import cache
from itertools import count
from pathlib import Path
from typing import Any, NamedTuple
from urllib.parse import urlsplit

import psycopg
from psycopg import errors
from psycopg.sql import SQL, Identifier, Literal
from testcontainers.community.postgres import PostgresContainer

from support.roots import REPOSITORY_ROOT

MIGRATIONS_DIR = REPOSITORY_ROOT / "packages" / "schema" / "migrations"


_IMAGE_SOURCE = REPOSITORY_ROOT / "packages" / "schema" / "src" / "postgres-image.ts"


@cache
def pinned_postgres_image() -> str:
    source = _IMAGE_SOURCE.read_text("utf-8")
    matches = re.findall(r'"(pgvector/pgvector:[^"]+)"', source)
    if len(matches) != 1:
        msg = f"expected one pinned image in {_IMAGE_SOURCE}, found {len(matches)}"
        raise RuntimeError(msg)
    return str(matches[0])


def journal_entries() -> list[dict[str, object]]:
    journal = json.loads((MIGRATIONS_DIR / "meta" / "_journal.json").read_text("utf-8"))
    return [dict(entry) for entry in journal["entries"]]


def journal_migrations() -> list[Path]:
    return [MIGRATIONS_DIR / f"{entry['tag']}.sql" for entry in journal_entries()]


_STAMP_TABLE = """
CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
)
"""


def stamp_migration(cursor: psycopg.Cursor[Any], *, digest: str, when: object) -> None:
    cursor.execute(
        'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")'
        " VALUES (%s, %s)",
        (digest, when),
    )


def stamp_contract_as_migrate_does(cursor: psycopg.Cursor[Any], *, digest: str) -> None:
    cursor.execute(
        "INSERT INTO contract_stamp (only_row, digest) VALUES (true, %s)"
        " ON CONFLICT (only_row) DO UPDATE SET digest = excluded.digest",
        (digest,),
    )


def apply_journal(conninfo: str) -> None:
    with psycopg.connect(conninfo) as connection:
        for statement in _STAMP_TABLE.split(";"):
            if statement.strip():
                connection.execute(statement)
        for entry in journal_entries():
            migration = MIGRATIONS_DIR / f"{entry['tag']}.sql"
            sql = migration.read_text("utf-8")
            for statement in sql.split("--> statement-breakpoint"):
                if statement.strip():
                    connection.execute(statement)
            with connection.cursor() as cursor:
                stamp_migration(
                    cursor,
                    digest=hashlib.sha256(sql.encode("utf-8")).hexdigest(),
                    when=entry["when"],
                )
        connection.commit()


@contextmanager
def migrated_postgres() -> Iterator[psycopg.Connection]:
    with migrated_postgres_at() as (connection, _conninfo):
        yield connection


MIGRATED_TEMPLATE = "migrated"


def on_database(conninfo: str, database: str) -> str:
    return urlsplit(conninfo)._replace(path=f"/{database}").geturl()


LOCATOR = "TEST_POSTGRES_URI"
SHARED = "shared"
PORT_OVERRIDE = "TEST_POSTGRES_PORT"
UP_COMMAND = "deploy/test-postgres.sh up"

# Postgres advisory locks conflict only within one database.
_BUILD_LOCK_KEY = "hashtextextended('better-answers template build', 0)"
_TAKE_BUILD_LOCK = f"SELECT pg_advisory_lock({_BUILD_LOCK_KEY})"
_RELEASE_BUILD_LOCK = f"SELECT pg_advisory_unlock({_BUILD_LOCK_KEY})"
_SESSIONS_GONE_WITHIN_SECONDS = 30


class Cluster(NamedTuple):
    conninfo: str
    template: str


@cache
def _migrated_cluster() -> Cluster:
    locator = os.environ.get(LOCATOR, "").strip()
    if not locator:
        return _container_cluster()
    if locator == SHARED:
        return _located_cluster(shared_address(), shared=True)
    return _located_cluster(locator, shared=False)


def _pinned_digest() -> str:
    image = pinned_postgres_image()
    found = re.search(r"@sha256:([0-9a-f]{64})$", image)
    if found is None:
        msg = f"{_IMAGE_SOURCE} pins {image}, which carries no sha256 digest"
        raise RuntimeError(msg)
    return found.group(1)


def shared_address() -> str:
    override = os.environ.get(PORT_OVERRIDE, "").strip()
    port = int(override) if override else 55434 + int(_pinned_digest()[:4], 16) % 1000
    return f"postgresql://postgres:postgres@127.0.0.1:{port}/postgres"


def _container_cluster() -> Cluster:
    container = PostgresContainer(pinned_postgres_image(), dbname=MIGRATED_TEMPLATE)
    container.start()
    atexit.register(container.stop)
    conninfo = container.get_connection_url().replace(
        "postgresql+psycopg2", "postgresql"
    )
    apply_journal(conninfo)
    return Cluster(conninfo, MIGRATED_TEMPLATE)


def _located_cluster(locator: str, *, shared: bool) -> Cluster:
    maintenance = on_database(locator, "postgres")
    _refuse_unless_fit(maintenance, shared=shared)
    sweep_dead_cases(maintenance)
    return Cluster(
        maintenance, ensure_template(maintenance, template_name(), apply_journal)
    )


def _server_facts(maintenance: str) -> tuple[bool, str | None]:
    try:
        with psycopg.connect(maintenance, connect_timeout=5) as connection:
            row = connection.execute(
                "SELECT rolsuper, current_setting('better_answers.image', true)"
                " FROM pg_roles WHERE rolname = current_user"
            ).fetchone()
    except (psycopg.OperationalError, psycopg.ProgrammingError) as error:
        reason = (str(error).splitlines() or [""])[0]
        message = f"{LOCATOR} reaches no Postgres ({reason}): run `{UP_COMMAND}`"
        raise RuntimeError(message) from None
    return (False, None) if row is None else (bool(row[0]), row[1])


def _refuse_unless_fit(maintenance: str, *, shared: bool) -> None:
    superuser, stamp = _server_facts(maintenance)
    if not superuser:
        message = (
            f"{LOCATOR} signs in as no superuser: export the URI `{UP_COMMAND}` prints"
        )
        raise RuntimeError(message)
    pinned = pinned_postgres_image()
    if stamp is None and shared:
        message = (
            f"{LOCATOR} reaches a Postgres with no image stamp: run `{UP_COMMAND}`"
        )
        raise RuntimeError(message)
    if stamp is not None and stamp != pinned:
        message = (
            f"{LOCATOR} reaches a Postgres stamped {stamp} but this checkout pins"
            f" {pinned}: run `{UP_COMMAND}`"
        )
        raise RuntimeError(message)


_TEMPLATE_PREFIX = "tpl_py_"


def template_name() -> str:
    digest = hashlib.sha256()
    files = sorted(
        (path.relative_to(MIGRATIONS_DIR).as_posix(), path)
        for path in MIGRATIONS_DIR.rglob("*")
        if path.is_file()
    )
    for relative, path in files:
        digest.update(relative.encode("utf-8") + b"\0" + path.read_bytes() + b"\0")
    digest.update(Path(__file__).read_bytes())
    return f"{_TEMPLATE_PREFIX}{digest.hexdigest()[:12]}"


def _exists(admin: psycopg.Connection, database: str) -> bool:
    found = admin.execute(
        "SELECT 1 FROM pg_database WHERE datname = %s", (database,)
    ).fetchone()
    return found is not None


def _alter(admin: psycopg.Connection, database: str, clause: str) -> None:
    admin.execute(SQL("ALTER DATABASE {} ").format(Identifier(database)) + SQL(clause))


def _until_sessions_gone(admin: psycopg.Connection, database: str) -> None:
    deadline = time.monotonic() + _SESSIONS_GONE_WITHIN_SECONDS
    while _exists_session_on(admin, database):
        if time.monotonic() > deadline:
            message = f"a session stayed on {database} after its build returned"
            raise RuntimeError(message)
        time.sleep(0.05)


def _exists_session_on(admin: psycopg.Connection, database: str) -> bool:
    found = admin.execute(
        "SELECT 1 FROM pg_stat_activity WHERE datname = %s", (database,)
    ).fetchone()
    return found is not None


def _drop_template(admin: psycopg.Connection, database: str) -> None:
    if not _exists(admin, database):
        return
    # Postgres refuses to drop a database still marked as a template.
    _alter(admin, database, "IS_TEMPLATE false")
    admin.execute(SQL("DROP DATABASE {} WITH (FORCE)").format(Identifier(database)))


def _publish(
    admin: psycopg.Connection,
    maintenance: str,
    name: str,
    build: Callable[[str], None],
) -> None:
    building = f"{name}_building"
    _drop_template(admin, building)
    admin.execute(SQL("CREATE DATABASE {}").format(Identifier(building)))
    build(on_database(maintenance, building))
    _until_sessions_gone(admin, building)
    _alter(admin, building, "ALLOW_CONNECTIONS false")
    _alter(admin, building, "IS_TEMPLATE true")
    admin.execute(
        SQL("ALTER DATABASE {} RENAME TO {}").format(
            Identifier(building), Identifier(name)
        )
    )


def _stamp_use(admin: psycopg.Connection, database: str) -> None:
    admin.execute(
        SQL("COMMENT ON DATABASE {} IS {}").format(
            Identifier(database), Literal(datetime.now(UTC).isoformat())
        )
    )


_AGES = r"""
SELECT datname, CASE WHEN shobj_description(oid, 'pg_database') ~ '^\d{4}-\d{2}-\d{2}T'
  THEN shobj_description(oid, 'pg_database')::timestamptz < now() - interval '1 day' END
FROM pg_database WHERE datistemplate AND starts_with(datname, %s)
"""


# DROP DATABASE waits on a CREATE DATABASE cloning it, so a run still cloning keeps
# its template until the clone ends.
def _hold_the_tmpfs_to_a_days_templates(admin: psycopg.Connection) -> None:
    for database, stale in admin.execute(_AGES, (_TEMPLATE_PREFIX,)).fetchall():
        if stale is None:
            _stamp_use(admin, str(database))
        elif stale:
            _drop_template(admin, str(database))


def _drop_killed_builds(admin: psycopg.Connection) -> None:
    found = admin.execute(
        r"SELECT datname FROM pg_database"
        r" WHERE starts_with(datname, %s) AND datname LIKE '%%\_building'",
        (_TEMPLATE_PREFIX,),
    ).fetchall()
    for (database,) in found:
        _drop_template(admin, str(database))


def ensure_template(
    maintenance_conninfo: str, name: str, build: Callable[[str], None]
) -> str:
    # Postgres frees a session-level advisory lock when the session ends, so any
    # failure here releases it.
    with psycopg.connect(maintenance_conninfo, autocommit=True) as admin:
        admin.execute(_TAKE_BUILD_LOCK)
        if not _exists(admin, name):
            _publish(admin, maintenance_conninfo, name, build)
        _stamp_use(admin, name)
        _hold_the_tmpfs_to_a_days_templates(admin)
        _drop_killed_builds(admin)
        admin.execute(_RELEASE_BUILD_LOCK)
    return name


def _is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def sweep_dead_cases(maintenance: str) -> None:
    with psycopg.connect(maintenance, autocommit=True) as admin:
        names = [
            str(row[0])
            for row in admin.execute(
                "SELECT datname FROM pg_database WHERE datname ~ '^case_[0-9]+_[0-9]+$'"
            ).fetchall()
        ]
        for database in names:
            if _is_alive(int(database.split("_")[1])):
                continue
            with suppress(errors.ObjectInUse, errors.InvalidCatalogName):
                admin.execute(
                    SQL("DROP DATABASE IF EXISTS {}").format(Identifier(database))
                )


_DATABASE_NUMBERS = count()


@contextmanager
def migrated_postgres_at() -> Iterator[tuple[psycopg.Connection, str]]:
    cluster = _migrated_cluster()
    database = f"case_{os.getpid()}_{next(_DATABASE_NUMBERS)}"
    maintenance = on_database(cluster.conninfo, "postgres")
    with psycopg.connect(maintenance, autocommit=True) as admin:
        admin.execute(
            SQL("CREATE DATABASE {} TEMPLATE {}").format(
                Identifier(database), Identifier(cluster.template)
            )
        )
    conninfo = on_database(cluster.conninfo, database)
    try:
        with psycopg.connect(conninfo) as connection:
            yield connection, conninfo
    finally:
        with psycopg.connect(maintenance, autocommit=True) as admin:
            admin.execute(
                SQL("DROP DATABASE {} WITH (FORCE)").format(Identifier(database))
            )


# Roles span the server, and two concurrent creates of one raise unique_violation,
# not duplicate_object.
def login_in_role(
    connection: psycopg.Connection, *, login: str, password: str, role: str
) -> None:
    with (
        suppress(errors.DuplicateObject, errors.UniqueViolation),
        connection.transaction(),
    ):
        connection.execute(
            SQL("CREATE ROLE {} LOGIN PASSWORD {} IN ROLE {}").format(
                Identifier(login), Literal(password), Identifier(role)
            )
        )
    connection.commit()


WORKER_LOGIN = "worker_login_under_test"
_WORKER_PASSWORD = "worker-login-under-test"


def worker_login_dsn(connection: psycopg.Connection, conninfo: str) -> str:
    login_in_role(
        connection, login=WORKER_LOGIN, password=_WORKER_PASSWORD, role="worker_rt"
    )
    replaced, count = re.subn(
        r"//[^@/]*@", f"//{WORKER_LOGIN}:{_WORKER_PASSWORD}@", conninfo, count=1
    )
    if count != 1:
        message = f"expected credentials in the harness's conninfo, found {count}"
        raise RuntimeError(message)
    return replaced
