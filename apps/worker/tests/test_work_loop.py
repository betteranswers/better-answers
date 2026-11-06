import contextlib
import json
import signal
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Iterator, Mapping, MutableMapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
import pytest
from structlog.testing import capture_logs

from better_answers_worker import health, loop, queue
from better_answers_worker.concepts.audit import run_audit
from better_answers_worker.concepts.bundle import (
    NotAWorkspaceIdError,
    concepts_at_head,
    repository_path,
)
from better_answers_worker.concepts.rebuild import run_rebuild
from better_answers_worker.config import Bootstrap, Engine, ObjectStore
from better_answers_worker.contract_stamp import CONTRACT_DIGEST
from better_answers_worker.ids import ulid
from better_answers_worker.kinds import KINDS
from better_answers_worker.queue import scoped
from better_answers_worker.schema_view import MIGRATION_WHEN
from support.bundles import write_bundle
from support.factories import (
    hold_map_generation,
    seed_concept,
    seed_job,
    seed_map_generation,
    seed_map_node,
    seed_workspace,
)
from support.pg_harness import (
    migrated_postgres_at,
    stamp_contract_as_migrate_does,
    stamp_migration,
    worker_login_dsn,
)

WORKER = "worker-under-test"
IRI = "https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM"
OTHER_IRI = "https://better-answers.com/c/01J6NNNNNNNNNNNNNNNNNNNNNN"


@pytest.fixture(name="database")
def a_migrated_database() -> Iterator[psycopg.Connection]:
    with migrated_postgres_at() as (connection, conninfo):
        _CONNINFO[connection] = conninfo
        yield connection


_CONNINFO: dict[psycopg.Connection, str] = {}


def seed_expenses(
    cursor: psycopg.Cursor,
    workspace: str,
    body: str = "Expenses are claimed within sixty days.",
) -> str:
    return seed_concept(
        cursor,
        workspace_id=workspace,
        iri=IRI,
        path="knowledge/expenses.md",
        frontmatter={"title": "Expenses", "type": "Policy", "iri": IRI},
        body=body,
    )


def bootstrap_for(database: psycopg.Connection, git_store: Path) -> Bootstrap:
    return Bootstrap(
        database_url=_CONNINFO[database],
        git_store_dir=str(git_store),
        worker_id=WORKER,
        object_store=ObjectStore(
            endpoint="http://objectstore:3900",
            access_key="key-under-test",
            secret_key="secret-under-test",
            bucket="better-answers",
            region="garage",
        ),
        engine=Engine(lmdb_dir=str(git_store / "lmdb")),
    )


def create_an_empty_repository(git_store: Path, workspace: str) -> None:
    (git_store / f"{workspace}.git").mkdir()


def end_backoffs(database: psycopg.Connection, workspace: str) -> None:
    with scoped(database, workspace) as cursor:
        cursor.execute(
            "UPDATE job SET backoff_ends_at = now() WHERE backoff_ends_at IS NOT NULL"
        )


def a_workspace_with_one_job(
    database: psycopg.Connection, *, kind: str, reason: str | None = None
) -> str:
    workspace = seed_workspace(database.cursor())["id"]
    database.commit()
    with scoped(database, workspace) as cursor:
        seed_job(cursor, workspace_id=workspace, kind=kind, reason=reason)
    return str(workspace)


def test_the_kinds_registry_lists_audit_rebuild_and_index() -> None:
    assert tuple(KINDS) == ("nightly-audit", "full-rebuild", "index")


