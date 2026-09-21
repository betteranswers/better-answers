import hashlib
import json
import re
from collections.abc import Callable, Iterator, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypedDict

import psycopg
import pytest

from better_answers_worker import loop, queue
from better_answers_worker.ids import ulid
from better_answers_worker.pipeline import (
    IndexRun,
    ReadDocument,
    RedactedDocument,
    index_binding,
)
from better_answers_worker.pipeline.catalogue import record_findings
from better_answers_worker.redaction.engine import Finding
from better_answers_worker.redaction.pins import DETECTOR_PIN, RULE_VERSION
from factories import (
    seed_finding,
    seed_job,
    seed_narrowed,
    seed_restore,
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
from test_upload_media_types_contract import read_upload_media_types

BINDING = "01M2B1ND1NGAAAAAAAAAAAAAAA"


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


A_SICK_NOTE_ID = "01M2Q3R4S5T6V7W8X9YZAB0002"
A_SICK_NOTE = (
    "Cover for the depot is arranged until the end of the quarter.\n\n"
    "The team lead is on long-term sick leave after a diabetes diagnosis.\n"
)
A_SICK_NOTE_REDACTED = (
    "Cover for the depot is arranged until the end of the quarter.\n\n[withheld]\n"
)


A_DELIVERY_NOTE_ID = "01M2Q3R4S5T6V7W8X9YZAB0003"
A_DELIVERY_NOTE = (
    "Deliveries are booked by Priya Raman on 0161 496 0000.\n\n"
    "The depot opens at seven.\n"
)
A_DELIVERY_NOTE_SUPPRESSED = (
    "Deliveries are booked by [withheld] on 0161 496 0000.\n\n"
    "The depot opens at seven.\n"
)


THE_VERSION = f"{RULE_VERSION}:{DETECTOR_PIN}"


def sha256_of(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class ABucket:
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
    with migrated_postgres_at() as (connection, conninfo):
        connection.execute(
            f"CREATE ROLE \"{WORKER_LOGIN}\" LOGIN PASSWORD '{WORKER_PASSWORD}'"
            " IN ROLE worker_rt"
        )
        connection.commit()
        yield connection, as_role(conninfo, WORKER_LOGIN, WORKER_PASSWORD)


def original_key_of(document_id: str) -> str:
    return f"documents/{document_id.lower()}/original"


def normalised_key_of(document_id: str) -> str:
    return f"documents/{document_id.lower()}/normalised"


CONVERSION_FIXTURES = Path(__file__).resolve().parent / "fixtures" / "conversion"
A_SCANNED_PDF = (CONVERSION_FIXTURES / "scanned-invoice.pdf").read_bytes()
A_RATE_CARD_PDF = (CONVERSION_FIXTURES / "rate-card.pdf").read_bytes()
A_RATE_CARD_CONVERTED = (
    "# Rate card\n\n"
    "## Rates hold for the quarter.\n\n"
    "|Service|Day rate|\n"
    "|---|---|\n"
    "|Survey|450|\n"
    "|Report|300|\n"
)


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
    media_types: Mapping[str, str] | None = None,
) -> str:
    workspace_id = seed_partitioned_workspace(connection)
    named = media_types or {}
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
                media_type=named.get(document_id, media_type),
                original_key=original_key_of(document_id),
            )
    connection.commit()
    return workspace_id


def a_run(reason: str = "bound") -> IndexRun:
    return IndexRun(workspace_id="", binding_id=BINDING, reason=reason)


def run_for(workspace_id: str, reason: str = "bound") -> IndexRun:
    return IndexRun(workspace_id=workspace_id, binding_id=BINDING, reason=reason)


def by_column(cursor: psycopg.Cursor[Any]) -> list[dict[str, Any]]:
    assert cursor.description is not None
    names = [column.name for column in cursor.description]
    return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]


def chunk_rows_of(
    connection: psycopg.Connection, workspace_id: str
) -> list[dict[str, Any]]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, workspace_id, content, published_at, sensitivity, audience,"
            " audience_groups, binding_id, source_document_id, locator, ordinal,"
            ' char_start, char_end FROM "index".chunk'
            " WHERE workspace_id = %s ORDER BY id",
            (workspace_id,),
        )
        return by_column(cursor)


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
            " quarantine_error, sensitivity, last_seen > first_seen AS seen_again"
            " FROM source_document WHERE workspace_id = %s ORDER BY id",
            (workspace_id,),
        )
        return by_column(cursor)


