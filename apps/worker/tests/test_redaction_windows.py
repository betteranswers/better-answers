"""The windows the model reads a page in, and the one rule on where each one begins.

Presidio hands GLiNER a long text in overlapping windows of characters, stepping by a
count from the start of the text: it extends each window's **end** forward to the next
space or newline, so a window never ends inside a word, and takes the next window's
start as that end minus the overlap, a plain subtraction that lands wherever it lands.
Two things follow, and both were measured rather than reasoned about.

A window that begins inside a word puts a fragment at the front of the page the model
reads, and a zero-shot name model answers for the fragment at full confidence. T-168
measured `gned` at 0.946 inside *resigned* and `gen Sarkar` in place of *Imogen Sarkar*
on the page it had then; the planted page answers `person-name 'bers'` at 0.947 for the
tail of *numbers* at 2,664 characters and `job-title 'gnificant control'` for the tail
of *significant* at 2,484.

And because the step counts from the start of the text, **an edit anywhere moves every
window after it**, so the same paragraph is read inside a different window on a page
that gained a sentence above it — which is how T-168 found this at all.

**The rule.** A window begins where the document itself begins something: a run under a
heading, read whole up to twice the window Presidio would have used; that run cut at its
paragraphs when it is longer; and only a paragraph longer still stepped through by a
count, on whole words at both edges. Heading, then paragraph, then nothing — the largest
piece of its own shape the text offers.

**What that is worth, measured.** Two fixtures. The planted page has ten headings and is
taken to each of T-168's four lengths from its end, because what used to move a window's
edge was where the text sat under the grid and not which end was trimmed. The
heading-less `depot-delivery-terms.txt` is taken at eight lengths by rewriting its first
paragraph, so everything below it is byte-identical and a finding in the tail that moves
moved for no reason but the grid. A run past the ceiling is only stepped through inside
a paragraph, which that fixture's fourth paragraph — 661 characters — is there to be.

| rule | the planted page levels | a heading-less page levels | the pages' own spans |
| --- | --- | --- | --- |
| Presidio's own, on `main` | no | no | the reference |
| a whole-word start | no | no | unchanged |
| a sentence or a line start | no | not measured | loses one, gains one |
| a heading start | yes | **no** | unchanged |
| a blank line anchoring everywhere | yes | yes | loses one, gains two |
| this rule | **yes** | **yes** | unchanged |

Each cell in the last column that is not *unchanged* is spelled out below. A sentence or
a line start loses the officers block's `job-title [1363,1388)` and gains a
`person-name` at `[2144,2166)`. A blank line everywhere loses `job-title 'supervisors'`,
gains `job-title 'Finance'` — the heading word read as a role — and that same
`person-name [2144,2166)`.

The rejected rows are kept because each was built and run. A heading start alone is the
rule this one replaces and it levels only a page that has headings: on the heading-less
fixture it raises `job-title 'driver'` at two of the eight lengths and not at the other
six. Taking a blank line as an anchor everywhere levels both and costs the planted page
a true `job-title` while reading the heading word *Finance* as one and *One of our
supervisors* as a person, at 27 windows and 1,282 ms against this rule's 14 and 867 ms.

**Why twice a window.** The ceiling was swept rather than chosen: 250, 300, 350, 378,
379, 400, 500, 750, 1000, 1500. Every one levels the planted page's four lengths, so the
levelling is the anchor's doing and not the ceiling's. What the ceiling decides is the
page's own answer, and there the sweep is flat from 300 upward — identical to `main`'s,
gaining and losing nothing — and wrong only at 250, where cutting the 282-character run
under *Contract history* in two makes the model raise `person-name` over the word
*person* at `[1032,1038)`. Twice Presidio's window sits inside that plateau and is
derived from its number rather than fitted to either fixture.
"""

from collections.abc import Sequence
from itertools import pairwise
from typing import NamedTuple

from presidio_analyzer.chunkers import CharacterBasedTextChunker

from better_answers_worker.redaction.engine import AnchoredWindows, detect
from planted_page import FIXTURE_PAGE

HEADING_LESS_PAGE = FIXTURE_PAGE.parent / "depot-delivery-terms.txt"


class ACut(NamedTuple):
    """One window start Presidio puts inside a word, by offset, as measured here."""

    page_length: int
    at: int
    word_starts_at: int
    word_ends_at: int
    word: str
    fragment: str


