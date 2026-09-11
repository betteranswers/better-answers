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

**Why the first name on the page is not `[person A]`.** The letters are a permutation
the binding's seed draws, and a name takes the letter at the index its first appearance
falls on — so `[person A]` is the shape every pseudonym is written in rather than a
promise about the first person met. The alternative, handing out A, B, C in appearance
order, gives the same name the same letter in every binding that holds the document,
which is the join the agreement's own reason for a per-binding seed exists to prevent.
The letters two seeds hand out are written down below, derived from the seed alone.
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

#: A meeting-note, support-ticket or HR-shaped binding: the one flip story 6 names, and
#: the only binding under which a name is written out of the text at all.
AN_HR_SHAPED_BINDING: Mapping[str, bool] = {"default_on": True, "default_off": True}

#: No erasure request applies to this document, and the seed is one binding's.
NO_SUPPRESSIONS: Sequence[Mapping[str, Sequence[str]]] = ()
SEED = "b0f3a1d2c4e5"

#: A second binding's seed. Two seeds are written down rather than one sampled twice,
#: because what has to hold is that a named person takes a different letter under each
#: — and "assert the two differ" over a pair nobody wrote down proves nothing on the run
#: where they happen to agree (`[TEST9]`).
ANOTHER_SEED = "7c1e9b04af62"

#: The letter each of the page's three people takes under each seed, by the order their
#: names are first met: Rosalind Petheridge, then Callum Whitcombe, then Imogen Sarkar.
#: Each is the seeded permutation of the alphabet read at index 0, 1 and 2, derived from
#: the seed and the alphabet alone and written down here rather than read off the seam.
LETTERS_UNDER_SEED: Mapping[str, str] = {
    "Rosalind Petheridge": "U",
    "Callum Whitcombe": "E",
    "Imogen Sarkar": "Y",
}
LETTERS_UNDER_ANOTHER_SEED: Mapping[str, str] = {
    "Rosalind Petheridge": "Q",
    "Callum Whitcombe": "R",
    "Imogen Sarkar": "X",
}

#: One erasure request's identifier set, naming one of the page's three people and
#: neither of the other two. It is the shape the `subject_request` row holds, and the
#: name is given under the kind a requester would give it under.
ONE_NAME_SUPPRESSED: Sequence[Mapping[str, Sequence[str]]] = (
    {"emails": (), "names": ("Rosalind Petheridge",), "other": ()},
)

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


@pytest.fixture(scope="module")
def on_an_hr_shaped_binding(page: str) -> Redaction:
    return redact(page, AN_HR_SHAPED_BINDING, NO_SUPPRESSIONS, SEED)


@pytest.fixture(scope="module")
def under_another_seed(page: str) -> Redaction:
    return redact(page, AN_HR_SHAPED_BINDING, NO_SUPPRESSIONS, ANOTHER_SEED)


@pytest.fixture(scope="module")
def with_one_name_suppressed(page: str) -> Redaction:
    return redact(page, AN_HR_SHAPED_BINDING, ONE_NAME_SUPPRESSED, SEED)


def spans_under(found: Redaction, page: str, category: str) -> list[str]:
    """Every finding of one category, cut back out of the text by its own offsets."""
    return [
        page[finding.start : finding.end]
        for finding in found.findings
        if finding.category == category
    ]


def officers_block(text: str) -> str:
    """The persons-with-significant-control section of a text, heading to heading."""
    opened = text.index("## Persons with significant control")
    return text[opened : text.index("## Finance", opened)]


def past_the_officers_block(text: str) -> str:
    """Everything after that section, which is where the same names are met again."""
    return text[text.index("## Finance") :]


def tiers_of(found: Redaction, page: str, span: str) -> set[str]:
    """Every tier one literal value was raised at, wherever it sits on the page."""
    return {
        finding.tier
        for finding in found.findings
        if page[finding.start : finding.end] == span
    }


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
    # Six spans: the two sort-code pairs, the NHS number, the health sentence and the
    # two officers the block rule raised to this tier out of the one a binding could
    # have switched off.
    assert redacted.count("[withheld]") == 6


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


def test_a_name_passes_through_on_a_plain_binding_and_is_a_pseudonym_on_an_hr_one(
    on_a_plain_binding: Redaction, on_an_hr_shaped_binding: Redaction
) -> None:
    # Story 6, both directions (`[TEST7]`): a capability statement still names its ISO
    # lead, and one flip of the binding's own key turns every name into its letter.
    # Imogen Sarkar is the one of the three who is never inside the officers block, so
    # she is the person this pair is about.
    # The space matters: `[personal contact withheld]` is a different placeholder for a
    # different category, and a prefix without it would match that instead.
    assert "Imogen Sarkar" in on_a_plain_binding.text
    assert "[person " not in on_a_plain_binding.text

    assert "Imogen Sarkar" not in on_an_hr_shaped_binding.text
    assert "[person Y]" in on_an_hr_shaped_binding.text


def test_the_same_name_is_the_same_letter_everywhere_in_one_binding(
    on_an_hr_shaped_binding: Redaction, page: str
) -> None:
    # The page names Imogen Sarkar three times and never inside the officers block, so
    # every one of her spans is her own tier's and every one must read the same. A
    # letter drawn per span rather than per name would leave this at one each.
    assert page.count("Imogen Sarkar") == 3
    assert on_an_hr_shaped_binding.text.count("[person Y]") == 3


