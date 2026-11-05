import json
import re
from collections.abc import Mapping
from typing import Any, cast

import pytest

from better_answers_worker.redaction import redact
from better_answers_worker.redaction.engine import spans_detected
from better_answers_worker.schema_view import TABLES
from support.roots import REPOSITORY_ROOT

CONTRACTS_DIR = REPOSITORY_ROOT / "contracts"


EXPECTED_TIERS = ["always", "default-on", "default-off"]
ALWAYS_TIER = "always"


ONLY_THE_ALWAYS_TIER: Mapping[str, bool] = {"default_on": False, "default_off": False}


def read_redaction_contract() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "redaction" / "cases.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


TYPED_TEXT_CASES: list[dict[str, Any]] = read_redaction_contract()["typed_text"][
    "cases"
]


def test_the_contract_lists_the_three_tiers_in_order() -> None:
    contract = read_redaction_contract()

    assert [tier["tier"] for tier in contract["tiers"]] == EXPECTED_TIERS


def test_only_the_always_tier_is_unswitchable_and_has_no_key() -> None:
    contract = read_redaction_contract()

    unswitchable = [
        tier["tier"] for tier in contract["tiers"] if not tier["switchable"]
    ]
    keyless = [
        tier["tier"]
        for tier in contract["tiers"]
        if tier["connected_source_key"] is None
    ]
    assert unswitchable == [ALWAYS_TIER]
    assert keyless == [ALWAYS_TIER]


def test_tier_keys_have_no_spaces_and_the_column_is_jsonb() -> None:

    contract = read_redaction_contract()

    assert TABLES["public.connected_source"]["rules_in_force"] == "jsonb NOT NULL"
    for tier in contract["tiers"]:
        key = tier["connected_source_key"]
        assert key is None or (key and " " not in key), tier["tier"]


def test_every_category_has_a_listed_tier_and_appears_once() -> None:
    contract = read_redaction_contract()

    tiers = {tier["tier"] for tier in contract["tiers"]}
    named = [category["category"] for category in contract["categories"]]
    for category in contract["categories"]:
        assert category["tier"] in tiers, category["category"]
    assert sorted(named) == sorted(set(named))


def test_only_always_tier_categories_use_the_always_placeholder() -> None:

    contract = read_redaction_contract()
    neutral = contract["always_placeholder"]

    for category in contract["categories"]:
        is_always = category["tier"] == ALWAYS_TIER
        assert (category["placeholder"] == neutral) is is_always, category["category"]


def test_every_placeholder_matches_the_placeholder_shape() -> None:
    contract = read_redaction_contract()
    shape = re.compile(contract["placeholder_shape"])

    assert shape.fullmatch(contract["always_placeholder"]) is not None, (
        "the always placeholder does not match placeholder_shape"
    )
    for category in contract["categories"]:
        assert shape.fullmatch(category["placeholder"]) is not None, category[
            "category"
        ]


def test_only_a_special_category_finding_narrows_the_document() -> None:

    contract = read_redaction_contract()

    for category in contract["categories"]:
        expected = contract["narrows_to"] if category["special_category"] else None
        assert category["narrows_to"] == expected, category["category"]


def test_the_version_pattern_accepts_and_rejects_the_contract_examples() -> None:
    contract = read_redaction_contract()
    pattern = re.compile(contract["version_string"]["pattern"])

    for case in contract["version_string"]["must_parse"]:
        assert pattern.fullmatch(case["value"]) is not None, case["why"]
    for case in contract["version_string"]["must_not_parse"]:
        assert pattern.fullmatch(case["value"]) is None, case["why"]


def test_the_version_string_joins_rule_version_and_detector_pin() -> None:

    contract = read_redaction_contract()
    separator = contract["version_string"]["separator"]

    columns = TABLES["public.finding"]
    assert columns["rule_version"] == "text NOT NULL"
    assert columns["detector_pin"] == "text NOT NULL"
    assert contract["version_string"]["shape"] == f"rule_version{separator}detector_pin"

    written = separator.join(["3", "presidio-2.2.364+gliner-multi-pii-v1"])
    assert (
        re.compile(contract["version_string"]["pattern"]).fullmatch(written) is not None
    )


@pytest.mark.parametrize(
    "case", TYPED_TEXT_CASES, ids=[case["name"] for case in TYPED_TEXT_CASES]
)
def test_redact_produces_the_expected_text_for_each_typed_case(
    case: dict[str, Any],
) -> None:
    typed = case["input"]

    read = redact(typed, spans_detected(typed), ONLY_THE_ALWAYS_TIER, (), "a-seed")

    assert read.text == case["expected"], case["why"]
