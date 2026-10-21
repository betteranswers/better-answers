import time
from collections.abc import Callable

from better_answers_worker.links import links_and_marks_of, outgoing_edges, prose_of

BODY_MAX_SECONDS = 1.0

FRONTMATTER = {"sources": [{"resource": "https://example.test/handbook", "id": "a"}]}


def taken_by(work: Callable[[], object]) -> float:
    started = time.monotonic()
    work()
    return time.monotonic() - started


def test_reads_a_hundred_thousand_brackets_inside_a_second() -> None:
    brackets = "[" * 100_000

    assert taken_by(lambda: prose_of(brackets)) < BODY_MAX_SECONDS
    assert taken_by(lambda: links_and_marks_of(brackets, FRONTMATTER)) < (
        BODY_MAX_SECONDS
    )


def test_reads_a_linked_body_inside_a_second() -> None:
    linked = "[a](b)" * 10_000 + "[" * 20_000

    assert taken_by(lambda: links_and_marks_of(linked, FRONTMATTER)) < BODY_MAX_SECONDS


def test_reads_four_hundred_thousand_unmatched_backticks_inside_a_second() -> None:
    no_run_closes = "".join("`" * n + "a" for n in range(1, 900))

    assert taken_by(lambda: prose_of(no_run_closes)) < BODY_MAX_SECONDS


def test_reads_a_heading_of_eighty_thousand_spaces_inside_a_second() -> None:
    spaced = (
        "# Mileage" + " " * 80_000 + "rates\n\n"
        "See [the rates](https://better-answers.com/c/01J6NNNNNNNNNNNNNNNNNNNNNN)."
    )

    assert (
        taken_by(
            lambda: outgoing_edges(
                iri="https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM",
                kind="Policy",
                path="knowledge/expenses.md",
                body=spaced,
                frontmatter=FRONTMATTER,
                by_path={},
                by_iri={},
            )
        )
        < BODY_MAX_SECONDS
    )
