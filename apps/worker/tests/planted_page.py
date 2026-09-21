import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

TEST_DIRECTORY = Path(__file__).resolve().parent
REPO_ROOT = TEST_DIRECTORY.parents[2]

FIXTURE_PAGE = (
    TEST_DIRECTORY / "fixtures" / "redaction" / "supplier-information-pack.md"
)


TIER_AGREEMENT = REPO_ROOT / "contracts" / "redaction" / "cases.json"

_AGREEMENT = cast(
    "dict[str, Any]", json.loads(TIER_AGREEMENT.read_text(encoding="utf-8"))
)


_TIER_BY_CATEGORY: Mapping[str, str] = {
    str(category["category"]): str(category["tier"])
    for category in _AGREEMENT["categories"]
}


_PLACEHOLDER_BY_CATEGORY: Mapping[str, str] = {
    str(category["category"]): str(category["placeholder"])
    for category in _AGREEMENT["categories"]
}
_SWITCHABLE_TIERS = frozenset(
    str(tier["tier"]) for tier in _AGREEMENT["tiers"] if tier["switchable"]
)


A_CONSUMER_ADDRESS = "rosalind.petheridge@hotmail.co.uk"


AN_ADDRESS_AROUND_A_NAME = "9 Kestrel Lane, care of Oliver Denbigh, Barwick, LS22 4TD"


A_PLANTED_JOB_TITLE = "procurement manager"


A_HEALTH_SENTENCE = (
    "One of our supervisors was on long-term sick leave following a cancer "
    "diagnosis, which is why the programme slipped by six weeks."
)


A_HEALTH_AND_SAFETY_SENTENCE = (
    "Our Health and Safety policy is reviewed annually, and no condition of contract "
    "in this pack departs from it."
)


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


FINDINGS_BY_CATEGORY: Mapping[str, int] = {
    "date-of-birth": 1,
    "home-address": 3,
    "bank-details": 2,
    "personal-contact": 2,
    "government-identifier": 1,
    "special-category": 1,
}


def _tiers_in_force(rules: Mapping[str, bool]) -> tuple[str, ...]:
    return tuple(
        str(tier["tier"])
        for tier in _AGREEMENT["tiers"]
        if not tier["switchable"] or rules.get(str(tier["binding_key"]), False)
    )


def spans_withheld_under(rules: Mapping[str, bool]) -> tuple[str, ...]:
    in_force = _tiers_in_force(rules)
    return tuple(
        planted
        for category, planted in PLANTED_SPANS
        if _TIER_BY_CATEGORY[category] in in_force
    )


def typed_placeholders_under(rules: Mapping[str, bool]) -> Mapping[str, int]:
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
