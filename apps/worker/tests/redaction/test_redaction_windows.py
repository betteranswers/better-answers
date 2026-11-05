import json
import subprocess
import sys
from collections.abc import Sequence
from itertools import pairwise
from typing import NamedTuple

from presidio_analyzer.chunkers import CharacterBasedTextChunker

from better_answers_worker.redaction.detector import AnchoredWindows
from better_answers_worker.redaction.engine import findings_of, spans_detected
from support.planted_page import FIXTURE_PAGE

HEADING_LESS_PAGE = FIXTURE_PAGE.parent / "depot-delivery-terms.txt"


class PresidioCut(NamedTuple):
    page_length: int
    at: int
    word_starts_at: int
    word_ends_at: int
    word: str
    fragment: str


PRESIDIO_WORD_CUTS: tuple[PresidioCut, ...] = (
    PresidioCut(2484, 607, 605, 616, "significant", "gnificant"),
    PresidioCut(2664, 201, 198, 205, "numbers", "bers"),
)


MEASURED_PAGE_LENGTHS = (2484, 2637, 2664, 2740)


HEADING_OFFSETS = (
    0,
    815,
    1097,
    1464,
    1641,
    2019,
    2364,
    2590,
    2749,
    2939,
)
FIRST_HEADING_IN_EVERY_LENGTH = 815


CONTACTS_SECTION_START = 1641
CONTACTS_SECTION_END = 2019


PREAMBLES_OF_GROWING_LENGTH = (
    "Delivery terms.",
    "Delivery terms for the Northgate depot.",
    "Delivery terms for the Northgate depot, as agreed.",
    "Delivery terms for the Northgate depot, as agreed for the current period.",
    "Delivery terms for the Northgate depot, as agreed for the current period and"
    " read with the schedule.",
    "Delivery terms for the Northgate depot, as agreed for the current period and"
    " read with the schedule rather than instead of it.",
    "Delivery terms for the Northgate depot, as agreed for the current period and"
    " read with the schedule rather than instead of it, covering the whole of the"
    " run.",
    "Delivery terms for the Northgate depot, as agreed for the current period and"
    " read with the schedule rather than instead of it, covering the whole of the"
    " run and every pallet the driver takes out of the gate.",
)


PERSON_NAME_CATEGORY = "person-name"
NAMES_FOUND_AT_EVERY_LENGTH = frozenset(
    {"Rosalind Petheridge", "Callum Whitcombe", "Imogen Sarkar", "Oliver Denbigh"}
)


DEPOT_MANAGER_NAME = "Marguerite Ashdown"
DEPOT_BANK_DETAILS = "00-00-00 and the account number is 12345678"


DEPOT_PAGE_FINDINGS: tuple[tuple[str, int, int], ...] = (
    ("person-name", 227, 245),
    ("job-title", 253, 266),
    ("home-address", 323, 361),
    ("personal-contact", 402, 434),
    ("bank-details", 562, 605),
    ("job-title", 818, 824),
)


def whole_page() -> str:
    return FIXTURE_PAGE.read_text(encoding="utf-8")


def heading_less_page() -> str:
    return HEADING_LESS_PAGE.read_text(encoding="utf-8")


def page_tail(length: int) -> str:
    page = whole_page()
    assert len(page) >= length, f"{FIXTURE_PAGE.name} is shorter than {length}"
    return page[len(page) - length :]


def with_preamble(preamble: str) -> tuple[str, int]:
    tail = heading_less_page().split("\n\n", 1)[1]
    return f"{preamble}\n\n{tail}", len(preamble) + 2


def inside_a_word(text: str, at: int) -> bool:
    if at <= 0 or at >= len(text):
        return False
    return text[at - 1].isalnum() and text[at].isalnum()


def cuts_in(text: str, edges: Sequence[int]) -> list[int]:
    return [at for at in edges if inside_a_word(text, at)]


def edges_of(text: str) -> tuple[list[int], list[int]]:
    windows = AnchoredWindows().chunk(text)
    return [w.start for w in windows], [w.end for w in windows]


def headings_in(text: str) -> list[int]:
    return [
        at
        for at, character in enumerate(text)
        if character == "#" and (at == 0 or text[at - 1] == "\n")
    ]


def spans_from_first_shared_heading(
    text: str, offset: int
) -> list[tuple[str, int, int]]:
    return [
        (finding.category, finding.start + offset, finding.end + offset)
        for finding in findings_of(spans_detected(text))
        if finding.start + offset >= FIRST_HEADING_IN_EVERY_LENGTH
    ]


def spans_past(text: str, tail_at: int) -> list[tuple[str, int, int, str]]:
    return [
        (
            finding.category,
            finding.start - tail_at,
            finding.end - tail_at,
            text[finding.start : finding.end],
        )
        for finding in findings_of(spans_detected(text))
        if finding.start >= tail_at
    ]


def partial_spans_on(text: str) -> list[str]:
    return [
        text[finding.start : finding.end]
        for finding in findings_of(spans_detected(text))
        if inside_a_word(text, finding.start) or inside_a_word(text, finding.end)
    ]


def names_on(text: str) -> set[str]:
    return {
        text[finding.start : finding.end]
        for finding in findings_of(spans_detected(text))
        if finding.category == PERSON_NAME_CATEGORY
    }


