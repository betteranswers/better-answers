import threading
import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any

import psycopg
import pytest
from structlog.testing import capture_logs

from better_answers_worker import health, loop, queue
from better_answers_worker.audit import run_audit
from better_answers_worker.bundle import (
    NotAWorkspaceIdError,
    concepts_at_head,
    repository_path,
)
from better_answers_worker.config import Bootstrap, Engine, ObjectStore
from better_answers_worker.contract_stamp import CONTRACT_DIGEST
from better_answers_worker.ids import ulid
from better_answers_worker.kinds import KINDS
from better_answers_worker.queue import scoped
from better_answers_worker.rebuild import run_rebuild
from better_answers_worker.schema_view import MIGRATION_WHEN
from bundles import write_bundle
from factories import (
    hold_graph_generation,
    seed_concept,
    seed_graph_generation,
    seed_job,
    seed_workspace,
)
from pg_harness import migrated_postgres_at, stamp_contract, stamp_migration

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
    binding_id = ulid()
    with database.cursor() as cursor:
        seed_job(
            cursor,
            workspace_id=workspace,
            kind="index",
            reason="bound",
            subject_id=binding_id,
            enqueued_ago_seconds=2,
        )
        seed_job(cursor, workspace_id=workspace, kind="nightly-audit")
    database.commit()
    return workspace, binding_id


def test_a_claim_leaves_unnamed_kinds_queued_and_unpoisoned(
    database: psycopg.Connection,
) -> None:
    workspace, binding_id = an_index_job_older_than_an_audit(database)

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
    assert (indexing.kind, indexing.subject_id) == ("index", binding_id)


def test_a_claim_hands_the_handler_what_the_job_is_about(
    database: psycopg.Connection,
) -> None:
    workspace, binding_id = an_index_job_older_than_an_audit(database)

    with queue.connected(_WHERE[database]) as worker:
        with scoped(worker, workspace) as cursor:
            indexing = queue.claim(cursor, workspace, WORKER, ["index"])
        with scoped(worker, workspace) as cursor:
            auditing = queue.claim(cursor, workspace, WORKER, ["nightly-audit"])

    assert indexing is not None
    assert indexing.kind == "index"
    assert indexing.reason == "bound"
    assert indexing.subject_id == binding_id

    assert auditing is not None
    assert auditing.kind == "nightly-audit"
    assert auditing.subject_id is None


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
        blocker.execute("LOCK TABLE graph_generation IN EXCLUSIVE MODE")
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

    (tmp_path / f"{workspace}.git").mkdir()
    bootstrap = bootstrap_for(database, tmp_path)

    assert loop.tick(database, bootstrap) is False
    assert loop.tick(database, bootstrap) is True

    assert loop.tick(database, bootstrap) is False

    with database.cursor() as cursor:
        cursor.execute(
            "SELECT status FROM job WHERE workspace_id = %s ORDER BY enqueued_at",
            (workspace,),
        )
        assert cursor.fetchall() == [("failed",)]


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


def test_a_rebuild_holds_the_generation_row_first_so_writes_land(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    with database.cursor() as cursor:
        expenses = seed_expenses(cursor, workspace)

        seed_graph_generation(cursor, workspace_id=workspace)
    database.commit()
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
            hold_graph_generation(cursor, workspace_id=workspace)
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
            "SELECT uid FROM graph_node WHERE workspace_id = %s AND gen = 2"
            " ORDER BY uid",
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

        seed_graph_generation(cursor, workspace_id=workspace)
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
            "SELECT live_gen FROM graph_generation WHERE workspace_id = %s",
            (workspace,),
        )
        assert cursor.fetchone() == (2,)
        cursor.execute(
            "SELECT gen, label, from_uid, to_uid, from_kind, to_kind, section, sentence"
            " FROM graph_edge WHERE workspace_id = %s",
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


def test_a_mismatched_schema_stamp_claims_nothing_and_exits_one(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_a_queued_audit(database, tmp_path)
    with database.cursor() as cursor:
        stamp_contract(cursor, digest=CONTRACT_DIGEST)
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
        stamp_contract(cursor, digest="a" * 64)
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
        stamp_contract(cursor, digest=CONTRACT_DIGEST)
    database.commit()

    with capture_logs() as written:
        assert loop.run(bootstrap_for(database, tmp_path), once=True) == 0

    assert refusals_in(written) == []
    assert audit_job(database, workspace) == ("done", WORKER)


def test_the_refusal_logs_once_and_lifts_when_the_deploy_finishes(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_with_a_queued_audit(database, tmp_path)
    with database.cursor() as cursor:
        stamp_contract(cursor, digest="b" * 64)
    database.commit()

    with capture_logs() as written:
        running = threading.Thread(
            target=loop.run,
            args=(bootstrap_for(database, tmp_path),),
            kwargs={"once": False},
            daemon=True,
        )
        running.start()
        # A daemon thread because the loop never returns on its own, and the stamp is
        # corrected from a connection of its own while it sleeps.
        time.sleep(loop.IDLE_SLEEP_SECONDS / 2)
        with (
            psycopg.connect(_WHERE[database], autocommit=True) as deploying,
            deploying.cursor() as cursor,
        ):
            stamp_contract(cursor, digest=CONTRACT_DIGEST)
        deadline = time.monotonic() + loop.IDLE_SLEEP_SECONDS * 4
        while time.monotonic() < deadline:
            if audit_job(database, workspace)[0] == "done":
                break
            time.sleep(0.1)

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


def test_a_long_run_keeps_its_lease_on_its_own_connection(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = a_workspace_holding_one_job(database, kind="nightly-audit")
    with scoped(database, workspace) as cursor:
        claimed = queue.claim(cursor, workspace, WORKER, list(KINDS))
    assert claimed is not None

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
