"""The windows the model reads a long page in, and the one rule on their edges.

Presidio hands GLiNER a long text in overlapping windows of characters. Its own chunker
extends each window's **end** forward to the next space or newline, so a window never
ends inside a word; the next window's start is that end minus the overlap, a plain
subtraction that lands wherever it lands. On this page it lands inside a word ten times
out of sixteen, and a window beginning inside a word is a page the model reads with a
fragment at the front of it — which a zero-shot name model answers for. T-168 measured
two of those answers on the page it had then, `gned` at 0.946 inside *resigned* and
`gen Sarkar` in place of *Imogen Sarkar*; this suite measures the same defect on the
page as it stands, `bers` at 0.947 inside *numbers*.

What is held here is the rule and not the model's answer. The first two tests are the
chunker alone — Presidio's, then the seam's, over the same text, differing in one
thing — so they say which offsets were cut and by which rule without loading a model.
The last two run the detector, because a rule about what the model is shown is only
worth having if the fragments stop coming back, and no reading of a chunker can show
that.

**The two lengths.** 2,664 and 2,740 characters are not arbitrary: they are the two
lengths T-168's measurement table records the defect at. The page is taken to a length
from its end rather than its start, because what moves a window's edge is where the
text sits under the window grid and not which end of it was trimmed — the same thing
T-168's added preamble did by accident. On the page as it stands today the two lengths
no longer behave alike: 2,664 cuts *numbers* and the model answers for the four letters
left of the cut, while 2,740 cuts only *officer*, *following* and *registered*, out of
which no name-shaped fragment falls. So 2,664 is the length this suite regresses and
2,740 is a control with no regression power of its own: it was clean before the rule
and its job is to show the rule did not open a defect where there was none. A rule
that closed one length while moving the other would be a rule nobody could trust on
the next page.
"""

from collections.abc import Sequence
from itertools import pairwise

from presidio_analyzer.chunkers import CharacterBasedTextChunker

from better_answers_worker.redaction.engine import WholeWordWindows, detect
from planted_page import FIXTURE_PAGE

#: The length at which a window's start falls inside *numbers* and the model answers
#: for the four letters left of it (T-168's table; re-measured here on today's page).
A_LENGTH_THAT_CUT_A_NAME_SHAPED_WORD = 2664

#: The other length T-168's table records. A window's start falls inside a word here
#: too and no fragment of any of them comes back, which is what makes it the control
#: this pair needs.
A_LENGTH_THAT_CUT_NO_NAME_SHAPED_WORD = 2740

#: Where Presidio's own chunker begins its second window on the page at 2,664
#: characters, and the word it begins in the middle of. Written down rather than
#: computed, so a change to the rule cannot move both sides of the comparison at once.
A_CUT_OFFSET = 201
THE_CUT_WORD_STARTS_AT = 198
THE_CUT_WORD_ENDS_AT = 205
THE_WORD_THAT_WAS_CUT = "numbers"
THE_FRAGMENT_LEFT_OF_THE_CUT = "bers"

#: The category a fragment was raised under, and the four people the page names past
#: the point both lengths begin at. An empty list of fragments is only worth reading
#: beside these: a rule that took every name with them would satisfy the first
#: assertion of each pair and fail the second.
THE_CATEGORY_A_FRAGMENT_WAS_RAISED_UNDER = "person-name"
THE_PEOPLE_BOTH_LENGTHS_STILL_NAME = frozenset(
    {"Rosalind Petheridge", "Callum Whitcombe", "Imogen Sarkar", "Oliver Denbigh"}
)


def page_at(length: int) -> str:
    """The fixture page at one of T-168's lengths, whole at the end it is read to."""
    page = FIXTURE_PAGE.read_text(encoding="utf-8")
    assert len(page) >= length, f"{FIXTURE_PAGE.name} is shorter than {length}"
    return page[len(page) - length :]


def inside_a_word(text: str, at: int) -> bool:
    """Whether an offset cuts a word — the predicate this ticket's proof is made of."""
    if at <= 0 or at >= len(text):
        return False
    return text[at - 1].isalnum() and text[at].isalnum()


