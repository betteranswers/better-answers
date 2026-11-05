import json
import re
from typing import Any, cast

from better_answers_worker.pipeline import (
    PASSAGE_SIZE_BYTES,
    split_into_passages,
)
from better_answers_worker.pipeline import (
    locator_of as worker_locator_of,
)
from better_answers_worker.pipeline import (
    passage_id_of as worker_passage_id_of,
)
from support.roots import REPOSITORY_ROOT

CONTRACTS_DIR = REPOSITORY_ROOT / "contracts"


DOCUMENT_ID = re.compile(r"[0-9A-HJKMNP-TV-Z]{26}")

OFFSET = re.compile(r"0|[1-9][0-9]*")
SPAN_PREFIX = "chars:"
NOT_FOUND = "not-found"


def read_document_passage() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "document-passage" / "cases.json").read_text(
        encoding="utf-8"
    )
    return cast("dict[str, Any]", json.loads(raw))


def passage_id_of(source_document_id: str, ordinal: int, digits: int) -> str:
    return f"{source_document_id}#{ordinal:0{digits}d}"


def parse_locator(wire: str) -> tuple[str, int, int] | str:
    parts = wire.split("/")
    if len(parts) != 2:
        return NOT_FOUND
    document, span = parts
    if not DOCUMENT_ID.fullmatch(document) or not span.startswith(SPAN_PREFIX):
        return NOT_FOUND
    offsets = span[len(SPAN_PREFIX) :].split("-")
    if len(offsets) != 2:
        return NOT_FOUND
    start, end = offsets
    if not OFFSET.fullmatch(start) or not OFFSET.fullmatch(end):
        return NOT_FOUND

    if int(start) >= int(end):
        return NOT_FOUND
    return (document, int(start), int(end))


def test_derives_the_passage_id_from_the_document_and_ordinal() -> None:
    fixture = read_document_passage()
    digits = fixture["passage_id"]["ordinal_digits"]

    for case in fixture["passage_id"]["cases"]:
        derived = passage_id_of(case["source_document_id"], case["ordinal"], digits)
        assert derived == case["id"], case["why"]


def test_every_passage_row_id_matches_its_derived_id() -> None:
    fixture = read_document_passage()
    document = fixture["document"]
    digits = fixture["passage_id"]["ordinal_digits"]

    for row in document["passages"]:
        derived = passage_id_of(document["source_document_id"], row["ordinal"], digits)
        assert derived == row["id"], row["ordinal"]


def test_derived_ids_sort_by_ordinal_and_differ_from_document_ids() -> None:
    fixture = read_document_passage()
    shape = re.compile(fixture["passage_id"]["pattern"])
    ids = [case["id"] for case in fixture["passage_id"]["cases"]]

    for identifier in ids:
        assert shape.fullmatch(identifier), identifier

        assert not DOCUMENT_ID.fullmatch(identifier), identifier
    document_ids = [
        case["id"] for case in fixture["passage_id"]["cases"] if case["ordinal"] < 1000
    ]
    assert document_ids == sorted(document_ids)


def test_parses_a_wire_locator_to_its_document_and_span() -> None:
    fixture = read_document_passage()

    for case in fixture["locator"]["must_parse"]:
        parsed = parse_locator(case["wire"])
        assert parsed == (
            case["source_document_id"],
            case["char_start"],
            case["char_end"],
        ), case["why"]


def test_rejects_every_malformed_locator_in_the_cases_file() -> None:
    fixture = read_document_passage()

    for case in fixture["locator"]["must_not_parse"]:
        assert parse_locator(case["wire"]) == fixture["locator"]["not_found"], case[
            "why"
        ]


def test_a_passage_row_locator_parses_to_its_own_span() -> None:
    fixture = read_document_passage()
    document = fixture["document"]

    for row in document["passages"]:
        assert parse_locator(row["locator"]) == (
            document["source_document_id"],
            row["char_start"],
            row["char_end"],
        ), row["ordinal"]


def test_offsets_count_code_points_not_utf16_units() -> None:
    fixture = read_document_passage()
    document = fixture["document"]
    text = document["normalised_text"]

    assert len(text) == document["code_points"]
    assert len(text.encode("utf-16-le")) // 2 == document["utf16_units"]
    assert document["utf16_units"] > document["code_points"]

    astral = document["astral"]
    assert text[astral["at"]] == astral["character"]
    assert len(astral["character"].encode("utf-16-le")) // 2 == astral["utf16_units"]
    assert ord(astral["character"]) == int(astral["code_point"].removeprefix("U+"), 16)


def test_the_cases_file_passage_rows_partition_the_text() -> None:
    fixture = read_document_passage()
    document = fixture["document"]
    text = document["normalised_text"]

    at = 0
    for row in document["passages"]:
        assert row["char_start"] == at, row["ordinal"]
        assert text[row["char_start"] : row["char_end"]] == row["content"], row[
            "ordinal"
        ]
        assert len(row["content"]) <= document["passage_size"], row["ordinal"]
        at = row["char_end"]
    assert at == document["code_points"]


def test_a_locator_selects_the_expected_passage_text() -> None:
    fixture = read_document_passage()
    document = fixture["document"]
    text = document["normalised_text"]
    passage_cases = [case for case in fixture["open"] if case["expect"] == "passage"]

    assert passage_cases
    for case in passage_cases:
        parsed = parse_locator(case["wire"])
        assert isinstance(parsed, tuple), case["case"]
        _document, start, end = parsed
        assert text[start:end] == case["passage"], case["why"]


