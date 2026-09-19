"""What the redaction fixture plants, declared once for the two suites that read it.

`tests/fixtures/redaction/supplier-information-pack.md` has one set of answers and two
suites ask it for them. `test_redaction.py` runs the seam over the page in this tree;
`test_image.py` runs the same seam over the same page inside the worker image, so that
the image's answers can be held to this repository's. Both used to write the spans and
the counts out for themselves, and when T-145 grew the fixture the image suite's copy
was left saying two home addresses against a page that answers three — false, green, and
found only by T-147's ambiguous impact reading. One declaration is what makes the next
fixture edit fail in one place instead of passing in the wrong one.

A span is the category it must be raised under and the literal the fixture planted, and
it is written down rather than read back from the seam: an oracle that asks the detector
what it found agrees with a detector that moved a boundary by one character. The counts
are per category and not per literal, because a category can be raised by something
nobody planted — the appendix's fenced sort code is the second `bank-details` finding
and is no span of this list.

**No redaction tier is declared here.** `contracts/redaction/cases.json` declares the
tier each category is ordinarily raised at and the key each switchable tier is switched
by, and the app and this tier both read it. So a suite asking which of these spans a
binding withholds hands `spans_withheld_under` the rules it handed the seam, and the
agreement answers: the tiers a binding has in force are read off the binding rather than
restated beside it, which is the way a case can say one binding and exercise another.

`test_planted_page.py` holds every literal below to the page it claims to come from. It
loads no detector and asks no Docker daemon, so it runs wherever `check` runs.
"""

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

#: `apps/worker/tests/` → the repository root.
TEST_DIRECTORY = Path(__file__).resolve().parent
REPO_ROOT = TEST_DIRECTORY.parents[2]

FIXTURE_PAGE = (
    TEST_DIRECTORY / "fixtures" / "redaction" / "supplier-information-pack.md"
)

#: The redaction agreement both tiers read (ADR 0031). Its tables carry the tier each
#: category is raised at, the binding key each tier is switched by and the word written
#: in place of a span of each category, which is why this module declares none of them.
TIER_AGREEMENT = REPO_ROOT / "contracts" / "redaction" / "cases.json"

_AGREEMENT = cast(
    "dict[str, Any]", json.loads(TIER_AGREEMENT.read_text(encoding="utf-8"))
)

#: The tier each category is ordinarily raised at. One rule outranks it — the
#: officer-block post-pass puts a name inside such a block at the always tier whatever
#: its category says — and no span below is a name, so nothing derived from this table
#: reads through that rule.
_TIER_BY_CATEGORY: Mapping[str, str] = {
    str(category["category"]): str(category["tier"])
    for category in _AGREEMENT["categories"]
}

#: The word written in place of a span of each category, and the tiers whose word is
#: that typed one rather than the always tier's single neutral word.
_PLACEHOLDER_BY_CATEGORY: Mapping[str, str] = {
    str(category["category"]): str(category["placeholder"])
    for category in _AGREEMENT["categories"]
}
_SWITCHABLE_TIERS = frozenset(
    str(tier["tier"]) for tier in _AGREEMENT["tiers"] if tier["switchable"]
)

#: The page's consumer-domain email address: an invented mailbox at a real provider. The
#: page carries a second address, on the invented company's own domain, which is
#: deliberately not planted here — no consumer-domain rule raises it, so the page keeps
#: it, and a list that named it would be asserting the opposite of the rule.
A_CONSUMER_ADDRESS = "rosalind.petheridge@hotmail.co.uk"

#: The signatories section's planted overlap. The address is one span the home-address
#: rule raises and the fourth person the page names sits **inside** it, so two rules
#: claim the same run of characters and only one placeholder can be written over it.
AN_ADDRESS_AROUND_A_NAME = "9 Kestrel Lane, care of Oliver Denbigh, Barwick, LS22 4TD"

#: The title planted in the roles section, and the fifth the page carries. It is the
#: only one of the five sitting inside no other finding's span, which is what makes it
#: the span a suite can read the switchable-off tier off: the health sentence covers one
#: of the other four whatever a binding says about job titles, because the run of
#: characters a placeholder is written over is settled between findings and not between
#: categories.
A_PLANTED_JOB_TITLE = "procurement manager"

#: The health note prototype 52 planted, which the seam raises whole. A cue withheld
#: out of its sentence leaves the sentence saying it anyway, so the span is the
#: sentence. It carries a name because the case that reads the narrowing verdict has to
#: say which span narrowed the document, and reaching for an end of the list below would
#: make the order of that list a contract two suites then depend on.
A_HEALTH_SENTENCE = (
    "One of our supervisors was on long-term sick leave following a cancer "
    "diagnosis, which is why the programme slipped by six weeks."
)

