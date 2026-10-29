import json
from typing import Any, cast

from better_answers_worker.pipeline import REASONS_EMPTYING_THE_CONNECTED_SOURCE
from support.roots import REPOSITORY_ROOT

CONTRACTS_DIR = REPOSITORY_ROOT / "contracts"


def read_emptying_a_connected_source() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "emptying-a-connected-source" / "cases.json").read_text(
        encoding="utf-8"
    )
    return cast("dict[str, Any]", json.loads(raw))


def test_empties_a_connected_source_for_the_agreed_reasons_alone() -> None:
    reasons = read_emptying_a_connected_source()["reasons"]

    assert sorted(REASONS_EMPTYING_THE_CONNECTED_SOURCE) == sorted(reasons)


def test_the_agreement_names_each_reason_once() -> None:
    reasons = read_emptying_a_connected_source()["reasons"]

    assert reasons
    assert len(set(reasons)) == len(reasons)
