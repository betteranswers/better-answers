from .concept_file import parse_concept_file

PASSAGE_MAX_CHARACTERS = 1200


def passages_of(file_text: str) -> list[str]:
    """The body's paragraphs packed into passages of at most
    `PASSAGE_MAX_CHARACTERS`; a longer paragraph is cut at that length,
    mid-word. Raises `MalformedConceptFileError` as `parse_concept_file` does."""
    _, body = parse_concept_file(file_text)

    passages: list[str] = []
    current = ""
    for paragraph in (piece.strip() for piece in body.split("\n\n")):
        if paragraph == "":
            continue
        if len(paragraph) > PASSAGE_MAX_CHARACTERS:
            if current != "":
                passages.append(current)
                current = ""
            passages.extend(
                paragraph[at : at + PASSAGE_MAX_CHARACTERS]
                for at in range(0, len(paragraph), PASSAGE_MAX_CHARACTERS)
            )
            continue
        joined = paragraph if current == "" else f"{current}\n\n{paragraph}"
        if len(joined) > PASSAGE_MAX_CHARACTERS:
            passages.append(current)
            current = paragraph
        else:
            current = joined
    if current != "":
        passages.append(current)
    return passages
