import json
from pathlib import Path
from typing import Any, cast

import psycopg
import pytest

from better_answers_worker import queue
from better_answers_worker.pipeline import SENSITIVITY_MOVED_KEY, IndexOutcome
from better_answers_worker.pipeline.catalogue import reconcile_catalogue
from test_pipeline_host import bootstrap_for
from test_pipeline_index import (
    AN_INVOICE_ID,
    AN_INVOICE_REDACTED,
    a_connected_source_whose_document_stands_at,
    a_migrated_database,  # noqa: F401  # pytest finds the `database` fixture by import
    an_invoice_read_as,
    catalogue_rows_of,
)

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"


def read_sync_sensitivity_moves() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "sync-sensitivity-moves" / "cases.json").read_text(
        encoding="utf-8"
    )
    return cast("dict[str, Any]", json.loads(raw))


MOVES = read_sync_sensitivity_moves()["moves"]


def test_the_outcome_carries_the_agreed_key_even_when_empty() -> None:
    key = read_sync_sensitivity_moves()["key"]

    assert key == SENSITIVITY_MOVED_KEY
    assert IndexOutcome(0, 0, 0).as_row()[key] == []


@pytest.mark.parametrize("move", MOVES, ids=[move["why"] for move in MOVES])
def test_the_catalogue_write_names_a_document_exactly_when_it_moved(
    database: tuple[psycopg.Connection, str], tmp_path: Path, move: dict[str, Any]
) -> None:
    connection, dsn = database
    workspace_id = a_connected_source_whose_document_stands_at(
        connection, AN_INVOICE_ID, move["stored"]
    )
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE source_document SET narrowed_to = %s WHERE id = %s",
            (move["narrowed_to"], AN_INVOICE_ID),
        )
    connection.commit()
    read = an_invoice_read_as(
        text=AN_INVOICE_REDACTED, verdict=move["verdict"], lifted=move["lifted"]
    )

    with (
        queue.connected(bootstrap_for(dsn, tmp_path).database_url) as worker,
        queue.scoped(worker, workspace_id) as cursor,
    ):
        moved = reconcile_catalogue(cursor, [read])

    stored = catalogue_rows_of(connection, workspace_id)[0]["sensitivity"]
    assert stored == move["after"]
    assert list(moved) == ([AN_INVOICE_ID] if move["named"] else [])
