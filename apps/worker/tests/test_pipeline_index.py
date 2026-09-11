"""One index run end to end: the rows it lands, the records it writes and the
visibility it re-copies before it finishes (`[TEST1]`, `[TEST2]`, `[TEST3]`,
`[TEST4]`, `[TEST7]`, `[TEST9]`).

Driven through `better_answers_worker.pipeline`'s own seam and through the work loop's
registry, against a real Postgres on the pinned image and a real engine and detector.
Nothing of this tier is replaced; the one thing that is, is the estate's object store,
behind the two-method adapter the pipeline reaches it through — a bucket could not say
which key was read and which was written any more clearly than a dictionary does.

**The role every run connects as.** `index`.`chunk` forces row-level security and a
superuser bypasses it by design, so the runs below open Postgres as a login role that is
a member of `worker_rt` and is nothing else — the shape the deploy unit gives the
worker. That is also what holds the grants honest: the suppression read is migration
0036's, the finding insert migration 0024's, and the catalogue's update migration
0035's, and a run connected as the owner would prove none of them. Rows are **read back
on the owner connection**, so a verification read never stands in for the write under
test.

**What is written down here, and why it is not derived.** The redacted text of every
document, the findings' categories, tiers, rule ids and spans, each chunk row's id, span
and wire locator, and the content hash of each original are literals (`[TEST9]`). They
were read out of the seam and the splitter on 11 September 2026 at `rule_version` 1 and
the detector pin this tier ships; a case that asked the code what it answered would
agree with code that answered anything.
"""

import hashlib
import json
import re
from collections.abc import Callable, Iterator, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg
import pytest

from better_answers_worker import loop, queue
from better_answers_worker.ids import ulid
from better_answers_worker.pipeline import IndexRun, index_binding
from better_answers_worker.redaction.pins import DETECTOR_PIN, RULE_VERSION
from factories import (
    seed_job,
    seed_source_binding,
    seed_source_document,
    seed_suppression,
)
from pg_harness import migrated_postgres_at
from test_pipeline_host import (
    WORKER_LOGIN,
    WORKER_PASSWORD,
    as_role,
    bootstrap_for,
    seed_partitioned_workspace,
)

#: The binding every run below is for, spelled rather than minted: it is the seed a
#: name's pseudonym is drawn from, so a binding whose id moved between two runs would
#: re-read every document for a reason no case is about.
BINDING = "01M2B1ND1NGAAAAAAAAAAAAAAA"

#: An invoice carrying a sort code beside an account number, which the seam raises as
#: one `bank-details` span at the tier no binding can switch off (ADR 0027: every value
#: invented).
AN_INVOICE_ID = "01M2Q3R4S5T6V7W8X9YZAB0001"
AN_INVOICE = (
    "Invoice 2026-041 is due on receipt.\n\n"
    "The sort code is 20-00-00 and the account number is 12345678.\n\n"
    "Delivery follows within ten working days of a signed order.\n"
)
AN_INVOICE_REDACTED = (
    "Invoice 2026-041 is due on receipt.\n\n"
    "The sort code is [withheld].\n\n"
    "Delivery follows within ten working days of a signed order.\n"
)
THE_ACCOUNT_NUMBER = "12345678"

#: A note naming a health condition, which the seam raises as a special-category finding
#: and answers with the verdict that narrows the document to Restricted.
A_SICK_NOTE_ID = "01M2Q3R4S5T6V7W8X9YZAB0002"
A_SICK_NOTE = (
    "Cover for the depot is arranged until the end of the quarter.\n\n"
    "The team lead is on long-term sick leave after a diabetes diagnosis.\n"
)
A_SICK_NOTE_REDACTED = (
    "Cover for the depot is arranged until the end of the quarter.\n\n[withheld]\n"
)

#: A delivery note naming one person. Under the safe set a name is a finding and not a
#: withholding, so this document's redacted text is its own — until an erasure request
#: names her, which raises her span to the always tier and writes her out.
A_DELIVERY_NOTE_ID = "01M2Q3R4S5T6V7W8X9YZAB0003"
A_DELIVERY_NOTE = (
    "Deliveries are booked by Priya Raman on 0161 496 0000.\n\n"
    "The depot opens at seven.\n"
)
A_DELIVERY_NOTE_SUPPRESSED = (
    "Deliveries are booked by [withheld] on 0161 496 0000.\n\n"
    "The depot opens at seven.\n"
)

