"""The Python half of the tier-contract conformance suite (ADR 0031).

The TypeScript half is ``packages/core/test/tier-contract.test.ts``, and the two
assert the same expectations against the same ``contracts/`` directory.

The version and the agreement ids are hardcoded on each side on purpose, never read
from a shared constant: each suite states what its tier speaks, so a change to the
contract that either tier has not been taught fails that tier's suite. That failure
is the mechanism; deduplicating it away would delete the test.
"""

import json
import re
from pathlib import Path
from typing import Any, cast

SPOKEN_CONTRACT_VERSION = 1
SPOKEN_AGREEMENTS = {
    "concept-inbox": "sql-function",
    "cost-ledger": "generated",
    "id-shape": "fixtured",
    "credential-envelope": "fixtured",
    "llm-routing": "sql-function",
    "queue": "sql-function",
    "visibility-columns": "fixtured",
}
NOT_FIXTURES = {"manifest.json", "README.md"}

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"


def read_manifest() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "manifest.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def fixtures_on_disk(directory: Path) -> set[str]:
    """Every fixture a directory holds, as the manifest writes a path.

    Dotfiles are not fixtures. macOS writes a ``.DS_Store`` into any directory a
    Finder window has opened, and ``contracts/`` is a directory a person browses;
    ``rglob`` returns it exactly as the TypeScript half's ``readdirSync`` does. It
    is git-ignored, so no manifest can list it, CI never has one, and the owner
    reviewing the failure cannot see it — the suite would fail on the one machine
    that has one and pass on every other. The TypeScript half applies the same rule
    to the same directory (ADR 0031); a filter in one half alone leaves the other
    tripping on the same file.
    """
    found: set[str] = set()
    for file in directory.rglob("*"):
        if not file.is_file():
            continue
        relative = file.relative_to(directory)
        if any(part.startswith(".") for part in relative.parts):
            continue
        if str(relative) in NOT_FIXTURES:
            continue
        found.add(str(relative))
    return found


def test_speaks_this_tiers_contract_version() -> None:
    assert read_manifest()["contract_version"] == SPOKEN_CONTRACT_VERSION


def test_names_exactly_the_agreements_spoken_each_in_the_expected_form() -> None:
    manifest = read_manifest()

    assert set(manifest["agreements"]) == set(SPOKEN_AGREEMENTS)
    for agreement_id, form in SPOKEN_AGREEMENTS.items():
        assert manifest["agreements"][agreement_id]["form"] == form


def test_lists_a_fixture_if_and_only_if_it_exists_under_an_agreement_it_names() -> None:
    manifest = read_manifest()

    for fixture in manifest["fixtures"]:
        assert fixture["agreement"] in SPOKEN_AGREEMENTS
        assert (CONTRACTS_DIR / fixture["path"]).exists()

    # The other direction: a file on disk the manifest does not list fails too.
    assert fixtures_on_disk(CONTRACTS_DIR) == {
        fixture["path"] for fixture in manifest["fixtures"]
    }


def test_counts_a_fixture_and_never_a_dotfile(tmp_path: Path) -> None:
    (tmp_path / "id-shape").mkdir()
    (tmp_path / "id-shape" / "cases.json").write_text("{}", encoding="utf-8")
    (tmp_path / "manifest.json").write_text("{}", encoding="utf-8")
    (tmp_path / "README.md").write_text("", encoding="utf-8")
    # What macOS writes into any directory a Finder window has opened, at the root and
    # under a fixture's own. `rglob` returns it exactly as `readdirSync` does, which is
    # why both halves need the same filter: fixing one leaves the other tripping on it.
    (tmp_path / ".DS_Store").write_text("", encoding="utf-8")
    (tmp_path / "id-shape" / ".DS_Store").write_text("", encoding="utf-8")
    (tmp_path / ".cache").mkdir()
    (tmp_path / ".cache" / "cases.json").write_text("{}", encoding="utf-8")

    assert fixtures_on_disk(tmp_path) == {"id-shape/cases.json"}


# --- id-shape: one id shape, whichever tier minted it (ADR 0035) ----------------------
#
# The fixture is the contract: the pattern an id matches, the ids that must match it and
# the ids that must not. This tier reads an id the other tier minted on every row it
# touches, so the pattern is what it holds them to; and every id this tier seeds is held
# to the same one, so an id minted here parses at the other tier's boundary.


def read_id_shape() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "id-shape" / "cases.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def test_the_id_shape_accepts_and_refuses_exactly_what_the_fixture_says() -> None:
    fixture = read_id_shape()
    pattern = re.compile(fixture["pattern"])

    for identifier in fixture["must_parse"]:
        assert pattern.fullmatch(identifier), identifier
    for rejected in fixture["must_not_parse"]:
        assert not pattern.fullmatch(rejected["id"]), rejected["why"]


def test_an_id_minted_in_this_tier_matches_the_shape_the_other_tier_parses() -> None:
    from factories import ulid

    pattern = re.compile(read_id_shape()["pattern"])

    minted = [ulid() for _ in range(100)]
    for identifier in minted:
        assert pattern.fullmatch(identifier), identifier
    # The time half is the half the shape promises: ids made in order read in order.
    assert [identifier[:10] for identifier in minted] == sorted(
        identifier[:10] for identifier in minted
    )


# --- llm-routing: the first real fixture (ADR 0031) -----------------------------------
#
# The fixture is the contract: seed its workspaces and routes, run every call as
# app_rt under the call's workspace GUC ('' = the missing scope), and expect exactly
# expect_route_id (None = zero rows). The TypeScript half runs the same cases in
# packages/core/test/llm-routing.contract.test.ts.


def test_llm_routing_resolves_every_fixtured_call() -> None:
    from factories import seed_llm_route, seed_workspace
    from pg_harness import migrated_postgres

    fixture = json.loads(
        (CONTRACTS_DIR / "llm-routing" / "cases.json").read_text("utf-8")
    )

    with migrated_postgres() as connection, connection.cursor() as cursor:
        for workspace in fixture["workspaces"]:
            seed_workspace(cursor, workspace_id=workspace["id"], name=workspace["name"])
        for route in fixture["routes"]:
            seed_llm_route(
                cursor,
                route_id=route["id"],
                workspace_id=route["workspace_id"],
                purpose=route["purpose"],
                provider=route["provider"],
                model=route["model"],
                dimensions=route["dimensions"],
            )

        cursor.execute("SET LOCAL ROLE app_rt")
        for call in fixture["calls"]:
            cursor.execute(
                "SELECT set_config('app.workspace_id', %s, true)",
                (call["workspace_id"],),
            )
            cursor.execute(
                "SELECT id FROM llm_route_for(%s::llm_purpose)", (call["purpose"],)
            )
            rows = cursor.fetchall()
            resolved = rows[0][0] if rows else None
            assert resolved == call["expect_route_id"], call
        connection.rollback()
