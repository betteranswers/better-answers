from dataclasses import dataclass
from itertools import pairwise

from cocoindex.ops.text import RecursiveSplitter

CHUNK_SIZE_BYTES = 1200


CHUNK_ID_SEPARATOR = "#"
ORDINAL_DIGITS = 6


LOCATOR_SEPARATOR = "/"
SPAN_PREFIX = "chars:"


@dataclass(frozen=True, slots=True)
class Chunk:
    ordinal: int
    id: str
    char_start: int
    char_end: int
    locator: str
    content: str


def chunk_id_of(source_document_id: str, ordinal: int) -> str:
    return f"{source_document_id}{CHUNK_ID_SEPARATOR}{ordinal:0{ORDINAL_DIGITS}d}"


def locator_of(source_document_id: str, char_start: int, char_end: int) -> str:
    return (
        f"{source_document_id}{LOCATOR_SEPARATOR}{SPAN_PREFIX}{char_start}-{char_end}"
    )


def split_into_chunks(
    source_document_id: str, text: str, *, chunk_size: int = CHUNK_SIZE_BYTES
) -> tuple[Chunk, ...]:
    splitter = RecursiveSplitter()
    starts = [chunk.start.char_offset for chunk in splitter.split(text, chunk_size)]
    if not starts:
        return ()

    boundaries = [0, *starts[1:], len(text)]
    return tuple(
        Chunk(
            ordinal=ordinal,
            id=chunk_id_of(source_document_id, ordinal),
            char_start=start,
            char_end=end,
            locator=locator_of(source_document_id, start, end),
            content=text[start:end],
        )
        for ordinal, (start, end) in enumerate(pairwise(boundaries))
    )