#: The version string every finding row and every reconciled document carries, as its
#: two columns hold it — the pair the seam answers with, split once.
THE_VERSION = f"{RULE_VERSION}:{DETECTOR_PIN}"


def sha256_of(text: str) -> str:
    """The hash the catalogue row carries, over the normalised text before the seam."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class ABucket:
    """The estate's object store as a dictionary of the bytes under each key.

    The adapter's own interface and not boto3's: what these cases need to see is which
    key was read, which was written and what the bytes became (`[TEST3]`). `on_write` is
    the one hook a case uses to land a narrowing in the middle of a run, at the moment
    the run has read the binding and has not yet written a row.
    """

    def __init__(
        self,
        objects: Mapping[str, bytes],
        *,
        on_write: Callable[[], None] | None = None,
    ) -> None:
        self.objects = dict(objects)
        self.reads: list[str] = []
        self.writes: list[str] = []
        self._on_write = on_write

    def read(self, key: str) -> bytes:
        self.reads.append(key)
        return self.objects[key]

    def write(self, key: str, body: bytes) -> None:
        if self._on_write is not None:
            self._on_write()
        self.writes.append(key)
        self.objects[key] = body


@pytest.fixture(name="database")
def a_migrated_database() -> Iterator[tuple[psycopg.Connection, str]]:
    """A migrated throwaway Postgres, and a DSN on it for the worker's runtime role."""
    with migrated_postgres_at() as (connection, conninfo):
        connection.execute(
            f"CREATE ROLE \"{WORKER_LOGIN}\" LOGIN PASSWORD '{WORKER_PASSWORD}'"
            " IN ROLE worker_rt"
        )
        connection.commit()
        yield connection, as_role(conninfo, WORKER_LOGIN, WORKER_PASSWORD)


def original_key_of(document_id: str) -> str:
    """Where the bind act put the bytes, inside the workspace's own prefix."""
    return f"documents/{document_id.lower()}/original"


def normalised_key_of(document_id: str) -> str:
    """Where a run puts the normalised redacted text, beside the original."""
    return f"documents/{document_id.lower()}/normalised"


def a_bucket_holding_the_three() -> ABucket:
    return ABucket(
        {
            original_key_of(AN_INVOICE_ID): AN_INVOICE.encode(),
            original_key_of(A_SICK_NOTE_ID): A_SICK_NOTE.encode(),
            original_key_of(A_DELIVERY_NOTE_ID): A_DELIVERY_NOTE.encode(),
        }
    )


def seed_the_binding(
    connection: psycopg.Connection,
    *,
    documents: tuple[str, ...] = (AN_INVOICE_ID,),
    sensitivity: str = "Internal",
    audience: str = "everyone",
    audience_groups: list[str] | None = None,
    published_at: str | None = None,
    media_type: str = "text/markdown",
) -> str:
    """A provisioned workspace holding one binding and the documents a case names."""
    workspace_id = seed_partitioned_workspace(connection)
    with connection.cursor() as cursor:
        seed_source_binding(
            cursor,
            workspace_id=workspace_id,
            binding_id=BINDING,
            sensitivity=sensitivity,
            audience=audience,
            audience_groups=audience_groups,
            published_at=published_at,
        )
        for document_id in documents:
            seed_source_document(
                cursor,
                workspace_id=workspace_id,
                binding_id=BINDING,
                document_id=document_id,
                media_type=media_type,
                original_key=original_key_of(document_id),
            )
    connection.commit()
    return workspace_id


def a_run(reason: str = "bound") -> IndexRun:
    return IndexRun(workspace_id="", binding_id=BINDING, reason=reason)


def run_for(workspace_id: str, reason: str = "bound") -> IndexRun:
    return IndexRun(workspace_id=workspace_id, binding_id=BINDING, reason=reason)


