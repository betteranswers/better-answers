import json
import re
from typing import Any, cast

from better_answers_worker.schema_view import TABLES
from support.roots import REPOSITORY_ROOT

CONTRACTS_DIR = REPOSITORY_ROOT / "contracts"

PROMPT_OR_COMPLETION_WORDS = (
    "prompt",
    "completion",
    "message",
    "content",
    "response",
    "text",
    "body",
)

EMBEDDING_PURPOSE = "embedding"


def read_cost_ledger() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "cost-ledger" / "rows.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def recorded_columns() -> list[str]:
    return sorted(field["field"] for field in read_cost_ledger()["fields"])


def purposes_in_rows() -> list[str]:
    return sorted({row["purpose"] for row in read_cost_ledger()["rows"]})


def test_every_row_carries_exactly_the_recorded_columns() -> None:
    columns = recorded_columns()

    for row in read_cost_ledger()["rows"]:
        assert sorted(row) == columns, row


def test_recorded_columns_match_the_llm_call_table() -> None:
    assert sorted(TABLES["public.llm_call"]) == recorded_columns()


def test_recorded_outcomes_match_the_llm_call_outcome_check() -> None:
    from support.pg_harness import migrated_postgres

    fixture = read_cost_ledger()

    with migrated_postgres() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint"
            " WHERE conname = 'llm_call_outcome_check'"
        )
        found = cursor.fetchone()
        assert found is not None, "the llm_call_outcome_check constraint is missing"
        allowed = sorted(re.findall(r"'([^']+)'::text", str(found[0])))
        assert allowed == sorted(entry["outcome"] for entry in fixture["outcomes"])


def test_no_column_name_suggests_prompt_or_completion_text() -> None:
    for column in recorded_columns():
        for word in PROMPT_OR_COMPLETION_WORDS:
            assert word not in column, column


def test_model_choice_for_resolves_every_llm_purpose() -> None:
    from support.factories import (
        EMBEDDING_DIMENSIONS,
        seed_model_choice,
        seed_workspace,
    )
    from support.pg_harness import migrated_postgres

    purposes = purposes_in_rows()

    with migrated_postgres() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT unnest(enum_range(NULL::llm_purpose))::text")
        assert sorted(name for (name,) in cursor.fetchall()) == purposes

        workspace = seed_workspace(cursor)
        seeded = {
            purpose: seed_model_choice(
                cursor,
                workspace_id=workspace["id"],
                purpose=purpose,
                dimensions=(
                    EMBEDDING_DIMENSIONS if purpose == EMBEDDING_PURPOSE else None
                ),
            )["id"]
            for purpose in purposes
        }

        cursor.execute("SET LOCAL ROLE app_rt")
        cursor.execute(
            "SELECT set_config('app.workspace_id', %s, true)", (workspace["id"],)
        )
        resolved = {}
        for purpose in purposes:
            cursor.execute(
                "SELECT id FROM model_choice_for(%s::llm_purpose)", (purpose,)
            )
            found = cursor.fetchone()
            resolved[purpose] = found[0] if found else None

        assert resolved == seeded
        connection.rollback()


def test_every_outcome_has_a_row_and_a_failure_row_exists() -> None:
    fixture = read_cost_ledger()

    assert sorted({row["outcome"] for row in fixture["rows"]}) == sorted(
        outcome["outcome"] for outcome in fixture["outcomes"]
    )

    failures = {
        outcome["outcome"] for outcome in fixture["outcomes"] if outcome["failure"]
    }
    assert [row for row in fixture["rows"] if row["outcome"] in failures], (
        "no row in rows.json has a failure outcome"
    )


def test_every_row_belongs_to_exactly_one_run_or_answer() -> None:
    rows = read_cost_ledger()["rows"]

    for row in rows:
        owners = [
            owner for owner in (row["run_id"], row["answer_id"]) if owner is not None
        ]
        assert len(owners) == 1, row

    assert [row for row in rows if row["run_id"] is not None], (
        "no row in rows.json has a run_id"
    )
    assert [row for row in rows if row["answer_id"] is not None], (
        "no row in rows.json has an answer_id"
    )
