"""The work loop, its two job kinds and its healthcheck (`[TEST1]`, `[TEST2]`,
`[TEST4]`).

Driven through the entry points a deploy unit drives — `loop.main` with `--once`, and
`health.is_healthy` — against a real Postgres on the pinned image and a real bare
repository, because the whole of what this tier does is read one and write the other.

What is **not** proved here is that this tier's derivation matches the app's. That is
the cross-tier rebuild-equivalence test in `packages/core`, which drives the app's own
acts and then runs this loop as a real process against the same two stores. Here the
app's side is seeded, so what these cases hold is the loop's own behaviour: claim, run,
finish, and the refusals around them.
"""

import json
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import psycopg
import pytest

from better_answers_worker import health, loop, queue
from better_answers_worker.audit import run_audit
from better_answers_worker.bundle import (
    NotAWorkspaceIdError,
    concepts_at_head,
    repository_path,
)
from better_answers_worker.concept_file import content_hash_of, parse_concept_file
from better_answers_worker.config import Bootstrap
from better_answers_worker.ids import ulid
from better_answers_worker.kinds import KINDS
from better_answers_worker.queue import scoped
from better_answers_worker.rebuild import run_rebuild
from better_answers_worker.schema_view import MIGRATION_WHEN
from bundles import render_concept_file, write_bundle
from factories import seed_concept_identity, seed_job, seed_workspace
from pg_harness import migrated_postgres_at

WORKER = "worker-under-test"
IRI = "https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM"
OTHER_IRI = "https://better-answers.com/c/01J6NNNNNNNNNNNNNNNNNNNNNN"


@pytest.fixture(name="database")
def a_migrated_database() -> Iterator[psycopg.Connection]:
    with migrated_postgres_at() as (connection, conninfo):
        _WHERE[connection] = conninfo
        yield connection


#: Where a test's database is, for the one case that opens a second connection to it.
#: `Connection` gives its conninfo back without the password, so the address is kept
#: here rather than asked of the connection.
_WHERE: dict[psycopg.Connection, str] = {}


def seed_concept(
    cursor: psycopg.Cursor,
    *,
    workspace_id: str,
    iri: str,
    path: str,
    frontmatter: dict[str, Any],
    body: str,
    kind: str = "Policy",
    status: str = "stable",
) -> str:
    """A concept as the app would have written it: the identity, the commit and the
    index row, with the content hash this tier's own reader computes over the very
    file the bundle holds — which is what makes a *seeded* mismatch a deliberate one.
    """
    seed_concept_identity(
        cursor, workspace_id=workspace_id, iri=iri, merge_key=f"{kind}:{path}".lower()
    )
    sha = f"{abs(hash(path)):040x}"[:40]
    cursor.execute(
        "INSERT INTO bundle_commit (workspace_id, sha, audit_event_id, actor)"
        " VALUES (%s, %s, %s, 'process:better-answers-test')"
        " ON CONFLICT DO NOTHING",
        (workspace_id, sha, ulid()),
    )
    content = render_concept_file(frontmatter, body)
    parsed_frontmatter, parsed_body = parse_concept_file(content)
    cursor.execute(
        "INSERT INTO concept_index (workspace_id, iri, path, kind, title, frontmatter,"
        " body, content_hash, commit_sha, status, published_at, sensitivity, audience)"
        " VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, now(), 'Internal',"
        " 'everyone')",
        (
            workspace_id,
            iri,
            path,
            kind,
            str(frontmatter.get("title", "Untitled")),
            json.dumps(parsed_frontmatter),
            parsed_body,
            content_hash_of(parsed_frontmatter, parsed_body, path),
            sha,
            status,
        ),
    )
    return content


def seed_expenses(
    cursor: psycopg.Cursor,
    workspace: str,
    body: str = "Expenses are claimed within sixty days.",
) -> str:
    """The one concept most cases here start from, as the app would have written it."""
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
    )


def test_the_worker_runs_exactly_the_kinds_its_registry_holds_a_handler_for() -> None:
    """The dispatch is a table, so what this worker can run is one list in one place —
    and the two words are written down here rather than read back off that table
    (`[TEST9]`), so a handler landing or leaving is a change this case sees.
    """
    assert tuple(KINDS) == ("nightly-audit", "full-rebuild")