def test_the_loop_claims_an_index_job_runs_it_and_finishes_it_with_its_three_figures(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
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

    assert row[4]["restores_overridden_by_erasure"] == []


def test_every_column_of_the_chunk_rows_one_run_lands(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
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
        "restores_overridden_by_erasure": [],
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


def test_the_findings_land_as_the_rows_an_admin_will_review(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
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
        (
            A_SICK_NOTE_ID,
            "job-title",
            "default-off",
            "JOB_TITLE",
            67,
            76,
            pytest.approx(0.96, abs=0.05),
            RULE_VERSION,
            DETECTOR_PIN,
            "unreviewed",
        ),
    ]


def test_the_catalogue_row_is_reconciled_and_the_copy_lands_beside_the_original(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
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
            "quarantine_error": None,
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


# jscpd:ignore-start
def test_a_special_category_verdict_narrows_the_document_and_every_row_cut_from_it(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_the_binding(
        connection, documents=(AN_INVOICE_ID, A_SICK_NOTE_ID)
    )

    index_binding(
        bootstrap_for(dsn, tmp_path),
        run_for(workspace_id),
        copies=a_bucket_holding_the_three(),
    )
    # jscpd:ignore-end

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


def test_a_document_this_tier_cannot_read_is_quarantined_on_its_own_catalogue_row(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_the_binding(
        connection,
        documents=(AN_INVOICE_ID, A_SICK_NOTE_ID),
        media_types={A_SICK_NOTE_ID: "application/pdf"},
    )

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
        "outcome": "quarantined",
        "quarantine_error": "ValueError",
        "sensitivity": None,
        "seen_again": True,
    }
    assert [
        row["source_document_id"] for row in chunk_rows_of(connection, workspace_id)
    ] == [AN_INVOICE_ID]


def test_a_pdf_with_no_text_layer_names_ocr_on_its_row_which_is_what_an_admin_counts(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_the_binding(
        connection,
        documents=(AN_INVOICE_ID, A_SICK_NOTE_ID),
        media_types={A_SICK_NOTE_ID: "application/pdf"},
    )
    bucket = a_bucket_holding_the_three()
    bucket.objects[original_key_of(A_SICK_NOTE_ID)] = A_SCANNED_PDF

    outcome = index_binding(
        bootstrap_for(dsn, tmp_path), run_for(workspace_id), copies=bucket
    )

    assert outcome.documents == 1
    quarantined = catalogue_rows_of(connection, workspace_id)[1]
    assert (quarantined["outcome"], quarantined["quarantine_error"]) == (
        "quarantined",
        "NeedsOcrError",
    )
    assert [
        row["source_document_id"] for row in chunk_rows_of(connection, workspace_id)
    ] == [AN_INVOICE_ID]


@pytest.mark.parametrize(
    "media_type",
    [outside["media_type"] for outside in read_upload_media_types()["outside"]],
)
def test_a_media_type_the_agreement_places_outside_the_list_is_quarantined_on_its_row(
    database: tuple[psycopg.Connection, str], tmp_path: Path, media_type: str
) -> None:
    connection, dsn = database
    workspace_id = seed_the_binding(
        connection,
        documents=(AN_INVOICE_ID, A_SICK_NOTE_ID),
        media_types={A_SICK_NOTE_ID: media_type},
    )
    bucket = a_bucket_holding_the_three()

    outcome = index_binding(
        bootstrap_for(dsn, tmp_path), run_for(workspace_id), copies=bucket
    )

    unconverted = catalogue_rows_of(connection, workspace_id)[1]
    assert {
        "documents": outcome.documents,
        "outcome": unconverted["outcome"],
        "quarantine_error": unconverted["quarantine_error"],
        "normalised_key": unconverted["normalised_key"],
    } == {
        "documents": 1,
        "outcome": "quarantined",
        "quarantine_error": "UnsupportedMediaType",
        "normalised_key": None,
    }
    assert {
        row["source_document_id"] for row in chunk_rows_of(connection, workspace_id)
    } == {AN_INVOICE_ID}


def test_a_document_that_ran_past_its_ceiling_lands_the_deadline_on_its_row(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_the_binding(connection, documents=(AN_INVOICE_ID,))
    bucket = a_bucket_holding_the_three()

    outcome = index_binding(
        bootstrap_for(dsn, tmp_path),
        run_for(workspace_id),
        copies=bucket,
        ms_per_page=0,
        margin_ms=0,
    )

    assert (outcome.documents, outcome.chunks) == (0, 0)
    quarantined = catalogue_rows_of(connection, workspace_id)[0]
    assert (quarantined["outcome"], quarantined["quarantine_error"]) == (
        "quarantined",
        "DeadlineExceededError",
    )
    assert quarantined["normalised_key"] is None
    assert bucket.writes == []
    assert chunk_rows_of(connection, workspace_id) == []


def test_a_document_quarantined_by_one_run_and_read_by_the_next_loses_its_error(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_the_binding(
        connection,
        documents=(AN_INVOICE_ID,),
        media_types={AN_INVOICE_ID: "application/pdf"},
    )
    bootstrap = bootstrap_for(dsn, tmp_path)
    bucket = a_bucket_holding_the_three()

    index_binding(bootstrap, run_for(workspace_id), copies=bucket)
    quarantined = catalogue_rows_of(connection, workspace_id)[0]

    bucket.objects[original_key_of(AN_INVOICE_ID)] = A_RATE_CARD_PDF
    outcome = index_binding(bootstrap, run_for(workspace_id), copies=bucket)

    assert (quarantined["outcome"], quarantined["quarantine_error"]) == (
        "quarantined",
        "ValueError",
    )
    assert outcome.documents == 1
    reconciled = catalogue_rows_of(connection, workspace_id)[0]
    assert (reconciled["outcome"], reconciled["quarantine_error"]) == (
        "converted",
        None,
    )
    assert [row["content"] for row in chunk_rows_of(connection, workspace_id)] == [
        A_RATE_CARD_CONVERTED
    ]


def test_a_suppression_standing_over_a_document_is_read_off_the_table_and_kept_out(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
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


def marked_rows_of(
    connection: psycopg.Connection, workspace_id: str
) -> list[dict[str, Any]]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, document_id, rule_id, char_start, char_end, review_state,"
            " restored_at IS NOT NULL AS restored"
            " FROM finding WHERE workspace_id = %s ORDER BY document_id, char_start",
            (workspace_id,),
        )
        return by_column(cursor)


def test_a_second_run_lands_no_second_finding_row_and_moves_none(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_the_binding(
        connection, documents=(AN_INVOICE_ID, A_SICK_NOTE_ID)
    )
    bootstrap = bootstrap_for(dsn, tmp_path)

    index_binding(bootstrap, run_for(workspace_id), copies=a_bucket_holding_the_three())
    first = marked_rows_of(connection, workspace_id)
    written = readings_of(connection, workspace_id)
    index_binding(
        bootstrap,
        run_for(workspace_id, "narrowed"),
        copies=a_bucket_holding_the_three(),
    )

    assert [(row["rule_id"], row["char_start"], row["char_end"]) for row in first] == [
        ("UK_BANK_ACCOUNT", 54, 97),
        ("HEALTH_CUE", 63, 131),
        ("JOB_TITLE", 67, 76),
    ]
    assert marked_rows_of(connection, workspace_id) == first

    assert readings_of(connection, workspace_id) == written


class ASpan(TypedDict):
    rule_id: str
    char_start: int
    char_end: int


HER_NAME: ASpan = {"rule_id": "PERSON", "char_start": 25, "char_end": 36}


def readings_of(
    connection: psycopg.Connection, workspace_id: str
) -> list[dict[str, Any]]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, category, tier, score, rule_version, detector_pin,"
            " xmin::text AS written_by"
            " FROM finding WHERE workspace_id = %s ORDER BY document_id, char_start",
            (workspace_id,),
        )
        return by_column(cursor)


def test_a_span_an_older_run_left_is_read_again_and_all_five_of_its_reading_move(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_the_binding(connection, documents=(AN_INVOICE_ID,))
    with connection.cursor() as cursor:
        older = seed_finding(
            cursor,
            workspace_id=workspace_id,
            document_id=AN_INVOICE_ID,
            category="government-identifier",
            tier="default-on",
            rule_id="UK_BANK_ACCOUNT",
            char_start=54,
            char_end=97,
        )
    connection.commit()

    index_binding(
        bootstrap_for(dsn, tmp_path),
        run_for(workspace_id),
        copies=a_bucket_holding_the_three(),
    )

    (row,) = readings_of(connection, workspace_id)

    (catalogued,) = catalogue_rows_of(connection, workspace_id)
    assert catalogued["redaction_version"] == (
        f"{row['rule_version']}:{row['detector_pin']}"
    )
    assert {key: row[key] for key in row if key != "written_by"} == {
        "id": older["id"],
        "category": "bank-details",
        "tier": "always",
        "score": pytest.approx(0.55),
        "rule_version": RULE_VERSION,
        "detector_pin": DETECTOR_PIN,
    }


def test_a_restored_span_keeps_its_id_its_marks_and_the_tier_it_was_restored_at(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_the_binding(connection, documents=(A_DELIVERY_NOTE_ID,))
    with connection.cursor() as cursor:
        seed_finding(
            cursor,
            workspace_id=workspace_id,
            document_id=A_DELIVERY_NOTE_ID,
            category="person-name",
            tier="always",
            **HER_NAME,
        )
        kept = seed_restore(
            cursor,
            workspace_id=workspace_id,
            document_id=A_DELIVERY_NOTE_ID,
            **HER_NAME,
        )
    connection.commit()

    index_binding(
        bootstrap_for(dsn, tmp_path),
        run_for(workspace_id),
        copies=a_bucket_holding_the_three(),
    )

    assert [
        row for row in marked_rows_of(connection, workspace_id) if row["restored"]
    ] == [
        {
            "id": kept["id"],
            "document_id": A_DELIVERY_NOTE_ID,
            **HER_NAME,
            "review_state": "kept-in-text",
            "restored": True,
        }
    ]
    (refreshed,) = [
        row for row in readings_of(connection, workspace_id) if row["id"] == kept["id"]
    ]
    assert (
        refreshed["tier"],
        refreshed["rule_version"],
        refreshed["detector_pin"],
    ) == (
        "always",
        RULE_VERSION,
        DETECTOR_PIN,
    )


# jscpd:ignore-start
def test_a_name_an_erasure_has_since_raised_reads_always_after_the_next_run(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_the_binding(connection, documents=(A_DELIVERY_NOTE_ID,))
    bootstrap = bootstrap_for(dsn, tmp_path)

    index_binding(bootstrap, run_for(workspace_id), copies=a_bucket_holding_the_three())
    # jscpd:ignore-end
    with connection.cursor() as cursor:
        reviewed = seed_narrowed(
            cursor,
            workspace_id=workspace_id,
            document_id=A_DELIVERY_NOTE_ID,
            **HER_NAME,
        )
        seed_suppression(
            cursor, workspace_id=workspace_id, document_id=A_DELIVERY_NOTE_ID
        )
    connection.commit()
    index_binding(
        bootstrap,
        run_for(workspace_id, "wiped"),
        copies=a_bucket_holding_the_three(),
    )

    assert reviewed["tier"] == "default-off"
    assert [
        (row["id"], row["review_state"])
        for row in marked_rows_of(connection, workspace_id)
        if row["rule_id"] == "PERSON"
    ] == [(reviewed["id"], "narrowed")]
    assert [
        row["tier"]
        for row in readings_of(connection, workspace_id)
        if row["id"] == reviewed["id"]
    ] == ["always"]


def test_the_insert_steps_over_a_known_span_and_over_no_other_collision(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_the_binding(connection, documents=(AN_INVOICE_ID,))
    bootstrap = bootstrap_for(dsn, tmp_path)
    index_binding(bootstrap, run_for(workspace_id), copies=a_bucket_holding_the_three())
    taken = marked_rows_of(connection, workspace_id)[0]["id"]
    another_span = ReadDocument(
        source_document_id=AN_INVOICE_ID,
        normalised_key=normalised_key_of(AN_INVOICE_ID),
        redacted=RedactedDocument(
            text="",
            findings=(
                Finding(
                    category="bank-details",
                    tier="always",
                    rule_id="UK_BANK_ACCOUNT",
                    start=0,
                    end=7,
                    score=0.55,
                ),
            ),
            counts=(("bank-details", 1),),
            verdict=None,
            version=THE_VERSION,
            content_hash=sha256_of(AN_INVOICE),
            overridden=(),
        ),
        chunks=(),
    )

    with (
        queue.connected(bootstrap.database_url) as worker,
        pytest.raises(
            psycopg.errors.UniqueViolation, match="finding_workspace_id_id_pk"
        ),
        queue.scoped(worker, workspace_id) as cursor,
    ):
        record_findings(
            cursor, run_for(workspace_id), [another_span], mint=lambda: taken
        )

    assert [row["id"] for row in marked_rows_of(connection, workspace_id)] == [taken]


# jscpd:ignore-start
def test_a_span_an_admin_restored_is_back_in_the_text_after_the_next_run(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_the_binding(connection, documents=(AN_INVOICE_ID,))
    bootstrap = bootstrap_for(dsn, tmp_path)

    index_binding(bootstrap, run_for(workspace_id), copies=a_bucket_holding_the_three())
    # jscpd:ignore-end
    withheld = [row["content"] for row in chunk_rows_of(connection, workspace_id)]

    with connection.cursor() as cursor:
        kept = seed_restore(
            cursor,
            workspace_id=workspace_id,
            document_id=AN_INVOICE_ID,
            rule_id="UK_BANK_ACCOUNT",
            char_start=54,
            char_end=97,
        )
    connection.commit()

    bucket = a_bucket_holding_the_three()
    index_binding(bootstrap, run_for(workspace_id, "restored"), copies=bucket)

    assert withheld == [AN_INVOICE_REDACTED]
    assert [row["content"] for row in chunk_rows_of(connection, workspace_id)] == [
        AN_INVOICE
    ]
    assert bucket.objects[normalised_key_of(AN_INVOICE_ID)] == AN_INVOICE.encode()
    assert marked_rows_of(connection, workspace_id) == [
        {
            "id": kept["id"],
            "document_id": AN_INVOICE_ID,
            "rule_id": "UK_BANK_ACCOUNT",
            "char_start": 54,
            "char_end": 97,
            "review_state": "kept-in-text",
            "restored": True,
        }
    ]


THE_INVOICES_ACCOUNT_AS_FOUND = "20-00-00 and the account number is 12345678"


# jscpd:ignore-start
def test_a_kept_span_an_erasure_names_stays_withheld_and_the_run_says_which(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
    connection, dsn = database
    workspace_id = seed_the_binding(connection, documents=(AN_INVOICE_ID,))
    bootstrap = bootstrap_for(dsn, tmp_path)
    index_binding(bootstrap, run_for(workspace_id), copies=a_bucket_holding_the_three())
    # jscpd:ignore-end
    with connection.cursor() as cursor:
        seed_restore(
            cursor,
            workspace_id=workspace_id,
            document_id=AN_INVOICE_ID,
            rule_id="UK_BANK_ACCOUNT",
            char_start=54,
            char_end=97,
        )
    connection.commit()

    kept = index_binding(
        bootstrap,
        run_for(workspace_id, "restored"),
        copies=a_bucket_holding_the_three(),
    )
    shown = [row["content"] for row in chunk_rows_of(connection, workspace_id)]

    with connection.cursor() as cursor:
        seed_suppression(
            cursor,
            workspace_id=workspace_id,
            document_id=AN_INVOICE_ID,
            identifiers={
                "emails": [],
                "names": [],
                "other": [THE_INVOICES_ACCOUNT_AS_FOUND],
            },
        )
    connection.commit()
    erased = index_binding(
        bootstrap, run_for(workspace_id, "wiped"), copies=a_bucket_holding_the_three()
    )

    assert shown == [AN_INVOICE]
    assert kept.as_row()["restores_overridden_by_erasure"] == []
    assert [row["content"] for row in chunk_rows_of(connection, workspace_id)] == [
        AN_INVOICE_REDACTED
    ]
    assert erased.as_row()["restores_overridden_by_erasure"] == [
        {
            "document_id": AN_INVOICE_ID,
            "rule_id": "UK_BANK_ACCOUNT",
            "char_start": 54,
            "char_end": 97,
        }
    ]


def read_afresh_in(written: str) -> list[int]:
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
    connection, dsn = database
    workspace_id = seed_the_binding(connection, documents=(AN_INVOICE_ID,))
    bootstrap = bootstrap_for(dsn, tmp_path)
    binding_directory = tmp_path / workspace_id / BINDING

    def files_now() -> dict[str, tuple[int, int]]:
        return {
            str(path.relative_to(binding_directory)): (
                path.stat().st_ino,
                path.stat().st_ctime_ns,
            )
            for path in sorted(binding_directory.rglob("*"))
            if path.is_file()
        }

    def inodes_of(files: dict[str, tuple[int, int]]) -> dict[str, int]:
        return {name: inode for name, (inode, _) in files.items()}

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
    kept, first = inodes_of(after_the_rule_change), inodes_of(after_the_first)
    assert kept.items() >= first.items()
    assert planted.exists() is False
    assert set(after_the_wipe) & set(after_the_first) != set()
    assert set(after_the_wipe.values()).isdisjoint(after_the_first.values())

    assert (unwiped_read, wiped_read) == ([0], [1])
    assert wiped.lmdb_bytes > 0
    assert chunk_rows_of(connection, workspace_id)[0]["content"] == AN_INVOICE_REDACTED


def test_the_runs_last_statement_recopy_takes_a_narrowing_that_landed_mid_run(
    database: tuple[psycopg.Connection, str], tmp_path: Path
) -> None:
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
    _connection, dsn = database

    assert re.search(rf"//{WORKER_LOGIN}:", dsn) is not None
    with psycopg.connect(dsn) as opened, opened.cursor() as cursor:
        cursor.execute(
            "SELECT current_user, pg_has_role(current_user, 'worker_rt', 'member')"
        )
        assert cursor.fetchone() == (WORKER_LOGIN, True)
