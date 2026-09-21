from .concept_file import parse_concept_file

CHUNK_MAX_CHARACTERS = 1200


def chunks_of(file_text: str) -> list[str]:
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
