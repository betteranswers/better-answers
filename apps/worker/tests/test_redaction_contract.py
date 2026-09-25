import json
import re
from pathlib import Path
from typing import Any, cast

from better_answers_worker.schema_view import TABLES

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"


SPOKEN_TIERS = ["always", "default-on", "default-off"]
SPOKEN_ALWAYS_TIER = "always"


def read_redaction() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "redaction" / "cases.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def test_writes_the_three_agreed_tiers_on_a_finding() -> None:
    fixture = read_redaction()

    assert [tier["tier"] for tier in fixture["tiers"]] == SPOKEN_TIERS


def test_the_always_tier_alone_is_unswitchable_and_keyless() -> None:
    fixture = read_redaction()

    unswitchable = [tier["tier"] for tier in fixture["tiers"] if not tier["switchable"]]
    keyless = [tier["tier"] for tier in fixture["tiers"] if tier["binding_key"] is None]
    assert unswitchable == [SPOKEN_ALWAYS_TIER]
    assert keyless == [SPOKEN_ALWAYS_TIER]


def test_a_switchable_tiers_key_fits_the_column_this_tier_reads() -> None:

    fixture = read_redaction()

    assert TABLES["public.source_binding"]["rules_in_force"] == "jsonb NOT NULL"
    for tier in fixture["tiers"]:
        key = tier["binding_key"]
        assert key is None or (key and " " not in key), tier["tier"]


def test_every_category_names_an_agreed_tier_and_appears_once() -> None:
    fixture = read_redaction()

    tiers = {tier["tier"] for tier in fixture["tiers"]}
    named = [category["category"] for category in fixture["categories"]]
    for category in fixture["categories"]:
        assert category["tier"] in tiers, category["category"]
    assert sorted(named) == sorted(set(named))


def test_withholds_the_always_set_under_its_own_word() -> None:

    fixture = read_redaction()
    neutral = fixture["always_placeholder"]

    for category in fixture["categories"]:
        is_always = category["tier"] == SPOKEN_ALWAYS_TIER
        assert (category["placeholder"] == neutral) is is_always, category["category"]


def test_every_placeholder_is_bracketed_so_it_never_reads_as_text() -> None:
    fixture = read_redaction()
    shape = re.compile(fixture["placeholder_shape"])

    assert shape.fullmatch(fixture["always_placeholder"]) is not None
    for category in fixture["categories"]:
        assert shape.fullmatch(category["placeholder"]) is not None, category[
            "category"
        ]


def test_only_a_special_category_finding_narrows_the_document() -> None:

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


def test_the_version_string_joins_a_findings_two_columns() -> None:

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
