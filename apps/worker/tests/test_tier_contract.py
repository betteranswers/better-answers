"""The Python half of the tier-contract conformance suite (ADR 0031).

The TypeScript half is ``packages/core/test/tier-contract.test.ts``, and the two
assert the same expectations against the same ``contracts/`` directory.

The version and the agreement ids are hardcoded on each side on purpose, never read
from a shared constant: each suite states what its tier speaks, so a change to the
contract that either tier has not been taught fails that tier's suite. That failure
is the mechanism; deduplicating it away would delete the test.
"""

import json
from pathlib import Path
from typing import Any, cast

SPOKEN_CONTRACT_VERSION = 0
SPOKEN_AGREEMENTS = {
    "concept-inbox",
    "cost-ledger",
    "credential-envelope",
    "llm-routing",
    "queue",
    "visibility-columns",
}
FORMS = {"sql-function", "fixtured", "generated"}

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"


def read_manifest() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "manifest.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def test_speaks_this_tiers_contract_version() -> None:
    assert read_manifest()["contract_version"] == SPOKEN_CONTRACT_VERSION


def test_names_exactly_the_agreements_this_tier_speaks_each_in_a_known_form() -> None:
    manifest = read_manifest()

    assert set(manifest["agreements"]) == SPOKEN_AGREEMENTS
    forms = {agreement["form"] for agreement in manifest["agreements"].values()}
    assert forms <= FORMS


def test_lists_a_fixture_if_and_only_if_it_exists_under_an_agreement_it_names() -> None:
    manifest = read_manifest()

    for fixture in manifest["fixtures"]:
        assert fixture["agreement"] in SPOKEN_AGREEMENTS
        assert (CONTRACTS_DIR / fixture["path"]).exists()
