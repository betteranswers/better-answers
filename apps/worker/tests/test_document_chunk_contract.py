"""The document-chunk agreement's Python half (ADR 0031, ADR 0036, ADR 0020).

The TypeScript half is ``packages/core/test/document-chunk.contract.test.ts``, and the
two read the same file in ``contracts/document-chunk/``: the derived chunk id, the wire
locator, the rows a document's normalised redacted text is cut into and the passage a
locator opens.

**This is the tier that produces the rows, and the tier the offsets are easy for.**
Python indexes a string by code point, which is what a locator counts in, so the
arithmetic below is the arithmetic the splitter and the run will do — and the cases pass
here by construction where the other half has to work for them. That asymmetry is the
point of the file: the astral character makes the other tier's natural reading
wrong, and this half is what says what right looks like.

**No splitter is called here and none is written.** The splitter is cocoindex's,
composed in T-129, and the run that writes the rows is T-129's and T-130's; what this
half can assert today is the address arithmetic and the invariants the rows have to
satisfy, which is exactly what the splitter will be held to when it lands.

Neither half holds the other's literals. Each tier states its own reading of the wire
form, so a locator one tier has not been taught fails that tier's suite (ADR 0031).
"""

import json
import re
from pathlib import Path
from typing import Any, cast

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"

# The one shape an id the platform mints has, as ``contracts/id-shape/cases.json``
# states it. Written here rather than imported from that fixture: a locator's document
# half is held to it by this tier, and a tier that read the shape out of the file it is
# checking would be agreeing with itself.
DOCUMENT_ID = re.compile(r"[0-9A-HJKMNP-TV-Z]{26}")
# A whole number written one way: no sign, no leading zero, no fraction.
OFFSET = re.compile(r"0|[1-9][0-9]*")
SPAN_PREFIX = "chars:"
NOT_FOUND = "not-found"


def read_document_chunk() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "document-chunk" / "cases.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def chunk_id_of(source_document_id: str, ordinal: int, digits: int) -> str:
    """This tier's derivation of a chunk's id from the address it sits at."""
    return f"{source_document_id}#{ordinal:0{digits}d}"


def parse_locator(wire: str) -> tuple[str, int, int] | str:
    """This tier's reading of a wire locator, or the one refusal word.

    What is refused here is what the string itself is wrong about. Whether the document
    exists and whether the text runs that far are the run's questions, not this one's.
    """
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
    # The end is exclusive, so an end at or before the start addresses no text at all.
    if int(start) >= int(end):
        return NOT_FOUND
    return (document, int(start), int(end))


def test_the_chunk_id_is_derived_from_the_document_and_the_ordinal() -> None:
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


def test_a_derived_id_sorts_by_ordinal_and_is_never_the_shape_the_platform_mints() -> (
    None
):
    fixture = read_document_chunk()
    shape = re.compile(fixture["chunk_id"]["pattern"])
    ids = [case["id"] for case in fixture["chunk_id"]["cases"]]

    for identifier in ids:
        assert shape.fullmatch(identifier), identifier
        # The padding is what makes the text order the ordinal order; the id is composed
        # and not minted, so the platform's own id shape must refuse it.
        assert not DOCUMENT_ID.fullmatch(identifier), identifier
    document_ids = [
        case["id"] for case in fixture["chunk_id"]["cases"] if case["ordinal"] < 1000
    ]
    assert document_ids == sorted(document_ids)


def test_the_wire_locator_reads_the_document_and_the_span_the_agreement_names() -> None:
    fixture = read_document_chunk()

    for case in fixture["locator"]["must_parse"]:
        read = parse_locator(case["wire"])
        assert read == (
            case["source_document_id"],
            case["char_start"],
            case["char_end"],
        ), case["why"]


def test_the_wire_locator_refuses_every_shape_the_agreement_says_is_not_one() -> None:
    fixture = read_document_chunk()

    for case in fixture["locator"]["must_not_parse"]:
        assert parse_locator(case["wire"]) == fixture["locator"]["not_found"], case[
            "why"
        ]


def test_a_chunk_rows_own_locator_reads_back_to_the_span_it_carries() -> None:
    fixture = read_document_chunk()
    document = fixture["document"]

    for row in document["chunks"]:
        assert parse_locator(row["locator"]) == (
            document["source_document_id"],
            row["char_start"],
            row["char_end"],
        ), row["ordinal"]


def test_the_text_is_counted_in_code_points_and_is_longer_in_utf16_units() -> None:
    fixture = read_document_chunk()
    document = fixture["document"]
    text = document["normalised_text"]

    # ``len`` on this tier counts code points, which is what a locator counts in. The
    # UTF-16 length is measured rather than counted, because nothing here works in it.
    assert len(text) == document["code_points"]
    assert len(text.encode("utf-16-le")) // 2 == document["utf16_units"]
    assert document["utf16_units"] > document["code_points"]

    astral = document["astral"]
    assert text[astral["at"]] == astral["character"]
    assert len(astral["character"].encode("utf-16-le")) // 2 == astral["utf16_units"]
    assert ord(astral["character"]) == int(astral["code_point"].removeprefix("U+"), 16)


def test_the_chunk_rows_partition_the_text_so_a_straddling_span_has_one_answer() -> (
    None
):
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


def test_the_passage_a_locator_opens_is_the_span_cut_out_of_the_text() -> None:
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


def test_a_passage_is_the_same_text_cut_from_the_rows_it_covers() -> None:
    # The property the partition buys: a span straddling two rows answers as one
    # passage, whether it is cut from the whole text or joined from the rows a read
    # selects by two comparisons. `passageAt` reads rows and a citation names text.
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


def test_a_well_shaped_locator_is_left_for_the_read_to_refuse() -> None:
    # A span past the end of the text and a document the workspace does not hold are
    # both well-formed addresses, answered with the word a withheld passage gets. A
    # parser that refused them would be answering without the text or the rows in
    # front of it, and the refusals would stop meaning one thing.
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
