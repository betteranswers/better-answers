import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, TypedDict, cast

import psycopg
import pytest
from psycopg import Cursor

SPOKEN_AGREEMENTS = {
    "citation": "fixtured",
    "concept-file": "fixtured",
    "concept-inbox": "sql-function",
    "cost-ledger": "generated",
    "document-chunk": "fixtured",
    "emptying-a-binding": "fixtured",
    "erasure-match": "fixtured",
    "id-shape": "fixtured",
    "credential-envelope": "fixtured",
    "llm-routing": "sql-function",
    "queue": "sql-function",
    "redaction": "fixtured",
    "upload-media-types": "fixtured",
}
NOT_FIXTURES = {"manifest.json", "README.md"}

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"
COMMENT_GATE = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "devtools"
    / "python"
    / "comment_gate.py"
)


class DeclaredForm(TypedDict):
    form: str


class ListedFixture(TypedDict):
    agreement: str
    path: str


class Manifest(TypedDict):
    agreements: dict[str, DeclaredForm]
    fixtures: list[ListedFixture]


def read_manifest(directory: Path = CONTRACTS_DIR) -> Manifest:
    raw = (directory / "manifest.json").read_text(encoding="utf-8")
    return cast("Manifest", json.loads(raw))


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


def directories_in(directory: Path) -> list[str]:
    return [
        entry.name
        for entry in directory.iterdir()
        if entry.is_dir() and not entry.name.startswith(".")
    ]


def files_under(root: Path, agreement: str) -> set[str]:
    directory = root / agreement
    return fixtures_on_disk(directory) if directory.is_dir() else set()


def _fixtured_failures(
    agreement: str, listed: list[ListedFixture], root: Path
) -> list[str]:
    failures: list[str] = []

    if not listed:
        failures.append(
            f"{agreement} declares fixtured and the manifest lists no fixture under it"
        )
    for fixture in listed:
        path = fixture["path"]
        if not path.startswith(f"{agreement}/"):
            failures.append(
                f"{agreement} declares fixtured and lists {path}, "
                f"which is not under {agreement}/"
            )
        elif not (root / path).exists():
            failures.append(
                f"{agreement} declares fixtured and lists {path}, which is not on disk"
            )

    return failures


def form_failures(manifest: Manifest, root: Path) -> list[str]:
    failures: list[str] = []

    for agreement, entry in manifest["agreements"].items():
        form = entry["form"]
        listed = [
            fixture
            for fixture in manifest["fixtures"]
            if fixture["agreement"] == agreement
        ]

        if form == "fixtured":
            failures.extend(_fixtured_failures(agreement, listed, root))
        elif form == "generated":
            if not files_under(root, agreement):
                failures.append(
                    f"{agreement} declares generated and has no golden rows on disk"
                )
        elif form != "sql-function":
            failures.append(
                f"{agreement} declares {form}, a form this check does not know"
            )

    failures.extend(
        f"{directory} is a directory under contracts/ that no agreement claims"
        for directory in directories_in(root)
        if directory not in manifest["agreements"]
    )

    return sorted(failures)


BROKEN_AGREEMENTS: dict[str, DeclaredForm] = {
    "shape": {"form": "fixtured"},
    "empty-handed": {"form": "fixtured"},
    "missing-file": {"form": "fixtured"},
    "astray": {"form": "fixtured"},
    "ledger": {"form": "generated"},
    "rows": {"form": "generated"},
    "routing": {"form": "sql-function"},
    "hearsay": {"form": "spoken"},
}
BROKEN_FIXTURES: list[ListedFixture] = [
    {"agreement": "shape", "path": "shape/cases.json"},
    {"agreement": "missing-file", "path": "missing-file/cases.json"},
    {"agreement": "astray", "path": "shape/cases.json"},
    {"agreement": "rows", "path": "rows/rows.json"},
]
LISTED_BUT_ABSENT = "missing-file/cases.json"
ON_DISK_BUT_UNLISTED = ["routing/cases.json", "orphan/cases.json"]


