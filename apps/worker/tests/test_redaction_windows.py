"""The windows the model reads a long page in, and the one rule on their edges.

Presidio hands GLiNER a long text in overlapping windows of characters. Its own chunker
extends each window's **end** forward to the next space or newline, so a window never
ends inside a word; the next window's start is that end minus the overlap, a plain
subtraction that lands wherever it lands. On this page it lands inside a word ten times
out of sixteen, and a window beginning inside a word is a page the model reads with a
fragment at the front of it — which a zero-shot name model answers for. T-168 measured
two of those answers on the page it had then, `gned` at 0.946 inside *resigned* and
`gen Sarkar` in place of *Imogen Sarkar*. This page answers the same way at two of the
four lengths that table records: `person-name 'bers'` at 0.947 for the tail of *numbers*
at 2,664 characters, and `job-title 'gnificant control'` for the tail of *significant*
at 2,484.

The rule in force is `WholeWordWindows`: a window's start obeys the boundary its end
already obeys. The first two tests are the chunker alone — Presidio's, then the seam's,
over one text, differing in one thing — so they say which offsets were cut and by which
rule with no model loaded. The last two run the detector, because a rule about what the
model is shown is only worth having if the fragments stop coming back, and no reading
of a chunker can show that.

**The four lengths, and what each rule answers at them.** T-168's measurement table
records this page at 2,484, 2,637, 2,664 and 2,740 characters. The page is taken to a
length from its end rather than its start, because what moves a window's edge is where
the text sits under the window grid and not which end of it was trimmed — the same
thing T-168's added preamble did by accident. Each length below is compared against the
whole page's own answer under the same rule, category and span, by offset, in the region
all four lengths share (from 619), excluding nothing. *Gains* is a finding the length
answers that the whole page does not; *loses* one it fails to answer that the whole page
does. Offsets are the whole page's, and `[1363,1388)` throughout is the officers block's
`job-title 'second registered officer'`.

Presidio's own rule, which is what the defect looked like:

- 2,484 gains `job-title [1226,1243) 'gnificant control'`, a cut word; loses [1363,1388)
- 2,637 equal
- 2,664 gains `person-name [640,644) 'bers'` and `person-name [2875,2881) 'arwick'`,
  two cut words; loses [1363,1388)
- 2,740 loses [1363,1388)

The word rule, in force here:

- 2,484 gains `person-name [1032,1038) 'person'`; loses [1363,1388)
- 2,637 gains `person-name [2315,2330) 'member of staff'`
- 2,664 gains `person-name [2874,2881) 'Barwick'`
- 2,740 gains `job-title [1381,1388) 'officer'`; loses [1363,1388)

A sentence or a line start, measured and not taken. Its reference moves first: under it
the whole page itself loses [1363,1388) and gains `person-name [2144,2166)`.

- 2,484 gains [1363,1388)
- 2,637 gains [1363,1388); loses `person-name [2144,2166)`
- 2,664 gains [1363,1388)
- 2,740 gains [1363,1388)

**Why the rule in force is the word and not the sentence.** The third column was built
and measured rather than reasoned about, both candidates: retract a window's start to
the sentence it landed in, and retract it to the line, each with a ceiling past which it
falls back to the word start so a sentence longer than a window still terminates. On
this page the two coincide, and they do buy something real — 2,664 and 2,740 come out
equal to the clean 2,484, which the word rule does not manage. They are not taken
because of what they cost the page the seam actually reads. Under either, **the whole
page loses `job-title [1363,1388) 'second registered officer'`** — one of the five
titles `test_redaction.py` counts, gone from the officers block — **and gains
`person-name [2144,2166) 'One of our supervisors'`**, a phrase that is nobody, which
takes a pseudonym letter in reading order and shifts every later one. That is this
ticket's own second harm, bought at the price of its first. And they still do not close
the line: 2,637 differs from the clean 2,484 under them as it does under the word rule.
So the word rule stands, and the residual — whole-word answers that move with a page's
length — is recorded here as open rather than closed, and is a question for the ticket
rather than a thing this suite pretends away.
"""

from collections.abc import Sequence
from itertools import pairwise
from typing import NamedTuple

