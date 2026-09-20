"""The windows the model reads a page in, and the one rule on where each one begins.

Presidio hands GLiNER a long text in overlapping windows of characters, stepping by a
count from the start of the text: it extends each window's **end** forward to the next
space or newline, so a window never ends inside a word, and takes the next window's
start as that end minus the overlap, a plain subtraction that lands wherever it lands.
Two things follow, and both were measured on this page rather than reasoned about.

A window that begins inside a word puts a fragment at the front of the page the model
reads, and a zero-shot name model answers for the fragment at full confidence. T-168
measured `gned` at 0.946 inside *resigned* and `gen Sarkar` in place of *Imogen Sarkar*
on the page it had then; this page answers `person-name 'bers'` at 0.947 for the tail of
*numbers* at 2,664 characters and `job-title 'gnificant control'` for the tail of
*significant* at 2,484.

And because the step counts from the start of the text, **an edit anywhere moves every
window after it**, so the same paragraph is read inside a different window on a page
that gained a sentence above it — which is how T-168 found this at all, and why the
answers moved at two of the four lengths its table records.

**The rule.** A window begins where a heading begins. The run of text under one heading
is read whole up to twice the window Presidio would have used; past that it is stepped
inside itself, each step landing on a whole word. No window reaches back over a heading,
so what the model is shown for one heading's text depends on that text and on nothing
before it, and an edit above it moves nothing. Text with no heading in it is one run and
is read exactly as the word rule read it.

**What that is worth, measured over T-168's four lengths.** The page is taken to a
length from its end, because what used to move a window's edge was where the text sat
under the window grid and not which end was trimmed — the same thing T-168's added
preamble did by accident. The runs that survive every one of the four begin at 815, and
in them:

The first column asks whether each of the four lengths answers what the whole page
answers in those runs. The second asks what the rule does to the whole page's own spans,
which is the page production reads, taking Presidio's own answer as the reference.

| rule | every length answers the whole page | the whole page's own spans |
| --- | --- | --- |
| Presidio's own, on `main` | no — a fragment at 2,484, two at 2,664 | the reference |
| a whole-word start | no — a name gained at three of four | unchanged |
| a sentence or a line start | no — 2,637 differs | loses `[1363,1388)` |
| a heading start, this rule | **yes** | unchanged |

The rejected rows are kept because each was built and run, not argued about. The word
rule's own drift is the row above this one: it gains `person-name 'person'` at 2,484,
`'member of staff'` at 2,637 and `'Barwick'` at 2,664, and each takes a pseudonym letter
in reading order and shifts every later one, which is this ticket's second harm. A
sentence or a line start levels two of the four and costs the whole page the officers
block's `job-title 'second registered officer'` — one of the five `test_redaction.py`
counts — while gaining a `person-name` over *One of our supervisors*, a phrase that is
nobody.

**Why twice a window, and not one.** The ceiling was swept rather than chosen: 250, 300,
350, 378, 379, 400, 500, 750, 1000, 1500. Every one of them levels all four lengths, so
the levelling is the heading anchor's doing and not the ceiling's. What the ceiling
decides is the whole page's own answer, and there the sweep is flat from 300 upward —
identical to the word rule's, gaining and losing nothing — and wrong only at 250, where
cutting the 282-character run under *Contract history* in two makes the model read *a
person's date* as a name. Twice Presidio's window sits in the middle of that plateau and
is derived from its number rather than fitted to this page; a ceiling there is what
stops a run with no heading in it from being handed to the model in one piece longer
than the model can read.

**Cost.** 13 windows against the word rule's 16, and the seam is faster, not slower:
840 ms a page against 1,011 ms, on this machine, against T-122's 2,841 ms for the same
call in the image. Shorter windows, fewer of them, no run scanned twice at a heading.
"""

from collections.abc import Sequence
from itertools import pairwise
from typing import NamedTuple

from presidio_analyzer.chunkers import CharacterBasedTextChunker

from better_answers_worker.redaction.engine import HeadingWindows, detect
from planted_page import FIXTURE_PAGE


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

#: Every offset a heading begins at on the whole page, and the first of them that
#: survives all four lengths. A finding at or past that offset is one every length can
#: be asked about, because the run it sits in is whole in every one of them.
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

#: The category a fragment was raised under, and the four people the page names past the
#: heading above. An equality that held over an empty list would hold over anything.
THE_CATEGORY_A_FRAGMENT_WAS_RAISED_UNDER = "person-name"
THE_PEOPLE_EVERY_LENGTH_STILL_NAMES = frozenset(
    {"Rosalind Petheridge", "Callum Whitcombe", "Imogen Sarkar", "Oliver Denbigh"}
)


def whole_page() -> str:
    return FIXTURE_PAGE.read_text(encoding="utf-8")


def page_at(length: int) -> str:
    """The fixture page at one of T-168's lengths, whole at the end it is read to."""
    page = whole_page()
    assert len(page) >= length, f"{FIXTURE_PAGE.name} is shorter than {length}"
    return page[len(page) - length :]


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


def test_every_window_begins_at_a_heading_and_none_reaches_back_over_one() -> None:
    # The rule itself, by offset and with no model in it. The headings are written down
    # rather than read off the chunker, so a rule that stopped finding them would fail
    # here rather than agree with itself.
    page = whole_page()

    assert tuple(headings_in(page)[1:]) == THE_HEADINGS_ON_THE_WHOLE_PAGE[1:]

    windows = HeadingWindows().chunk(page)
    heading_at = set(THE_HEADINGS_ON_THE_WHOLE_PAGE)

    for window in windows:
        began_at_a_heading = window.start in heading_at
        stepped_inside_a_run = not any(
            window.start < heading < window.end for heading in heading_at
        )
        assert began_at_a_heading or stepped_inside_a_run, window.start
        assert not any(window.start < heading < window.end for heading in heading_at), (
            window.start
        )

    assert heading_at <= {window.start for window in windows}


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

        ours = HeadingWindows().chunk(text)

        assert cuts_in(text, [window.start for window in ours]) == [], cut
        assert cuts_in(text, [window.end for window in ours]) == [], cut


def test_the_windows_cover_every_length_and_carry_the_offsets_they_claim() -> None:
    # What anchoring on a heading must not cost: every character still reaches the
    # model, and a window's text is the run its offsets name — the offsets every span
    # found inside it is shifted by, so a window that misreported them would move every
    # finding after it. No model is loaded, so every length is asked.
    for length in THE_LENGTHS_T168_MEASURED:
        text = page_at(length)

        windows = HeadingWindows().chunk(text)

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


def test_every_length_still_names_the_people_the_page_names() -> None:
    # What keeps the equality above from being an agreement between two empty lists: a
    # detector that answered nothing at all — a model that failed to load, a threshold
    # that swallowed every span — would satisfy it and fail here.
    for length in THE_LENGTHS_T168_MEASURED:
        assert names_on(page_at(length)) >= THE_PEOPLE_EVERY_LENGTH_STILL_NAMES, length