def materialise_broken_contracts(root: Path) -> None:
    listed = [
        fixture["path"]
        for fixture in BROKEN_FIXTURES
        if fixture["path"] != LISTED_BUT_ABSENT
    ]
    for relative in listed + ON_DISK_BUT_UNLISTED:
        written = root / relative
        written.parent.mkdir(parents=True, exist_ok=True)
        written.write_text("{}", encoding="utf-8")

    (root / "manifest.json").write_text(
        json.dumps({"agreements": BROKEN_AGREEMENTS, "fixtures": BROKEN_FIXTURES}),
        encoding="utf-8",
    )


# Each hex below is worked out of band from the framing, never by calling this
# tier's own reading a second time.
DIGEST_CASES: list[tuple[str, dict[str, bytes], str]] = [
    (
        "the manifest alone",
        {"manifest.json": b"{}"},
        "672dd81724a921629ec57079d240c5d4240d85207c5c577acc3d938a1da9a4b2",
    ),
    (
        "a nested directory",
        {"manifest.json": b"{}", "deep/under/cases.json": b"[1]"},
        "1310b1d47249afd06d6da598edb9e740822903427cea944583bcd09cdad30f4b",
    ),
    (
        "a file with no trailing newline",
        {"manifest.json": b"{}", "id-shape/cases.json": b"no newline here"},
        "c61774dee59597de850816f074c5b3898df77407b81f994c8f532db6ccdf9b01",
    ),
    (
        "a file holding CRLF bytes",
        {"manifest.json": b"{}", "queue/cases.json": b"one\r\ntwo\r\n"},
        "d46eb55502392e4b377c93fc25bd904e84c3d3c1222ce84db61209ff9b3c229f",
    ),
    (
        "an astral character in a filename and in content",
        {"manifest.json": b"{}", "\U0001f680/\U0001f6f0.json": "\U0001f30d".encode()},
        "157a522841253276bd185d632b885a7193389d3181826ac45bd0611acba19457",
    ),
    (
        "an empty file",
        {"manifest.json": b"{}", "redaction/cases.json": b""},
        "d86176b333d785144bf5abef1f09c05550d49e57602b9965c15b9c919b4e38c3",
    ),
    (
        "a dotfile that must not count",
        {
            "manifest.json": b"{}",
            ".DS_Store": b"junk",
            ".cache/cases.json": b"junk",
            "citation/.hidden": b"junk",
        },
        "672dd81724a921629ec57079d240c5d4240d85207c5c577acc3d938a1da9a4b2",
    ),
    (
        "a README that must not count",
        {"manifest.json": b"{}", "README.md": b"prose for a person"},
        "672dd81724a921629ec57079d240c5d4240d85207c5c577acc3d938a1da9a4b2",
    ),
]


def materialised(root: Path, tree: dict[str, bytes]) -> Path:
    for relative, content in tree.items():
        written = root / relative
        written.parent.mkdir(parents=True, exist_ok=True)
        written.write_bytes(content)
    return root


def test_the_digest_answers_the_agreed_hex_for_every_case_tree(
    tmp_path: Path,
) -> None:
    from better_answers_worker.contract_digest import contract_digest

    answered = [
        (why, contract_digest(materialised(tmp_path / str(index), tree)))
        for index, (why, tree, _hex) in enumerate(DIGEST_CASES)
    ]

    assert answered == [(why, expected) for why, _tree, expected in DIGEST_CASES]


def test_a_symlink_counts_for_nothing_in_the_digest(
    tmp_path: Path,
) -> None:
    from better_answers_worker.contract_digest import contract_digest

    root = materialised(tmp_path / "linked", {"manifest.json": b"{}"})
    (root / "queue").mkdir()
    (root / "queue" / "cases.json").symlink_to(root / "manifest.json")

    assert contract_digest(root) == DIGEST_CASES[0][2]


def test_the_carried_digest_is_whole_never_a_short_form() -> None:
    from better_answers_worker.contract_stamp import CONTRACT_DIGEST

    assert re.fullmatch(r"[0-9a-f]{64}", CONTRACT_DIGEST)