def test_a_passage_matches_the_text_of_the_rows_it_covers() -> None:

    fixture = read_document_passage()
    document = fixture["document"]
    covering = [case for case in fixture["open"] if case.get("covers_ordinals")]

    assert covering
    for case in covering:
        parsed = parse_locator(case["wire"])
        assert isinstance(parsed, tuple), case["case"]
        _document, start, end = parsed
        rows = [
            row
            for row in document["passages"]
            if row["char_start"] < end and row["char_end"] > start
        ]
        assert [row["ordinal"] for row in rows] == case["covers_ordinals"], case["case"]

        joined = "".join(row["content"] for row in rows)
        offset = rows[0]["char_start"]
        assert joined[start - offset : end - offset] == case["passage"], case["why"]


def test_the_parser_rejects_a_malformed_locator() -> None:
    fixture = read_document_passage()
    rejected_by_parser = [
        case for case in fixture["open"] if case.get("refused_by") == "the parser"
    ]

    assert rejected_by_parser
    for case in rejected_by_parser:
        assert parse_locator(case["wire"]) == fixture["locator"]["not_found"], case[
            "case"
        ]


def test_the_parser_accepts_a_well_formed_locator_the_read_rejects() -> None:

    fixture = read_document_passage()
    document = fixture["document"]
    rejected_by_read = [
        case for case in fixture["open"] if case.get("refused_by") == "the read"
    ]

    assert rejected_by_read
    for case in rejected_by_read:
        parsed = parse_locator(case["wire"])
        assert isinstance(parsed, tuple), case["case"]
        named, _start, end = parsed
        if case["because"] == "out of range":
            assert named == document["source_document_id"], case["case"]
            assert end > document["code_points"], case["case"]
        else:
            assert named != document["source_document_id"], case["case"]


def test_split_into_passages_returns_the_cases_file_rows() -> None:
    document = read_document_passage()["document"]

    cut = split_into_passages(
        document["source_document_id"],
        document["normalised_text"],
        passage_size=document["passage_size"],
    )

    assert [
        {
            "ordinal": passage.ordinal,
            "id": passage.id,
            "char_start": passage.char_start,
            "char_end": passage.char_end,
            "locator": passage.locator,
            "content": passage.content,
        }
        for passage in cut
    ] == document["passages"]


def test_split_into_passages_counts_code_points_past_an_astral_character() -> None:
    document = read_document_passage()["document"]
    text = document["normalised_text"]

    assert len(text) == 165
    assert len(text.encode("utf-16-le")) // 2 == 166
    assert len(text.encode("utf-8")) == 168
    assert text[document["astral"]["at"]] == document["astral"]["character"]

    cut = split_into_passages(
        document["source_document_id"], text, passage_size=document["passage_size"]
    )

    assert (cut[0].char_start, cut[0].char_end) == (0, 39)
    assert cut[0].content == "Invoice \U0001f9fe 2026-041 is due on receipt.\n\n"
    assert cut[0].locator == "01M2Q3R4S5T6V7W8X9YZAB0001/chars:0-39"


def test_split_into_passages_partitions_the_text() -> None:
    document = read_document_passage()["document"]
    text = document["normalised_text"]

    cut = split_into_passages(
        document["source_document_id"], text, passage_size=document["passage_size"]
    )

    assert cut[0].char_start == 0
    assert cut[-1].char_end == len(text)
    assert [passage.char_end for passage in cut[:-1]] == [
        passage.char_start for passage in cut[1:]
    ]
    assert "".join(passage.content for passage in cut) == text


def test_passage_id_of_matches_every_cases_file_id() -> None:
    passage_id_cases = read_document_passage()["passage_id"]

    assert [
        worker_passage_id_of(case["source_document_id"], case["ordinal"])
        for case in passage_id_cases["cases"]
    ] == [case["id"] for case in passage_id_cases["cases"]]
    assert worker_passage_id_of("01M2Q3R4S5T6V7W8X9YZAB0001", 0) == (
        "01M2Q3R4S5T6V7W8X9YZAB0001#000000"
    )
    assert worker_passage_id_of("01M2Q3R4S5T6V7W8X9YZAB0001", 142) == (
        "01M2Q3R4S5T6V7W8X9YZAB0001#000142"
    )


def test_locator_of_writes_the_document_id_and_the_span() -> None:
    assert worker_locator_of("01M2Q3R4S5T6V7W8X9YZAB0001", 39, 106) == (
        "01M2Q3R4S5T6V7W8X9YZAB0001/chars:39-106"
    )
    assert worker_locator_of("01M2Q3R4S5T6V7W8X9YZAB0001", 0, 37) == (
        "01M2Q3R4S5T6V7W8X9YZAB0001/chars:0-37"
    )


def test_parses_every_locator_the_worker_writes() -> None:
    document = read_document_passage()["document"]

    for row in document["passages"]:
        wire = worker_locator_of(
            document["source_document_id"], row["char_start"], row["char_end"]
        )
        assert wire == row["locator"]
        assert parse_locator(wire) == (
            document["source_document_id"],
            row["char_start"],
            row["char_end"],
        )


def test_passage_size_is_1200_and_the_fixture_uses_80() -> None:
    assert PASSAGE_SIZE_BYTES == 1200
    assert read_document_passage()["document"]["passage_size"] == 80
