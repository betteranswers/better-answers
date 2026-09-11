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

**The file is in two halves, and the second one runs the real splitter.** The cases
above the divider state the agreement in this tier's own arithmetic — the address
derivation and the invariants the rows have to satisfy — written out here rather than
called, so that the agreement is held even where no code of ours has landed yet. The
cases below the divider run `better_answers_worker.pipeline`'s own splitter, id
derivation and locator builder over the same file, which is what makes this a contract
the worker is held to and not a statement about what the worker ought to do.

Neither half holds the other's literals. Each tier states its own reading of the wire
form, so a locator one tier has not been taught fails that tier's suite (ADR 0031).
"""

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


# -- the worker's own half: the splitter, the offsets and the derivations that ship ----
#
# Everything above states the agreement. Everything below runs the code that has to keep
# it — `better_answers_worker.pipeline` — over the same file, so a splitter that moved,
# an offset counted in the wrong unit or an id written to a different width is a red
# suite here and not a wrong row found later in a citation nobody can open.


def test_the_workers_splitter_cuts_the_agreements_text_into_the_rows_it_names() -> None:
    """Every field of every row, because a splitter that agreed on three of five would
    still write a citation the other tier could not open.

    The size is the fixture's and not this tier's: the agreement says its rows were cut
    at the size it names, and the way to hold the splitter to them is to run it there.
    """
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


def test_the_workers_offsets_are_code_points_and_the_astral_case_is_what_says_so() -> (
    None
):
    """The one case that fails silently when it is got wrong. The engine's splitter
    reports a byte offset beside the character one, and taking the wrong one puts every
    later span three places out on this text — a passage starting and ending mid-word,
    which no assertion about how many rows there are would catch.
    """
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


def test_the_workers_rows_partition_the_text_so_a_straddling_span_has_one_answer() -> (
    None
):
    """The property the agreement's description names and the splitter does not give for
    free: it trims the separator it cut on, which would leave the blank line between two
    paragraphs inside no row at all. A citation landing there would open nothing.
    """
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
    """The derivation that ships, over the agreement's own list — the separator,
    the width and the padding, all at once.
    """
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


def test_the_worker_writes_the_whole_wire_locator_and_never_the_span_alone() -> None:
    """The column holds the address a citation carries, both halves of it: the evidence
    row keys on that string and the read composes the same one back out of the columns,
    so a worker that wrote the span alone would write a second spelling of one address.
    """
    assert the_workers_locator("01M2Q3R4S5T6V7W8X9YZAB0001", 39, 106) == (
        "01M2Q3R4S5T6V7W8X9YZAB0001/chars:39-106"
    )
    assert the_workers_locator("01M2Q3R4S5T6V7W8X9YZAB0001", 0, 37) == (
        "01M2Q3R4S5T6V7W8X9YZAB0001/chars:0-37"
    )


def test_what_the_worker_writes_is_what_this_tiers_reading_parses_back() -> None:
    """The pair, both ways (`[TEST7]`): the builder that ships and the reading stated at
    the top of this file are one agreement seen from each end, so a locator the worker
    writes must be one this file's parser accepts and reads the same span out of.
    """
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


def test_the_size_a_run_splits_at_is_stated_and_is_not_the_fixtures() -> None:
    """Written down rather than read off the module (`[TEST9]`). The agreement's
    rows were cut at eighty bytes and say so; a run cuts at the size the pipeline
    states, and the two are deliberately different — a fixture sized for a production
    chunk would be a page of text nobody could read in a diff.
    """
    assert CHUNK_SIZE_BYTES == 1200
    assert read_document_chunk()["document"]["chunk_size"] == 80
