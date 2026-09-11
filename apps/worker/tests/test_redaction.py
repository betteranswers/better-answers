"""The redaction seam over one synthetic page, span by span.

The page under `tests/fixtures/redaction/` carries the eight spans a supplier pack was
flagged for and prototype 52's health note, every value invented (ADR 0027). The first
assertion here is the one research 65 asks for and the reason this suite exists: a
detector that reports offsets it cannot cut its own span back out of would withhold the
wrong run of characters, and the round-trip pass rate that research measured for
Presidio was 64 %. So every span the recall set names is sliced out of the text by the
offsets the seam returned and compared to the literal the fixture planted (`[TEST9]`).

The offsets are code points into the **normalised text the seam was given**, never into
the redacted text it returns: the two are the same document read two ways and their
lengths differ by every placeholder written.

**The known false-positive class.** A sort-code-shaped number inside a code fence or a
URL is a finding today. The fixture's appendix carries one — a payment-file example
with `SORTCODE=` and an eight-digit account beside it — and the seam raises it exactly
as it raises the real one in the finance section, because the words that validate a
sort code sit beside that example too. Presidio's negative context, which would let a
rule say *not when the span is inside a fence*, is a later rule and lands only if the
first client's documents show the class is worth the risk of suppressing a true
positive. Until then the reviewer sees it and keeps it in text.

What is asserted here is this iteration's half of the seam: the offsets, the recall set,
the always tier's one word, the date pair and the health cue's narrowing. The stable
pseudonyms, the officer block, what a suppression does to a span and the determinism of
two identical runs are asserted in the iterations that build them.
"""

from collections.abc import Mapping, Sequence
from pathlib import Path

import pytest

from better_answers_worker.redaction import Redaction, redact
from better_answers_worker.redaction.pins import VERSION_STRING

FIXTURE = (
    Path(__file__).resolve().parent
    / "fixtures"
    / "redaction"
    / "supplier-information-pack.md"
)

#: A binding nobody configured: the always tier and the default-on tier in force, names
#: and job titles left in the text. It is the default the `source_binding` column takes.
THE_SAFE_SET: Mapping[str, bool] = {"default_on": True, "default_off": False}

#: The binding acceptance line 3 names — every rule a binding can switch off, switched
#: off — under which only the always tier is written out of the text.
NOTHING_SWITCHABLE: Mapping[str, bool] = {"default_on": False, "default_off": False}

#: No erasure request applies to this document, and the seed is one binding's.
NO_SUPPRESSIONS: Sequence[Mapping[str, Sequence[str]]] = ()
SEED = "b0f3a1d2c4e5"

#: Every span the recall set is made of, as the category it must be raised under and
#: the literal the fixture planted. Written out here rather than read back from the
#: seam, so a recogniser that moved a boundary by one character fails rather than
#: agrees with itself.
PLANTED_SPANS: tuple[tuple[str, str], ...] = (
    ("date-of-birth", "3 February 1978"),
    ("home-address", "14 Marlbrook Rise, Hensworth, NN12 3AB"),
    ("home-address", "7 Pinfold Gate, Ashdale, YO41 9ZZ"),
    ("bank-details", "00-00-00, account number 12345678"),
    ("personal-contact", "rosalind.petheridge@example.com"),
    ("personal-contact", "callum.whitcombe@example.org"),
    ("personal-contact", "07700 900123"),
    ("government-identifier", "999 000 0018"),
    (
        "special-category",
        "One of our supervisors was on long-term sick leave following a cancer "
        "diagnosis, which is why the programme slipped by six weeks.",
    ),
)

#: The dates in the fixture's contract history. A bid library is dates all the way down
#: and none of these is a person's, so none of them may be raised as one.
BARE_DATES: tuple[str, ...] = ("14 March 2024", "2 June 2023", "19 September 2023")

#: The date the fixture puts beside the words *date of birth*, which is the other half
#: of the pair (`[TEST7]`).
DATE_IN_CONTEXT = "3 February 1978"

#: The sort-code-shaped number in the appendix's code fence: the known false-positive
#: class this suite's docblock records, asserted so the class is proved rather than
#: claimed.
FENCED_SORT_CODE = "00-00-99 ACCOUNT=87654321"


@pytest.fixture(scope="module")
def page() -> str:
    return FIXTURE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def on_a_plain_binding(page: str) -> Redaction:
    return redact(page, THE_SAFE_SET, NO_SUPPRESSIONS, SEED)


@pytest.fixture(scope="module")
def with_nothing_switchable_on(page: str) -> Redaction:
    return redact(page, NOTHING_SWITCHABLE, NO_SUPPRESSIONS, SEED)


def spans_under(found: Redaction, page: str, category: str) -> list[str]:
    """Every finding of one category, cut back out of the text by its own offsets."""
    return [
        page[finding.start : finding.end]
        for finding in found.findings
        if finding.category == category
    ]


def test_every_span_is_cut_back_out_of_the_text_by_the_offsets_it_came_with(
    on_a_plain_binding: Redaction, page: str
) -> None:
    # Research 65's open question 2, answered: the offsets a finding carries are the
    # offsets the placeholder will be written at, so a slice of the input taken with
    # them has to be the value that was there.
    for category, planted in PLANTED_SPANS:
        assert planted in spans_under(on_a_plain_binding, page, category), (
            f"{category}: {planted!r} was not cut back out of the page"
        )


