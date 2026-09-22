import json
import re
from pathlib import Path
from typing import Any, cast

import psycopg
import pytest
from psycopg import Cursor

SPOKEN_CONTRACT_VERSION = 9
SPOKEN_AGREEMENTS = {
    "concept-file": "fixtured",
    "concept-inbox": "sql-function",
    "cost-ledger": "generated",
    "document-chunk": "fixtured",
    "id-shape": "fixtured",
    "credential-envelope": "fixtured",
    "llm-routing": "sql-function",
    "queue": "sql-function",
    "redaction": "fixtured",
    "upload-media-types": "fixtured",
    "visibility-columns": "fixtured",
}
NOT_FIXTURES = {"manifest.json", "README.md"}

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"


def read_manifest() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "manifest.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def fixtures_on_disk(directory: Path) -> set[str]:
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

    assert fixtures_on_disk(CONTRACTS_DIR) == {
        fixture["path"] for fixture in manifest["fixtures"]
    }


def test_counts_a_fixture_and_never_a_dotfile(tmp_path: Path) -> None:
    (tmp_path / "id-shape").mkdir()
    (tmp_path / "id-shape" / "cases.json").write_text("{}", encoding="utf-8")
    (tmp_path / "manifest.json").write_text("{}", encoding="utf-8")
    (tmp_path / "README.md").write_text("", encoding="utf-8")

    (tmp_path / ".DS_Store").write_text("", encoding="utf-8")
    (tmp_path / "id-shape" / ".DS_Store").write_text("", encoding="utf-8")
    (tmp_path / ".cache").mkdir()
    (tmp_path / ".cache" / "cases.json").write_text("{}", encoding="utf-8")

    assert fixtures_on_disk(tmp_path) == {"id-shape/cases.json"}


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


def test_the_shape_this_tier_holds_a_workspace_id_to_is_the_fixtures_own() -> None:

    from better_answers_worker.ids import ID_SHAPE

    assert ID_SHAPE.pattern == read_id_shape()["pattern"]


def test_an_id_minted_in_this_tier_matches_the_shape_the_other_tier_parses() -> None:

    from better_answers_worker.ids import ulid

    pattern = re.compile(read_id_shape()["pattern"])

    minted = [ulid() for _ in range(100)]
    for identifier in minted:
        assert pattern.fullmatch(identifier), identifier

    assert [identifier[:10] for identifier in minted] == sorted(
        identifier[:10] for identifier in minted
    )


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


def read_concept_inbox() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "concept-inbox" / "cases.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def _seed_inbox_fixture(cursor: Cursor[Any], fixture: dict[str, Any]) -> None:
    from factories import seed_concept_identity, seed_concept_index, seed_workspace

    for workspace in fixture["workspaces"]:
        seed_workspace(cursor, workspace_id=workspace["id"], name=workspace["name"])
    for concept in fixture["concepts"]:
        seed_concept_identity(
            cursor,
            workspace_id=concept["workspace_id"],
            iri=concept["iri"],
            merge_key=concept["merge_key"],
        )
        seed_concept_index(
            cursor,
            workspace_id=concept["workspace_id"],
            iri=concept["iri"],
            path=concept["path"],
            content_hash=concept["content_hash"],
        )


def _submit_fixture_set(cursor: Cursor[Any], fixture: dict[str, Any]) -> int:
    submission = fixture["set"]
    cursor.execute(f"SET LOCAL ROLE {submission['role']}")
    cursor.execute(
        "SELECT set_config('app.workspace_id', %s, true)", (submission["workspace_id"],)
    )
    cursor.execute(
        "SELECT * FROM submit_suggestion_set(%s, %s, %s, %s::jsonb)",
        (
            submission["set_id"],
            submission["kind"],
            submission["proposer"],
            json.dumps(submission["requests"]),
        ),
    )
    submitted = len(cursor.fetchall())
    cursor.execute("RESET ROLE")
    return submitted


