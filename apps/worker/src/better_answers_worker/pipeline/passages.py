from dataclasses import dataclass
from itertools import pairwise

from cocoindex.ops.text import RecursiveSplitter

PASSAGE_SIZE_BYTES = 1200


PASSAGE_ID_SEPARATOR = "#"
ORDINAL_DIGITS = 6


LOCATOR_SEPARATOR = "/"
SPAN_PREFIX = "chars:"


@dataclass(frozen=True, slots=True)
class Passage:
    ordinal: int
    id: str
    char_start: int
    char_end: int
    locator: str
    content: str


def passage_id_of(source_document_id: str, ordinal: int) -> str:
    return f"{source_document_id}{PASSAGE_ID_SEPARATOR}{ordinal:0{ORDINAL_DIGITS}d}"


def locator_of(source_document_id: str, char_start: int, char_end: int) -> str:
    return (
        f"{source_document_id}{LOCATOR_SEPARATOR}{SPAN_PREFIX}{char_start}-{char_end}"
    )


def split_into_passages(
    source_document_id: str, text: str, *, passage_size: int = PASSAGE_SIZE_BYTES
) -> tuple[Passage, ...]:
    """Passages that tile `text` with no gap, each ending where the next
    begins, so one may run past `passage_size`. Offsets are in characters."""
    splitter = RecursiveSplitter()
    starts = [
        passage.start.char_offset for passage in splitter.split(text, passage_size)
    ]
    if not starts:
        return ()

    boundaries = [0, *starts[1:], len(text)]
    return tuple(
        Passage(
            ordinal=ordinal,
            id=passage_id_of(source_document_id, ordinal),
            char_start=start,
            char_end=end,
            locator=locator_of(source_document_id, start, end),
            content=text[start:end],
        )
        for ordinal, (start, end) in enumerate(pairwise(boundaries))
    )
