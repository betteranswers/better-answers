"""The chunker: a concept's body reaches the index, and its frontmatter never does."""

from better_answers_worker.chunker import CHUNK_MAX_CHARACTERS, chunks_of
from bundles import render_concept_file

#: A frontmatter carrying `@` in every place one can appear: an OKF-shaped key, a second
#: key, and a value that is a person's address — which is what `generated.by` and
#: `verified[].by` hold by decision (ADR 0019).
FRONTMATTER = {
    "@id": "https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM",
    "@type": "Policy",
    "title": "Expenses",
    "generated": "human:ada@acme.invalid",
    "verified": ["human:blake@acme.invalid"],
}


def test_a_concept_chunk_carries_the_body_and_never_the_frontmatter() -> None:
    # The assertion fails both ways on purpose: if the frontmatter leaked, an `@`
    # appears where none may; if the body were dropped, the `@` that is allowed goes
    # missing.
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
    # Every paragraph survives the split: chunking loses nothing, it only divides.
    joined = " ".join(chunks)
    assert all(f"Paragraph {number}." in joined for number in range(6))


def test_a_concept_with_no_body_yields_no_chunks() -> None:
    assert chunks_of(render_concept_file(FRONTMATTER, "")) == []
