from better_answers_worker.chunker import CHUNK_MAX_CHARACTERS, chunks_of
from bundles import render_concept_file

FRONTMATTER = {
    "@id": "https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM",
    "@type": "Policy",
    "title": "Expenses",
    "generated": "human:ada@acme.invalid",
    "verified": ["human:blake@acme.invalid"],
}


def test_a_concept_chunk_carries_the_body_and_never_the_frontmatter() -> None:

    body = (
        "Expenses are claimed within sixty days.\n\nAsk finance@example.invalid first."
    )

    chunks = chunks_of(render_concept_file(FRONTMATTER, body))

    assert chunks, "a concept with a body yields at least one chunk"
    assert not any("@" in chunk for chunk in chunks if "finance" not in chunk)
    assert "@" in "\n".join(chunks)
    assert "ada@acme.invalid" not in "\n".join(chunks)
    assert "@type" not in "\n".join(chunks)


def test_a_chunk_ends_at_a_paragraph_and_never_grows_past_its_size() -> None:
    paragraphs = [f"Paragraph {number}. " + "word " * 60 for number in range(6)]

    chunks = chunks_of(render_concept_file(FRONTMATTER, "\n\n".join(paragraphs)))

    assert len(chunks) > 1, "a body over the ceiling is split"
    assert all(len(chunk) <= CHUNK_MAX_CHARACTERS for chunk in chunks)

    joined = " ".join(chunks)
    assert all(f"Paragraph {number}." in joined for number in range(6))


def test_one_paragraph_past_the_ceiling_is_cut_at_it_and_loses_nothing() -> None:

    short = "A short paragraph first."
    long = "".join(f"w{number:04d} " for number in range(300)).strip()
    assert len(long) > CHUNK_MAX_CHARACTERS

    chunks = chunks_of(render_concept_file(FRONTMATTER, f"{short}\n\n{long}"))

    assert chunks[0] == short
    assert all(len(chunk) <= CHUNK_MAX_CHARACTERS for chunk in chunks)

    assert "".join(chunks[1:]) == long


def test_a_concept_with_no_body_yields_no_chunks() -> None:
    assert chunks_of(render_concept_file(FRONTMATTER, "")) == []
