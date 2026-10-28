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
        _WHERE[connection] = conninfo
        yield connection


_WHERE: dict[psycopg.Connection, str] = {}


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
        database_url=_WHERE[database],
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


def an_empty_store_fails_the_audit(git_store: Path, workspace: str) -> None:
    (git_store / f"{workspace}.git").mkdir()


def end_backoffs(database: psycopg.Connection, workspace: str) -> None:
    with scoped(database, workspace) as cursor:
        cursor.execute(
            "UPDATE job SET backoff_ends_at = now() WHERE backoff_ends_at IS NOT NULL"
        )


def a_workspace_holding_one_job(
    database: psycopg.Connection, *, kind: str, reason: str | None = None
) -> str:
    workspace = seed_workspace(database.cursor())["id"]
    database.commit()
    with scoped(database, workspace) as cursor:
        seed_job(cursor, workspace_id=workspace, kind=kind, reason=reason)
    return str(workspace)


def test_runs_exactly_the_kinds_its_registry_has_handlers_for() -> None:
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


def test_a_claim_leaves_unnamed_kinds_queued_and_unpoisoned(
    database: psycopg.Connection,
) -> None:
    workspace, connected_source_id = an_index_job_older_than_an_audit(database)

    with queue.connected(_WHERE[database]) as worker:
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


def test_a_claim_hands_the_handler_what_the_job_is_about(
    database: psycopg.Connection,
) -> None:
    workspace, connected_source_id = an_index_job_older_than_an_audit(database)

    with queue.connected(_WHERE[database]) as worker:
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