#: The two of T-168's four lengths whose cut word came back as a finding, written down
#: rather than computed so that a change to the rule cannot move both sides of the
#: comparison at once. At 2,664 the answer is a `person-name`, which is the harm the
#: ticket names; at 2,484 it is a `job-title` over the tail of *significant*.
THE_CUTS_PRESIDIO_MAKES: tuple[ACut, ...] = (
    ACut(2484, 607, 605, 616, "significant", "gnificant"),
    ACut(2664, 201, 198, 205, "numbers", "bers"),
)

#: All four of T-168's lengths.
THE_LENGTHS_T168_MEASURED = (2484, 2637, 2664, 2740)

#: Every offset a heading begins at on the whole planted page, and the first of them
#: that survives all four lengths. A finding at or past that offset is one every length
#: can be asked about, because the run it sits in is whole in every one of them.
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

#: The heading-less fixture's first paragraph, rewritten at eight lengths. Everything
#: below it is byte-identical in all eight, so a finding in the tail that moves moved
#: because the grid moved under it and for no other reason.
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

#: The category a fragment was raised under, and the four people the planted page names
#: past the heading above. An equality that held over an empty list would hold over
#: anything, which is what the second assertion of each pair is for.
THE_CATEGORY_A_FRAGMENT_WAS_RAISED_UNDER = "person-name"
THE_PEOPLE_EVERY_LENGTH_STILL_NAMES = frozenset(
    {"Rosalind Petheridge", "Callum Whitcombe", "Imogen Sarkar", "Oliver Denbigh"}
)

#: What the heading-less fixture plants, which every one of its lengths must still find.
THE_DEPOT_MANAGER = "Marguerite Ashdown"
THE_DEPOT_SORT_CODE = "20-00-00 and the account number is 12345678"


def whole_page() -> str:
    return FIXTURE_PAGE.read_text(encoding="utf-8")


def heading_less_page() -> str:
    return HEADING_LESS_PAGE.read_text(encoding="utf-8")


def page_at(length: int) -> str:
    """The planted page at one of T-168's lengths, whole at the end it is read to."""
    page = whole_page()
    assert len(page) >= length, f"{FIXTURE_PAGE.name} is shorter than {length}"
    return page[len(page) - length :]


def under(preamble: str) -> tuple[str, int]:
    """The heading-less page under one preamble, and where its fixed tail starts."""
    tail = heading_less_page().split("\n\n", 1)[1]
    return f"{preamble}\n\n{tail}", len(preamble) + 2


def inside_a_word(text: str, at: int) -> bool:
    """Whether an offset cuts a word — the predicate this ticket's proof is made of.

    Deliberately narrower than the rule's own boundary, which is Presidio's space or
    newline: this asks only whether the two characters either side of an offset are both
    part of a word, so an offset the rule would still move — between a bracket and a
    capital in `(Rosalind` — passes here. A predicate wider than the rule would fail on
    offsets the rule never promised to move; this one fails only where the defect is.
    """
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
    """Every finding the whole page could also be asked about, in the page's offsets."""
    return [
        (finding.category, finding.start + offset, finding.end + offset)
        for finding in detect(text)
        if finding.start + offset >= THE_FIRST_HEADING_EVERY_LENGTH_KEEPS
    ]


def spans_past(text: str, tail_at: int) -> list[tuple[str, int, int, str]]:
    """Every finding in the fixed tail, at offsets counted from the tail's own start."""
    return [
        (
            finding.category,
            finding.start - tail_at,
            finding.end - tail_at,
            text[finding.start : finding.end],
        )
        for finding in detect(text)
        if finding.start >= tail_at
    ]


def partial_spans_on(text: str) -> list[str]:
    return [
        text[finding.start : finding.end]
        for finding in detect(text)
        if inside_a_word(text, finding.start) or inside_a_word(text, finding.end)
    ]


def names_on(text: str) -> set[str]:
    return {
        text[finding.start : finding.end]
        for finding in detect(text)
        if finding.category == THE_CATEGORY_A_FRAGMENT_WAS_RAISED_UNDER
    }


