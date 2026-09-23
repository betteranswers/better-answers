import json
from pathlib import Path
from typing import Any, cast

from better_answers_worker.pipeline import REASONS_EMPTYING_THE_BINDING

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"


def read_emptying_a_binding() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "emptying-a-binding" / "cases.json").read_text(
        encoding="utf-8"
    )
    return cast("dict[str, Any]", json.loads(raw))


def test_a_run_empties_its_binding_on_the_reasons_agreed_and_no_other() -> None:
    reasons = read_emptying_a_binding()["reasons"]

    assert sorted(REASONS_EMPTYING_THE_BINDING) == sorted(reasons)


def test_the_agreement_names_each_reason_once() -> None:
    reasons = read_emptying_a_binding()["reasons"]

    assert reasons
    assert len(set(reasons)) == len(reasons)
