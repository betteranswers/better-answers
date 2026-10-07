from better_answers_worker.splitter import PASSAGE_MAX_CHARACTERS, passages_of
from bundles import render_concept_file

FRONTMATTER = {
    "@id": "https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM",
    "@type": "Policy",
    "title": "Expenses",
    "generated": "human:ada@acme.invalid",
    "verified": ["human:blake@acme.invalid"],
}


def test_a_concept_passage_carries_the_body_and_never_the_frontmatter() -> None:

    body = (
        "Expenses are claimed within sixty days.\n\nAsk finance@example.invalid first."
    )

    passages = passages_of(render_concept_file(FRONTMATTER, body))

    assert passages, "a concept with a body yields at least one passage"
    assert not any("@" in passage for passage in passages if "finance" not in passage)
    assert "@" in "\n".join(passages)
    assert "ada@acme.invalid" not in "\n".join(passages)
    assert "@type" not in "\n".join(passages)


def test_ends_a_passage_at_a_paragraph_within_its_size() -> None:
    paragraphs = [f"Paragraph {number}. " + "word " * 60 for number in range(6)]

    passages = passages_of(render_concept_file(FRONTMATTER, "\n\n".join(paragraphs)))

    assert len(passages) > 1, "a body over the ceiling is split"
    assert all(len(passage) <= PASSAGE_MAX_CHARACTERS for passage in passages)

    joined = " ".join(passages)
    assert all(f"Paragraph {number}." in joined for number in range(6))


def test_cuts_a_paragraph_past_the_ceiling_and_loses_nothing() -> None:

    short = "A short paragraph first."
    long = "".join(f"w{number:04d} " for number in range(300)).strip()
    assert len(long) > PASSAGE_MAX_CHARACTERS

    passages = passages_of(render_concept_file(FRONTMATTER, f"{short}\n\n{long}"))

    assert passages[0] == short
    assert all(len(passage) <= PASSAGE_MAX_CHARACTERS for passage in passages)

    assert "".join(passages[1:]) == long


def test_a_concept_with_no_body_yields_no_passages() -> None:
    assert passages_of(render_concept_file(FRONTMATTER, "")) == []
