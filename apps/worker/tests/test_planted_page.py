"""The page two redaction suites share, held to the answers they are declared with.

`planted_page.py` declares one set of answers for
`tests/fixtures/redaction/supplier-information-pack.md`, and both suites that ask the
page anything read them from there. A declaration and a fixture still drift: a literal
retyped, a paragraph rewritten, a span moved out of the section it was planted in. The
two cases that would notice are the most expensive this tier has — one loads the
detector, the other builds the worker image and skips outright on a machine with no
Docker daemon — so the cheapest reading is made here instead, against the page's own
bytes. No daemon, no detector, and a failure that names the literal rather than a count
that came out one short.
"""

import pytest

from planted_page import (
    A_CONSUMER_ADDRESS,
    A_PLANTED_JOB_TITLE,
    FIXTURE_PAGE,
    PLANTED_SPANS,
    spans_withheld_under,
    typed_placeholders_under,
)

#: A binding nobody configured, the one flip an HR-shaped workspace makes, and every
#: rule a binding can switch off switched off — the three `test_redaction.py` hands the
#: seam, spelled here to be handed to the derivations both suites read from.
THE_SAFE_SET = {"default_on": True, "default_off": False}
AN_HR_SHAPED_BINDING = {"default_on": True, "default_off": True}
NOTHING_SWITCHABLE = {"default_on": False, "default_off": False}


def test_every_span_the_declaration_plants_is_on_the_page_once() -> None:
    page = FIXTURE_PAGE.read_text(encoding="utf-8")

    for category, planted in PLANTED_SPANS:
        # Once, and not merely somewhere. A literal the page carries twice is a span the
        # per-category counts beside it cannot describe, because the seam raises both
        # and the declaration claims one.
        assert page.count(planted) == 1, f"{category}: {planted!r}"


def test_a_span_goes_when_its_binding_switches_its_tier_on_and_not_before() -> None:
    # The derivation the image suite's absence list is made of, both ways and off the
    # binding rather than off a tier set written beside it. The page's planted job title
    # is raised at the tier an unconfigured binding leaves off, so its absence from that
    # binding's list is the binding's doing: flip the one key and the title joins the
    # list, which is what a second hand-kept list could never be made to do.
    unconfigured = spans_withheld_under(THE_SAFE_SET)

    assert A_CONSUMER_ADDRESS in unconfigured
    assert A_PLANTED_JOB_TITLE not in unconfigured
    assert A_PLANTED_JOB_TITLE in spans_withheld_under(AN_HR_SHAPED_BINDING)


def test_a_binding_writes_a_typed_word_for_each_switchable_tier_it_has_on() -> None:
    # Both suites read their placeholder totals out of this derivation, so a run where
    # it answered nothing would let both of them loop over an empty mapping and pass
    # having asserted nothing. The words are named here, once, and only the words: how
    # many of each is the fixture's business and stays where the fixture's counts are,
    # so a page that grows a fourth home address never touches this case.
    assert set(typed_placeholders_under(THE_SAFE_SET)) == {
        "[date of birth withheld]",
        "[home address withheld]",
        "[personal contact withheld]",
    }
    # The other way: with every switchable rule off there is no typed word to write, and
    # what the binding still takes goes under the always tier's one neutral word — which
    # is the total neither suite can derive and each writes down for itself.
    assert typed_placeholders_under(NOTHING_SWITCHABLE) == {}


def test_a_binding_whose_tier_this_page_carries_no_count_for_is_refused() -> None:
    # This page's counts are the recall set's, and the agreement raises a name and a job
    # title at the tier an HR-shaped binding switches on. Answering that binding would
    # mean handing back a mapping short by two words and no sign of it, so the direction
    # the mistake has to fail in is loudly, at the call rather than in the assertion.
    with pytest.raises(RuntimeError, match="no count"):
        typed_placeholders_under(AN_HR_SHAPED_BINDING)