def test_the_recall_set_is_found_in_full(on_a_plain_binding: Redaction) -> None:
    # The eight flagged spans and the health note, counted by the category each is
    # raised under: two home addresses, three pieces of personal contact, and one each
    # of the rest.
    counts = on_a_plain_binding.counts

    assert counts["date-of-birth"] == 1
    assert counts["home-address"] == 2
    assert counts["bank-details"] == 2
    assert counts["personal-contact"] == 3
    assert counts["government-identifier"] == 1
    assert counts["special-category"] == 1


def test_every_finding_names_the_tier_its_category_is_raised_at(
    on_a_plain_binding: Redaction,
) -> None:
    raised = {
        (finding.category, finding.tier) for finding in on_a_plain_binding.findings
    }

    assert ("special-category", "always") in raised
    assert ("bank-details", "always") in raised
    assert ("government-identifier", "always") in raised
    assert ("date-of-birth", "default-on") in raised
    assert ("home-address", "default-on") in raised
    assert ("personal-contact", "default-on") in raised


def test_the_always_set_is_withheld_where_every_switchable_rule_is_off(
    with_nothing_switchable_on: Redaction,
) -> None:
    # Acceptance line 3's first clause: the always tier is policy, so a binding with
    # both switchable tiers off still loses every always-tier span, and loses it to the
    # one neutral word rather than a typed placeholder that would say what class of
    # data the document held.
    redacted = with_nothing_switchable_on.text

    assert "00-00-00, account number 12345678" not in redacted
    assert "999 000 0018" not in redacted
    assert "cancer diagnosis" not in redacted
    # Four spans: the two sort-code pairs, the NHS number and the health sentence.
    assert redacted.count("[withheld]") == 4


def test_a_switchable_tier_that_is_off_leaves_its_spans_in_the_text(
    with_nothing_switchable_on: Redaction,
) -> None:
    # The other side of the same binding: the default-on tier is off, so the spans it
    # would have written out are still there to read.
    redacted = with_nothing_switchable_on.text

    assert "3 February 1978" in redacted
    assert "14 Marlbrook Rise, Hensworth, NN12 3AB" in redacted
    assert "rosalind.petheridge@example.com" in redacted


def test_the_default_on_tier_writes_its_own_word_in_place_of_each_span(
    on_a_plain_binding: Redaction,
) -> None:
    # The always tier has one word for everything in it; the tiers a binding switches
    # say what was taken, because a reader has to know a way of reaching somebody was
    # removed rather than a name.
    redacted = on_a_plain_binding.text

    assert "[date of birth withheld]" in redacted
    assert redacted.count("[home address withheld]") == 2
    assert redacted.count("[personal contact withheld]") == 3
    assert "rosalind.petheridge@example.com" not in redacted


def test_a_bare_date_is_not_a_finding_and_a_date_beside_date_of_birth_is(
    on_a_plain_binding: Redaction, page: str
) -> None:
    # The pair, both ways (`[TEST7]`). "In context" is Presidio's context enhancer: the
    # date pattern alone scores under the category's threshold, and the lemma *birth*
    # beside it is what carries it over.
    dates = spans_under(on_a_plain_binding, page, "date-of-birth")

    assert dates == [DATE_IN_CONTEXT]
    for bare in BARE_DATES:
        assert bare not in dates
        assert bare in on_a_plain_binding.text


def test_a_health_cue_withholds_its_sentence_and_narrows_the_document(
    on_a_plain_binding: Redaction, page: str
) -> None:
    # A cue withheld out of its sentence leaves the sentence saying it anyway, so the
    # span is the sentence. The narrowing verdict is the seam's answer to what the
    # document's sensitivity must become, and it is the only verdict the seam gives.
    sentences = spans_under(on_a_plain_binding, page, "special-category")

    assert sentences == [PLANTED_SPANS[-1][1]]
    assert on_a_plain_binding.verdict == "Restricted"
    assert PLANTED_SPANS[-1][1] not in on_a_plain_binding.text


def test_a_page_with_no_special_category_cue_narrows_nothing() -> None:
    # The other half of the verdict (`[TEST7]`): narrowing is a finding's doing, so a
    # page without one comes back with no verdict rather than with the safe one.
    found = redact(
        "The framework agreement was signed on 14 March 2024.",
        THE_SAFE_SET,
        NO_SUPPRESSIONS,
        SEED,
    )

    assert found.verdict is None
    assert [
        finding for finding in found.findings if finding.category == "special-category"
    ] == []


def test_a_sort_code_shaped_number_inside_a_code_fence_is_a_finding_today(
    on_a_plain_binding: Redaction, page: str
) -> None:
    # The known false-positive class this suite's docblock records, held by a test so
    # that the day a negative-context rule lands, this assertion is what has to change.
    assert FENCED_SORT_CODE in spans_under(on_a_plain_binding, page, "bank-details")


def test_the_redaction_carries_the_version_string_every_finding_rides_on(
    on_a_plain_binding: Redaction,
) -> None:
    assert on_a_plain_binding.version == VERSION_STRING
