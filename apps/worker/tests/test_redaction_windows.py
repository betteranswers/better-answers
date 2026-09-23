from collections.abc import Sequence
from itertools import pairwise
from typing import NamedTuple

from presidio_analyzer.chunkers import CharacterBasedTextChunker

from better_answers_worker.redaction.engine import (
    AnchoredWindows,
    findings_of,
    spans_detected,
)
from planted_page import FIXTURE_PAGE

HEADING_LESS_PAGE = FIXTURE_PAGE.parent / "depot-delivery-terms.txt"


class ACut(NamedTuple):
    page_length: int
    at: int
    word_starts_at: int
    word_ends_at: int
    word: str
    fragment: str


THE_CUTS_PRESIDIO_MAKES: tuple[ACut, ...] = (
    ACut(2484, 607, 605, 616, "significant", "gnificant"),
    ACut(2664, 201, 198, 205, "numbers", "bers"),
)


THE_LENGTHS_T168_MEASURED = (2484, 2637, 2664, 2740)


THE_HEADINGS_ON_THE_WHOLE_PAGE = (
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
THE_FIRST_HEADING_EVERY_LENGTH_KEEPS = 815


THE_CONTACTS_RUN = 1641
THE_CONTACTS_RUN_ENDS_AT = 2019


THE_PREAMBLES_THAT_MOVE_THE_GRID = (
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


THE_CATEGORY_A_FRAGMENT_WAS_RAISED_UNDER = "person-name"
THE_PEOPLE_EVERY_LENGTH_STILL_NAMES = frozenset(
    {"Rosalind Petheridge", "Callum Whitcombe", "Imogen Sarkar", "Oliver Denbigh"}
)


THE_DEPOT_MANAGER = "Marguerite Ashdown"
THE_DEPOT_SORT_CODE = "00-00-00 and the account number is 12345678"


THE_DEPOT_FIXTURES_ANSWER: tuple[tuple[str, int, int], ...] = (
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


def page_at(length: int) -> str:
    page = whole_page()
    assert len(page) >= length, f"{FIXTURE_PAGE.name} is shorter than {length}"
    return page[len(page) - length :]


def under(preamble: str) -> tuple[str, int]:
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


def spans_past_the_shared_heading(text: str, offset: int) -> list[tuple[str, int, int]]:
    return [
        (finding.category, finding.start + offset, finding.end + offset)
        for finding in findings_of(spans_detected(text))
        if finding.start + offset >= THE_FIRST_HEADING_EVERY_LENGTH_KEEPS
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
        if finding.category == THE_CATEGORY_A_FRAGMENT_WAS_RAISED_UNDER
    }


def test_no_window_edge_falls_inside_a_word_on_a_page_that_has_to_be_stepped() -> None:

    for text in (whole_page(), heading_less_page()):
        starts, ends = edges_of(text)

        assert cuts_in(text, starts) == [], text[:40]
        assert cuts_in(text, ends) == [], text[:40]

    stepped = heading_less_page()
    longest = max(
        window.end - window.start for window in AnchoredWindows().chunk(stepped)
    )

    assert longest <= CharacterBasedTextChunker().chunk_size * 2


def test_every_window_begins_where_the_page_begins_something() -> None:

    page = whole_page()

    assert tuple(headings_in(page)) == THE_HEADINGS_ON_THE_WHOLE_PAGE

    windows = AnchoredWindows().chunk(page)
    heading_at = set(THE_HEADINGS_ON_THE_WHOLE_PAGE)

    assert heading_at <= {window.start for window in windows}
    for window in windows:
        assert not any(window.start < heading < window.end for heading in heading_at), (
            window.start
        )

    assert (THE_CONTACTS_RUN, THE_CONTACTS_RUN_ENDS_AT) in [
        (window.start, window.end) for window in windows
    ]
    assert "\n\n" in page[THE_CONTACTS_RUN:THE_CONTACTS_RUN_ENDS_AT]


def test_a_heading_inside_a_code_fence_opens_no_window() -> None:

    fenced = (
        "# Rate card\n\nRates hold.\n\n"
        "```text\n# not a heading\nSORTCODE=00-00-99\n```\n"
    )

    starts = [window.start for window in AnchoredWindows().chunk(fenced)]

    assert starts == [0]
    assert fenced.index("# not a heading") not in starts


def test_presidio_cuts_a_word_on_this_page_and_the_seams_windows_never_do() -> None:

    for cut in THE_CUTS_PRESIDIO_MAKES:
        text = page_at(cut.page_length)

        theirs = [window.start for window in CharacterBasedTextChunker().chunk(text)]

        assert cut.at in cuts_in(text, theirs), cut
        assert text[cut.word_starts_at : cut.word_ends_at] == cut.word, cut
        assert text[cut.at : cut.word_ends_at] == cut.fragment, cut

        starts, ends = edges_of(text)

        assert cuts_in(text, starts) == [], cut
        assert cuts_in(text, ends) == [], cut


def test_the_windows_cover_every_length_and_carry_the_offsets_they_claim() -> None:

    for length in THE_LENGTHS_T168_MEASURED:
        text = page_at(length)

        windows = AnchoredWindows().chunk(text)

        assert [window.text for window in windows] == [
            text[window.start : window.end] for window in windows
        ], length
        assert windows[0].start == 0, length
        assert windows[-1].end == len(text), length
        assert all(
            later.start <= earlier.end for earlier, later in pairwise(windows)
        ), length


def test_no_length_this_page_was_measured_at_raises_part_of_a_word() -> None:

    for length in THE_LENGTHS_T168_MEASURED:
        assert partial_spans_on(page_at(length)) == [], length


def test_every_length_answers_what_the_whole_page_answers_in_the_runs_they_share() -> (
    None
):

    page = whole_page()
    expected = spans_past_the_shared_heading(page, 0)

    for length in THE_LENGTHS_T168_MEASURED:
        offset = len(page) - length
        here = spans_past_the_shared_heading(page_at(length), offset)

        assert here == expected, length


def test_a_page_with_no_heading_answers_the_same_at_every_length() -> None:

    first, tail_at = under(THE_PREAMBLES_THAT_MOVE_THE_GRID[0])
    expected = spans_past(first, tail_at)

    for preamble in THE_PREAMBLES_THAT_MOVE_THE_GRID:
        text, offset = under(preamble)

        assert spans_past(text, offset) == expected, len(preamble)


def test_a_page_with_no_heading_still_finds_what_it_plants() -> None:

    text = heading_less_page()

    found = [text[f.start : f.end] for f in findings_of(spans_detected(text))]

    assert THE_DEPOT_MANAGER in found
    assert THE_DEPOT_SORT_CODE in found
    assert partial_spans_on(text) == []
    assert (
        tuple((f.category, f.start, f.end) for f in findings_of(spans_detected(text)))
        == THE_DEPOT_FIXTURES_ANSWER
    )


def test_every_length_still_names_the_people_the_page_names() -> None:

    for length in THE_LENGTHS_T168_MEASURED:
        assert names_on(page_at(length)) >= THE_PEOPLE_EVERY_LENGTH_STILL_NAMES, length
