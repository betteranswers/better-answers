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

from planted_page import (
    A_CONSUMER_ADDRESS,
    A_PLANTED_JOB_TITLE,
    FIXTURE_PAGE,
    PLANTED_SPANS,
    spans_withheld_under,
)

#: A binding nobody configured, and the one flip an HR-shaped workspace makes — the two
#: `test_redaction.py` hands the seam, spelled here to be handed to the derivation the
#: image suite's absence list is built by.
THE_SAFE_SET = {"default_on": True, "default_off": False}
AN_HR_SHAPED_BINDING = {"default_on": True, "default_off": True}


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