def test_the_inbox_takes_a_whole_set_in_one_call_and_re_renders_its_summary() -> None:
    from pg_harness import migrated_postgres

    fixture = read_concept_inbox()

    with migrated_postgres() as connection, connection.cursor() as cursor:
        _seed_inbox_fixture(cursor, fixture)
        assert _submit_fixture_set(cursor, fixture) == len(fixture["set"]["requests"])

        cursor.execute("SET LOCAL ROLE app_rt")
        cursor.execute(
            "SELECT suggestion_id, status, kind, merge_key, resolved_iri, base_moved"
            " FROM suggestion_set_summary(%s)",
            (fixture["set"]["set_id"],),
        )
        summary = cursor.fetchall()
        assert summary == [
            (
                expected["suggestion_id"],
                expected["status"],
                expected["kind"],
                expected["merge_key"],
                expected["resolved_iri"],
                expected["base_moved"],
            )
            for expected in fixture["expect_summary"]
        ]
        connection.rollback()


def test_the_inbox_refuses_every_road_the_fixture_says_is_closed() -> None:
    from pg_harness import migrated_postgres

    fixture = read_concept_inbox()

    with migrated_postgres() as connection, connection.cursor() as cursor:
        _seed_inbox_fixture(cursor, fixture)
        _submit_fixture_set(cursor, fixture)

        for refusal in fixture["refusals"]:
            cursor.execute("SAVEPOINT probe")
            cursor.execute(f"SET LOCAL ROLE {refusal['role']}")
            cursor.execute(
                "SELECT set_config('app.workspace_id', %s, true)",
                (refusal["workspace_id"],),
            )
            try:
                cursor.execute(refusal["statement"])
            except psycopg.Error as refused:
                assert refused.sqlstate == refusal["sqlstate"], refusal["why"]
            else:
                pytest.fail(f"the statement was allowed: {refusal['why']}")
            finally:
                cursor.execute("ROLLBACK TO SAVEPOINT probe")
                cursor.execute("RESET ROLE")
        connection.rollback()


def read_queue() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "queue" / "cases.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def _seed_queue_fixture(cursor: Cursor[Any], fixture: dict[str, Any]) -> None:
    from factories import seed_job, seed_workspace

    for workspace in fixture["workspaces"]:
        seed_workspace(cursor, workspace_id=workspace["id"], name=workspace["name"])
    for seeded in fixture["jobs"]:
        seed_job(
            cursor,
            workspace_id=seeded["workspace_id"],
            job_id=seeded["id"],
            kind=seeded["kind"],
            reason=seeded["reason"],
            subject_id=seeded["subject_id"],
            status=seeded["status"],
            attempts=seeded["attempts"],
            max_attempts=seeded["max_attempts"],
            enqueued_ago_seconds=seeded["enqueued_ago_seconds"],
            claimed_by=seeded["claimed_by"],
            lease_expires_in_seconds=seeded["lease_expires_in_seconds"],
        )


def _refused_enqueue(cursor: Cursor[Any], refused: dict[str, Any]) -> str:
    from factories import enqueue_job

    cursor.execute("SAVEPOINT refused_enqueue")
    try:
        enqueue_job(
            cursor,
            workspace_id=refused["workspace_id"],
            job_id=refused["id"],
            kind=refused["kind"],
            reason=refused["reason"],
            subject_id=refused["subject_id"],
        )
    except psycopg.Error as error:
        cursor.execute("ROLLBACK TO SAVEPOINT refused_enqueue")
        return str(error.sqlstate)
    cursor.execute("ROLLBACK TO SAVEPOINT refused_enqueue")
    return "admitted"


def _lapse_leases(cursor: Cursor[Any], job_ids: list[str]) -> None:
    if not job_ids:
        return
    cursor.execute(
        "UPDATE job SET lease_expires_at = now() - interval '30 seconds'"
        " WHERE id = ANY(%s)",
        (job_ids,),
    )