def cuts_in(text: str, edges: Sequence[int]) -> list[int]:
    return [at for at in edges if inside_a_word(text, at)]


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


def test_presidio_cuts_a_word_on_this_page_and_the_seams_windows_never_do() -> None:
    # The rule, both ways and by offset both ways, with no model in it. The control is
    # Presidio's chunker taken at its own defaults and the subject is the seam's taken
    # at the same ones, so the single difference between the two runs is the rule.
    text = page_at(A_LENGTH_THAT_CUT_A_NAME_SHAPED_WORD)

    theirs = CharacterBasedTextChunker().chunk(text)

    assert A_CUT_OFFSET in cuts_in(text, [window.start for window in theirs])
    assert text[THE_CUT_WORD_STARTS_AT:THE_CUT_WORD_ENDS_AT] == THE_WORD_THAT_WAS_CUT
    assert text[A_CUT_OFFSET:THE_CUT_WORD_ENDS_AT] == THE_FRAGMENT_LEFT_OF_THE_CUT

    ours = WholeWordWindows().chunk(text)

    assert cuts_in(text, [window.start for window in ours]) == []
    assert cuts_in(text, [window.end for window in ours]) == []
    assert THE_CUT_WORD_STARTS_AT in [window.start for window in ours]


def test_the_windows_cover_the_whole_page_and_carry_the_offsets_they_claim() -> None:
    # What retracting a start must not cost: every character still reaches the model,
    # and a window's text is the run its offsets name — the offsets every span found
    # inside it is shifted by, so a window that misreported them would move every
    # finding after it.
    text = page_at(A_LENGTH_THAT_CUT_A_NAME_SHAPED_WORD)

    windows = WholeWordWindows().chunk(text)

    assert [window.text for window in windows] == [
        text[window.start : window.end] for window in windows
    ]
    assert windows[0].start == 0
    assert windows[-1].end == len(text)
    assert all(later.start <= earlier.end for earlier, later in pairwise(windows))


def test_a_page_at_a_length_that_cut_a_word_raises_no_part_of_one() -> None:
    # The defect itself, at the length that shows it. Before the rule the seam answered
    # `bers` at 0.947 and `arwick` at 0.961, both `person-name`, both at an offset a
    # window's start had cut; after it, neither, and the fragments are the whole words
    # *numbers* and *Barwick,* again.
    #
    # What is asserted is that no span's edge falls inside a word, and never that the
    # two lengths answer identically to the whole page — that was measured and is not
    # true. At this length the model also names the whole word *Barwick*, the town in
    # the signatories' address, a person; at the other it shortens *second registered
    # officer* to *officer*. That residual is **not** harmless and is not claimed to
    # be: a letter is handed out per person-name finding in reading order whatever
    # tier it lands at (`pseudonyms.py`), so an extra name still shifts every later
    # letter, which is this ticket's own second harm. What the residual is not is a
    # boundary: both spans are whole words, so no placeholder is written across half
    # of one, and a model reading a page that begins mid-sentence answering
    # differently about whole words is beyond the reach of any rule about where a
    # window starts. It is length-sensitive model drift, and it belongs on a ticket of
    # its own rather than in this rule.
    text = page_at(A_LENGTH_THAT_CUT_A_NAME_SHAPED_WORD)

    assert partial_spans_on(text) == []
    assert names_on(text) >= THE_PEOPLE_BOTH_LENGTHS_STILL_NAME


def test_a_page_at_the_length_that_cut_no_name_is_left_where_it_was() -> None:
    # This length was clean before the rule, so it regresses nothing on its own: what
    # it holds is that the rule did no harm where there was none to undo.
    text = page_at(A_LENGTH_THAT_CUT_NO_NAME_SHAPED_WORD)

    assert partial_spans_on(text) == []
    assert names_on(text) >= THE_PEOPLE_BOTH_LENGTHS_STILL_NAME