def chunk_rows_of(
    connection: psycopg.Connection, workspace_id: str
) -> list[dict[str, Any]]:
    """Every chunk row the workspace holds, read as the owner so the read itself proves
    nothing about the scope — only the write under test does (R4)."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, workspace_id, content, published_at, sensitivity, audience,"
            " audience_groups, binding_id, source_document_id, locator, ordinal,"
            ' char_start, char_end FROM "index".chunk'
            " WHERE workspace_id = %s ORDER BY id",
            (workspace_id,),
        )
        assert cursor.description is not None
        names = [column.name for column in cursor.description]
        return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]


def finding_rows_of(
    connection: psycopg.Connection, workspace_id: str
) -> list[tuple[Any, ...]]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT document_id, category, tier, rule_id, char_start, char_end,"
            " score, rule_version, detector_pin, review_state"
            " FROM finding WHERE workspace_id = %s ORDER BY document_id, char_start",
            (workspace_id,),
        )
        return list(cursor.fetchall())


def catalogue_rows_of(
    connection: psycopg.Connection, workspace_id: str
) -> list[dict[str, Any]]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, content_hash, normalised_key, redaction_version, outcome,"
            " sensitivity, last_seen > first_seen AS seen_again FROM source_document"
            " WHERE workspace_id = %s ORDER BY id",
            (workspace_id,),
        )
        assert cursor.description is not None
        names = [column.name for column in cursor.description]
        return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]


# -- the registry ----------------------------------------------------------------------
#
# That the table holds this kind at all, and that a claim filtered by it leaves another
# process's kind alone, are the work-loop suite's own cases beside the dispatch they are
# about. What is here is the run the dispatch reaches.


def test_the_loop_claims_an_index_job_runs_it_and_finishes_it_with_its_three_figures(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    """The host is unchanged: it claims, stamps the claimant and the heartbeat, and
    finishes the row with whatever the handler answered. What the handler answers is the
    outcome the index run made — how many documents it saw, how many chunks it landed
    and how much disk the binding's store is using, which is the signal the per-binding
    cap is read against (ADR 0025).

    A binding with no documents, so the run reaches no object store: what this case is
    about is the dispatch and the row, and a run that read bytes would be proving the
    pipeline twice. The loop itself runs as the worker's runtime role, which is also
    what says the role may read the schema stamp it refuses to claim without.
    """
    connection, dsn = database
    workspace_id = seed_the_binding(connection, documents=())
    with connection.cursor() as cursor:
        seed_job(
            cursor,
            workspace_id=workspace_id,
            kind="index",
            reason="bound",
            subject_id=BINDING,
        )
    connection.commit()

    bootstrap = bootstrap_for(dsn, tmp_path)
    with queue.connected(bootstrap.database_url) as worker:
        assert loop.tick(worker, bootstrap) is True

    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT kind, status, claimed_by, heartbeat_at IS NOT NULL, outcome"
            " FROM job WHERE workspace_id = %s",
            (workspace_id,),
        )
        row = cursor.fetchone()
    assert row is not None
    assert row[:4] == ("index", "done", bootstrap.worker_id, True)
    assert (row[4]["documents"], row[4]["chunks"]) == (0, 0)
    assert row[4]["lmdb_bytes"] > 0


# -- the rows --------------------------------------------------------------------------


def test_every_column_of_the_chunk_rows_one_run_lands(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    """The row is the run's whole output, so every column of it is written down here:
    the derived id, the ordinal the splitter sat the row at, the span in code points,
    the full wire locator a citation carries, the redacted content, and the three
    permission fields copied from the binding narrowed by the document (ADR 0031's
    visibility columns).

    The document carries no class of its own, so the row takes its binding's — the
    ordinary case, and the one a narrowing has to be able to move.
    """
    connection, dsn = database
    workspace_id = seed_the_binding(
        connection,
        documents=(AN_INVOICE_ID,),
        published_at="2026-09-11T09:30:00Z",
    )
    bucket = a_bucket_holding_the_three()

    outcome = index_binding(
        bootstrap_for(dsn, tmp_path), run_for(workspace_id), copies=bucket
    )

    assert outcome.as_row() == {
        "documents": 1,
        "chunks": 1,
        "lmdb_bytes": outcome.lmdb_bytes,
    }
    assert chunk_rows_of(connection, workspace_id) == [
        {
            "id": f"{AN_INVOICE_ID}#000000",
            "workspace_id": workspace_id,
            "content": AN_INVOICE_REDACTED,
            "published_at": datetime(2026, 9, 11, 9, 30, tzinfo=UTC),
            "sensitivity": "Internal",
            "audience": "everyone",
            "audience_groups": None,
            "binding_id": BINDING,
            "source_document_id": AN_INVOICE_ID,
            "locator": f"{AN_INVOICE_ID}/chars:0-127",
            "ordinal": 0,
            "char_start": 0,
            "char_end": 127,
        }
    ]


def test_the_rows_of_a_binding_published_to_named_groups_carry_the_group_ids(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    """A document has no audience of its own, so the word and its group-id array are
    copies and never folds — and the array rides on the row beside the word, because the
    predicate that reads it runs in SQL against the row and has nothing else to test.
    """
    connection, dsn = database
    groups = ["01M2GR0PAAAAAAAAAAAAAAAAAA", "01M2GR0PBBBBBBBBBBBBBBBBBB"]
    workspace_id = seed_the_binding(
        connection,
        documents=(AN_INVOICE_ID,),
        audience="groups",
        audience_groups=groups,
    )

    index_binding(
        bootstrap_for(dsn, tmp_path),
        run_for(workspace_id),
        copies=a_bucket_holding_the_three(),
    )

    landed = chunk_rows_of(connection, workspace_id)
    assert [(row["audience"], row["audience_groups"]) for row in landed] == [
        ("groups", groups)
    ]


# -- the findings, the catalogue and the copies ----------------------------------------


def test_the_findings_land_as_the_rows_an_admin_will_review(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    """This block is the first writer of S0's table, and `worker_rt` holds INSERT on it
    and nothing else (migration 0024) — so the run connects as that role and the rows
    appear, which is the grant proved by use rather than by assertion.

    A finding is a location and never a quotation: the category, the tier, the rule that
    raised it, the span in code points into the text the seam was **given**, the score
    and the two halves of the version string. Born unreviewed, because reviewing one is
    an Admin's act and no run takes it.
    """
    connection, dsn = database
    workspace_id = seed_the_binding(
        connection, documents=(AN_INVOICE_ID, A_SICK_NOTE_ID)
    )

    index_binding(
        bootstrap_for(dsn, tmp_path),
        run_for(workspace_id),
        copies=a_bucket_holding_the_three(),
    )

    assert finding_rows_of(connection, workspace_id) == [
        (
            AN_INVOICE_ID,
            "bank-details",
            "always",
            "UK_BANK_ACCOUNT",
            54,
            97,
            pytest.approx(0.55),
            RULE_VERSION,
            DETECTOR_PIN,
            "unreviewed",
        ),
        (
            A_SICK_NOTE_ID,
            "special-category",
            "always",
            "HEALTH_CUE",
            63,
            131,
            pytest.approx(0.85),
            RULE_VERSION,
            DETECTOR_PIN,
            "unreviewed",
        ),
    ]


def test_the_catalogue_row_is_reconciled_and_the_copy_lands_beside_the_original(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    """What a run reconciles is exactly what it found: the hash of the text it read
    **before** the seam ran — a hash holds no value, so it is the fact a later run
    compares against to answer *unchanged* — the key of the normalised copy it wrote,
    the version the seam decided with, the outcome word and when it last saw the item.

    The copy is written under the document's own normalised key and the original is read
    and never written, because the original is the evidence an erasure map is read from
    and a re-detection is re-run over.
    """
    connection, dsn = database
    workspace_id = seed_the_binding(connection, documents=(AN_INVOICE_ID,))
    bucket = a_bucket_holding_the_three()

    index_binding(bootstrap_for(dsn, tmp_path), run_for(workspace_id), copies=bucket)

    assert catalogue_rows_of(connection, workspace_id) == [
        {
            "id": AN_INVOICE_ID,
            "content_hash": sha256_of(AN_INVOICE),
            "normalised_key": normalised_key_of(AN_INVOICE_ID),
            "redaction_version": THE_VERSION,
            "outcome": "converted",
            "sensitivity": None,
            "seen_again": True,
        }
    ]
    assert bucket.reads == [original_key_of(AN_INVOICE_ID)]
    assert bucket.writes == [normalised_key_of(AN_INVOICE_ID)]
    assert bucket.objects[original_key_of(AN_INVOICE_ID)] == AN_INVOICE.encode()
    assert bucket.objects[normalised_key_of(AN_INVOICE_ID)] == (
        AN_INVOICE_REDACTED.encode()
    )
    assert (
        THE_ACCOUNT_NUMBER.encode()
        not in bucket.objects[normalised_key_of(AN_INVOICE_ID)]
    )


def test_a_special_category_verdict_narrows_the_document_and_every_row_cut_from_it(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    """A health-shaped document lands Restricted whatever its binding's class, and the
    narrowing reaches the rows in the same run: the document's own class is the fold's
    other half, so a run that wrote the verdict and left the rows at the binding's word
    would serve the passage it had just narrowed.

    Its sibling under the same binding is untouched, which is the other half of the
    pair: the verdict is one document's and never the binding's.
    """
    connection, dsn = database
    workspace_id = seed_the_binding(
        connection, documents=(AN_INVOICE_ID, A_SICK_NOTE_ID)
    )

    index_binding(
        bootstrap_for(dsn, tmp_path),
        run_for(workspace_id),
        copies=a_bucket_holding_the_three(),
    )

    assert [
        (row["id"], row["sensitivity"])
        for row in catalogue_rows_of(connection, workspace_id)
    ] == [(AN_INVOICE_ID, None), (A_SICK_NOTE_ID, "Restricted")]
    assert [
        (row["source_document_id"], row["sensitivity"], row["content"])
        for row in chunk_rows_of(connection, workspace_id)
    ] == [
        (AN_INVOICE_ID, "Internal", AN_INVOICE_REDACTED),
        (A_SICK_NOTE_ID, "Restricted", A_SICK_NOTE_REDACTED),
    ]


def test_a_document_this_tier_cannot_convert_is_left_exactly_as_the_bind_act_left_it(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    """The engine catches a component's failure and lets the run finish, which is what
    fanning a document per component is for — so an unreadable upload is its own failure
    and never the binding's. The run answers the documents it read; the one it could not
    is simply absent, and its catalogue row keeps every null the bind act left on it.

    It is deliberately **not** written as *quarantined*: naming the failure per document
    needs the error's own name beside it, which the run has no way to learn, and that is
    the next ticket's line rather than a word this one writes on a guess.
    """
    connection, dsn = database
    workspace_id = seed_the_binding(
        connection, documents=(AN_INVOICE_ID, A_SICK_NOTE_ID)
    )
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE source_document SET media_type = 'application/pdf' WHERE id = %s",
            (A_SICK_NOTE_ID,),
        )
    connection.commit()

    outcome = index_binding(
        bootstrap_for(dsn, tmp_path),
        run_for(workspace_id),
        copies=a_bucket_holding_the_three(),
    )

    assert outcome.documents == 1
    assert catalogue_rows_of(connection, workspace_id)[1] == {
        "id": A_SICK_NOTE_ID,
        "content_hash": None,
        "normalised_key": None,
        "redaction_version": None,
        "outcome": None,
        "sensitivity": None,
        "seen_again": False,
    }
    assert [
        row["source_document_id"] for row in chunk_rows_of(connection, workspace_id)
    ] == [AN_INVOICE_ID]


def test_a_suppression_standing_over_a_document_is_read_off_the_table_and_kept_out(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    """The run gathers what each document must keep out from the `suppression` table
    itself, under its own workspace scope and through the SELECT migration 0036 grants —
    rather than being handed a set on the job row, which would write an erased person's
    identifiers into a queue row that outlives the run.

    Held both ways (`[TEST7]`): with no suppression standing, the name is a finding at
    the tier a binding switches off and the text keeps it; with one standing, the same
    span is raised to the tier no binding switches off and the text loses it.
    """
    connection, dsn = database
    workspace_id = seed_the_binding(connection, documents=(A_DELIVERY_NOTE_ID,))
    bootstrap = bootstrap_for(dsn, tmp_path)

    index_binding(bootstrap, run_for(workspace_id), copies=a_bucket_holding_the_three())
    kept = [row["content"] for row in chunk_rows_of(connection, workspace_id)]

    with connection.cursor() as cursor:
        seed_suppression(
            cursor, workspace_id=workspace_id, document_id=A_DELIVERY_NOTE_ID
        )
    connection.commit()

    index_binding(
        bootstrap,
        run_for(workspace_id, "rule-change"),
        copies=a_bucket_holding_the_three(),
    )

    assert kept == [A_DELIVERY_NOTE]
    assert [row["content"] for row in chunk_rows_of(connection, workspace_id)] == [
        A_DELIVERY_NOTE_SUPPRESSED
    ]


# -- the wipe --------------------------------------------------------------------------


def read_afresh_in(written: str) -> list[int]:
    """How many documents each run in this output read for itself.

    Off the run's own log line, which is the figure an operator has for whether a run
    did work or recognised that it had none. It is read here rather than taken off the
    outcome because the outcome is the job row's three figures and this is not one of
    them: the job row says what the binding holds, and this says what the run had to do
    to say so.
    """
    return [
        int(line["read_afresh"])
        for line in (json.loads(one) for one in written.splitlines() if one.strip())
        if line.get("event") == "the binding's landed copies were read"
    ]


def test_the_wipe_reason_empties_the_bindings_store_before_the_run_reads_anything(
    database: tuple[psycopg.Connection, str],
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """The wipe is two acts across the two tiers that hold the two stores: the app
    deletes the binding's chunk rows in its own transaction, and the worker removes the
    binding's directory at the start of the `index` job that deletion enqueued. It has
    to be the run's *first* act: everything the binding knows about its own documents
    lives in that directory, so a wipe taken after the documents were read is a wipe
    that read the answers it was enqueued to throw away.

    Two observables, and each answers half of the sentence.

    **That the store went** is the files: a store removed and reopened is new files, and
    the pair is the two reasons (`[TEST7]`) — after a *rule-change* run every file the
    first run left is the same file, and after a *wiped* run not one of them is. A file
    planted in the directory by hand goes with it, which is what says the directory
    itself was removed rather than a store emptied through the engine.

    **That it went first** is what the run then had to do. A binding whose store is
    intact answers out of it and reads nothing afresh; a binding whose store has just
    been removed has nothing to answer out of and runs the detector over every document
    again. That figure is the run's own log line, which is where an operator reads it.
    """
    connection, dsn = database
    workspace_id = seed_the_binding(connection, documents=(AN_INVOICE_ID,))
    bootstrap = bootstrap_for(dsn, tmp_path)
    binding_directory = tmp_path / workspace_id / BINDING

    def files_now() -> dict[str, int]:
        """Every file in the binding's store by name, and which file it is."""
        return {
            str(path.relative_to(binding_directory)): path.stat().st_ino
            for path in sorted(binding_directory.rglob("*"))
            if path.is_file()
        }

    index_binding(bootstrap, run_for(workspace_id), copies=a_bucket_holding_the_three())
    after_the_first = files_now()
    planted = binding_directory / "planted-before-the-wipe"
    planted.write_bytes(b"what the wipe must take with it")
    capsys.readouterr()

    index_binding(
        bootstrap,
        run_for(workspace_id, "rule-change"),
        copies=a_bucket_holding_the_three(),
    )
    after_the_rule_change = files_now()
    unwiped_read = read_afresh_in(capsys.readouterr().out)
    wiped = index_binding(
        bootstrap, run_for(workspace_id, "wiped"), copies=a_bucket_holding_the_three()
    )
    after_the_wipe = files_now()
    wiped_read = read_afresh_in(capsys.readouterr().out)

    assert after_the_first != {}
    assert after_the_rule_change.items() >= after_the_first.items()
    assert planted.exists() is False
    assert set(after_the_wipe) & set(after_the_first) != set()
    assert set(after_the_wipe.values()).isdisjoint(after_the_first.values())

    assert (unwiped_read, wiped_read) == ([0], [1])
    assert wiped.lmdb_bytes > 0
    assert chunk_rows_of(connection, workspace_id)[0]["content"] == AN_INVOICE_REDACTED


