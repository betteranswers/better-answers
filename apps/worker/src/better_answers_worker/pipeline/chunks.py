"""One document's normalised redacted text, cut into the rows the chunk index holds.

The two tiers agree on this arithmetic through `contracts/document-chunk/cases.json` and
not by reading each other: the worker cuts the rows and the app parses the locator a
citation carries, derives the same id from the same address and cuts the same passage
back out. Three things are settled here and each of them is a way the two could
disagree.

**The id is derived and never minted** — the document's own id joined to the ordinal,
zero-padded — so a reprocess upserts on the row's key rather than writing a second row
for the same span, and either tier can compute a row's id from its address without
asking the other. It is the engine's *stable id* in ADR 0036's sense.

**The offsets are Unicode code points.** The engine's splitter reports a character
offset, and a character in Rust is a code point, so nothing is converted here — but the
agreement's text carries a character outside the basic plane and the case that holds it
is what proves that sentence rather than assuming it. Python counts a string in code
points and JavaScript in UTF-16 units, so a tier that took the byte offset beside it, or
the length of a JavaScript string, would put every later span one place out.

**The rows partition the text**, which the splitter does not do on its own. It trims the
separator it cut on, so the blank line between two paragraphs would fall inside no row —
and a citation landing there would open nothing. Each row's end is therefore carried out
to the next row's start and the last row's to the end of the text, which is what makes a
span straddling two rows have one answer whether it is cut from the whole text or joined
from the rows a read selected.
"""

from dataclasses import dataclass
from itertools import pairwise

from cocoindex.ops.text import RecursiveSplitter

#: How large a chunk the splitter aims at, in **bytes** — which is what the engine's
#: splitter counts, and is the one place that unit appears in this tier. The number is
#: the concept chunker's (`chunker.CHUNK_MAX_CHARACTERS`), so the two knowledge layers
#: are cut at one scale; for the English prose a UK SMB uploads the two units are within
#: a few percent of each other, and a target size is not a limit either way. It is not
#: imported from there: that constant counts characters, and a size in one unit is not a
#: size in the other however close the numbers run.
CHUNK_SIZE_BYTES = 1200

#: What joins a document's id to its ordinal, and how wide the ordinal is written. The
#: padding is not decoration: without it chunk 10 would sort before chunk 2 and a
#: document's rows would read out of the order they were cut in.
CHUNK_ID_SEPARATOR = "#"
ORDINAL_DIGITS = 6

#: The half of a wire locator that says the offsets are a character span, and what
#: separates the document from it. Both are the agreement's, spelled once.
LOCATOR_SEPARATOR = "/"
SPAN_PREFIX = "chars:"


@dataclass(frozen=True, slots=True)
class Chunk:
    """One row of a document's normalised redacted text, at the address it sits at.

    `content` is the text between the two offsets and is carried rather than recomputed,
    because the row the index holds is what a reader is served and a row whose content
    and whose span could drift apart would serve one and cite the other.
    """

    ordinal: int
    id: str
    char_start: int
    char_end: int
    locator: str
    content: str


def chunk_id_of(source_document_id: str, ordinal: int) -> str:
    """A chunk's id from the address it sits at — the whole of how one is made."""
    return f"{source_document_id}{CHUNK_ID_SEPARATOR}{ordinal:0{ORDINAL_DIGITS}d}"


def locator_of(source_document_id: str, char_start: int, char_end: int) -> str:
    """The whole wire locator: the document, then the span inside it.

    Both halves, because this one string is what a citation's evidence row keys on and
    what `open` is handed — so a chunk row carrying the span alone would be a second
    spelling of one address, and the unique key over the column would stop meaning what
    it says. The offsets are written without leading zeros for the same reason.
    """
    return (
        f"{source_document_id}{LOCATOR_SEPARATOR}{SPAN_PREFIX}{char_start}-{char_end}"
    )


def split_into_chunks(
    source_document_id: str, text: str, *, chunk_size: int = CHUNK_SIZE_BYTES
) -> tuple[Chunk, ...]:
    """Cut one document's normalised redacted text into the rows the index holds.

    `chunk_size` is a parameter and not only a constant because the agreement's own rows
    were cut at a size it names, and the way to hold this tier to them is to run at that
    size rather than to copy their boundaries into the code.
    """
    splitter = RecursiveSplitter()
    starts = [chunk.start.char_offset for chunk in splitter.split(text, chunk_size)]
    if not starts:
        # A document of nothing but whitespace splits into no chunks at all, and no rows
        # is the right answer for it: there is no passage to cite.
        return ()
    # The first row starts at the beginning whatever the splitter trimmed off the front,
    # and every other boundary is the start of the row after it.
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