def _as_role_in_scope(cursor: Cursor[Any], where: dict[str, Any]) -> None:
    cursor.execute(f"SET LOCAL ROLE {where['role']}")
    cursor.execute(
        "SELECT set_config('app.workspace_id', %s, true)", (where["workspace_id"],)
    )


def test_the_queue_hands_out_every_job_the_fixture_says_and_answers_every_call() -> (
    None
):
    from pg_harness import migrated_postgres

    fixture = read_queue()
    lease = f"{fixture['lease_seconds']} seconds"

    with migrated_postgres() as connection, connection.cursor() as cursor:
        _seed_queue_fixture(cursor, fixture)

        enqueues = [
            {"why": refused["why"], "sqlstate": _refused_enqueue(cursor, refused)}
            for refused in fixture["refused_enqueues"]
        ]
        assert enqueues == [
            {"why": refused["why"], "sqlstate": refused["sqlstate"]}
            for refused in fixture["refused_enqueues"]
        ]

        claimed: list[dict[str, Any]] = []
        for claim in fixture["claims"]:
            _lapse_leases(cursor, claim.get("lapse_first", []))
            _as_role_in_scope(cursor, claim)
            cursor.execute(
                "SELECT id FROM claim_job(%s, %s::interval, %s)",
                (claim["worker_id"], lease, claim["kinds"]),
            )
            claimed.append(
                {"why": claim["why"], "ids": [row[0] for row in cursor.fetchall()]}
            )
            cursor.execute("RESET ROLE")
        assert claimed == [
            {"why": claim["why"], "ids": claim["expect_ids"]}
            for claim in fixture["claims"]
        ]

        answered: list[dict[str, Any]] = []
        for call in fixture["calls"]:
            _as_role_in_scope(cursor, call)
            if call["function"] == "heartbeat_job":
                statement = "SELECT heartbeat_job(%s, %s, %s::interval)"
                third: str | None = lease
            else:
                statement = f"SELECT {call['function']}(%s, %s, %s::jsonb)"
                third = (
                    None if call.get("outcome") is None else json.dumps(call["outcome"])
                )
            cursor.execute(statement, (call["job_id"], call["worker_id"], third))
            row = cursor.fetchone()
            answered.append({"why": call["why"], "answer": bool(row and row[0])})
            cursor.execute("RESET ROLE")
        assert answered == [
            {"why": call["why"], "answer": call["expect"]} for call in fixture["calls"]
        ]

        cursor.execute(
            "SELECT workspace_id, id, status, attempts, claimed_by FROM job"
            " ORDER BY workspace_id, id"
        )
        assert cursor.fetchall() == [
            (
                expected["workspace_id"],
                expected["id"],
                expected["status"],
                expected["attempts"],
                expected["claimed_by"],
            )
            for expected in sorted(
                fixture["expect_final"],
                key=lambda job: (job["workspace_id"], job["id"]),
            )
        ]
        connection.rollback()


def read_concept_file() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "concept-file" / "cases.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def test_the_concept_file_canonical_text_and_hash_are_the_fixtures_for_every_case() -> (
    None
):
    from better_answers_worker.concept_file import (
        Frontmatter,
        canonical_frontmatter,
        content_hash_of,
    )

    for case in read_concept_file()["cases"]:
        frontmatter = cast("Frontmatter", case["frontmatter"])
        produced = {
            "why": case["why"],
            "canonical": canonical_frontmatter(frontmatter, case["path"]),
            "sha256": content_hash_of(frontmatter, case["body"], case["path"]),
        }
        assert produced == {
            "why": case["why"],
            "canonical": case["canonical"],
            "sha256": case["sha256"],
        }


def test_every_number_the_fixture_names_is_written_as_the_text_both_tiers_write() -> (
    None
):
    from better_answers_worker.concept_file import canonical_frontmatter

    for entry in read_concept_file()["numbers"]:
        assert canonical_frontmatter({"n": entry["value"]}, "knowledge/x.md") == (
            f'{{"n":{entry["text"]}}}'
        ), entry
