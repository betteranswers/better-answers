"""The redaction seam over one synthetic page, span by span.

The page under `tests/fixtures/redaction/` carries the eight spans a supplier pack was
flagged for, prototype 52's health note and one planted overlap, every value invented
(ADR 0027). The first
assertion here is the one research 65 asks for and the reason this suite exists: a
detector that reports offsets it cannot cut its own span back out of would withhold the
wrong run of characters, and the round-trip pass rate that research measured for
Presidio was 64 %. So every span the recall set names is sliced out of the text by the
offsets the seam returned and compared to the literal the fixture planted (`[TEST9]`).

The offsets are code points into the **normalised text the seam was given**, never into
the redacted text it returns: the two are the same document read two ways and their
lengths differ by every placeholder written.

**The planted overlap, and what it settles.** The signatories block's address is care of
a named officer, so the home-address rule and the person-name rule claim one run of
characters and only one placeholder can be written over it. Two rules of this seam meet
there: the tier a binding switches, which decides whether the address is written out at
all, and the officer-block rule, which puts a name inside such a block beyond any
binding's reach. Before T-145 the run was settled at detection time, ahead of both, and
the address won it on tier alone — so under a binding with the address tier switched off
the seam wrote neither span and the reader got the officer and his street together. The
run is now settled over the findings the binding actually withholds, and a span inside
another gives way to the one around it, which is what keeps the fix from becoming the
opposite leak: the name withheld and the street and postcode left in the clear.

**The known false-positive class.** A sort-code-shaped number inside a code fence or a
URL is a finding today. The fixture's appendix carries one — a payment-file example
with `SORTCODE=` and an eight-digit account beside it — and the seam raises it exactly
as it raises the real one in the finance section, because the words that validate a
sort code sit beside that example too. Presidio's negative context, which would let a
rule say *not when the span is inside a fence*, is a later rule and lands only if the
first client's documents show the class is worth the risk of suppressing a true
positive. Until then the reviewer sees it and keeps it in text.

**The second known false-positive class, and the more expensive one: an ordinary
sentence carrying a health *word*.** `HealthCueRecogniser` reads the special-category
descriptor's `context` tuple as its cue list and raises **the whole sentence** around
any token whose lemma is one of them, and two of the five — `health` and `condition` —
are ordinary words of a bid library. So *Our Health and Safety policy is reviewed
annually* and *this condition of contract* are each withheld entire as `[withheld]`,
and because the category narrows, the document they sit in lands **Restricted**
whatever its binding's class. That is the always tier, which no binding switches off,
so it is the one false positive an Admin cannot undo by changing a rule: the reviewer's
only road back is the per-span restore, story 4's act. The cost is stated here rather
than answered here — the cues, the thresholds and every answer this suite reads are
exactly what they were — because narrowing a cue is a recall decision about
special-category data and is **T-179's**, which is the ticket that removes this class.
Until it lands, a bid library on the always-on tier loses its health and safety policy
to a word.

**Why the first name on the page is not `[person A]`.** The letters are a permutation
the binding's seed draws, and a name takes the letter at the index its first appearance
falls on — so `[person A]` is the shape every pseudonym is written in rather than a
promise about the first person met. The alternative, handing out A, B, C in appearance
order, gives the same name the same letter in every binding that holds the document,
which is the join the agreement's own reason for a per-binding seed exists to prevent.
The letters two seeds hand out are written down below, derived from the seed alone.

**What a page of this fixture costs** is measured where the worker runs rather than
here, and `tests/test_image.py`'s docblock records it: milliseconds per page under each
of the two pinned GLiNER models, on the image, with the date and the machine class
(`T-122`), from which S1 derives the seam's per-document timeout.
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

#: The letter each of the page's first three people takes under each seed, by the order
#: their names are first met: Rosalind Petheridge, then Callum Whitcombe, then Imogen
#: Sarkar. Each is the seeded permutation of the alphabet read at index 0, 1 and 2,
#: derived from the seed and the alphabet alone and written down here rather than read
#: off the seam. The fourth person the page names is the signatory, met last and so at
#: index 3, and no letter of his is written down because none is ever written out: the
#: officer-block rule puts him at the always tier, which has one word for everybody.
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

#: The page's two email addresses, which are the pair the consumer-domain rule is read
#: through: an invented mailbox at a real consumer provider, and an invented mailbox on
#: the invented company's own domain. Only the domain differs in kind — both local parts
#: are a person's name — so what either assertion below can be about is the domain.
A_CONSUMER_ADDRESS = "rosalind.petheridge@hotmail.co.uk"
A_COMPANY_ADDRESS = "callum.whitcombe@meridianfenland.co.uk"

#: The signatories section's planted overlap, and the fourth person the page names. The
#: address is one span the home-address rule raises and the name sits **inside** it, so
#: the two rules claim the same run of characters and only one placeholder can be
#: written over it. The name is also inside a block of officers, which is the one place
#: the tier a finding is raised at stops being the binding's to switch.
A_FOURTH_OFFICER = "Oliver Denbigh"
AN_ADDRESS_AROUND_A_NAME = "9 Kestrel Lane, care of Oliver Denbigh, Barwick, LS22 4TD"

#: The two ends of that address, held separately because the whole literal cannot say
#: what has to be said here. A pass that let the name outrank the span around it would
#: write one word over the name alone and hand the reader `9 Kestrel Lane, care of
#: [withheld], Barwick, LS22 4TD` — the whole address bar the person it belongs to, and
#: a string the literal above no longer matches.
A_STREET_AND_ITS_POSTCODE: tuple[str, ...] = ("9 Kestrel Lane", "LS22 4TD")

#: The title planted in the roles section, and the fifth the page carries. It is the
#: only one of the five that sits inside no other finding's span, which is what makes it
#: the span this suite can read the switchable-off tier off: the health sentence covers
#: one of the other four whatever a binding says about job titles, because the run of
#: characters a placeholder is written over is settled between findings and not between
#: categories.
A_PLANTED_JOB_TITLE = "procurement manager"

#: Every span the recall set is made of, as the category it must be raised under and
#: the literal the fixture planted. Written out here rather than read back from the
#: seam, so a recogniser that moved a boundary by one character fails rather than
#: agrees with itself. The company address is deliberately absent: it is on no consumer
#: domain, so it is not personal contact and the page keeps it.
#:
#: The health sentence is last and has to stay last, because the test that narrows the
#: document reads this tuple's final entry as that sentence. A span planted later than
#: it goes into the middle of the list and never onto the end.
PLANTED_SPANS: tuple[tuple[str, str], ...] = (
    ("date-of-birth", "3 February 1978"),
    ("home-address", "14 Marlbrook Rise, Hensworth, NN12 3AB"),
    ("home-address", "7 Pinfold Gate, Ashdale, YO41 9ZZ"),
    ("home-address", AN_ADDRESS_AROUND_A_NAME),
    ("bank-details", "00-00-00, account number 12345678"),
    ("personal-contact", A_CONSUMER_ADDRESS),
    ("personal-contact", "07700 900123"),
    ("government-identifier", "999 000 0018"),
    ("job-title", A_PLANTED_JOB_TITLE),
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
    # raised under: three home addresses, two pieces of personal contact, and one each
    # of the rest. Personal contact is two and not three because the page's third email
    # address is the company's own, which no consumer-domain rule raises. The third home
    # address is the signatories block's, planted around an officer's name, and it is
    # counted here because a finding is what a rule raised and not what a binding wrote
    # out — the name inside it is a finding too.
    counts = on_a_plain_binding.counts

    assert counts["date-of-birth"] == 1
    assert counts["home-address"] == 3
    assert counts["bank-details"] == 2
    assert counts["personal-contact"] == 2
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
    # Seven spans: the two sort-code pairs, the NHS number, the health sentence and the
    # three officers the block rule raised to this tier out of the one a binding could
    # have switched off. The third of those officers is the signatory, and this binding
    # is the one that proves the rule reaches him: the home address around his name is
    # switched off here, so nothing else on the page covers those characters.
    assert redacted.count("[withheld]") == 7


def test_a_switchable_tier_that_is_off_leaves_its_spans_in_the_text(
    with_nothing_switchable_on: Redaction,
) -> None:
    # The other side of the same binding: the default-on tier is off, so the spans it
    # would have written out are still there to read.
    redacted = with_nothing_switchable_on.text

    assert "3 February 1978" in redacted
    assert "14 Marlbrook Rise, Hensworth, NN12 3AB" in redacted
    assert A_CONSUMER_ADDRESS in redacted


def test_the_default_on_tier_writes_its_own_word_in_place_of_each_span(
    on_a_plain_binding: Redaction,
) -> None:
    # The always tier has one word for everything in it; the tiers a binding switches
    # say what was taken, because a reader has to know a way of reaching somebody was
    # removed rather than a name.
    redacted = on_a_plain_binding.text

    assert "[date of birth withheld]" in redacted
    assert redacted.count("[home address withheld]") == 3
    assert redacted.count("[personal contact withheld]") == 2
    assert A_CONSUMER_ADDRESS not in redacted


def test_a_job_title_stays_in_the_text_until_the_binding_switches_its_tier_on(
    on_a_plain_binding: Redaction, on_an_hr_shaped_binding: Redaction, page: str
) -> None:
    # The last category the agreement declares and nothing here read off the seam. The
    # roles section plants a title inside no other finding's span, so no placeholder can
    # be written across it and what becomes of it is the binding's own answer: the
    # binding nobody configured leaves a job title where a reader can see whose job it
    # is, and the one flip an HR-shaped binding makes takes it out under its own word
    # rather than the neutral one. The count is the same on both, because what a binding
    # has in force decides what is written out and never what was found — which is also
    # why the four titles already on the page are counted here beside the planted one.
    assert A_PLANTED_JOB_TITLE in spans_under(on_a_plain_binding, page, "job-title")
    assert tiers_of(on_a_plain_binding, page, A_PLANTED_JOB_TITLE) == {"default-off"}

    assert A_PLANTED_JOB_TITLE in on_a_plain_binding.text
    assert "[job title withheld]" not in on_a_plain_binding.text
    assert on_a_plain_binding.counts["job-title"] == 5

    assert A_PLANTED_JOB_TITLE not in on_an_hr_shaped_binding.text
    assert "[job title withheld]" in on_an_hr_shaped_binding.text
    assert on_an_hr_shaped_binding.counts["job-title"] == 5


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


def test_an_email_on_a_consumer_domain_is_personal_contact_and_a_company_one_is_not(
    on_a_plain_binding: Redaction, page: str
) -> None:
    # The pair this rule is, both ways (`[TEST7]`), and the reason both local parts on
    # the page are a person's name: the only thing that differs between the two is the
    # domain, so the only thing either half can be about is the domain. The positive
    # half is the span cut back out of the page by the offsets the finding carried; the
    # negative half is asserted over the same offsets rather than over a list of
    # strings, because a finding that claimed part of the company address would be a
    # placeholder written across it whatever the whole address matched.
    contact = spans_under(on_a_plain_binding, page, "personal-contact")

    assert A_CONSUMER_ADDRESS in contact

    opened = page.index(A_COMPANY_ADDRESS)
    closed = opened + len(A_COMPANY_ADDRESS)

    assert [
        finding
        for finding in on_a_plain_binding.findings
        if finding.start < closed and opened < finding.end
    ] == []
    # The other half of the negative direction, and a different string: the offsets
    # above are into the text the seam was given, and what a reader is handed is the
    # text it returns, whose length differs by every placeholder written.
    assert A_COMPANY_ADDRESS in on_a_plain_binding.text


def test_the_telephone_number_is_personal_contact_whatever_the_domain_rule_does(
    on_a_plain_binding: Redaction, page: str
) -> None:
    # The regression a domain rule is most likely to cause. Personal contact is raised
    # by two entities and only one of them is an email, so a rule that filtered the
    # category rather than the one recogniser would take the number out with it — and
    # a number has no domain to be on a list.
    assert "07700 900123" in spans_under(on_a_plain_binding, page, "personal-contact")
    assert "07700 900123" not in on_a_plain_binding.text


def test_a_shouted_consumer_domain_is_still_the_same_domain() -> None:
    # A domain is case-insensitive by the standard that defines it, so a document that
    # shouted one names the same provider. Both halves are literals (`[TEST9]`): the
    # address withheld and the address kept are written down here rather than derived
    # from the list the rule reads.
    found = redact(
        "Her own address is R.PETHERIDGE@GMAIL.COM and the office takes enquiries at"
        " enquiries@meridianfenland.co.uk.",
        THE_SAFE_SET,
        NO_SUPPRESSIONS,
        SEED,
    )

    assert "R.PETHERIDGE@GMAIL.COM" not in found.text
    assert found.text.count("[personal contact withheld]") == 1
    assert "enquiries@meridianfenland.co.uk" in found.text


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


def test_a_signatory_named_inside_a_home_address_is_withheld_with_its_block(
    on_a_plain_binding: Redaction,
    with_nothing_switchable_on: Redaction,
    page: str,
) -> None:
    # The signatories block carries a home address whose span contains the officer it is
    # care of, so two rules claim one run of characters and only one placeholder can be
    # written over it. Both are still findings — the row an Admin reviews is what a rule
    # raised — and the name is at the always tier, because a name inside a block of
    # officers is not the binding's to switch.
    assert AN_ADDRESS_AROUND_A_NAME in spans_under(
        on_a_plain_binding, page, "home-address"
    )
    assert tiers_of(on_a_plain_binding, page, A_FOURTH_OFFICER) == {"always"}

    # What is written out is two-sided, and this is the half a bare precedence move
    # breaks: with the address tier on, the address covers the run, so the street and
    # the postcode leave the page with the name rather than staying behind it.
    assert A_FOURTH_OFFICER not in on_a_plain_binding.text
    for end_of_the_address in A_STREET_AND_ITS_POSTCODE:
        assert end_of_the_address not in on_a_plain_binding.text

    # And the other half, which is where the seam used to write neither span: with that
    # tier switched off nothing else on the page covers those characters, so the block
    # rule is the only thing left between the officer and the reader. The street and the
    # postcode stay, because switching the address tier off is what this binding asked
    # for and the block rule reaches names alone.
    assert A_FOURTH_OFFICER not in with_nothing_switchable_on.text
    for end_of_the_address in A_STREET_AND_ITS_POSTCODE:
        assert end_of_the_address in with_nothing_switchable_on.text


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
