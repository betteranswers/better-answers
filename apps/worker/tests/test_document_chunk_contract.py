import json
import re
from pathlib import Path
from typing import Any, cast

from better_answers_worker.pipeline import (
    CHUNK_SIZE_BYTES,
    split_into_chunks,
)
from better_answers_worker.pipeline import (
    chunk_id_of as the_workers_chunk_id,
)
from better_answers_worker.pipeline import (
    locator_of as the_workers_locator,
)

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"


DOCUMENT_ID = re.compile(r"[0-9A-HJKMNP-TV-Z]{26}")

OFFSET = re.compile(r"0|[1-9][0-9]*")
SPAN_PREFIX = "chars:"
NOT_FOUND = "not-found"


def read_document_chunk() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "document-chunk" / "cases.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def chunk_id_of(source_document_id: str, ordinal: int, digits: int) -> str:
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


def test_derives_the_chunk_id_from_the_document_and_ordinal() -> None:
    fixture = read_document_chunk()
    digits = fixture["chunk_id"]["ordinal_digits"]

    for case in fixture["chunk_id"]["cases"]:
        derived = chunk_id_of(case["source_document_id"], case["ordinal"], digits)
        assert derived == case["id"], case["why"]


def test_every_chunk_row_carries_the_id_its_address_derives() -> None:
    fixture = read_document_chunk()
    document = fixture["document"]
    digits = fixture["chunk_id"]["ordinal_digits"]

    for row in document["chunks"]:
        derived = chunk_id_of(document["source_document_id"], row["ordinal"], digits)
        assert derived == row["id"], row["ordinal"]


def test_a_derived_id_sorts_by_ordinal_and_never_looks_minted() -> None:
    fixture = read_document_chunk()
    shape = re.compile(fixture["chunk_id"]["pattern"])
    ids = [case["id"] for case in fixture["chunk_id"]["cases"]]

    for identifier in ids:
        assert shape.fullmatch(identifier), identifier

        assert not DOCUMENT_ID.fullmatch(identifier), identifier
    document_ids = [
        case["id"] for case in fixture["chunk_id"]["cases"] if case["ordinal"] < 1000
    ]
    assert document_ids == sorted(document_ids)


def test_parses_a_wire_locator_to_its_document_and_span() -> None:
    fixture = read_document_chunk()

    for case in fixture["locator"]["must_parse"]:
        read = parse_locator(case["wire"])
        assert read == (
            case["source_document_id"],
            case["char_start"],
            case["char_end"],
        ), case["why"]


def test_refuses_every_wire_locator_shape_the_agreement_rejects() -> None:
    fixture = read_document_chunk()

    for case in fixture["locator"]["must_not_parse"]:
        assert parse_locator(case["wire"]) == fixture["locator"]["not_found"], case[
            "why"
        ]


def test_a_chunk_rows_locator_reads_back_to_its_own_span() -> None:
    fixture = read_document_chunk()
    document = fixture["document"]

    for row in document["chunks"]:
        assert parse_locator(row["locator"]) == (
            document["source_document_id"],
            row["char_start"],
            row["char_end"],
        ), row["ordinal"]


def test_counts_code_points_where_utf16_units_run_longer() -> None:
    fixture = read_document_chunk()
    document = fixture["document"]
    text = document["normalised_text"]

    assert len(text) == document["code_points"]
    assert len(text.encode("utf-16-le")) // 2 == document["utf16_units"]
    assert document["utf16_units"] > document["code_points"]

    astral = document["astral"]
    assert text[astral["at"]] == astral["character"]
    assert len(astral["character"].encode("utf-16-le")) // 2 == astral["utf16_units"]
    assert ord(astral["character"]) == int(astral["code_point"].removeprefix("U+"), 16)


def test_the_agreed_chunk_rows_partition_the_text() -> None:
    fixture = read_document_chunk()
    document = fixture["document"]
    text = document["normalised_text"]

    at = 0
    for row in document["chunks"]:
        assert row["char_start"] == at, row["ordinal"]
        assert text[row["char_start"] : row["char_end"]] == row["content"], row[
            "ordinal"
        ]
        assert len(row["content"]) <= document["chunk_size"], row["ordinal"]
        at = row["char_end"]
    assert at == document["code_points"]


def test_a_locator_opens_the_span_cut_from_the_text() -> None:
    fixture = read_document_chunk()
    document = fixture["document"]
    text = document["normalised_text"]
    answered = [case for case in fixture["open"] if case["expect"] == "passage"]

    assert answered
    for case in answered:
        read = parse_locator(case["wire"])
        assert isinstance(read, tuple), case["case"]
        _document, start, end = read
        assert text[start:end] == case["passage"], case["why"]