def test_no_window_edge_splits_a_word_and_windows_stay_bounded() -> None:

    for text in (whole_page(), heading_less_page()):
        starts, ends = edges_of(text)

        assert cuts_in(text, starts) == [], text[:40]
        assert cuts_in(text, ends) == [], text[:40]

    stepped = heading_less_page()
    longest = max(
        window.end - window.start for window in AnchoredWindows().chunk(stepped)
    )

    assert longest <= CharacterBasedTextChunker().chunk_size * 2


def test_windows_start_at_headings_and_never_span_one() -> None:

    page = whole_page()

    assert tuple(headings_in(page)) == HEADING_OFFSETS

    windows = AnchoredWindows().chunk(page)
    heading_at = set(HEADING_OFFSETS)

    assert heading_at <= {window.start for window in windows}
    for window in windows:
        assert not any(window.start < heading < window.end for heading in heading_at), (
            window.start
        )

    assert (CONTACTS_SECTION_START, CONTACTS_SECTION_END) in [
        (window.start, window.end) for window in windows
    ]
    assert "\n\n" in page[CONTACTS_SECTION_START:CONTACTS_SECTION_END]


def test_a_heading_inside_a_code_fence_opens_no_window() -> None:

    fenced = (
        "# Rate card\n\nRates hold.\n\n"
        "```text\n# not a heading\nSORTCODE=00-00-99\n```\n"
    )

    starts = [window.start for window in AnchoredWindows().chunk(fenced)]

    assert starts == [0]
    assert fenced.index("# not a heading") not in starts


A_RUN_WITH_NO_BOUNDARY = "x" * 600 + " " + "y" * 600


PRINT_WINDOWS_OF_A_RUN_WITH_NO_BOUNDARY = f"""
import json
from better_answers_worker.redaction.detector import AnchoredWindows

windows = AnchoredWindows().chunk({A_RUN_WITH_NO_BOUNDARY!r})
print(json.dumps([[one.start, one.end] for one in windows]))
"""


def test_windows_advance_through_text_with_no_boundary() -> None:
    finished = subprocess.run(
        [sys.executable, "-c", PRINT_WINDOWS_OF_A_RUN_WITH_NO_BOUNDARY],
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    )
    windows: list[list[int]] = json.loads(finished.stdout.splitlines()[-1])

    starts = [start for start, _ in windows]
    assert all(before < after for before, after in pairwise(starts)), starts
    assert windows[-1][1] == len(A_RUN_WITH_NO_BOUNDARY)


def test_anchored_windows_avoid_the_word_cuts_presidio_makes() -> None:

    for cut in PRESIDIO_WORD_CUTS:
        text = page_tail(cut.page_length)

        presidio_starts = [
            window.start for window in CharacterBasedTextChunker().chunk(text)
        ]

        assert cut.at in cuts_in(text, presidio_starts), cut
        assert text[cut.word_starts_at : cut.word_ends_at] == cut.word, cut
        assert text[cut.at : cut.word_ends_at] == cut.fragment, cut

        starts, ends = edges_of(text)

        assert cuts_in(text, starts) == [], cut
        assert cuts_in(text, ends) == [], cut


def test_window_text_matches_its_offsets_and_windows_cover_the_page() -> None:

    for length in MEASURED_PAGE_LENGTHS:
        text = page_tail(length)

        windows = AnchoredWindows().chunk(text)

        assert [window.text for window in windows] == [
            text[window.start : window.end] for window in windows
        ], length
        assert windows[0].start == 0, length
        assert windows[-1].end == len(text), length
        assert all(
            later.start <= earlier.end for earlier, later in pairwise(windows)
        ), length


def test_no_measured_length_finds_part_of_a_word() -> None:

    for length in MEASURED_PAGE_LENGTHS:
        assert partial_spans_on(page_tail(length)) == [], length


def test_every_length_finds_the_same_spans_as_the_whole_page() -> None:

    page = whole_page()
    expected = spans_from_first_shared_heading(page, 0)

    for length in MEASURED_PAGE_LENGTHS:
        offset = len(page) - length
        here = spans_from_first_shared_heading(page_tail(length), offset)

        assert here == expected, length


def test_a_headingless_page_finds_the_same_spans_under_every_preamble() -> None:

    first, tail_at = with_preamble(PREAMBLES_OF_GROWING_LENGTH[0])
    expected = spans_past(first, tail_at)

    for preamble in PREAMBLES_OF_GROWING_LENGTH:
        text, offset = with_preamble(preamble)

        assert spans_past(text, offset) == expected, len(preamble)


def test_a_headingless_page_finds_its_planted_details() -> None:

    text = heading_less_page()

    found = [text[f.start : f.end] for f in findings_of(spans_detected(text))]

    assert DEPOT_MANAGER_NAME in found
    assert DEPOT_BANK_DETAILS in found
    assert partial_spans_on(text) == []
    assert (
        tuple((f.category, f.start, f.end) for f in findings_of(spans_detected(text)))
        == DEPOT_PAGE_FINDINGS
    )


def test_every_length_finds_the_person_names_on_the_page() -> None:

    for length in MEASURED_PAGE_LENGTHS:
        assert names_on(page_tail(length)) >= NAMES_FOUND_AT_EVERY_LENGTH, length
