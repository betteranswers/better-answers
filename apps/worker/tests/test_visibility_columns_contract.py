import json
from pathlib import Path
from typing import Any, cast

from better_answers_worker.schema_view import TABLES

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"


CHUNK_TABLE = "index.chunk"
BINDING_TABLE = "public.source_binding"
DOCUMENT_TABLE = "public.source_document"


def read_visibility_columns() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "visibility-columns" / "cases.json").read_text(
        encoding="utf-8"
    )
    return cast("dict[str, Any]", json.loads(raw))


def test_every_column_the_agreement_names_on_a_chunk_row_is_one_the_table_has() -> None:
    fixture = read_visibility_columns()

    for column in fixture["chunk_columns"]:
        assert column in TABLES[CHUNK_TABLE], column


def test_every_binding_field_the_agreement_names_is_a_column_this_tier_reads() -> None:
    fixture = read_visibility_columns()

    for column in fixture["binding_fields"]:
        assert column in TABLES[BINDING_TABLE], column


def test_a_document_may_leave_its_class_unset_which_is_what_the_bindings_means() -> (
    None
):
    fixture = read_visibility_columns()
    column = fixture["document_class_column"]

    assert TABLES[DOCUMENT_TABLE][column] == "text"
    assert TABLES[BINDING_TABLE][column] == "text NOT NULL"


def test_the_class_the_agreement_states_is_the_narrower_of_the_two() -> None:
    fixture = read_visibility_columns()
    rank = fixture["sensitivity_rank"]

    for case in fixture["cases"]:
        binding = case["binding"]["sensitivity"]
        document = case["document"]["sensitivity"]
        folded = (
            binding
            if document is None
            else min(binding, document, key=lambda word: rank[word])
        )

        assert case["chunk"]["sensitivity"] == folded, case["why"]

        assert rank[case["chunk"]["sensitivity"]] <= rank[binding], case["case"]


def test_the_audience_and_the_publish_stamp_travel_from_the_binding_unchanged() -> None:
    fixture = read_visibility_columns()

    for case in fixture["cases"]:
        binding, chunk = case["binding"], case["chunk"]

        assert chunk["audience"] == binding["audience"], case["case"]
        assert chunk["audience_groups"] == binding["audience_groups"], case["case"]
        assert chunk["published_at"] == binding["published_at"], case["case"]


def test_the_agreement_states_both_arms_of_the_documents_own_class() -> None:

    fixture = read_visibility_columns()
    rank = fixture["sensitivity_rank"]

    def ranked(case: dict[str, Any], side: str) -> int:
        word = case[side]["sensitivity"]
        return -1 if word is None else rank[word]

    narrower = [
        case
        for case in fixture["cases"]
        if case["document"]["sensitivity"] is not None
        and ranked(case, "document") < ranked(case, "binding")
    ]
    wider = [
        case
        for case in fixture["cases"]
        if case["document"]["sensitivity"] is not None
        and ranked(case, "document") > ranked(case, "binding")
    ]

    assert narrower
    assert wider
    for case in narrower:
        assert case["chunk"]["sensitivity"] == case["document"]["sensitivity"], case[
            "case"
        ]
    for case in wider:
        assert case["chunk"]["sensitivity"] == case["binding"]["sensitivity"], case[
            "case"
        ]


def test_the_two_writers_of_one_source_are_named_in_the_order_a_row_meets_them() -> (
    None
):
    fixture = read_visibility_columns()

    assert [writer["writer"] for writer in fixture["writers"]] == [
        "the worker",
        "the app",
    ]