def test_a_hand_edited_digest_fails_this_tiers_own_check() -> None:
    from better_answers_worker.contract_digest import (
        CONTRACT_STAMP_MODULE,
        CONTRACTS_ROOT,
        contract_digest,
        render_contract_stamp,
    )

    assert CONTRACT_STAMP_MODULE.read_text(encoding="utf-8") == render_contract_stamp(
        contract_digest(CONTRACTS_ROOT)
    )


def test_names_exactly_the_agreements_spoken_each_in_the_expected_form() -> None:
    manifest = read_manifest()

    assert set(manifest["agreements"]) == set(SPOKEN_AGREEMENTS)
    for agreement_id, form in SPOKEN_AGREEMENTS.items():
        assert manifest["agreements"][agreement_id]["form"] == form


def test_lists_a_fixture_exactly_when_it_exists_under_its_agreement() -> None:
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


def test_the_disk_matches_every_declared_form_and_claimed_directory() -> None:
    assert form_failures(read_manifest(), CONTRACTS_DIR) == []


def test_names_the_agreement_and_form_of_each_denied_entry(
    tmp_path: Path,
) -> None:
    materialise_broken_contracts(tmp_path)

    assert form_failures(read_manifest(tmp_path), tmp_path) == [
        "astray declares fixtured and lists shape/cases.json, "
        "which is not under astray/",
        "empty-handed declares fixtured and the manifest lists no fixture under it",
        "hearsay declares spoken, a form this check does not know",
        "ledger declares generated and has no golden rows on disk",
        "missing-file declares fixtured and lists missing-file/cases.json, "
        "which is not on disk",
        "orphan is a directory under contracts/ that no agreement claims",
    ]


def read_id_shape() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "id-shape" / "cases.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def test_the_id_shape_accepts_and_refuses_as_the_fixture_says() -> None:
    fixture = read_id_shape()
    pattern = re.compile(fixture["pattern"])

    for identifier in fixture["must_parse"]:
        assert pattern.fullmatch(identifier), identifier
    for rejected in fixture["must_not_parse"]:
        assert not pattern.fullmatch(rejected["id"]), rejected["why"]


def test_holds_workspace_ids_to_the_fixtures_own_shape() -> None:

    from better_answers_worker.ids import ID_SHAPE

    assert ID_SHAPE.pattern == read_id_shape()["pattern"]


def test_a_minted_id_matches_the_shape_the_other_tier_parses() -> None:

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


def test_one_call_submits_a_set_and_re_renders_its_summary() -> None:
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


def test_the_queue_hands_out_and_answers_as_the_fixture_says() -> None:
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


def test_the_canonical_text_and_hash_match_every_fixture_case() -> None:
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


def test_writes_every_fixture_number_as_both_tiers_write_it() -> None:
    from better_answers_worker.concept_file import canonical_frontmatter

    for entry in read_concept_file()["numbers"]:
        assert canonical_frontmatter({"n": entry["value"]}, "knowledge/x.md") == (
            f'{{"n":{entry["text"]}}}'
        ), entry


def read_citation() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "citation" / "cases.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def _the_gate_over(directory: Path, prose: str) -> str:
    probe = directory / "probe.py"
    probe.write_text(f"# {prose}\nKEEP = 1\n", encoding="utf-8")
    ran = subprocess.run(
        [sys.executable, str(COMMENT_GATE), str(probe)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert ran.returncode in {0, 1}, ran.stderr
    return ran.stdout


def test_the_comment_gate_refuses_every_sentence_the_fixture_says_cites(
    tmp_path: Path,
) -> None:
    for pattern in read_citation()["patterns"]:
        for case in pattern["cites"]:
            prose = "".join(case["prose"])
            cited = "".join(case["cited"])
            said = _the_gate_over(tmp_path, prose)

            assert f"cites {pattern['name']} (`{cited}`)" in said, prose


def test_the_comment_gate_passes_every_sentence_that_cites_nothing(
    tmp_path: Path,
) -> None:
    for prose in read_citation()["cites_nothing"]:
        assert _the_gate_over(tmp_path, prose) == "", prose