#: Every span the recall set is made of, as the category it must be raised under and the
#: literal the fixture planted.
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
    ("special-category", A_HEALTH_SENTENCE),
)

#: What the page answers by category, whatever binding holds it: a finding is what a
#: rule raised, and what a binding has in force decides only what is written out. Three
#: home addresses, two pieces of personal contact and one each of the rest. Personal
#: contact is two and not three because the page's third email address is the company's
#: own. Bank details is two against one planted span, the appendix's fenced sort code
#: being the other. The third home address is the signatories block's, planted around an
#: officer's name, and it is counted because the name inside it is a finding too.
#:
#: The two switchable-off categories are absent. What the page answers for a name or a
#: title is a count of the people it describes rather than of what was planted in it —
#: four job titles the page already carried beside the one above — so it is asserted
#: where the binding that writes them out is the subject, and not here.
FINDINGS_BY_CATEGORY: Mapping[str, int] = {
    "date-of-birth": 1,
    "home-address": 3,
    "bank-details": 2,
    "personal-contact": 2,
    "government-identifier": 1,
    "special-category": 1,
}


def _tiers_in_force(rules: Mapping[str, bool]) -> tuple[str, ...]:
    """The tiers a binding with these rules in force writes out of a document.

    The always tier carries no binding key, because no binding switches it off; each
    switchable tier is in force when the rules say so under the key the agreement gives
    it. Read that way round so that the rules a case hands the seam are the same rules
    its expectation is built from, rather than a second statement of the binding sitting
    beside the first with nothing holding the two together.
    """
    return tuple(
        str(tier["tier"])
        for tier in _AGREEMENT["tiers"]
        if not tier["switchable"] or rules.get(str(tier["binding_key"]), False)
    )


def spans_withheld_under(rules: Mapping[str, bool]) -> tuple[str, ...]:
    """Every planted literal a binding with these rules in force takes out of the text.

    A span goes when the tier its category is raised at is one the binding has in force,
    so a suite asking what is gone from a redacted page derives the list from the
    declaration and the agreement rather than keeping one of its own: a category that
    moves tier in the agreement moves in the list, and a span left in the text is left
    because its tier is off rather than because somebody forgot to write it down.
    """
    in_force = _tiers_in_force(rules)
    return tuple(
        planted
        for category, planted in PLANTED_SPANS
        if _TIER_BY_CATEGORY[category] in in_force
    )


def typed_placeholders_under(rules: Mapping[str, bool]) -> Mapping[str, int]:
    """Every typed placeholder this page carries under a binding, and how many of each.

    A finding at a switchable tier the binding has in force is written out under its
    own category's word, one placeholder per finding — so the word is the agreement's
    and the number is that category's count above, and a suite that spelled either out
    would be keeping a third copy of an answer this module already holds.

    The answer is complete or there is no answer. This page's counts cover the recall
    set and not the two categories the agreement raises at the tier an unconfigured
    binding leaves off, so a binding that switches *that* tier on is refused rather than
    handed a mapping short by a word and no sign of it; a word two categories at one
    in-force tier would share is refused for the same reason, since the second would
    land on the first and the mapping would read as complete.

    **The always tier is not here and cannot be derived.** It has one neutral word for
    every category in it, and what that word ends up covering is settled between
    findings rather than per category, so each suite writes its own total for it down:
    six under the binding nobody configured, seven under the binding with every
    switchable rule off, where the home address around an officer's name is left in the
    text and his name needs a word of its own.
    """
    in_force = set(_tiers_in_force(rules)) & _SWITCHABLE_TIERS
    taken = [
        category for category, tier in _TIER_BY_CATEGORY.items() if tier in in_force
    ]
    uncounted = sorted(
        category for category in taken if category not in FINDINGS_BY_CATEGORY
    )
    if uncounted:
        message = (
            f"{', '.join(uncounted)}: raised at a tier these rules have in force, and "
            f"{FIXTURE_PAGE.name} declares no count"
        )
        raise RuntimeError(message)
    written = {
        _PLACEHOLDER_BY_CATEGORY[category]: FINDINGS_BY_CATEGORY[category]
        for category in taken
    }
    if len(written) != len(taken):
        message = (
            f"{TIER_AGREEMENT.name} gives two of {', '.join(sorted(taken))} the same "
            "word at a tier these rules have in force, so one total would hide another"
        )
        raise RuntimeError(message)
    return written