# -- the re-copy -----------------------------------------------------------------------


def test_the_runs_last_statement_recopy_takes_a_narrowing_that_landed_mid_run(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    """Two writers, one source: the run copies the binding's fields onto every row it
    lands, and the app rewrites them on a publish and on either narrowing. They can
    disagree only in a race — a run that read the binding before a narrowing committed
    and upserted its rows after it — and the run's own last statement settles it,
    re-reading both rows as they now stand and writing the fold onto every row the run
    wrote.

    The narrowing is committed from a second connection at the moment the run writes the
    normalised copy: the binding has been read, the detector has answered, and not one
    row has landed. Without the re-copy the rows would stand at the class the run set
    out with, which is the class an Admin has just taken away.
    """
    connection, dsn = database
    workspace_id = seed_the_binding(connection, documents=(AN_INVOICE_ID,))

    def narrow_the_document() -> None:
        with (
            psycopg.connect(dsn, autocommit=True) as narrower,
            queue.scoped(narrower, workspace_id) as cursor,
        ):
            cursor.execute(
                "UPDATE source_document SET sensitivity = 'Restricted' WHERE id = %s",
                (AN_INVOICE_ID,),
            )

    bucket = ABucket(
        {original_key_of(AN_INVOICE_ID): AN_INVOICE.encode()},
        on_write=narrow_the_document,
    )

    index_binding(bootstrap_for(dsn, tmp_path), run_for(workspace_id), copies=bucket)

    assert [row["sensitivity"] for row in chunk_rows_of(connection, workspace_id)] == [
        "Restricted"
    ]


def test_the_recopy_reaches_the_rows_of_this_run_and_leaves_another_bindings_alone(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    """The statement is aimed at the rows the run wrote and at nothing else, so a second
    binding's rows keep the fields its own run gave them. The pair matters because the
    statement joins the binding and the document rather than naming a class: an aim one
    row too wide would rewrite a neighbouring binding's visibility from this binding's.
    """
    connection, dsn = database
    workspace_id = seed_the_binding(connection, documents=(AN_INVOICE_ID,))
    another = ulid()
    with connection.cursor() as cursor:
        seed_source_binding(
            cursor,
            workspace_id=workspace_id,
            binding_id=another,
            sensitivity="Public",
        )
        cursor.execute(
            "SELECT set_config('app.workspace_id', %s, true)", (workspace_id,)
        )
        cursor.execute(
            'INSERT INTO "index".chunk (id, workspace_id, content, sensitivity,'
            " audience, binding_id) VALUES ('another-binding-row', %s, 'body',"
            " 'Public', 'everyone', %s)",
            (workspace_id, another),
        )
    connection.commit()

    index_binding(
        bootstrap_for(dsn, tmp_path),
        run_for(workspace_id),
        copies=a_bucket_holding_the_three(),
    )

    assert [
        (row["binding_id"], row["sensitivity"])
        for row in chunk_rows_of(connection, workspace_id)
    ] == [(BINDING, "Internal"), (another, "Public")]


def test_the_worker_login_the_runs_connect_as_is_the_runtime_role_and_not_the_owner(
    database: tuple[psycopg.Connection, str],
) -> None:
    """Written down because every case above rests on it: a run that connected as the
    container's superuser would bypass row-level security by design and would pass with
    the workspace scope taken out. The DSN the cases hand the bootstrap carries the
    login role provisioned `IN ROLE worker_rt` and nothing else.
    """
    _connection, dsn = database

    assert re.search(rf"//{WORKER_LOGIN}:", dsn) is not None
    with psycopg.connect(dsn) as opened, opened.cursor() as cursor:
        cursor.execute(
            "SELECT current_user, pg_has_role(current_user, 'worker_rt', 'member')"
        )
        assert cursor.fetchone() == (WORKER_LOGIN, True)