def test_no_window_edge_falls_inside_a_word_on_a_page_that_has_to_be_stepped() -> None:
    # The stepping branch is the one place a window's edge is still decided by a count,
    # so it is the one place the original defect can come back — and it is reached only
    # by a paragraph longer than the ceiling, which neither of T-168's two shortest
    # lengths contains. Deleting the word retraction from that step leaves every other
    # assertion in this file green; it fails here.
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
    # The rule itself, by offset. The headings are written down rather than read off the
    # chunker, so a rule that stopped finding them fails here rather than agreeing with
    # itself; every other start is a paragraph's or a whole word inside one.
    page = whole_page()

    assert tuple(headings_in(page)) == THE_HEADINGS_ON_THE_WHOLE_PAGE

    windows = AnchoredWindows().chunk(page)
    heading_at = set(THE_HEADINGS_ON_THE_WHOLE_PAGE)

    assert heading_at <= {window.start for window in windows}
    for window in windows:
        assert not any(window.start < heading < window.end for heading in heading_at), (
            window.start
        )


def test_a_heading_inside_a_code_fence_opens_no_window() -> None:
    # Both converters emit Markdown and a document may carry a fence, inside which a
    # line-initial `#` is somebody's sample code and not a heading. A run opened there
    # would be a boundary the document does not have.
    fenced = (
        "# Rate card\n\nRates hold.\n\n"
        "```text\n# not a heading\nSORTCODE=00-00-99\n```\n"
    )

    starts = [window.start for window in AnchoredWindows().chunk(fenced)]

    assert starts == [0]
    assert fenced.index("# not a heading") not in starts


def test_presidio_cuts_a_word_on_this_page_and_the_seams_windows_never_do() -> None:
    # The control is Presidio's chunker taken at its own defaults and the subject is the
    # seam's taken at the same ones, so the single difference between the two runs is
    # the rule.
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
    # What anchoring must not cost: every character still reaches the model, and a
    # window's text is the run its offsets name — the offsets every span found inside it
    # is shifted by, so a window that misreported them would move every finding after
    # it. No model is loaded, so every length is asked.
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
    # The first harm, at every length T-168 recorded rather than only at the two that
    # showed it: a rule that closed one length and opened another would be a rule nobody
    # could trust on the next page.
    for length in THE_LENGTHS_T168_MEASURED:
        assert partial_spans_on(page_at(length)) == [], length


def test_every_length_answers_what_the_whole_page_answers_in_the_runs_they_share() -> (
    None
):
    # The second harm, and the acceptance line this ticket turned on. A page's length
    # must not decide what the seam finds in text the length did not touch, because a
    # name the shorter page gains takes a pseudonym letter in reading order and shifts
    # every later one. Compared by category and by offset, excluding nothing, over every
    # finding at or past the first heading all four lengths keep whole.
    page = whole_page()
    expected = spans_past_the_shared_heading(page, 0)

    for length in THE_LENGTHS_T168_MEASURED:
        offset = len(page) - length
        here = spans_past_the_shared_heading(page_at(length), offset)

        assert here == expected, length


def test_a_page_with_no_heading_answers_the_same_at_every_length() -> None:
    # The same acceptance line on the document the heading rule could not hold: a plain
    # text file, which is what T-130's plain-text converter lands byte for byte. Its
    # tail is identical under all eight preambles, so every finding in it must be too.
    first, tail_at = under(THE_PREAMBLES_THAT_MOVE_THE_GRID[0])
    expected = spans_past(first, tail_at)

    for preamble in THE_PREAMBLES_THAT_MOVE_THE_GRID:
        text, offset = under(preamble)

        assert spans_past(text, offset) == expected, len(preamble)


def test_a_page_with_no_heading_still_finds_what_it_plants() -> None:
    # What keeps the equality above from being an agreement between eight empty lists.
    text = heading_less_page()

    found = [text[f.start : f.end] for f in detect(text)]

    assert THE_DEPOT_MANAGER in found
    assert THE_DEPOT_SORT_CODE in found
    assert partial_spans_on(text) == []


def test_every_length_still_names_the_people_the_page_names() -> None:
    # The same guard on the planted page: a detector that answered nothing at all — a
    # model that failed to load, a threshold that swallowed every span — would satisfy
    # the equality above and fail here.
    for length in THE_LENGTHS_T168_MEASURED:
        assert names_on(page_at(length)) >= THE_PEOPLE_EVERY_LENGTH_STILL_NAMES, length
