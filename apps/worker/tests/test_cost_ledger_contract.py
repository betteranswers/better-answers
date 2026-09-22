import json
from pathlib import Path
from typing import Any, cast

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"

WORDS_A_PROMPT_OR_A_COMPLETION_SITS_UNDER = (
    "prompt",
    "completion",
    "message",
    "content",
    "response",
    "text",
    "body",
)

PURPOSE_CARRYING_DIMENSIONS = "embedding"


def read_cost_ledger() -> dict[str, Any]:
    raw = (CONTRACTS_DIR / "cost-ledger" / "rows.json").read_text(encoding="utf-8")
    return cast("dict[str, Any]", json.loads(raw))


def recorded_columns() -> list[str]:
    return sorted(field["field"] for field in read_cost_ledger()["fields"])


def purposes_the_rows_use() -> list[str]:
    return sorted({row["purpose"] for row in read_cost_ledger()["rows"]})


def test_every_row_carries_the_columns_the_row_is_fixed_to_and_no_other() -> None:
    columns = recorded_columns()

    for row in read_cost_ledger()["rows"]:
        assert sorted(row) == columns, row


def test_no_column_recorded_is_one_a_prompt_or_a_completion_sits_under() -> None:
    for column in recorded_columns():
        for word in WORDS_A_PROMPT_OR_A_COMPLETION_SITS_UNDER:
            assert word not in column, column


def test_this_tier_resolves_a_route_for_every_purpose_and_knows_no_other() -> None:
    from factories import EMBEDDING_DIMENSIONS, seed_llm_route, seed_workspace
    from pg_harness import migrated_postgres

    purposes = purposes_the_rows_use()

    with migrated_postgres() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT unnest(enum_range(NULL::llm_purpose))::text")
        assert sorted(spoken for (spoken,) in cursor.fetchall()) == purposes

        workspace = seed_workspace(cursor)
        seeded = {
            purpose: seed_llm_route(
                cursor,
                workspace_id=workspace["id"],
                purpose=purpose,
                dimensions=(
                    EMBEDDING_DIMENSIONS
                    if purpose == PURPOSE_CARRYING_DIMENSIONS
                    else None
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
            cursor.execute("SELECT id FROM llm_route_for(%s::llm_purpose)", (purpose,))
            found = cursor.fetchone()
            resolved[purpose] = found[0] if found else None

        assert resolved == seeded
        connection.rollback()


def test_every_outcome_word_has_a_row_and_one_of_them_is_a_failure() -> None:
    fixture = read_cost_ledger()

    assert sorted({row["outcome"] for row in fixture["rows"]}) == sorted(
        outcome["outcome"] for outcome in fixture["outcomes"]
    )

    failures = {
        outcome["outcome"] for outcome in fixture["outcomes"] if outcome["failure"]
    }
    assert [row for row in fixture["rows"] if row["outcome"] in failures]


def test_every_row_serves_a_run_or_an_answer_never_both_and_never_neither() -> None:
    rows = read_cost_ledger()["rows"]

    for row in rows:
        served = [
            named for named in (row["run_id"], row["answer_id"]) if named is not None
        ]
        assert len(served) == 1, row

    assert [row for row in rows if row["run_id"] is not None]
    assert [row for row in rows if row["answer_id"] is not None]