def test_a_different_seed_gives_the_same_name_a_different_letter(
    on_an_hr_shaped_binding: Redaction, under_another_seed: Redaction
) -> None:
    # The reason a seed is per binding: two bindings holding the same document must not
    # be joinable on the letter. Both seeds and all six letters are literals, so this
    # says which letters rather than that two samples happened to differ (`[TEST9]`).
    for name, letter in LETTERS_UNDER_SEED.items():
        under_one = f"[person {letter}]"
        under_other = f"[person {LETTERS_UNDER_ANOTHER_SEED[name]}]"

        assert under_one != under_other
        assert under_one in on_an_hr_shaped_binding.text
        assert under_one not in under_another_seed.text
        assert under_other in under_another_seed.text


def test_a_name_inside_an_officers_block_is_withheld_with_its_block_whatever_the_rules(
    on_a_plain_binding: Redaction,
    on_an_hr_shaped_binding: Redaction,
    with_nothing_switchable_on: Redaction,
) -> None:
    # Story 7, over all three bindings, because "whatever the rules in force" is the
    # whole of the line: the binding that leaves names alone, the one that turns them
    # into letters, and the one that switches off every rule it is allowed to. The
    # placeholder follows the tier the finding was raised at and not its category, so an
    # officer's name loses the pseudonym its category would otherwise have given it.
    for found in (
        on_a_plain_binding,
        on_an_hr_shaped_binding,
        with_nothing_switchable_on,
    ):
        block = officers_block(found.text)

        assert "Rosalind Petheridge" not in block
        assert "Callum Whitcombe" not in block
        assert "[person " not in block
        assert block.count("[withheld]") == 2


def test_the_same_name_outside_the_block_is_still_its_own_tier(
    on_a_plain_binding: Redaction, on_an_hr_shaped_binding: Redaction, page: str
) -> None:
    # The other half of the block rule (`[TEST7]`): Rosalind Petheridge is named inside
    # the officers block and twice again past it, and only the first is the rule's. A
    # pass that withheld every name everywhere would satisfy the test above and fail
    # here, and it would also make an HR binding unreadable.
    assert "Rosalind Petheridge" in past_the_officers_block(on_a_plain_binding.text)
    assert "[person U]" in past_the_officers_block(on_an_hr_shaped_binding.text)
    assert tiers_of(on_a_plain_binding, page, "Rosalind Petheridge") == {
        "always",
        "default-off",
    }


def test_a_suppressed_name_is_withheld_and_every_other_name_is_untouched(
    on_an_hr_shaped_binding: Redaction, with_one_name_suppressed: Redaction
) -> None:
    # What a suppression does to a span: the always tier and its one neutral word, the
    # officer block's own mechanism. `[person U]` would still mark where she is, how
    # often she is mentioned and which paragraphs are about her, and marking where she
    # is is what a suppression exists to prevent. Both directions (`[TEST7]`): her
    # letter goes and the other two stay, letter for letter and count for count, on a
    # binding whose only difference from the control is the request.
    assert "[person U]" in on_an_hr_shaped_binding.text
    assert "[person U]" not in with_one_name_suppressed.text

    for letter in ("E", "Y"):
        assert with_one_name_suppressed.text.count(
            f"[person {letter}]"
        ) == on_an_hr_shaped_binding.text.count(f"[person {letter}]")


def test_a_suppression_raises_the_named_person_to_the_always_tier(
    on_a_plain_binding: Redaction, with_one_name_suppressed: Redaction, page: str
) -> None:
    # The finding row is what an Admin reviews and what the erasure map is read from, so
    # the tier has to move on the row and not only in the text. Without the request the
    # same name is raised at two tiers, the officers block deciding one of them; with
    # it, both are the always tier, and the two people the request does not name are
    # where they were.
    assert tiers_of(on_a_plain_binding, page, "Rosalind Petheridge") == {
        "always",
        "default-off",
    }
    assert tiers_of(with_one_name_suppressed, page, "Rosalind Petheridge") == {"always"}
    assert tiers_of(with_one_name_suppressed, page, "Imogen Sarkar") == {"default-off"}


def test_the_same_inputs_twice_give_identical_output(
    on_an_hr_shaped_binding: Redaction, page: str
) -> None:
    # The seam holds no answer between calls, so a second run does the whole of the work
    # again and has to arrive in the same place: the permutation is drawn from the seed
    # rather than from anything the process carries, the letters are handed out in
    # reading order, and nothing here is sampled. All five of what the seam answers,
    # because a text that agreed while the counts drifted would be the harder bug.
    again = redact(page, AN_HR_SHAPED_BINDING, NO_SUPPRESSIONS, SEED)

    assert again.text == on_an_hr_shaped_binding.text
    assert again.findings == on_an_hr_shaped_binding.findings
    assert again.counts == on_an_hr_shaped_binding.counts
    assert again.verdict == on_an_hr_shaped_binding.verdict
    assert again.version == on_an_hr_shaped_binding.version
