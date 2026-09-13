"""The redaction agreement's Python half (ADR 0031, ADR 0020).

The TypeScript half is ``packages/core/test/redaction.contract.test.ts``, and the two
read the same file in ``contracts/redaction/``: the category list, the placeholder word
per tier and category, the special-category narrowing and the shape of the version
string.

**The fixture is the contract, and this tier is the one that produces what it
describes.** The detector runs here (the S0 spec, *The tier boundary*), so T-121's
category descriptors — name, tier, recogniser, threshold, context words, placeholder,
whether a finding narrows the document — are held to this file, and the analyzer
registry and ``rule_version`` are derived from the same declarations. Nothing here is
derived from a detector that does not exist yet: what this half can assert today is the
agreement's own sentences and the columns this tier writes the answers into, read out of
the generated schema view.

Neither half holds the other's literals. That is not duplication to remove: each suite
states what its tier speaks, so an agreement one tier has not been taught fails that
tier's suite, which is the mechanism (ADR 0031).
"""

import json
import re
from pathlib import Path
from typing import Any, cast

from better_answers_worker.schema_view import TABLES

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"

# The three tiers of the glossary's *redaction rule*, as this tier writes one on a
# finding row, and the one of them no binding switches off. Written here rather than
# imported from the agreement, so a tier added to the file and not to this list fails.
SPOKEN_TIERS = ["always", "default-on", "default-off"]
SPOKEN_ALWAYS_TIER = "always"


def read_redaction() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "redaction" / "cases.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def test_the_three_tiers_are_the_ones_this_tier_writes_on_a_finding() -> None:
    fixture = read_redaction()

    assert [tier["tier"] for tier in fixture["tiers"]] == SPOKEN_TIERS


def test_the_always_tier_is_unswitchable_and_the_one_without_a_key() -> None:
    fixture = read_redaction()

    unswitchable = [tier["tier"] for tier in fixture["tiers"] if not tier["switchable"]]
    keyless = [tier["tier"] for tier in fixture["tiers"] if tier["binding_key"] is None]
    assert unswitchable == [SPOKEN_ALWAYS_TIER]
    assert keyless == [SPOKEN_ALWAYS_TIER]


def test_a_switchable_tiers_key_goes_in_the_column_this_tier_reads() -> None:
    # The seam takes the rules in force as an argument and never reads the binding (the
    # S0 spec, *The seam*), so what this tier can check is that the column the argument
    # is read out of exists and is the shape a set of tiers goes in. The keys inside it
    # are the app's to hold, and its half does.
    fixture = read_redaction()

    assert TABLES["public.source_binding"]["rules_in_force"] == "jsonb NOT NULL"
    for tier in fixture["tiers"]:
        key = tier["binding_key"]
        assert key is None or (key and " " not in key), tier["tier"]


def test_every_category_names_a_tier_the_agreement_names_and_names_itself_once() -> (
    None
):
    fixture = read_redaction()

    tiers = {tier["tier"] for tier in fixture["tiers"]}
    named = [category["category"] for category in fixture["categories"]]
    for category in fixture["categories"]:
        assert category["tier"] in tiers, category["category"]
    assert sorted(named) == sorted(set(named))


def test_the_always_set_is_withheld_under_a_word_no_other_category_uses() -> None:
    # A typed placeholder for the always set would tell the audience what class of data
    # the document holds, which is what the always set exists to keep back. So the word
    # is one for all three, and it belongs to no other tier.
    fixture = read_redaction()
    neutral = fixture["always_placeholder"]

    for category in fixture["categories"]:
        is_always = category["tier"] == SPOKEN_ALWAYS_TIER
        assert (category["placeholder"] == neutral) is is_always, category["category"]


def test_every_placeholder_is_a_bracketed_word_so_it_never_reads_as_the_text() -> None:
    fixture = read_redaction()
    shape = re.compile(fixture["placeholder_shape"])

    assert shape.fullmatch(fixture["always_placeholder"]) is not None
    for category in fixture["categories"]:
        assert shape.fullmatch(category["placeholder"]) is not None, category[
            "category"
        ]


def test_a_special_category_finding_narrows_the_document_and_no_other_kind_does() -> (
    None
):
    # Both ways (`[TEST7]`): a special-category finding narrows, and a category that
    # narrows is a special-category one. The verdict is one of the seam's return values,
    # so this tier is the one that has to read the rule the same way the app does.
    fixture = read_redaction()

    for category in fixture["categories"]:
        expected = fixture["narrows_to"] if category["special_category"] else None
        assert category["narrows_to"] == expected, category["category"]


def test_the_version_string_parses_and_refuses_what_the_agreement_says() -> None:
    fixture = read_redaction()
    pattern = re.compile(fixture["version_string"]["pattern"])

    for case in fixture["version_string"]["must_parse"]:
        assert pattern.fullmatch(case["value"]) is not None, case["why"]
    for case in fixture["version_string"]["must_not_parse"]:
        assert pattern.fullmatch(case["value"]) is None, case["why"]


def test_the_version_string_is_the_two_columns_this_tier_writes_a_finding_with() -> (
    None
):
    # `rule_version` is this tier's own exported constant and `detector_pin` is derived
    # from the pinned packages and the model id (the S0 spec, *Versioning*); both
    # ride on
    # every finding row this tier inserts, so the shape of the string is the shape of
    # those two columns joined.
    fixture = read_redaction()
    separator = fixture["version_string"]["separator"]

    columns = TABLES["public.finding"]
    assert columns["rule_version"] == "text NOT NULL"
    assert columns["detector_pin"] == "text NOT NULL"
    assert fixture["version_string"]["shape"] == f"rule_version{separator}detector_pin"

    written = separator.join(["3", "presidio-2.2.364+gliner-multi-pii-v1"])
    assert (
        re.compile(fixture["version_string"]["pattern"]).fullmatch(written) is not None
    )