def a_spent_claim_before_a_newer_job(
    database: psycopg.Connection,
) -> tuple[str, Mapping[str, Any], Mapping[str, Any]]:
    workspace = str(seed_workspace(database.cursor())["id"])
    connected_source_id = ulid()
    with database.cursor() as cursor:
        spent_older = seed_job(
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
    return workspace, spent_older, newer


def lapse(database: psycopg.Connection, workspace: str, job_id: str) -> None:
    with scoped(database, workspace) as cursor:
        cursor.execute(
            "UPDATE job SET lease_expires_at = now() - interval '1 second'"
            " WHERE id = %s",
            (job_id,),
        )
        assert cursor.rowcount == 1


def test_a_held_lapsed_claim_keeps_its_subjects_newer_job_back(
    database: psycopg.Connection,
) -> None:
    workspace, spent_older, newer = a_spent_claim_before_a_newer_job(database)

    dsn = _WHERE[database]
    with queue.connected(dsn) as holding, queue.connected(dsn) as claiming:
        with scoped(holding, workspace) as held:
            queue.hold_the_claim(held, spent_older["id"], "worker-gone-quiet")
            lapse(database, workspace, spent_older["id"])
            with scoped(claiming, workspace) as cursor:
                while_held = queue.claim(cursor, workspace, WORKER, ["index"])
        with scoped(claiming, workspace) as cursor:
            once_released = queue.claim(cursor, workspace, WORKER, ["index"])

    assert while_held is None
    assert once_released is not None
    assert once_released.id == newer["id"]
    with scoped(database, workspace) as cursor:
        cursor.execute("SELECT status FROM job WHERE id = %s", (spent_older["id"],))
        assert cursor.fetchone() == ("poisoned",)


def test_an_idle_fence_lets_its_subjects_newer_job_go(
    database: psycopg.Connection,
) -> None:
    workspace, spent_older, newer = a_spent_claim_before_a_newer_job(database)

    dsn = _WHERE[database]
    freed = None
    with (
        queue.connected(dsn, idle_in_transaction_seconds=1) as hung,
        queue.connected(dsn) as claiming,
        pytest.raises(psycopg.errors.IdleInTransactionSessionTimeout),
        scoped(hung, workspace) as held,
    ):
        queue.hold_the_claim(held, spent_older["id"], "worker-gone-quiet")
        lapse(database, workspace, spent_older["id"])
        deadline = time.monotonic() + 10
        while freed is None and time.monotonic() < deadline:
            with scoped(claiming, workspace) as cursor:
                freed = queue.claim(cursor, workspace, WORKER, ["index"])
            time.sleep(0.05)

    assert freed is not None, "the idle fence held the newer job back"
    assert freed.id == newer["id"]


def test_a_worker_session_ends_a_fence_idle_for_an_hour(
    database: psycopg.Connection,
) -> None:
    with queue.connected(_WHERE[database]) as worker:
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


def test_a_running_jobs_claim_is_visible_and_its_lease_moves(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_holding_one_job(
        database, kind="full-rebuild", reason="drill"
    )
    bootstrap = bootstrap_for(database, tmp_path)
    dsn = _WHERE[database]

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
            assert claimed is not None, "the claim never reached a second connection"
            moved = until(lambda read: read is not None and read[1] > claimed[1])
            assert moved is not None, "the heartbeat never moved the lease"
            assert moved[0] == "claimed"
        finally:
            blocker.rollback()
            pass_.join(timeout=30)

    assert passes == [True]

    finished = row()
    assert finished is not None
    assert (finished[0], finished[2]) == ("done", True)


def test_a_failed_audit_counts_so_idle_ticks_queue_no_other(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    database.commit()

    an_empty_store_fails_the_audit(tmp_path, workspace)
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
            "a failed audit runs to its bound of three"
        )


def test_a_failed_job_is_not_claimable_until_its_backoff_passes(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_holding_one_job(database, kind="nightly-audit")
    an_empty_store_fails_the_audit(tmp_path, workspace)
    bootstrap = bootstrap_for(database, tmp_path)

    assert loop.tick(database, bootstrap) is True
    assert loop.tick(database, bootstrap) is False, "the failed job was claimed at once"

    end_backoffs(database, workspace)
    assert loop.tick(database, bootstrap) is True, "the backoff never let the job go"


def test_a_job_failing_twice_then_succeeding_is_not_poisoned(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    with database.cursor() as cursor:
        content = seed_expenses(cursor, workspace)
    database.commit()
    with scoped(database, workspace) as cursor:
        seed_job(cursor, workspace_id=workspace, kind="nightly-audit")
    an_empty_store_fails_the_audit(tmp_path, workspace)
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


def test_two_claimants_never_run_one_subjects_two_queued_jobs(
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
        queue.connected(_WHERE[database]) as first,
        queue.connected(_WHERE[database]) as second,
        scoped(first, workspace) as claiming,
    ):
        taken = queue.claim(claiming, workspace, "first", ["index"])
        with scoped(second, workspace) as racing:
            raced = queue.claim(racing, workspace, "second", ["index"])

    assert taken is not None
    assert (taken.id, raced) == (retry["id"], None)


def test_a_failure_requeues_beside_a_fresh_job_for_its_subject(
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


def test_refuses_a_malformed_workspace_id_before_touching_the_store(
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


def test_a_rebuild_holds_the_generation_row_first_so_writes_land(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace, expenses = a_workspace_live_at_generation_one(database)
    dsn = _WHERE[database]

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
            assert waiting is not None, "the rebuild never waited on the generation row"
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


def test_the_audit_reports_a_mismatch_as_state_not_refusal(
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


def test_the_audit_counts_unparseable_files_and_rows_without_files(
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


def test_an_unparseable_file_with_an_index_row_lands_in_unparsed(
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


def test_a_rebuild_writes_the_next_generation_aside_then_flips_it(
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


def test_a_rebuild_leaves_the_prior_generation_for_the_apis_prune(
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


def test_a_rebuild_whose_analyse_fails_still_goes_live(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_rebuild_queued_on_an_unanalysed_map(database, tmp_path)
    bootstrap = bootstrap_for(database, tmp_path)

    with (
        psycopg.connect(_WHERE[database]) as holder,
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
    ] == [("the map was left unanalysed", "55P03")]


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


def refusals_in(
    written: Sequence[Mapping[str, Any]],
) -> list[tuple[str, str, str]]:
    return [
        (line["event"], line["schema_stamp"], line["contract_stamp"])
        for line in written
        if line["log_level"] == "error"
    ]


REFUSES = "a deploy stamp does not match; claiming nothing"

IDLE_SLEEPS_THE_DETECTORS_IMPORT_MAY_TAKE = 4
IDLE_SLEEPS_THE_LIFTED_AUDIT_MAY_TAKE = 4


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

    assert refusals_in(written) == [(REFUSES, "differs", "matches")]
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

    assert refusals_in(written) == [(REFUSES, "matches", "differs")]
    assert audit_job(database, workspace) == ("queued", None)


def test_a_worker_with_matching_stamps_runs_what_is_queued(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_a_queued_audit(database, tmp_path)
    with database.cursor() as cursor:
        stamp_contract_as_migrate_does(cursor, digest=CONTRACT_DIGEST)
    database.commit()

    with capture_logs() as written:
        assert loop.run(bootstrap_for(database, tmp_path), once=True) == 0

    assert refusals_in(written) == []
    assert audit_job(database, workspace) == ("done", WORKER)


A_TICKING_WORKER = """
import sys
from better_answers_worker import loop

sys.exit(loop.main())
"""

TICK_ANSWER_SECONDS = 60


@contextlib.contextmanager
def a_ticking_worker(
    database: psycopg.Connection, tmp_path: Path
) -> Iterator[subprocess.Popen[str]]:
    with (
        (tmp_path / "stderr.txt").open("w") as stderr,
        subprocess.Popen(
            [sys.executable, "-c", A_TICKING_WORKER, "--ticks"],
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


def its_answer_to_a_tick(worker: subprocess.Popen[str]) -> dict[str, Any]:
    assert worker.stdin is not None and worker.stdout is not None
    worker.stdin.write("tick\n")
    worker.stdin.flush()
    watchdog = threading.Timer(TICK_ANSWER_SECONDS, worker.kill)
    watchdog.start()
    try:
        for line in worker.stdout:
            said = json.loads(line) if line.startswith("{") else {}
            if said.get("event") == "tick done":
                return dict(said)
    finally:
        watchdog.cancel()
    raise AssertionError("the worker ended before it answered the tick")


def test_a_ticking_worker_answers_each_tick_then_exits(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_a_queued_audit(database, tmp_path)
    with database.cursor() as cursor:
        stamp_contract_as_migrate_does(cursor, digest=CONTRACT_DIGEST)
    database.commit()

    with a_ticking_worker(database, tmp_path) as worker:
        first = its_answer_to_a_tick(worker)
        second = its_answer_to_a_tick(worker)
        assert worker.stdin is not None
        worker.stdin.close()
        exit_code = worker.wait(timeout=EXIT_AFTER_STOP_SECONDS)

    assert (first["worked"], second["worked"]) == (True, False)
    assert audit_job(database, workspace) == ("done", WORKER)
    assert exit_code == 0, (tmp_path / "stderr.txt").read_text()


def test_a_ticking_worker_claims_nothing_until_its_stamps_match(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_a_queued_audit(database, tmp_path)
    stamped_as_deploy_leaves_it(database, "a" * 64)

    def ticks_across_the_deploy_finishing() -> Iterator[str]:
        yield "tick\n"
        assert audit_job(database, workspace) == ("queued", None)
        stamped_as_deploy_leaves_it(database, CONTRACT_DIGEST)
        yield "tick\n"

    with capture_logs() as written:
        loop.run_ticks(
            bootstrap_for(database, tmp_path), ticks_across_the_deploy_finishing()
        )

    answers = [
        (line["worked"], line["contract_stamp"])
        for line in written
        if line["event"] == "tick done"
    ]
    assert answers == [(False, loop.DIFFERS), (True, loop.MATCHES)]
    assert audit_job(database, workspace) == ("done", WORKER)


def stamped_as_deploy_leaves_it(database: psycopg.Connection, digest: str) -> None:
    with database.cursor() as cursor:
        stamp_contract_as_migrate_does(cursor, digest=digest)
    database.commit()


def a_daemon(bootstrap: Bootstrap) -> threading.Thread:
    def serve() -> None:
        with contextlib.suppress(psycopg.OperationalError):
            loop.run(bootstrap, once=False)

    return threading.Thread(target=serve, daemon=True)


def stop(daemon: threading.Thread, database: psycopg.Connection) -> None:
    with database.cursor() as cursor:
        cursor.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity"
            " WHERE datname = current_database() AND pid <> pg_backend_pid()"
        )
    database.commit()
    daemon.join(timeout=loop.IDLE_SLEEP_SECONDS * 2)
    assert not daemon.is_alive(), "the daemon outlived its test"


def test_the_refusal_logs_once_and_lifts_when_the_deploy_finishes(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_a_queued_audit(database, tmp_path)
    with database.cursor() as cursor:
        stamp_contract_as_migrate_does(cursor, digest="b" * 64)
    database.commit()

    with capture_logs() as written:
        running = a_daemon(bootstrap_for(database, tmp_path))
        running.start()
        refused_by = time.monotonic() + (
            loop.IDLE_SLEEP_SECONDS * IDLE_SLEEPS_THE_DETECTORS_IMPORT_MAY_TAKE
        )
        while not refusals_in(written) and time.monotonic() < refused_by:
            time.sleep(0.05)
        with (
            psycopg.connect(_WHERE[database], autocommit=True) as deploying,
            deploying.cursor() as cursor,
        ):
            stamp_contract_as_migrate_does(cursor, digest=CONTRACT_DIGEST)
        deadline = time.monotonic() + (
            loop.IDLE_SLEEP_SECONDS * IDLE_SLEEPS_THE_LIFTED_AUDIT_MAY_TAKE
        )
        while time.monotonic() < deadline:
            if audit_job(database, workspace)[0] == "done":
                break
            time.sleep(0.1)
    stop(running, database)

    assert audit_job(database, workspace) == ("done", WORKER)
    assert refusals_in(written) == [(REFUSES, "matches", "differs")]


def test_healthy_with_a_fresh_lease_unhealthy_with_a_waiting_queue(
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


def test_a_job_in_its_backoff_is_not_a_waiting_queue(
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
    worker_dsn = worker_login_dsn(database, _WHERE[database])
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
    workspace = a_workspace_holding_one_job(database, kind="nightly-audit")
    with scoped(database, workspace) as cursor:
        claimed = queue.claim(cursor, workspace, WORKER, list(KINDS))
    assert claimed is not None
    return workspace, claimed


def test_a_long_run_keeps_its_lease_on_its_own_connection(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace, claimed = a_claimed_audit(database)

    dsn = _WHERE[database]
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

    assert after is not None, "the heartbeat never reached a reader outside the job"
    assert after[1] > before[1], "and the lease moved with it"


def _within[T](seconds: float, read: Callable[[], T]) -> T | None:
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
class Beating:
    workspace: str
    job: queue.ClaimedJob
    onlooker: psycopg.Connection
    written: list[MutableMapping[str, Any]]
    session: int


@contextlib.contextmanager
def a_heartbeat_beating(database: psycopg.Connection) -> Iterator[Beating]:
    workspace, claimed = a_claimed_audit(database)
    dsn = _WHERE[database]
    with (
        capture_logs() as written,
        queue.connected(dsn) as onlooker,
        queue.keeping_alive(dsn, claimed, WORKER, every_seconds=0.05),
    ):
        sessions = _within(10, lambda: _heartbeat_sessions(onlooker, database))
        assert sessions, "the heartbeat never opened a session"
        yield Beating(workspace, claimed, onlooker, written, sessions[0])


def test_a_heartbeat_outlives_a_dropped_connection(
    database: psycopg.Connection,
) -> None:
    with a_heartbeat_beating(database) as beating:
        onlooker = beating.onlooker
        onlooker.execute("SELECT pg_terminate_backend(%s)", (beating.session,))
        assert _within(
            10,
            lambda: beating.session not in _heartbeat_sessions(onlooker, database),
        )
        dropped_at, _ = _lease_of(onlooker, beating.workspace)
        renewed = _within(
            10, lambda: _lease_of(onlooker, beating.workspace)[0] > dropped_at
        )
        _, live = _lease_of(onlooker, beating.workspace)

    assert renewed, "the heartbeat stopped at the dropped connection"
    assert live, "and the lease lapsed"
    assert {
        line["job_id"]
        for line in beating.written
        if line["event"] == "a heartbeat failed" and line["error"]
    } == {beating.job.id}


def test_a_heartbeat_whose_claim_is_gone_says_so_and_stops(
    database: psycopg.Connection,
) -> None:
    with a_heartbeat_beating(database) as beating:
        with scoped(beating.onlooker, beating.workspace) as cursor:
            cursor.execute("UPDATE job SET claimed_by = 'another-worker'")
        stopped = _within(
            10, lambda: not _heartbeat_sessions(beating.onlooker, database)
        )

    assert stopped, "the heartbeat kept its session after the claim was gone"
    assert [
        line["job_id"]
        for line in beating.written
        if line["event"] == "the claim was lost"
    ] == [beating.job.id]


def test_a_blocked_heartbeat_statement_ends_within_its_bound(
    database: psycopg.Connection,
) -> None:
    workspace, claimed = a_claimed_audit(database)

    dsn = _WHERE[database]
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
            cancelled = _within(
                10,
                lambda: [
                    line
                    for line in written
                    if line["event"] == "a heartbeat failed"
                    and line["error"] == "QueryCanceled"
                ],
            )
        cancelled_at, _ = _lease_of(onlooker, workspace)
        renewed = _within(10, lambda: _lease_of(onlooker, workspace)[0] > cancelled_at)

    assert cancelled, "the blocked heartbeat statement was never cancelled"
    assert renewed, "the heartbeat stopped after its statement was cancelled"


A_WORKER_RUN = """
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


def a_worker_hung_on_its_audit(
    database: psycopg.Connection,
    tmp_path: Path,
    *,
    deadline_seconds: float = 0.3,
    while_hung: Callable[[], object] = lambda: None,
) -> tuple[list[dict[str, Any]], str]:
    bootstrap = bootstrap_for(database, tmp_path)
    with queue.connected(bootstrap.database_url) as locking, locking.transaction():
        locking.execute("LOCK TABLE concept_index IN ACCESS EXCLUSIVE MODE")
        with subprocess.Popen(
            [sys.executable, "-c", A_WORKER_RUN, str(deadline_seconds)],
            env=worker_environment(bootstrap),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        ) as worker:
            try:
                while_hung()
                stdout, stderr = worker.communicate(timeout=30)
            finally:
                worker.kill()
    assert worker.returncode == queue.OUTLIVED_ITS_DEADLINE, stderr
    return [json.loads(line) for line in stdout.splitlines()], stderr


A_BEATS_SKEW_SECONDS = (
    queue.HEARTBEAT_CONNECT_SECONDS + 2 * queue.HEARTBEAT_STATEMENT_SECONDS
)


def the_lease_lapses(database: psycopg.Connection, workspace: str) -> bool:
    return bool(
        _within(A_BEATS_SKEW_SECONDS, lambda: not _lease_of(database, workspace)[1])
    )


def test_a_job_past_its_deadline_ends_the_worker_process(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_holding_one_job(database, kind="nightly-audit")

    written, stderr = a_worker_hung_on_its_audit(database, tmp_path)

    assert the_lease_lapses(database, workspace), (
        "the lease outlived the worker process"
    )
    with scoped(database, workspace) as cursor:
        reclaimed = queue.claim(cursor, workspace, WORKER, ["nightly-audit"])
    assert reclaimed is not None
    assert reclaimed.attempts == 2
    events = [line["event"] for line in written]
    assert not {"job finished", "job failed", "the claim was lost"} & set(events)
    assert (events[-1], written[-1]["job_id"]) == (
        "the job outlived its deadline",
        reclaimed.id,
    )
    assert "in nightly_audit" in stderr, "the hung frame went unrecorded"


def test_a_job_outliving_every_attempt_ends_poisoned(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = str(seed_workspace(database.cursor())["id"])
    database.commit()
    with scoped(database, workspace) as cursor:
        job = seed_job(
            cursor, workspace_id=workspace, kind="nightly-audit", max_attempts=2
        )

    for _ in range(2):
        a_worker_hung_on_its_audit(database, tmp_path)
        assert the_lease_lapses(database, workspace), "the lease outlived the worker"

    with scoped(database, workspace) as cursor:
        assert queue.claim(cursor, workspace, WORKER, ["nightly-audit"]) is None
        cursor.execute("SELECT status, attempts FROM job WHERE id = %s", (job["id"],))
        assert cursor.fetchone() == ("poisoned", 2)


def test_a_lost_claim_still_ends_the_worker_at_its_deadline(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_holding_one_job(database, kind="nightly-audit")

    def take_the_claim() -> None:
        with queue.connected(_WHERE[database]) as taking:

            def taken() -> int:
                with scoped(taking, workspace) as cursor:
                    cursor.execute(
                        "UPDATE job SET claimed_by = 'another-worker'"
                        " WHERE claimed_by = %s",
                        (WORKER,),
                    )
                    return cursor.rowcount

            assert _within(10, taken), "the worker never claimed its job"

    written, _ = a_worker_hung_on_its_audit(
        database, tmp_path, deadline_seconds=2.0, while_hung=take_the_claim
    )

    events = [line["event"] for line in written]
    assert events[-2:] == ["the claim was lost", "the job outlived its deadline"]


A_WORKER_PROCESS = """
import sys
from better_answers_worker import loop

sys.exit(loop.serve(finish_within_seconds=float(sys.argv[1])))
"""

WARM_UP_SECONDS = loop.IDLE_SLEEP_SECONDS * IDLE_SLEEPS_THE_DETECTORS_IMPORT_MAY_TAKE

EXIT_AFTER_STOP_SECONDS = 5


@contextlib.contextmanager
def a_worker_process(
    database: psycopg.Connection, tmp_path: Path, *, finish_within_seconds: float
) -> Iterator[subprocess.Popen[str]]:
    with database.cursor() as cursor:
        stamp_contract_as_migrate_does(cursor, digest=CONTRACT_DIGEST)
    database.commit()
    with subprocess.Popen(
        [sys.executable, "-c", A_WORKER_PROCESS, str(finish_within_seconds)],
        env=worker_environment(bootstrap_for(database, tmp_path)),
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
    with queue.connected(_WHERE[database]) as locking:
        locking.execute("BEGIN")
        locking.execute("LOCK TABLE concept_index IN ACCESS EXCLUSIVE MODE")
        yield locking


def claimed_by_the_worker(database: psycopg.Connection, workspace: str) -> bool:
    return bool(
        _within(WARM_UP_SECONDS, lambda: audit_job(database, workspace)[0] == "claimed")
    )


def test_an_idle_worker_exits_cleanly_on_sigterm(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    with (
        a_worker_process(database, tmp_path, finish_within_seconds=10) as worker,
        queue.connected(_WHERE[database]) as onlooker,
    ):
        connected = _within(
            WARM_UP_SECONDS, lambda: _heartbeat_sessions(onlooker, database)
        )
        assert connected, "the worker never reached its loop"

        worker.send_signal(signal.SIGTERM)
        exit_code, stderr = exit_within(worker, EXIT_AFTER_STOP_SECONDS)

    assert exit_code == 0, stderr


def test_a_stop_mid_job_hands_it_back_with_its_attempt(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_holding_one_job(database, kind="nightly-audit")

    with (
        concept_index_locked(database),
        a_worker_process(database, tmp_path, finish_within_seconds=0.5) as worker,
    ):
        assert claimed_by_the_worker(database, workspace)
        worker.send_signal(signal.SIGTERM)
        exit_code, stderr = exit_within(worker, EXIT_AFTER_STOP_SECONDS)

    assert exit_code == 0, stderr
    database.commit()
    with scoped(database, workspace) as cursor:
        reclaimed = queue.claim(cursor, workspace, WORKER, ["nightly-audit"])
    assert reclaimed is not None, "the handed-back job was not claimable at once"
    with database.cursor() as cursor:
        cursor.execute("SELECT max_attempts FROM job WHERE id = %s", (reclaimed.id,))
        bound = cursor.fetchone()
    assert bound is not None
    assert (reclaimed.attempts, bound[0]) == (2, 4), "the stop spent an attempt"


def test_a_stop_lets_a_job_that_ends_within_grace_finish(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_a_queued_audit(database, tmp_path)

    with (
        concept_index_locked(database) as locking,
        a_worker_process(database, tmp_path, finish_within_seconds=10) as worker,
    ):
        assert claimed_by_the_worker(database, workspace)
        worker.send_signal(signal.SIGTERM)
        locking.execute("COMMIT")
        exit_code, stderr = exit_within(worker, EXIT_AFTER_STOP_SECONDS)

    assert exit_code == 0, stderr
    assert audit_job(database, workspace) == ("done", WORKER)