def test_the_loop_runs_each_kind_one_job_at_a_time(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    with database.cursor() as cursor:
        content = seed_expenses(cursor, workspace)
        seed_job(
            cursor,
            workspace_id=workspace,
            kind="nightly-audit",
            enqueued_ago_seconds=2,
        )
        seed_job(cursor, workspace_id=workspace, kind="full-rebuild", reason="drill")
    database.commit()
    write_bundle(tmp_path, workspace, {"knowledge/expenses.md": content})

    bootstrap = bootstrap_for(database, tmp_path)
    with queue.connected(bootstrap.database_url) as worker:
        assert loop.tick(worker, bootstrap) is True
        assert loop.tick(worker, bootstrap) is True

    with database.cursor() as cursor:
        cursor.execute(
            "SELECT kind, status, claimed_by, heartbeat_at IS NOT NULL, outcome"
            " FROM job WHERE workspace_id = %s ORDER BY enqueued_at",
            (workspace,),
        )
        rows = cursor.fetchall()
    assert [row[:4] for row in rows] == [
        ("nightly-audit", "done", WORKER, True),
        ("full-rebuild", "done", WORKER, True),
    ]

    assert rows[0][4]["checked"] == 1
    assert "generation" not in rows[0][4]
    assert (rows[1][4]["generation"], rows[1][4]["nodes"]) == (2, 1)


def an_index_job_older_than_an_audit(database: psycopg.Connection) -> tuple[str, str]:
    workspace = str(seed_workspace(database.cursor())["id"])
    connected_source_id = ulid()
    with database.cursor() as cursor:
        seed_job(
            cursor,
            workspace_id=workspace,
            kind="index",
            reason="connected",
            subject_id=connected_source_id,
            enqueued_ago_seconds=2,
        )
        seed_job(cursor, workspace_id=workspace, kind="nightly-audit")
    database.commit()
    return workspace, connected_source_id


def test_a_claim_leaves_other_kinds_queued_with_no_attempt(
    database: psycopg.Connection,
) -> None:
    workspace, connected_source_id = an_index_job_older_than_an_audit(database)

    with queue.connected(_CONNINFO[database]) as worker:
        with scoped(worker, workspace) as cursor:
            auditing = queue.claim(cursor, workspace, WORKER, ["nightly-audit"])
        with database.cursor() as cursor:
            cursor.execute(
                "SELECT status, claimed_by, attempts FROM job"
                " WHERE workspace_id = %s AND kind = 'index'",
                (workspace,),
            )
            passed_over = cursor.fetchall()
        with scoped(worker, workspace) as cursor:
            indexing = queue.claim(cursor, workspace, WORKER, list(KINDS))

    assert auditing is not None
    assert auditing.kind == "nightly-audit"
    assert passed_over == [("queued", None, 0)]

    assert indexing is not None
    assert (indexing.kind, indexing.subject_id) == ("index", connected_source_id)


def test_a_claimed_job_carries_its_reason_and_subject_id(
    database: psycopg.Connection,
) -> None:
    workspace, connected_source_id = an_index_job_older_than_an_audit(database)

    with queue.connected(_CONNINFO[database]) as worker:
        with scoped(worker, workspace) as cursor:
            indexing = queue.claim(cursor, workspace, WORKER, ["index"])
        with scoped(worker, workspace) as cursor:
            auditing = queue.claim(cursor, workspace, WORKER, ["nightly-audit"])

    assert indexing is not None
    assert indexing.kind == "index"
    assert indexing.reason == "connected"
    assert indexing.subject_id == connected_source_id

    assert auditing is not None
    assert auditing.kind == "nightly-audit"
    assert auditing.subject_id is None


def an_exhausted_claim_and_a_newer_job(
    database: psycopg.Connection,
) -> tuple[str, Mapping[str, Any], Mapping[str, Any]]:
    workspace = str(seed_workspace(database.cursor())["id"])
    connected_source_id = ulid()
    with database.cursor() as cursor:
        exhausted_older = seed_job(
            cursor,
            workspace_id=workspace,
            kind="index",
            reason="connected",
            subject_id=connected_source_id,
            status="claimed",
            attempts=1,
            max_attempts=1,
            enqueued_ago_seconds=60,
            claimed_by="worker-gone-quiet",
            lease_expires_in_seconds=600,
        )
        newer = seed_job(
            cursor,
            workspace_id=workspace,
            kind="index",
            reason="wiped",
            subject_id=connected_source_id,
        )
    database.commit()
    return workspace, exhausted_older, newer


def expire_the_lease(database: psycopg.Connection, workspace: str, job_id: str) -> None:
    with scoped(database, workspace) as cursor:
        cursor.execute(
            "UPDATE job SET lease_expires_at = now() - interval '1 second'"
            " WHERE id = %s",
            (job_id,),
        )
        assert cursor.rowcount == 1


def test_a_held_expired_claim_blocks_newer_job_for_its_subject(
    database: psycopg.Connection,
) -> None:
    workspace, exhausted_older, newer = an_exhausted_claim_and_a_newer_job(database)

    dsn = _CONNINFO[database]
    with queue.connected(dsn) as holding, queue.connected(dsn) as claiming:
        with scoped(holding, workspace) as held:
            queue.hold_the_claim(held, exhausted_older["id"], "worker-gone-quiet")
            expire_the_lease(database, workspace, exhausted_older["id"])
            with scoped(claiming, workspace) as cursor:
                while_held = queue.claim(cursor, workspace, WORKER, ["index"])
        with scoped(claiming, workspace) as cursor:
            once_released = queue.claim(cursor, workspace, WORKER, ["index"])

    assert while_held is None
    assert once_released is not None
    assert once_released.id == newer["id"]
    with scoped(database, workspace) as cursor:
        cursor.execute("SELECT status FROM job WHERE id = %s", (exhausted_older["id"],))
        assert cursor.fetchone() == ("poisoned",)


def test_an_idle_held_claim_times_out_and_frees_newer_job(
    database: psycopg.Connection,
) -> None:
    workspace, exhausted_older, newer = an_exhausted_claim_and_a_newer_job(database)

    dsn = _CONNINFO[database]
    freed = None
    with (
        queue.connected(dsn, idle_in_transaction_seconds=1) as hung,
        queue.connected(dsn) as claiming,
        pytest.raises(psycopg.errors.IdleInTransactionSessionTimeout),
        scoped(hung, workspace) as held,
    ):
        queue.hold_the_claim(held, exhausted_older["id"], "worker-gone-quiet")
        expire_the_lease(database, workspace, exhausted_older["id"])
        deadline = time.monotonic() + 10
        while freed is None and time.monotonic() < deadline:
            with scoped(claiming, workspace) as cursor:
                freed = queue.claim(cursor, workspace, WORKER, ["index"])
            time.sleep(0.05)

    assert freed is not None, (
        "the newer job stayed unclaimable after the idle transaction timed out"
    )
    assert freed.id == newer["id"]


def test_worker_sessions_time_out_idle_transactions_after_one_hour(
    database: psycopg.Connection,
) -> None:
    with queue.connected(_CONNINFO[database]) as worker:
        shown = worker.execute("SHOW idle_in_transaction_session_timeout").fetchone()

    assert shown == ("1h",)


def test_the_loop_runs_a_nightly_audit_it_scheduled_itself(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    body = "Expenses are claimed within sixty days."
    with database.cursor() as cursor:
        content = seed_expenses(cursor, workspace, body)
    database.commit()
    write_bundle(tmp_path, workspace, {"knowledge/expenses.md": content})

    bootstrap = bootstrap_for(database, tmp_path)
    assert loop.tick(database, bootstrap) is False
    assert loop.tick(database, bootstrap) is True

    with database.cursor() as cursor:
        cursor.execute(
            "SELECT kind, status, claimed_by, attempts, outcome FROM job"
            " WHERE workspace_id = %s",
            (workspace,),
        )
        rows = cursor.fetchall()
    assert len(rows) == 1
    kind, status, claimed_by, attempts, outcome = rows[0]
    assert (kind, status, claimed_by, attempts) == ("nightly-audit", "done", WORKER, 1)
    assert outcome["checked"] == 1
    assert outcome["mismatched"] == []


def test_another_connection_sees_a_claimed_job_commit_and_finish(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    database.commit()
    bootstrap = bootstrap_for(database, tmp_path)

    with queue.connected(bootstrap.database_url) as worker:
        assert loop.tick(worker, bootstrap) is False
        assert loop.tick(worker, bootstrap) is True

        with database.cursor() as cursor:
            cursor.execute(
                "SELECT status, finished_at > claimed_at FROM job"
                " WHERE workspace_id = %s",
                (workspace,),
            )
            assert cursor.fetchall() == [("done", True)]


def test_other_connections_see_a_running_claim_and_its_lease_renewals(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_one_job(database, kind="full-rebuild", reason="drill")
    bootstrap = bootstrap_for(database, tmp_path)
    dsn = _CONNINFO[database]

    def row() -> tuple[Any, ...] | None:
        with scoped(database, workspace) as cursor:
            cursor.execute(
                "SELECT status, lease_expires_at, finished_at > claimed_at FROM job"
            )
            return cursor.fetchone()

    def until(seen: Callable[[tuple[Any, ...] | None], bool]) -> tuple[Any, ...] | None:
        for _ in range(200):
            read = row()
            if seen(read):
                return read
            time.sleep(0.05)
        return None

    passes: list[bool] = []
    with psycopg.connect(dsn) as blocker, queue.connected(dsn) as worker:
        blocker.execute("LOCK TABLE map_generation IN EXCLUSIVE MODE")
        pass_ = threading.Thread(
            target=lambda: passes.append(
                loop.tick(worker, bootstrap, heartbeat_every_seconds=0.05)
            )
        )
        pass_.start()
        try:
            claimed = until(lambda read: read is not None and read[0] == "claimed")
            assert claimed is not None, (
                "a second connection never saw the job as claimed"
            )
            moved = until(lambda read: read is not None and read[1] > claimed[1])
            assert moved is not None, "the heartbeat did not extend the lease"
            assert moved[0] == "claimed"
        finally:
            blocker.rollback()
            pass_.join(timeout=30)

    assert passes == [True]

    finished = row()
    assert finished is not None
    assert (finished[0], finished[2]) == ("done", True)


def test_failing_audit_stops_at_three_attempts_and_queues_no_other(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    database.commit()

    create_an_empty_repository(tmp_path, workspace)
    bootstrap = bootstrap_for(database, tmp_path)

    assert loop.tick(database, bootstrap) is False
    assert loop.tick(database, bootstrap) is True

    for _ in range(2):
        end_backoffs(database, workspace)
        assert loop.tick(database, bootstrap) is True

    assert loop.tick(database, bootstrap) is False

    with database.cursor() as cursor:
        cursor.execute(
            "SELECT status, attempts FROM job"
            " WHERE workspace_id = %s ORDER BY enqueued_at",
            (workspace,),
        )
        assert cursor.fetchall() == [("failed", 3)], (
            "the audit did not reach failed status after three attempts"
        )


def test_a_failed_job_is_not_claimable_until_its_backoff_passes(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_one_job(database, kind="nightly-audit")
    create_an_empty_repository(tmp_path, workspace)
    bootstrap = bootstrap_for(database, tmp_path)

    assert loop.tick(database, bootstrap) is True
    assert loop.tick(database, bootstrap) is False, (
        "the failed job was claimed again before its backoff ended"
    )

    end_backoffs(database, workspace)
    assert loop.tick(database, bootstrap) is True, (
        "the job was not claimable after its backoff ended"
    )


def test_a_job_failing_twice_then_succeeding_is_not_poisoned(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    with database.cursor() as cursor:
        content = seed_expenses(cursor, workspace)
    database.commit()
    with scoped(database, workspace) as cursor:
        seed_job(cursor, workspace_id=workspace, kind="nightly-audit")
    create_an_empty_repository(tmp_path, workspace)
    bootstrap = bootstrap_for(database, tmp_path)

    for _ in range(2):
        assert loop.tick(database, bootstrap) is True
        end_backoffs(database, workspace)
    (tmp_path / f"{workspace}.git").rmdir()
    write_bundle(tmp_path, workspace, {"knowledge/expenses.md": content})
    assert loop.tick(database, bootstrap) is True

    with database.cursor() as cursor:
        cursor.execute(
            "SELECT status, attempts FROM job WHERE workspace_id = %s", (workspace,)
        )
        assert cursor.fetchall() == [("done", 3)]


def test_two_workers_cannot_claim_two_jobs_for_the_same_subject(
    database: psycopg.Connection,
) -> None:
    workspace = str(seed_workspace(database.cursor())["id"])
    database.commit()
    subject = ulid()
    with scoped(database, workspace) as cursor:
        retry = seed_job(
            cursor,
            workspace_id=workspace,
            kind="index",
            reason="wiped",
            subject_id=subject,
            attempts=1,
            enqueued_ago_seconds=10,
            backoff_ends_in_seconds=-1,
        )
        seed_job(
            cursor,
            workspace_id=workspace,
            kind="index",
            reason="connected",
            subject_id=subject,
        )

    with (
        queue.connected(_CONNINFO[database]) as first,
        queue.connected(_CONNINFO[database]) as second,
        scoped(first, workspace) as claiming,
    ):
        taken = queue.claim(claiming, workspace, "first", ["index"])
        with scoped(second, workspace) as racing:
            raced = queue.claim(racing, workspace, "second", ["index"])

    assert taken is not None
    assert (taken.id, raced) == (retry["id"], None)


def test_failed_job_requeues_beside_a_queued_job_for_its_subject(
    database: psycopg.Connection,
) -> None:
    workspace = str(seed_workspace(database.cursor())["id"])
    database.commit()
    subject = ulid()
    with scoped(database, workspace) as cursor:
        failing = seed_job(
            cursor,
            workspace_id=workspace,
            kind="index",
            reason="connected",
            subject_id=subject,
            status="claimed",
            attempts=1,
            claimed_by=WORKER,
            lease_expires_in_seconds=60,
            enqueued_ago_seconds=10,
        )
        seed_job(
            cursor,
            workspace_id=workspace,
            kind="index",
            reason="connected",
            subject_id=subject,
        )

    with scoped(database, workspace) as cursor:
        assert queue.fail(cursor, failing["id"], WORKER, {"error": "TimeoutError"})
        cursor.execute("SELECT status, attempts FROM job ORDER BY enqueued_at")
        assert cursor.fetchall() == [("queued", 1), ("queued", 0)]


def test_concepts_at_head_rejects_malformed_workspace_ids_and_symlinks(
    tmp_path: Path,
) -> None:

    workspace = ulid()
    (tmp_path / "store").mkdir()

    assert repository_path(str(tmp_path / "store"), workspace) == (
        (tmp_path / "store" / f"{workspace}.git").resolve()
    )
    for escape in ("../escape", "..", f"{workspace}/../..", "", workspace.lower()):
        with pytest.raises(NotAWorkspaceIdError):
            concepts_at_head(str(tmp_path / "store"), escape)

    elsewhere = tmp_path / "elsewhere.git"
    elsewhere.mkdir()
    (tmp_path / "store" / f"{workspace}.git").symlink_to(elsewhere)
    with pytest.raises(NotAWorkspaceIdError):
        concepts_at_head(str(tmp_path / "store"), workspace)


def a_workspace_live_at_generation_one(
    database: psycopg.Connection,
) -> tuple[str, str]:
    workspace = seed_workspace(database.cursor())["id"]
    with database.cursor() as cursor:
        expenses = seed_expenses(cursor, workspace)
        seed_map_generation(cursor, workspace_id=workspace)
    database.commit()
    return str(workspace), expenses


def test_a_rebuild_locks_the_generation_row_before_reading_concepts(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace, expenses = a_workspace_live_at_generation_one(database)
    dsn = _CONNINFO[database]

    outcomes: list[Any] = []
    with psycopg.connect(dsn) as writer, queue.connected(dsn) as worker:
        with writer.cursor() as cursor:
            receipts = seed_concept(
                cursor,
                workspace_id=workspace,
                iri=OTHER_IRI,
                path="knowledge/receipts.md",
                frontmatter={"title": "Receipts", "type": "Evidence", "iri": OTHER_IRI},
                body="Receipts are kept for six years.",
                kind="Evidence",
            )
            hold_map_generation(cursor, workspace_id=workspace)
        write_bundle(
            tmp_path,
            workspace,
            {"knowledge/expenses.md": expenses, "knowledge/receipts.md": receipts},
        )

        def rebuild() -> None:
            with scoped(worker, workspace) as cursor:
                outcomes.append(run_rebuild(cursor, str(tmp_path), workspace))

        rebuilding = threading.Thread(target=rebuild)
        rebuilding.start()
        try:
            waiting = None
            for _ in range(200):
                with database.cursor() as cursor:
                    cursor.execute(
                        "SELECT 1 FROM pg_stat_activity"
                        " WHERE datname = current_database()"
                        " AND wait_event_type = 'Lock'"
                    )
                    waiting = cursor.fetchone()
                if waiting is not None:
                    break
                time.sleep(0.05)
            assert waiting is not None, (
                "the rebuild never waited for the lock on the map_generation row"
            )
        finally:
            writer.commit()
            rebuilding.join(timeout=30)

    assert len(outcomes) == 1
    outcome = outcomes[0]

    assert (outcome.generation, outcome.nodes, outcome.missing_row) == (2, 2, [])
    with database.cursor() as cursor:
        cursor.execute(
            "SELECT uid FROM map_node WHERE workspace_id = %s AND gen = 2 ORDER BY uid",
            (workspace,),
        )
        assert cursor.fetchall() == [(IRI,), (OTHER_IRI,)]


def test_the_audit_returns_a_hash_mismatch_instead_of_raising(
    database: psycopg.Connection, tmp_path: Path
) -> None:

    workspace = seed_workspace(database.cursor())["id"]
    with database.cursor() as cursor:
        content = seed_expenses(cursor, workspace)

        cursor.execute(
            "UPDATE concept_index SET content_hash = %s WHERE workspace_id = %s",
            ("f" * 64, workspace),
        )
    database.commit()
    write_bundle(tmp_path, workspace, {"knowledge/expenses.md": content})

    with scoped(database, workspace) as cursor:
        outcome = run_audit(cursor, str(tmp_path), workspace)

    assert outcome.checked == 1
    assert [found["path"] for found in outcome.mismatched] == ["knowledge/expenses.md"]
    assert outcome.mismatched[0]["expected"] == "f" * 64
    assert outcome.unparsed == []


def test_the_audit_reports_files_without_rows_and_rows_without_files(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    with database.cursor() as cursor:
        seed_concept(
            cursor,
            workspace_id=workspace,
            iri=IRI,
            path="knowledge/gone.md",
            frontmatter={"title": "Gone", "type": "Policy", "iri": IRI},
            body="A concept whose file is not in the bundle.",
        )
    database.commit()
    write_bundle(tmp_path, workspace, {"knowledge/strange.md": "not a concept file\n"})

    with scoped(database, workspace) as cursor:
        outcome = run_audit(cursor, str(tmp_path), workspace)

    assert outcome.checked == 0

    assert outcome.unparsed == []
    assert outcome.missing_row == ["knowledge/strange.md"]
    assert outcome.missing_file == ["knowledge/gone.md"]


def test_the_audit_reports_an_unparseable_file_with_an_index_row(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    with database.cursor() as cursor:
        seed_expenses(cursor, workspace)
    database.commit()
    write_bundle(tmp_path, workspace, {"knowledge/expenses.md": "not a concept file\n"})

    with scoped(database, workspace) as cursor:
        outcome = run_audit(cursor, str(tmp_path), workspace)

    assert (outcome.checked, outcome.unparsed) == (0, ["knowledge/expenses.md"])


def test_a_rebuild_writes_the_next_generation_then_makes_it_live(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    with database.cursor() as cursor:
        expenses = seed_expenses(
            cursor,
            workspace,
            f"## Details\n\nExpenses rest on [receipts]({OTHER_IRI}).",
        )
        receipts = seed_concept(
            cursor,
            workspace_id=workspace,
            iri=OTHER_IRI,
            path="knowledge/receipts.md",
            frontmatter={"title": "Receipts", "type": "Evidence", "iri": OTHER_IRI},
            body="Receipts are kept for six years.",
            kind="Evidence",
        )

        seed_map_generation(cursor, workspace_id=workspace)
    database.commit()
    write_bundle(
        tmp_path,
        workspace,
        {"knowledge/expenses.md": expenses, "knowledge/receipts.md": receipts},
    )

    with scoped(database, workspace) as cursor:
        outcome = run_rebuild(cursor, str(tmp_path), workspace)

    assert (outcome.generation, outcome.nodes, outcome.edges) == (2, 2, 1)
    with database.cursor() as cursor:
        cursor.execute(
            "SELECT live_gen FROM map_generation WHERE workspace_id = %s",
            (workspace,),
        )
        assert cursor.fetchone() == (2,)
        cursor.execute(
            "SELECT gen, label, from_uid, to_uid, from_kind, to_kind, section, sentence"
            " FROM map_edge WHERE workspace_id = %s",
            (workspace,),
        )
        assert cursor.fetchall() == [
            (
                2,
                "LINKS_TO",
                IRI,
                OTHER_IRI,
                "Policy",
                "Evidence",
                "Details",
                "Expenses rest on receipts.",
            ),
        ]


def test_a_rebuild_does_not_delete_the_previous_generation(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace, expenses = a_workspace_live_at_generation_one(database)
    with database.cursor() as cursor:
        seed_map_node(cursor, workspace_id=workspace, gen=1, uid=IRI)
    database.commit()
    write_bundle(tmp_path, workspace, {"knowledge/expenses.md": expenses})

    with scoped(database, workspace) as cursor:
        run_rebuild(cursor, str(tmp_path), workspace)

    with database.cursor() as cursor:
        cursor.execute(
            "SELECT gen FROM map_node WHERE workspace_id = %s ORDER BY gen",
            (workspace,),
        )
        assert cursor.fetchall() == [(1,), (2,)]


def planners_row_estimates(database: psycopg.Connection) -> dict[str, int]:
    with database.cursor() as cursor:
        cursor.execute(
            "SELECT relname, reltuples::int FROM pg_class"
            " WHERE relnamespace = 'public'::regnamespace"
            " AND relname IN ('map_node', 'map_edge')"
        )
        return {str(row[0]): int(row[1]) for row in cursor.fetchall()}


def a_rebuild_queued_on_an_unanalysed_map(
    database: psycopg.Connection, tmp_path: Path
) -> str:
    workspace, expenses = a_workspace_live_at_generation_one(database)
    with database.cursor() as cursor:
        cursor.execute("ALTER TABLE map_node SET (autovacuum_enabled = false)")
        cursor.execute("ALTER TABLE map_edge SET (autovacuum_enabled = false)")
    database.commit()
    with scoped(database, workspace) as cursor:
        seed_job(cursor, workspace_id=workspace, kind="full-rebuild", reason="drill")
    write_bundle(tmp_path, workspace, {"knowledge/expenses.md": expenses})
    assert planners_row_estimates(database) == {"map_node": -1, "map_edge": -1}
    return workspace


def rebuild_job_and_live_gen(
    database: psycopg.Connection, workspace: str
) -> tuple[Any, ...]:
    with database.cursor() as cursor:
        cursor.execute(
            "SELECT j.status, g.live_gen FROM job j"
            " JOIN map_generation g USING (workspace_id)"
            " WHERE j.workspace_id = %s AND j.kind = 'full-rebuild'",
            (workspace,),
        )
        row = cursor.fetchone()
    assert row is not None
    return tuple(row)


def test_a_rebuild_analyses_the_map_for_the_planner(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_rebuild_queued_on_an_unanalysed_map(database, tmp_path)
    bootstrap = bootstrap_for(database, tmp_path)

    with queue.connected(bootstrap.database_url) as worker:
        assert loop.tick(worker, bootstrap) is True

    assert rebuild_job_and_live_gen(database, workspace) == ("done", 2)
    assert planners_row_estimates(database) == {"map_node": 1, "map_edge": 0}


def make_analyse_map_time_out_on_locks(database: psycopg.Connection) -> None:
    database.execute("ALTER FUNCTION analyse_map() SET lock_timeout = '100ms'")
    database.commit()


def test_a_rebuild_whose_analyse_fails_still_goes_live(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_rebuild_queued_on_an_unanalysed_map(database, tmp_path)
    make_analyse_map_time_out_on_locks(database)
    bootstrap = bootstrap_for(database, tmp_path)

    with (
        psycopg.connect(_CONNINFO[database]) as holder,
        queue.connected(bootstrap.database_url) as worker,
        capture_logs() as written,
    ):
        holder.execute("LOCK TABLE map_node IN SHARE UPDATE EXCLUSIVE MODE")
        assert loop.tick(worker, bootstrap) is True

    assert rebuild_job_and_live_gen(database, workspace) == ("done", 2)
    assert planners_row_estimates(database) == {"map_node": -1, "map_edge": -1}
    assert [
        (line["event"], line["sqlstate"])
        for line in written
        if line["log_level"] == "warning"
    ] == [("analysing the map failed", "55P03")]


def a_workspace_with_a_queued_audit(
    database: psycopg.Connection, tmp_path: Path
) -> str:
    workspace = seed_workspace(database.cursor())["id"]
    with database.cursor() as cursor:
        content = seed_expenses(cursor, workspace)
    database.commit()
    write_bundle(tmp_path, workspace, {"knowledge/expenses.md": content})
    with scoped(database, workspace) as cursor:
        seed_job(cursor, workspace_id=workspace, kind="nightly-audit")
    return str(workspace)


def audit_job(database: psycopg.Connection, workspace: str) -> tuple[Any, ...]:
    with database.cursor() as cursor:
        cursor.execute(
            "SELECT status, claimed_by FROM job WHERE workspace_id = %s", (workspace,)
        )
        return cursor.fetchall()[0]


def error_lines_in(
    written: Sequence[Mapping[str, Any]],
) -> list[tuple[str, str, str]]:
    return [
        (line["event"], line["schema_stamp"], line["contract_stamp"])
        for line in written
        if line["log_level"] == "error"
    ]


STAMP_MISMATCH_EVENT = "deploy stamp differs from this worker's, so it claims no jobs"


def test_a_mismatched_schema_stamp_claims_nothing_and_exits_one(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_a_queued_audit(database, tmp_path)
    with database.cursor() as cursor:
        stamp_contract_as_migrate_does(cursor, digest=CONTRACT_DIGEST)
        stamp_migration(
            cursor,
            digest="a-migration-this-worker-has-never-seen",
            when=MIGRATION_WHEN + 1,
        )
    database.commit()

    with capture_logs() as written:
        assert loop.run(bootstrap_for(database, tmp_path), once=True) == 1

    assert error_lines_in(written) == [(STAMP_MISMATCH_EVENT, "differs", "matches")]
    assert audit_job(database, workspace) == ("queued", None)


def test_a_mismatched_contract_digest_claims_nothing_and_exits_one(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_a_queued_audit(database, tmp_path)
    with database.cursor() as cursor:
        stamp_contract_as_migrate_does(cursor, digest="a" * 64)
    database.commit()

    with capture_logs() as written:
        assert loop.run(bootstrap_for(database, tmp_path), once=True) == 1

    assert error_lines_in(written) == [(STAMP_MISMATCH_EVENT, "matches", "differs")]
    assert audit_job(database, workspace) == ("queued", None)


def test_a_worker_with_matching_stamps_runs_the_queued_job(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_a_queued_audit(database, tmp_path)
    with database.cursor() as cursor:
        stamp_contract_as_migrate_does(cursor, digest=CONTRACT_DIGEST)
    database.commit()

    with capture_logs() as written:
        assert loop.run(bootstrap_for(database, tmp_path), once=True) == 0

    assert error_lines_in(written) == []
    assert audit_job(database, workspace) == ("done", WORKER)


TICK_MODE_WORKER_SOURCE = """
import sys
from better_answers_worker import loop

sys.exit(loop.main())
"""

TICK_TIMEOUT_SECONDS = 60


@contextlib.contextmanager
def a_tick_mode_worker(
    database: psycopg.Connection, tmp_path: Path
) -> Iterator[subprocess.Popen[str]]:
    with (
        (tmp_path / "stderr.txt").open("w") as stderr,
        subprocess.Popen(
            [sys.executable, "-c", TICK_MODE_WORKER_SOURCE, "--ticks"],
            env=worker_environment(bootstrap_for(database, tmp_path)),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=stderr,
            text=True,
        ) as worker,
    ):
        try:
            yield worker
        finally:
            worker.kill()


def send_a_tick_and_read_the_result(worker: subprocess.Popen[str]) -> dict[str, Any]:
    assert worker.stdin is not None and worker.stdout is not None
    worker.stdin.write("tick\n")
    worker.stdin.flush()
    watchdog = threading.Timer(TICK_TIMEOUT_SECONDS, worker.kill)
    watchdog.start()
    try:
        for line in worker.stdout:
            said = json.loads(line) if line.startswith("{") else {}
            if said.get("event") == "tick done":
                return dict(said)
    finally:
        watchdog.cancel()
    raise AssertionError("the worker exited before it logged the end of the tick")


def test_tick_mode_logs_each_tick_and_exits_when_stdin_closes(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_a_queued_audit(database, tmp_path)
    with database.cursor() as cursor:
        stamp_contract_as_migrate_does(cursor, digest=CONTRACT_DIGEST)
    database.commit()

    with a_tick_mode_worker(database, tmp_path) as worker:
        first = send_a_tick_and_read_the_result(worker)
        second = send_a_tick_and_read_the_result(worker)
        assert worker.stdin is not None
        worker.stdin.close()
        exit_code = worker.wait(timeout=EXIT_AFTER_STOP_SECONDS)

    assert (first["worked"], second["worked"]) == (True, False)
    assert audit_job(database, workspace) == ("done", WORKER)
    assert exit_code == 0, (tmp_path / "stderr.txt").read_text()


def test_tick_mode_claims_nothing_until_the_stamps_match(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_a_queued_audit(database, tmp_path)
    stamp_contract_digest(database, "a" * 64)

    def two_ticks_with_a_deploy_between() -> Iterator[str]:
        yield "tick\n"
        assert audit_job(database, workspace) == ("queued", None)
        stamp_contract_digest(database, CONTRACT_DIGEST)
        yield "tick\n"

    with capture_logs() as written:
        loop.run_ticks(
            bootstrap_for(database, tmp_path), two_ticks_with_a_deploy_between()
        )

    tick_results = [
        (line["worked"], line["contract_stamp"])
        for line in written
        if line["event"] == "tick done"
    ]
    assert tick_results == [(False, loop.DIFFERS), (True, loop.MATCHES)]
    assert audit_job(database, workspace) == ("done", WORKER)


def stamp_contract_digest(database: psycopg.Connection, digest: str) -> None:
    with database.cursor() as cursor:
        stamp_contract_as_migrate_does(cursor, digest=digest)
    database.commit()


DAEMON_TIMEOUT_SECONDS = 30


class SteppedSleep:
    def __init__(self) -> None:
        self._changed = threading.Condition()
        self._elapsed = 0.0
        self._slept: list[float] = []

    def __call__(self, seconds: float) -> None:
        with self._changed:
            wakes_at = self._elapsed + seconds
            self._slept.append(seconds)
            self._changed.notify_all()
            self._changed.wait_for(
                lambda: self._elapsed >= wakes_at, timeout=DAEMON_TIMEOUT_SECONDS
            )

    def step(self, seconds: float) -> None:
        with self._changed:
            self._elapsed += seconds
            self._changed.notify_all()

    def slept(self, times: int) -> list[float]:
        with self._changed:
            assert self._changed.wait_for(
                lambda: len(self._slept) >= times,
                timeout=DAEMON_TIMEOUT_SECONDS,
            ), f"the daemon called sleep fewer than {times} times"
            return list(self._slept)


def a_daemon(bootstrap: Bootstrap, sleep: SteppedSleep) -> threading.Thread:
    def serve() -> None:
        with contextlib.suppress(psycopg.OperationalError):
            loop.run(bootstrap, once=False, sleep=sleep)

    return threading.Thread(target=serve, daemon=True)


def stop(
    daemon: threading.Thread, sleep: SteppedSleep, database: psycopg.Connection
) -> None:
    with database.cursor() as cursor:
        cursor.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity"
            " WHERE datname = current_database() AND pid <> pg_backend_pid()"
        )
    database.commit()
    sleep.step(loop.IDLE_SLEEP_SECONDS)
    daemon.join(timeout=DAEMON_TIMEOUT_SECONDS)
    assert not daemon.is_alive(), "the daemon thread was still running after the test"


def test_the_refusal_logs_once_and_lifts_when_the_deploy_finishes(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_a_queued_audit(database, tmp_path)
    with database.cursor() as cursor:
        stamp_contract_as_migrate_does(cursor, digest="b" * 64)
    database.commit()
    sleep = SteppedSleep()

    with capture_logs() as written:
        running = a_daemon(bootstrap_for(database, tmp_path), sleep)
        running.start()
        sleep.slept(1)
        assert audit_job(database, workspace) == ("queued", None)
        sleep.step(loop.IDLE_SLEEP_SECONDS)
        sleep.slept(2)
        with (
            psycopg.connect(_CONNINFO[database], autocommit=True) as deploying,
            deploying.cursor() as cursor,
        ):
            stamp_contract_as_migrate_does(cursor, digest=CONTRACT_DIGEST)
        sleep.step(loop.IDLE_SLEEP_SECONDS)
        slept = sleep.slept(3)
        done = audit_job(database, workspace)
    stop(running, sleep, database)

    assert done == ("done", WORKER)
    assert error_lines_in(written) == [(STAMP_MISMATCH_EVENT, "matches", "differs")]
    assert slept == [loop.IDLE_SLEEP_SECONDS] * 3


def test_health_fails_on_a_waiting_job_or_an_expired_lease(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    database.commit()

    assert health.is_healthy(database, WORKER) is True

    with scoped(database, workspace) as cursor:
        seed_job(
            cursor,
            workspace_id=workspace,
            kind="nightly-audit",
            enqueued_ago_seconds=300,
        )

    assert health.is_healthy(database, WORKER) is False

    with scoped(database, workspace) as cursor:
        cursor.execute(
            "SELECT id FROM claim_job(%s, interval '60 seconds', %s)",
            (WORKER, list(KINDS)),
        )
        assert cursor.fetchone() is not None

    assert health.is_healthy(database, WORKER) is True

    with scoped(database, workspace) as cursor:
        cursor.execute("UPDATE job SET heartbeat_at = now() - interval '5 minutes'")

    assert health.is_healthy(database, WORKER) is True

    with scoped(database, workspace) as cursor:
        cursor.execute("UPDATE job SET lease_expires_at = now() - interval '1 minute'")

    assert health.is_healthy(database, WORKER) is False


def test_a_job_in_backoff_does_not_fail_the_health_check(
    database: psycopg.Connection,
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    database.commit()
    with scoped(database, workspace) as cursor:
        seed_job(
            cursor,
            workspace_id=workspace,
            attempts=1,
            enqueued_ago_seconds=300,
            backoff_ends_in_seconds=60,
        )

    assert health.is_healthy(database, WORKER) is True

    with scoped(database, workspace) as cursor:
        cursor.execute("UPDATE job SET backoff_ends_at = now() - interval '5 minutes'")

    assert health.is_healthy(database, WORKER) is False


def test_the_worker_role_counts_a_waiting_job_as_unhealthy(
    database: psycopg.Connection,
) -> None:
    worker_dsn = worker_login_dsn(database, _CONNINFO[database])
    workspace = seed_workspace(database.cursor())["id"]
    database.commit()
    with scoped(database, workspace) as cursor:
        seed_job(
            cursor,
            workspace_id=workspace,
            kind="nightly-audit",
            enqueued_ago_seconds=300,
        )

    with queue.connected(worker_dsn) as worker:
        assert health.is_healthy(worker, WORKER) is False


def a_claimed_audit(database: psycopg.Connection) -> tuple[str, queue.ClaimedJob]:
    workspace = a_workspace_with_one_job(database, kind="nightly-audit")
    with scoped(database, workspace) as cursor:
        claimed = queue.claim(cursor, workspace, WORKER, list(KINDS))
    assert claimed is not None
    return workspace, claimed


def test_the_heartbeat_renews_the_lease_on_its_own_connection(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace, claimed = a_claimed_audit(database)

    dsn = _CONNINFO[database]
    with psycopg.connect(dsn) as onlooker:
        with scoped(onlooker, workspace) as cursor:
            cursor.execute("SELECT heartbeat_at, lease_expires_at FROM job")
            before = cursor.fetchone()
        assert before is not None

        with (
            queue.keeping_alive(dsn, claimed, WORKER, every_seconds=0.05),
            scoped(database, workspace) as job_cursor,
        ):
            job_cursor.execute("SELECT 1 FROM concept_index")
            after = None
            for _ in range(200):
                time.sleep(0.05)
                with scoped(onlooker, workspace) as cursor:
                    cursor.execute("SELECT heartbeat_at, lease_expires_at FROM job")
                    read = cursor.fetchone()
                if read is not None and read[0] > before[0]:
                    after = read
                    break

    assert after is not None, "another connection never saw a newer heartbeat_at"
    assert after[1] > before[1], "the heartbeat did not extend the lease"


def _wait_for[T](seconds: float, read: Callable[[], T]) -> T | None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        found = read()
        if found:
            return found
        time.sleep(0.05)
    return None


def _heartbeat_sessions(
    onlooker: psycopg.Connection, database: psycopg.Connection
) -> list[int]:
    rows = onlooker.execute(
        "SELECT pid FROM pg_stat_activity WHERE datname = current_database()"
        " AND backend_type = 'client backend' AND NOT pid = ANY(%s)",
        ([onlooker.info.backend_pid, database.info.backend_pid],),
    ).fetchall()
    return [int(row[0]) for row in rows]


def _lease_of(onlooker: psycopg.Connection, workspace: str) -> tuple[Any, bool]:
    with scoped(onlooker, workspace) as cursor:
        cursor.execute("SELECT heartbeat_at, lease_expires_at > now() FROM job")
        row = cursor.fetchone()
    assert row is not None
    return row[0], bool(row[1])


@dataclass(frozen=True, slots=True)
class RunningHeartbeat:
    workspace: str
    job: queue.ClaimedJob
    onlooker: psycopg.Connection
    written: list[MutableMapping[str, Any]]
    session: int


@contextlib.contextmanager
def a_running_heartbeat(database: psycopg.Connection) -> Iterator[RunningHeartbeat]:
    workspace, claimed = a_claimed_audit(database)
    dsn = _CONNINFO[database]
    with (
        capture_logs() as written,
        queue.connected(dsn) as onlooker,
        queue.keeping_alive(dsn, claimed, WORKER, every_seconds=0.05),
    ):
        sessions = _wait_for(10, lambda: _heartbeat_sessions(onlooker, database))
        assert sessions, "the heartbeat never opened a database session"
        yield RunningHeartbeat(workspace, claimed, onlooker, written, sessions[0])


def test_the_heartbeat_reconnects_after_its_connection_is_dropped(
    database: psycopg.Connection,
) -> None:
    with a_running_heartbeat(database) as heartbeat:
        onlooker = heartbeat.onlooker
        onlooker.execute("SELECT pg_terminate_backend(%s)", (heartbeat.session,))
        assert _wait_for(
            10,
            lambda: heartbeat.session not in _heartbeat_sessions(onlooker, database),
        ), "the terminated heartbeat session was still connected"
        dropped_at, _ = _lease_of(onlooker, heartbeat.workspace)
        renewed = _wait_for(
            10, lambda: _lease_of(onlooker, heartbeat.workspace)[0] > dropped_at
        )
        _, live = _lease_of(onlooker, heartbeat.workspace)

    assert renewed, "the heartbeat stopped after its connection was dropped"
    assert live, "the lease expired"
    assert {
        line["job_id"]
        for line in heartbeat.written
        if line["event"] == "a heartbeat failed" and line["error"]
    } == {heartbeat.job.id}


def test_the_heartbeat_logs_a_lost_claim_and_stops(
    database: psycopg.Connection,
) -> None:
    with a_running_heartbeat(database) as heartbeat:
        with scoped(heartbeat.onlooker, heartbeat.workspace) as cursor:
            cursor.execute("UPDATE job SET claimed_by = 'another-worker'")
        stopped = _wait_for(
            10, lambda: not _heartbeat_sessions(heartbeat.onlooker, database)
        )

    assert stopped, "the heartbeat kept its session open after losing the claim"
    assert [
        line["job_id"]
        for line in heartbeat.written
        if line["event"] == "job claim lost"
    ] == [heartbeat.job.id]


def test_a_blocked_heartbeat_statement_is_cancelled_at_its_timeout(
    database: psycopg.Connection,
) -> None:
    workspace, claimed = a_claimed_audit(database)

    dsn = _CONNINFO[database]
    with (
        capture_logs() as written,
        queue.connected(dsn) as locking,
        queue.connected(dsn) as onlooker,
        queue.keeping_alive(
            dsn, claimed, WORKER, every_seconds=0.05, statement_seconds=0.5
        ),
    ):
        with scoped(locking, workspace) as cursor:
            cursor.execute("SELECT 1 FROM job WHERE id = %s FOR UPDATE", (claimed.id,))
            cancelled = _wait_for(
                10,
                lambda: [
                    line
                    for line in written
                    if line["event"] == "a heartbeat failed"
                    and line["error"] == "QueryCanceled"
                ],
            )
        cancelled_at, _ = _lease_of(onlooker, workspace)
        renewed = _wait_for(
            10, lambda: _lease_of(onlooker, workspace)[0] > cancelled_at
        )

    assert cancelled, "the blocked heartbeat statement was never cancelled"
    assert renewed, "the heartbeat stopped after its statement was cancelled"


ONE_TICK_WORKER_SOURCE = """
import sys
from better_answers_worker import loop, queue
from better_answers_worker.config import read_bootstrap

bootstrap = read_bootstrap()
with queue.connected(bootstrap.database_url) as connection:
    loop.tick(
        connection,
        bootstrap,
        heartbeat_every_seconds=0.05,
        deadline_seconds=float(sys.argv[1]),
    )
"""


def worker_environment(bootstrap: Bootstrap) -> dict[str, str]:
    store = bootstrap.object_store
    return {
        "DATABASE_URL": bootstrap.database_url,
        "GIT_STORE_DIR": bootstrap.git_store_dir,
        "LMDB_DIR": bootstrap.engine.lmdb_dir,
        "WORKER_ID": bootstrap.worker_id,
        "S3_ENDPOINT": store.endpoint,
        "S3_ACCESS_KEY": store.access_key,
        "S3_SECRET_KEY": store.secret_key,
        "S3_BUCKET": store.bucket,
        "S3_REGION": store.region,
    }


def run_a_worker_blocked_on_its_audit(
    database: psycopg.Connection,
    tmp_path: Path,
    *,
    deadline_seconds: float = 0.3,
    while_blocked: Callable[[], object] = lambda: None,
) -> tuple[list[dict[str, Any]], str]:
    bootstrap = bootstrap_for(database, tmp_path)
    with queue.connected(bootstrap.database_url) as locking, locking.transaction():
        locking.execute("LOCK TABLE concept_index IN ACCESS EXCLUSIVE MODE")
        with subprocess.Popen(
            [sys.executable, "-c", ONE_TICK_WORKER_SOURCE, str(deadline_seconds)],
            env=worker_environment(bootstrap),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        ) as worker:
            try:
                while_blocked()
                stdout, stderr = worker.communicate(timeout=30)
            finally:
                worker.kill()
    assert worker.returncode == queue.OUTLIVED_ITS_DEADLINE, stderr
    return [json.loads(line) for line in stdout.splitlines()], stderr


HEARTBEAT_SLACK_SECONDS = (
    queue.HEARTBEAT_CONNECT_SECONDS + 2 * queue.HEARTBEAT_STATEMENT_SECONDS
)


def the_lease_expires(database: psycopg.Connection, workspace: str) -> bool:
    return bool(
        _wait_for(
            HEARTBEAT_SLACK_SECONDS, lambda: not _lease_of(database, workspace)[1]
        )
    )


def test_a_job_past_its_deadline_ends_the_worker_process(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_one_job(database, kind="nightly-audit")

    written, stderr = run_a_worker_blocked_on_its_audit(database, tmp_path)

    assert the_lease_expires(database, workspace), (
        "the lease did not expire after the worker process ended"
    )
    with scoped(database, workspace) as cursor:
        reclaimed = queue.claim(cursor, workspace, WORKER, ["nightly-audit"])
    assert reclaimed is not None, (
        "the job was not claimable after the worker process ended"
    )
    assert reclaimed.attempts == 2
    events = [line["event"] for line in written]
    assert not {"job finished", "job failed", "job claim lost"} & set(events)
    assert (events[-1], written[-1]["job_id"]) == (
        "job ran past its deadline",
        reclaimed.id,
    )
    assert "in nightly_audit" in stderr, (
        "stderr did not show the stack frame in nightly_audit"
    )


def test_a_job_that_times_out_on_every_attempt_is_poisoned(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = str(seed_workspace(database.cursor())["id"])
    database.commit()
    with scoped(database, workspace) as cursor:
        job = seed_job(
            cursor, workspace_id=workspace, kind="nightly-audit", max_attempts=2
        )

    for _ in range(2):
        run_a_worker_blocked_on_its_audit(database, tmp_path)
        assert the_lease_expires(database, workspace), (
            "the lease did not expire after the worker process ended"
        )

    with scoped(database, workspace) as cursor:
        assert queue.claim(cursor, workspace, WORKER, ["nightly-audit"]) is None
        cursor.execute("SELECT status, attempts FROM job WHERE id = %s", (job["id"],))
        assert cursor.fetchone() == ("poisoned", 2)


def test_a_lost_claim_still_ends_the_worker_at_its_deadline(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_one_job(database, kind="nightly-audit")

    def take_the_claim() -> None:
        with queue.connected(_CONNINFO[database]) as taking:

            def taken() -> int:
                with scoped(taking, workspace) as cursor:
                    cursor.execute(
                        "UPDATE job SET claimed_by = 'another-worker'"
                        " WHERE claimed_by = %s",
                        (WORKER,),
                    )
                    return cursor.rowcount

            assert _wait_for(10, taken), "the worker never claimed its job"

    written, _ = run_a_worker_blocked_on_its_audit(
        database, tmp_path, deadline_seconds=1.0, while_blocked=take_the_claim
    )

    events = [line["event"] for line in written]
    assert events[-2:] == ["job claim lost", "job ran past its deadline"]


LOOPING_WORKER_SOURCE = """
import sys
from better_answers_worker import loop
from better_answers_worker.config import read_bootstrap

loop.STOP.install({finish_within_seconds})
sys.exit(loop.run(read_bootstrap(), once=False))
"""

WORKER_STARTS_WITHIN_SECONDS = 20

EXIT_AFTER_STOP_SECONDS = 5


@contextlib.contextmanager
def a_worker_process(
    database: psycopg.Connection, tmp_path: Path, *, finish_within_seconds: float
) -> Iterator[subprocess.Popen[str]]:
    """Starts the worker through the environment gate. The gate runs the loop from PATH
    without the detectors' warm-up, which can take minutes."""
    entries = tmp_path / "bin"
    entries.mkdir()
    entry = entries / "better-answers-worker"
    entry.write_text(
        f"#!{sys.executable}\n"
        + LOOPING_WORKER_SOURCE.format(finish_within_seconds=finish_within_seconds)
    )
    entry.chmod(0o755)
    with database.cursor() as cursor:
        stamp_contract_as_migrate_does(cursor, digest=CONTRACT_DIGEST)
    database.commit()
    with subprocess.Popen(
        [sys.executable, "-m", "better_answers_worker.environment_gate", "worker"],
        env={
            **worker_environment(bootstrap_for(database, tmp_path)),
            "PATH": str(entries),
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    ) as worker:
        try:
            yield worker
        finally:
            worker.kill()


def exit_within(
    worker: subprocess.Popen[str], seconds: float
) -> tuple[int | None, str]:
    try:
        _, stderr = worker.communicate(timeout=seconds)
    except subprocess.TimeoutExpired:
        return None, "the worker was still running"
    return worker.returncode, stderr


@contextlib.contextmanager
def concept_index_locked(database: psycopg.Connection) -> Iterator[psycopg.Connection]:
    with queue.connected(_CONNINFO[database]) as locking:
        locking.execute("BEGIN")
        locking.execute("LOCK TABLE concept_index IN ACCESS EXCLUSIVE MODE")
        yield locking


def claimed_by_the_worker(database: psycopg.Connection, workspace: str) -> bool:
    return bool(
        _wait_for(
            WORKER_STARTS_WITHIN_SECONDS,
            lambda: audit_job(database, workspace)[0] == "claimed",
        )
    )


def test_an_idle_worker_exits_cleanly_on_sigterm(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    with (
        a_worker_process(database, tmp_path, finish_within_seconds=10) as worker,
        queue.connected(_CONNINFO[database]) as onlooker,
    ):
        connected = _wait_for(
            WORKER_STARTS_WITHIN_SECONDS,
            lambda: _heartbeat_sessions(onlooker, database),
        )
        assert connected, "the worker never connected to the database"

        worker.send_signal(signal.SIGTERM)
        exit_code, stderr = exit_within(worker, EXIT_AFTER_STOP_SECONDS)

    assert exit_code == 0, stderr


def test_sigterm_during_a_job_requeues_it_without_using_an_attempt(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_one_job(database, kind="nightly-audit")

    with (
        concept_index_locked(database),
        a_worker_process(database, tmp_path, finish_within_seconds=0.5) as worker,
    ):
        assert claimed_by_the_worker(database, workspace), (
            "the worker never claimed the audit"
        )
        worker.send_signal(signal.SIGTERM)
        exit_code, stderr = exit_within(worker, EXIT_AFTER_STOP_SECONDS)

    assert exit_code == 0, stderr
    database.commit()
    with scoped(database, workspace) as cursor:
        reclaimed = queue.claim(cursor, workspace, WORKER, ["nightly-audit"])
    assert reclaimed is not None, "the requeued job was not claimable straight away"
    with database.cursor() as cursor:
        cursor.execute("SELECT max_attempts FROM job WHERE id = %s", (reclaimed.id,))
        bound = cursor.fetchone()
    assert bound is not None
    assert (reclaimed.attempts, bound[0]) == (2, 4), (
        "SIGTERM used up one of the job's attempts"
    )


def test_sigterm_lets_a_job_finish_within_the_grace_period(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_a_queued_audit(database, tmp_path)

    with (
        concept_index_locked(database) as locking,
        a_worker_process(database, tmp_path, finish_within_seconds=10) as worker,
    ):
        assert claimed_by_the_worker(database, workspace), (
            "the worker never claimed the audit"
        )
        worker.send_signal(signal.SIGTERM)
        locking.execute("COMMIT")
        exit_code, stderr = exit_within(worker, EXIT_AFTER_STOP_SECONDS)

    assert exit_code == 0, stderr
    assert audit_job(database, workspace) == ("done", WORKER)
