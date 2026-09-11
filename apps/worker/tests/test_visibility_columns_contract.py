"""The visibility-columns agreement's Python half (ADR 0031, ADR 0023, ADR 0039).

The TypeScript half is ``packages/core/test/visibility-columns.contract.test.ts``, and
the two read the same file in ``contracts/visibility-columns/``: the fields a binding
carries, the class a document may carry of its own, and the columns every chunk row must
carry so the app's read predicate has something to test.

**This tier is the one that writes them.** The predicate is not this tier's work and its
logic is not in the agreement (ADR 0031, *The read predicate leaves the contract*); what
is, is the columns. A run that lands a row without them, or copies them from the binding
without folding in the document's own class, leaves the app filtering on a field that
says the wrong thing — and nothing fails until a reader sees a passage they should
not have.

What this half asserts is the shape the worker writes into, read out of the generated
schema view, and the fold each case states. The run that does the writing is T-129's and
the re-copy that settles the two writers' race is held from both sides by the cross-tier
test (T-137).

Neither half holds the other's literals: the TypeScript half folds through the app's own
`narrower` and its own boundary, and this one through the columns and the order the
agreement writes down.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any, cast

from better_answers_worker.pipeline import SENSITIVITY_ORDER, Visibility
from better_answers_worker.schema_view import TABLES

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"

# The three tables the columns travel across, named here rather than read out of the
# agreement: a tier that took the table names from the file it is checking would be
# agreeing with itself about where it writes.
CHUNK_TABLE = "index.chunk"
BINDING_TABLE = "public.source_binding"
DOCUMENT_TABLE = "public.source_document"


def read_visibility_columns() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "visibility-columns" / "cases.json").read_text(
        encoding="utf-8"
    )
    return cast("dict[str, Any]", json.loads(raw))


def test_every_column_the_agreement_names_on_a_chunk_row_is_one_this_tier_writes() -> (
    None
):
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

    # Nullable on purpose and not by omission: null is the ordinary case and says the
    # binding decides. A NOT NULL here would force every run to invent a class.
    assert TABLES[DOCUMENT_TABLE][column] == "text"
    assert TABLES[BINDING_TABLE][column] == "text NOT NULL"


def test_the_class_a_run_writes_is_the_narrower_of_the_two_for_every_case() -> None:
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
        # The fold only ever takes away: a row is never wider than its binding.
        assert rank[case["chunk"]["sensitivity"]] <= rank[binding], case["case"]


def test_the_audience_and_the_publish_stamp_travel_from_the_binding_unchanged() -> None:
    fixture = read_visibility_columns()

    for case in fixture["cases"]:
        binding, chunk = case["binding"], case["chunk"]

        # A document has no audience of its own: these three are copies, not folds.
        assert chunk["audience"] == binding["audience"], case["case"]
        assert chunk["audience_groups"] == binding["audience_groups"], case["case"]
        assert chunk["published_at"] == binding["published_at"], case["case"]


def test_the_agreement_states_both_arms_of_the_documents_own_class() -> None:
    # The pair the column turns on: a class narrower than the binding's reaches the row,
    # and a class wider than it does not. One arm alone would let an override pass for a
    # narrowing, or a column nothing reads pass for a narrowing.
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


# -- the fold the code ships ----------------------------------------------------------
#
# Everything above reads the agreement and checks it says what it means to say. What
# follows runs **the fold a run actually applies** over the same six cases, because an
# agreement both tiers hold and neither runs is an agreement about nothing. It is the
# shape wave C's splitter cases take in `test_document_chunk_contract.py`, for the same
# reason: the arithmetic is stated above, and the code that ships is held to it here.


def visibility_from(binding: dict[str, Any]) -> Visibility:
    """One case's binding as the run reads it off the row."""
    groups = binding["audience_groups"]
    return Visibility(
        published_at=(
            None
            if binding["published_at"] is None
            else datetime.fromisoformat(str(binding["published_at"]))
        ),
        sensitivity=str(binding["sensitivity"]),
        audience=str(binding["audience"]),
        audience_groups=None if groups is None else tuple(str(one) for one in groups),
    )


def test_the_order_the_fold_reads_is_the_rank_the_agreement_writes_down() -> None:
    """The words in one order, in the one place either fold can be changed: the Python
    fold indexes this tuple and the run's last statement hands the same list to Postgres
    as an array. The agreement writes the rank as a mapping of word to place, so the two
    are held equal here rather than copied and hoped over.
    """
    rank = read_visibility_columns()["sensitivity_rank"]

    assert list(SENSITIVITY_ORDER) == sorted(rank, key=lambda word: rank[word])


def test_the_fold_a_run_applies_answers_every_case_the_agreement_states() -> None:
    """The shipping fold over the agreement's six cases, field by field. A case that
    asked the code to agree with itself would pass whatever the code did; this one asks
    it to agree with the file the other tier reads.
    """
    for case in read_visibility_columns()["cases"]:
        folded = visibility_from(case["binding"]).narrowed_by(
            case["document"]["sensitivity"]
        )
        columns = dict(folded.as_columns())
        stamped = columns["published_at"]

        assert columns["sensitivity"] == case["chunk"]["sensitivity"], case["case"]
        assert columns["audience"] == case["chunk"]["audience"], case["case"]
        assert columns["audience_groups"] == case["chunk"]["audience_groups"], case[
            "case"
        ]
        # The instants and not their spellings: the agreement writes the stamp with
        # milliseconds and a column holds an instant, so two strings that differ by a
        # zero are one moment.
        expected = case["chunk"]["published_at"]
        assert stamped == (
            None if expected is None else datetime.fromisoformat(str(expected))
        ), case["case"]
