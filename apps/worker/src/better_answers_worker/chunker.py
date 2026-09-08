"""The chunker: a concept file's **body** split into chunks, and never its frontmatter.

The rule this exists for is one sentence of ADR 0020's, made a function: personal data
is withheld at the seam before any store, and a concept file's frontmatter is where the
platform's own keys live — `generated.by` and `verified[].by` carry `human:<email>` (ADR
0019), which is a person's address written into a file by decision. An indexer that
chunked the whole file would put those addresses into `index.chunk`, into an embedding,
and into whatever a search result shows. So the frontmatter is not chunked at all: not
redacted, not filtered, not chunked.

The test that holds it is the shape of the rule rather than a sample of it: a file whose
frontmatter carries `@`-shaped keys and an `@`-shaped value yields chunks with no `@` in
them, and a body `@` comes through — so the assertion fails both if the frontmatter
leaks and if the body is dropped.

No `index.chunk` row is written here. A row needs an embedding, and an embedding needs a
host this estate does not run yet (ADR 0024's model-host box, B7); what this tier can
settle now is *what a chunk is made of*, which is the half that has a rule attached to
it.
"""

from .concept_file import parse_concept_file

#: How large a chunk may get, in characters. A concept is a fact stated once and citable
#: in one sentence (`CONTEXT.md`), so a concept's whole body is usually one chunk and
#: this number only bites on the long ones. It is stated here rather than passed in
#: because a chunk's size is a property of the index the chunks go into, not of the
#: caller.
CHUNK_MAX_CHARACTERS = 1200


def chunks_of(file_text: str) -> list[str]:
    """A concept file's body, as chunks: paragraph-bounded, and none over the size
    above.

    Paragraph-bounded because a paragraph is the smallest run of a concept's body that
    still says something on its own; a paragraph longer than the ceiling is the one case
    that is cut, and it is cut at the ceiling rather than dropped.
    """
    _, body = parse_concept_file(file_text)

    chunks: list[str] = []
    current = ""
    for paragraph in (piece.strip() for piece in body.split("\n\n")):
        if paragraph == "":
            continue
        if len(paragraph) > CHUNK_MAX_CHARACTERS:
            if current != "":
                chunks.append(current)
                current = ""
            chunks.extend(
                paragraph[at : at + CHUNK_MAX_CHARACTERS]
                for at in range(0, len(paragraph), CHUNK_MAX_CHARACTERS)
            )
            continue
        joined = paragraph if current == "" else f"{current}\n\n{paragraph}"
        if len(joined) > CHUNK_MAX_CHARACTERS:
            chunks.append(current)
            current = paragraph
        else:
            current = joined
    if current != "":
        chunks.append(current)
    return chunks