from presidio_analyzer.chunkers import CharacterBasedTextChunker

from better_answers_worker.redaction.engine import WholeWordWindows, detect
from planted_page import FIXTURE_PAGE


class ACut(NamedTuple):
    """One window start Presidio puts inside a word, by offset, as measured here."""

    page_length: int
    at: int
    word_starts_at: int
    word_ends_at: int
    word: str
    fragment: str


#: The two of T-168's four lengths whose cut word came back as a finding, each written
#: down rather than computed so that a change to the rule cannot move both sides of the
#: comparison at once. At 2,664 the answer is a `person-name`, which is the harm the
#: ticket names; at 2,484 it is a `job-title` over the tail of *significant*.
THE_CUTS_PRESIDIO_MAKES: tuple[ACut, ...] = (
    ACut(2484, 607, 605, 616, "significant", "gnificant"),
    ACut(2664, 201, 198, 205, "numbers", "bers"),
)

#: All four of T-168's lengths. The two above showed the defect and the other two never
#: did, so those two regress nothing on their own: what they hold is that the rule did
#: no harm where there was none to undo.
THE_LENGTHS_T168_MEASURED = (2484, 2637, 2664, 2740)

#: The category a fragment was raised under, and the four people the page names past the
#: point every one of these lengths begins at. An empty list of fragments is only worth
#: reading beside these: a rule that took every name with them would satisfy the first
#: assertion of each pair and fail the second.
THE_CATEGORY_A_FRAGMENT_WAS_RAISED_UNDER = "person-name"
THE_PEOPLE_EVERY_LENGTH_STILL_NAMES = frozenset(
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
    # The control is Presidio's chunker taken at its own defaults and the subject is
    # the seam's taken at the same ones, so the single difference between the two runs
    # is the rule.
    for cut in THE_CUTS_PRESIDIO_MAKES:
        text = page_at(cut.page_length)

        theirs = [window.start for window in CharacterBasedTextChunker().chunk(text)]

        assert cut.at in cuts_in(text, theirs), cut
        assert text[cut.word_starts_at : cut.word_ends_at] == cut.word, cut
        assert text[cut.at : cut.word_ends_at] == cut.fragment, cut

        ours = WholeWordWindows().chunk(text)

        assert cuts_in(text, [window.start for window in ours]) == [], cut
        assert cuts_in(text, [window.end for window in ours]) == [], cut
        assert cut.word_starts_at in [window.start for window in ours], cut


def test_the_windows_cover_the_whole_page_and_carry_the_offsets_they_claim() -> None:
    # What retracting a start must not cost: every character still reaches the model,
    # and a window's text is the run its offsets name — the offsets every span found
    # inside it is shifted by, so a window that misreported them would move every
    # finding after it.
    text = page_at(THE_CUTS_PRESIDIO_MAKES[-1].page_length)

    windows = WholeWordWindows().chunk(text)

    assert [window.text for window in windows] == [
        text[window.start : window.end] for window in windows
    ]
    assert windows[0].start == 0
    assert windows[-1].end == len(text)
    assert all(later.start <= earlier.end for earlier, later in pairwise(windows))


def test_no_length_this_page_was_measured_at_raises_part_of_a_word() -> None:
    # The defect itself, at every length T-168 recorded rather than only at the two
    # that showed it, because a rule that closed one length and opened another would
    # be a rule nobody could trust on the next page. What is asserted is that no span's
    # edge falls inside a word, and never that the four lengths answer identically:
    # that was measured, is not true under any of the three rules, and the docblock's
    # table says exactly how each differs.
    for length in THE_LENGTHS_T168_MEASURED:
        assert partial_spans_on(page_at(length)) == [], length


def test_every_length_still_names_the_people_the_page_names() -> None:
    # The other direction of each pair: the rule takes the fragments and leaves the
    # names. Without this the assertion above is satisfied by a detector that answered
    # nothing at all — a model that failed to load, or a threshold that swallowed every
    # span.
    for length in THE_LENGTHS_T168_MEASURED:
        assert names_on(page_at(length)) >= THE_PEOPLE_EVERY_LENGTH_STILL_NAMES, length