def test_the_loop_runs_both_its_kinds_through_the_registry_one_job_at_a_time(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    """Every kind the worker runs goes through the one lookup, and the host around it is
    unchanged: it claims, stamps the claimant and the heartbeat the claim wrote, and
    finishes with whatever outcome the handler answered. Two jobs in one workspace take
    two passes, because the loop's shape is one job at a time.
    """
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
    # Each row carries the outcome shape of its own kind and not the other's, which is
    # what says the lookup ran the handler the row named.
    assert rows[0][4]["checked"] == 1
    assert "generation" not in rows[0][4]
    assert (rows[1][4]["generation"], rows[1][4]["nodes"]) == (2, 1)


def test_the_loop_claims_no_kind_its_registry_lacks_so_an_index_job_waits(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    """The claim is passed the kinds the registry holds, so a job whose handler has not
    landed is neither claimed nor poisoned by this worker — it waits, untouched, for the
    process that can run it. `index` is that kind today: its handler is T-129's, and
    until it lands an index run sitting at the head of the queue must not stop the
    kinds this worker does run.
    """
    workspace = seed_workspace(database.cursor())["id"]
    with database.cursor() as cursor:
        content = seed_expenses(cursor, workspace)
        # Older than the audit below, so a claim that read the queue without its kinds
        # would take this one first.
        seed_job(
            cursor,
            workspace_id=workspace,
            kind="index",
            reason="bound",
            subject_id=ulid(),
            enqueued_ago_seconds=2,
        )
        seed_job(cursor, workspace_id=workspace, kind="nightly-audit")
    database.commit()
    write_bundle(tmp_path, workspace, {"knowledge/expenses.md": content})

    bootstrap = bootstrap_for(database, tmp_path)
    with queue.connected(bootstrap.database_url) as worker:
        assert loop.tick(worker, bootstrap) is True
        # And the pass after it finds nothing to do rather than poisoning what is left.
        assert loop.tick(worker, bootstrap) is False

    with database.cursor() as cursor:
        cursor.execute(
            "SELECT kind, status, claimed_by, attempts FROM job"
            " WHERE workspace_id = %s ORDER BY enqueued_at",
            (workspace,),
        )
        assert cursor.fetchall() == [
            ("index", "queued", None, 0),
            ("nightly-audit", "done", WORKER, 1),
        ]


def test_the_loop_claims_runs_and_finishes_a_nightly_audit_it_scheduled_itself(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    body = "Expenses are claimed within sixty days."
    with database.cursor() as cursor:
        content = seed_expenses(cursor, workspace, body)
    database.commit()
    write_bundle(tmp_path, workspace, {"knowledge/expenses.md": content})

    # Nothing is queued, so the first pass schedules the audit and the second runs it —
    # which is the whole of the scheduler this tier has.
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


def test_a_job_commits_as_it_goes_and_another_connection_sees_it_finish_after_the_claim(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    """The claim, the work and the finish are three transactions, each committed where
    its block ends — on the connection the image opens, not this suite's — so an app
    polling the row sees it move while the worker lives, and the row says when the job
    was claimed and when it finished as two instants rather than one.
    """
    workspace = seed_workspace(database.cursor())["id"]
    database.commit()
    bootstrap = bootstrap_for(database, tmp_path)

    with queue.connected(bootstrap.database_url) as worker:
        assert loop.tick(worker, bootstrap) is False  # schedules the audit
        assert loop.tick(worker, bootstrap) is True  # claims, runs and finishes it
        # Read from this suite's own connection while the worker's is still open: what
        # the worker wrote is committed, and its two stamps are two transactions' now().
        with database.cursor() as cursor:
            cursor.execute(
                "SELECT status, finished_at > claimed_at FROM job"
                " WHERE workspace_id = %s",
                (workspace,),
            )
            assert cursor.fetchall() == [("done", True)]


def test_a_claim_is_visible_and_the_lease_moves_while_a_job_runs_through_the_loop(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    """Through the loop's own connection shape — not a claim this suite committed — a
    second connection sees the row *claimed* while the job runs, sees its lease pushed
    out by the heartbeat beside the work, and afterwards sees it finished later than it
    was claimed. The job is a rebuild held at its first write by a lock this suite
    holds, because no job in this suite runs a heartbeat interval on its own.
    """
    workspace = seed_workspace(database.cursor())["id"]
    database.commit()
    with scoped(database, workspace) as cursor:
        cursor.execute(
            "INSERT INTO job (workspace_id, id, kind, reason)"
            " VALUES (%s, %s, 'full-rebuild', 'drill')",
            (workspace, ulid()),
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
        # The rebuild's first write is its generation row; this lock holds it there.
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
    # Finished, and finished *after* it was claimed: two statements' clocks, not one
    # transaction's `now()`.
    finished = row()
    assert finished is not None
    assert (finished[0], finished[2]) == ("done", True)


def test_a_failed_audit_counts_as_run_so_the_loop_queues_no_other_every_idle_tick(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    database.commit()
    # A bundle directory that is not a repository: the audit raises on it, and the job
    # ends *failed* — the terminal verdict an operator should be reading.
    (tmp_path / f"{workspace}.git").mkdir()
    bootstrap = bootstrap_for(database, tmp_path)

    assert loop.tick(database, bootstrap) is False  # schedules the audit
    assert loop.tick(database, bootstrap) is True  # claims it, and it fails
    # And the next idle tick schedules nothing: a failure is the last audit this loop
    # ran, not an audit that never happened, so the next one comes round a day later.
    assert loop.tick(database, bootstrap) is False

    with database.cursor() as cursor:
        cursor.execute(
            "SELECT status FROM job WHERE workspace_id = %s ORDER BY enqueued_at",
            (workspace,),
        )
        assert cursor.fetchall() == [("failed",)]


def test_refuses_a_workspace_id_that_is_not_one_before_it_touches_the_store(
    tmp_path: Path,
) -> None:
    # Every id the loop hands this module came off a row the app wrote; what these hold
    # is that the path is arithmetic over an id and never over a caller's string.
    workspace = ulid()
    (tmp_path / "store").mkdir()

    assert repository_path(str(tmp_path / "store"), workspace) == (
        (tmp_path / "store" / f"{workspace}.git").resolve()
    )
    for escape in ("../escape", "..", f"{workspace}/../..", "", workspace.lower()):
        with pytest.raises(NotAWorkspaceIdError):
            concepts_at_head(str(tmp_path / "store"), escape)

    # And a repository directory that is a link out of the store is refused too — the
    # shape check cannot see it, the containment check can.
    elsewhere = tmp_path / "elsewhere.git"
    elsewhere.mkdir()
    (tmp_path / "store" / f"{workspace}.git").symlink_to(elsewhere)
    with pytest.raises(NotAWorkspaceIdError):
        concepts_at_head(str(tmp_path / "store"), workspace)


def test_a_rebuild_holds_the_generation_row_before_it_reads_so_a_write_beside_it_lands(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    """The app's delta takes the generation row as it lands an edit; a rebuild that read
    the records before taking that row would build the next generation without the edit
    a concurrent write had not yet committed, and lose it at the flip. So the row comes
    first: here a write is held open beyond its index row and its generation lock, the
    rebuild is started beside it and seen from the database to be waiting, and the
    write then commits — and the generation the rebuild flips live carries its concept.
    """
    workspace = seed_workspace(database.cursor())["id"]
    with database.cursor() as cursor:
        expenses = seed_expenses(cursor, workspace)
        # Raw, against `[TEST4]`: this suite's factories have none for graph_generation.
        cursor.execute(
            "INSERT INTO graph_generation (workspace_id, live_gen) VALUES (%s, 1)",
            (workspace,),
        )
    database.commit()
    dsn = _WHERE[database]

    outcomes: list[Any] = []
    with psycopg.connect(dsn) as writer, queue.connected(dsn) as worker:
        with writer.cursor() as cursor:
            # The write, as the app lands it: the commit is already in the bundle
            # (below), its index row is written, and it holds the generation row the
            # delta takes — uncommitted, for as long as the rebuild is made to wait.
            receipts = seed_concept(
                cursor,
                workspace_id=workspace,
                iri=OTHER_IRI,
                path="knowledge/receipts.md",
                frontmatter={"title": "Receipts", "type": "Evidence", "iri": OTHER_IRI},
                body="Receipts are kept for six years.",
                kind="Evidence",
            )
            cursor.execute(
                "INSERT INTO graph_generation (workspace_id, live_gen) VALUES (%s, 1)"
                " ON CONFLICT (workspace_id) DO UPDATE"
                " SET live_gen = graph_generation.live_gen RETURNING live_gen",
                (workspace,),
            )
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
    # Both concepts, the one the write landed while the rebuild waited included, and
    # no file the index did not know: the rebuild read the records after the write
    # committed.
    assert (outcome.generation, outcome.nodes, outcome.missing_row) == (2, 2, [])
    with database.cursor() as cursor:
        cursor.execute(
            "SELECT uid FROM graph_node WHERE workspace_id = %s AND gen = 2"
            " ORDER BY uid",
            (workspace,),
        )
        assert cursor.fetchall() == [(IRI,), (OTHER_IRI,)]


def test_the_audit_reports_a_mismatch_as_a_state_and_never_as_a_refusal(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    # "Nightly is fine; deleted is not" (ADR 0023): the two parsers police each other,
    # and a disagreement is a fact the outcome carries — never a job that failed.
    workspace = seed_workspace(database.cursor())["id"]
    with database.cursor() as cursor:
        content = seed_expenses(cursor, workspace)
        # The bundle moves under the row, which is what a drifted parse looks like from
        # here: the file says one thing and the row's hash says another.
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


def test_the_audit_counts_a_file_it_cannot_parse_and_a_row_whose_file_is_gone(
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
    # A file nobody can read is not a file whose hash is wrong, and a file the index
    # does not know is the crash window seen from this side: three different words,
    # three different lists.
    assert outcome.unparsed == []
    assert outcome.missing_row == ["knowledge/strange.md"]
    assert outcome.missing_file == ["knowledge/gone.md"]


def test_a_rebuild_writes_the_next_generation_beside_the_live_one_and_flips_it(
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
        # Raw, against `[TEST4]`: this suite's factories have none for graph_generation.
        cursor.execute(
            "INSERT INTO graph_generation (workspace_id, live_gen) VALUES (%s, 1)",
            (workspace,),
        )
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


def test_the_loop_claims_nothing_when_its_schema_stamp_does_not_match(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    # `[WRK1]`: the worker never migrates, so a view generated from another migration is
    # a deploy order that slipped — and reading a shape that has moved is worse than
    # waiting.
    workspace = seed_workspace(database.cursor())["id"]
    database.commit()
    with database.cursor() as cursor:
        cursor.execute(
            'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")'
            " VALUES ('a-migration-this-worker-has-never-seen', %s)",
            (MIGRATION_WHEN + 1,),
        )
    database.commit()

    assert loop.schema_stamp_matches(database) is False

    # And nothing was claimed or scheduled: the refusal is total, not partial.
    with database.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM job WHERE workspace_id = %s", (workspace,))
        assert cursor.fetchone() == (0,)


def test_a_worker_holding_a_fresh_lease_is_healthy_and_a_queue_left_waiting_is_not(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    workspace = seed_workspace(database.cursor())["id"]
    database.commit()

    # Idle with nothing waiting: healthy. This is what the worker is for most of a day,
    # and a check that demanded a live claim would page on it.
    assert health.is_healthy(database, WORKER) is True

    with scoped(database, workspace) as cursor:
        cursor.execute(
            "INSERT INTO job (workspace_id, id, kind, enqueued_at)"
            " VALUES (%s, %s, 'nightly-audit', now() - interval '5 minutes')",
            (workspace, ulid()),
        )
    # A job older than a lease that nothing has claimed: this worker has stopped
    # claiming, which is the failure the check exists to catch.
    assert health.is_healthy(database, WORKER) is False

    with scoped(database, workspace) as cursor:
        cursor.execute(
            "SELECT id FROM claim_job(%s, interval '60 seconds', %s)",
            (WORKER, list(KINDS)),
        )
        assert cursor.fetchone() is not None
    # Claimed, with a heartbeat the claim itself wrote: healthy again.
    assert health.is_healthy(database, WORKER) is True

    with scoped(database, workspace) as cursor:
        cursor.execute("UPDATE job SET heartbeat_at = now() - interval '5 minutes'")
    # A claimant that has stopped saying anything is not holding a fresh lease — but for
    # as long as the lease itself stands, the job is nobody else's to take and nothing
    # is waiting, so the check is still satisfied. That grace is exactly one lease long
    # and is the reason the compose probe carries eight retries.
    assert health.is_healthy(database, WORKER) is True

    with scoped(database, workspace) as cursor:
        cursor.execute("UPDATE job SET lease_expires_at = now() - interval '1 minute'")
    # And once the lease lapses, the job is claimable, older than a lease and unclaimed:
    # this worker has stopped working, which is what the check is for.
    assert health.is_healthy(database, WORKER) is False


def test_a_long_run_keeps_its_lease_from_a_connection_of_its_own(
    database: psycopg.Connection, tmp_path: Path
) -> None:
    """A heartbeat on the job's own connection would be invisible until the job
    committed, and a lease that lapsed halfway through a long rebuild would be handed
    to a second worker while the first was still building it. So the heartbeat has a
    connection of its own — and what proves it is a *third* connection reading the
    row while the job's transaction is still open.
    """
    workspace = seed_workspace(database.cursor())["id"]
    database.commit()

    with scoped(database, workspace) as cursor:
        cursor.execute(
            "INSERT INTO job (workspace_id, id, kind) VALUES (%s, %s, 'nightly-audit')",
            (workspace, ulid()),
        )
    with scoped(database, workspace) as cursor:
        claimed = queue.claim(cursor, workspace, WORKER, list(KINDS))
    assert claimed is not None

    dsn = _WHERE[database]
    with psycopg.connect(dsn) as onlooker:
        with scoped(onlooker, workspace) as cursor:
            cursor.execute("SELECT heartbeat_at, lease_expires_at FROM job")
            before = cursor.fetchone()
        assert before is not None

        # The job's own transaction, held open for as long as the run would hold it.
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