def test_a_passage_matches_the_text_of_the_rows_it_covers() -> None:

    fixture = read_document_chunk()
    document = fixture["document"]
    covering = [case for case in fixture["open"] if case.get("covers_ordinals")]

    assert covering
    for case in covering:
        read = parse_locator(case["wire"])
        assert isinstance(read, tuple), case["case"]
        _document, start, end = read
        rows = [
            row
            for row in document["chunks"]
            if row["char_start"] < end and row["char_end"] > start
        ]
        assert [row["ordinal"] for row in rows] == case["covers_ordinals"], case["case"]

        joined = "".join(row["content"] for row in rows)
        offset = rows[0]["char_start"]
        assert joined[start - offset : end - offset] == case["passage"], case["why"]


def test_a_malformed_locator_is_refused_before_anything_is_read() -> None:
    fixture = read_document_chunk()
    at_the_parser = [
        case for case in fixture["open"] if case.get("refused_by") == "the parser"
    ]

    assert at_the_parser
    for case in at_the_parser:
        assert parse_locator(case["wire"]) == fixture["locator"]["not_found"], case[
            "case"
        ]


def test_leaves_a_well_shaped_locator_for_the_read_to_refuse() -> None:

    fixture = read_document_chunk()
    document = fixture["document"]
    at_the_read = [
        case for case in fixture["open"] if case.get("refused_by") == "the read"
    ]

    assert at_the_read
    for case in at_the_read:
        read = parse_locator(case["wire"])
        assert isinstance(read, tuple), case["case"]
        named, _start, end = read
        if case["because"] == "out of range":
            assert named == document["source_document_id"], case["case"]
            assert end > document["code_points"], case["case"]
        else:
            assert named != document["source_document_id"], case["case"]


def test_the_workers_splitter_cuts_the_rows_the_agreement_names() -> None:
    document = read_document_chunk()["document"]

    cut = split_into_chunks(
        document["source_document_id"],
        document["normalised_text"],
        chunk_size=document["chunk_size"],
    )

    assert [
        {
            "ordinal": chunk.ordinal,
            "id": chunk.id,
            "char_start": chunk.char_start,
            "char_end": chunk.char_end,
            "locator": chunk.locator,
            "content": chunk.content,
        }
        for chunk in cut
    ] == document["chunks"]


def test_the_workers_offsets_count_code_points_past_an_astral_character() -> None:
    document = read_document_chunk()["document"]
    text = document["normalised_text"]

    assert len(text) == 165
    assert len(text.encode("utf-16-le")) // 2 == 166
    assert len(text.encode("utf-8")) == 168
    assert text[document["astral"]["at"]] == document["astral"]["character"]

    cut = split_into_chunks(
        document["source_document_id"], text, chunk_size=document["chunk_size"]
    )

    assert (cut[0].char_start, cut[0].char_end) == (0, 39)
    assert cut[0].content == "Invoice \U0001f9fe 2026-041 is due on receipt.\n\n"
    assert cut[0].locator == "01M2Q3R4S5T6V7W8X9YZAB0001/chars:0-39"


def test_the_workers_chunks_partition_the_text() -> None:
    document = read_document_chunk()["document"]
    text = document["normalised_text"]

    cut = split_into_chunks(
        document["source_document_id"], text, chunk_size=document["chunk_size"]
    )

    assert cut[0].char_start == 0
    assert cut[-1].char_end == len(text)
    assert [chunk.char_end for chunk in cut[:-1]] == [
        chunk.char_start for chunk in cut[1:]
    ]
    assert "".join(chunk.content for chunk in cut) == text


def test_the_workers_id_derivation_answers_every_case_the_agreement_names() -> None:
    agreement = read_document_chunk()["chunk_id"]

    assert [
        the_workers_chunk_id(case["source_document_id"], case["ordinal"])
        for case in agreement["cases"]
    ] == [case["id"] for case in agreement["cases"]]
    assert the_workers_chunk_id("01M2Q3R4S5T6V7W8X9YZAB0001", 0) == (
        "01M2Q3R4S5T6V7W8X9YZAB0001#000000"
    )
    assert the_workers_chunk_id("01M2Q3R4S5T6V7W8X9YZAB0001", 142) == (
        "01M2Q3R4S5T6V7W8X9YZAB0001#000142"
    )


def test_writes_the_whole_wire_locator_never_the_span_alone() -> None:
    assert the_workers_locator("01M2Q3R4S5T6V7W8X9YZAB0001", 39, 106) == (
        "01M2Q3R4S5T6V7W8X9YZAB0001/chars:39-106"
    )
    assert the_workers_locator("01M2Q3R4S5T6V7W8X9YZAB0001", 0, 37) == (
        "01M2Q3R4S5T6V7W8X9YZAB0001/chars:0-37"
    )


def test_parses_back_every_locator_the_worker_writes() -> None:
    document = read_document_chunk()["document"]

    for row in document["chunks"]:
        wire = the_workers_locator(
            document["source_document_id"], row["char_start"], row["char_end"]
        )
        assert wire == row["locator"]
        assert parse_locator(wire) == (
            document["source_document_id"],
            row["char_start"],
            row["char_end"],
        )


def test_a_run_splits_at_a_stated_size_not_the_fixtures() -> None:
    assert CHUNK_SIZE_BYTES == 1200
    assert read_document_chunk()["document"]["chunk_size"] == 80
