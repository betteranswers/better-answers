"""The one memoised function: a landed copy converted, redacted and cut into chunks.

`landed` is the only memoised thing in this estate, and every line of its shape is a
decision ADR 0020 takes rather than a convenience.

**Its body is the conversion and then the seam, in that order and in one function.** The
memo holds what a function returned, so the only text it can ever be handed to hold is
the redacted one. A design that memoised the conversion separately would put the
document as it arrived — every span the seam was built to withhold — on a volume that is
never backed up (ADR 0005) and never reviewed, which is precisely the defect this shape
exists to prevent. Nothing beneath `landed` is memoised, and the chunk step above it is
not memoised either: splitting redacted text is cheap, and a second memo over it would
be a second copy of the text the first one holds.

**The rules in force and the suppressions are arguments and never a change key.** They
belong to the memo key because they change the answer, and they are per document because
an erasure request reaches the documents it names — so one person asking to be erased
re-reads the documents that mention them and leaves the rest of the binding alone. A
change key would do the opposite: it would put every memo entry in every binding out of
date, and the next run would read the whole library to answer for one person.

**The version is an argument too.** The engine's own `version=` takes an integer, and
what has to invalidate a memo here is the pair `rule_version:detector_pin` — the string
every finding and every document's own column already carries. Passing it as an argument
puts it in the key by the same route the suppressions take, and keeps the function a
plain function of everything its answer depends on.

**The copies are read and written outside the memo.** The bytes go in as an argument, so
the key covers the document's actual content rather than the name of a place it might be
found; the normalised copy goes out after the answer comes back, once per run. The
original is never written: it is the evidence an erasure map is read from and a
re-detection is re-run over.

**One component per document** (`mount_each`), which is what makes a document's failure
its own rather than the run's. The per-document timeout, the quarantine of a document
the converter cannot read and the memory measurement rest on that and arrive with T-130.
"""

import hashlib
import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import cocoindex as coco

from ..log import logger
from ..redaction import redact
from ..redaction.engine import Finding
from ..redaction.pins import VERSION_STRING
from .chunks import CHUNK_SIZE_BYTES, Chunk, split_into_chunks
from .host import LANDED_APP, Host, IndexRun
from .objects import LandedCopies

#: What invalidates every memo entry in every binding: this repository's rule version
#: and the pin it decided with, joined as the finding rows and the document's own column
#: carry them. Taken from the seam's own constant rather than composed again here, so a
#: detector that moves cannot move in one place and not the other.
MEMO_VERSION = VERSION_STRING

#: The media types this tier converts today, which is the two that need no conversion at
#: all: the bytes are the normalised text already. `.docx` and PDF arrive with T-130.
PASSED_THROUGH = ("text/markdown", "text/plain")

#: How the bytes of a passed-through document are read. One encoding and not a guess:
#: the bind act takes what a reader uploaded and a document that is not valid UTF-8 is
#: one this tier cannot read, which is the same answer as a media type it cannot
#: convert.
TEXT_ENCODING = "utf-8"


@dataclass(frozen=True, slots=True)
class Suppression:
    """The identifiers one erasure request named, by the kind each was given under.

    Held as sorted pairs rather than as a mapping because this value is part of a memo
    key: two requests naming the same identifiers must fingerprint alike whatever order
    the rows came back in, and a mapping's order is the reader's and not the set's.
    """

    identifiers: tuple[tuple[str, tuple[str, ...]], ...]

    def as_set(self) -> Mapping[str, Sequence[str]]:
        """The shape the seam takes, and the shape a `subject_request` row holds."""
        return dict(self.identifiers)


def suppression_of(identifiers: Mapping[str, Sequence[str]]) -> Suppression:
    """One erasure request's identifier set, in the order a memo key needs it in."""
    return Suppression(
        identifiers=tuple(
            (kind, tuple(named)) for kind, named in sorted(identifiers.items())
        )
    )


@dataclass(frozen=True, slots=True)
class LandedDocument:
    """One document the run is to read, as its catalogue row addresses it.

    The two keys are keys *inside* the workspace's own prefix, which is what the column
    holds and what the object store's adapter adds to.
    """

    source_document_id: str
    media_type: str
    original_key: str
    normalised_key: str
    suppressions: tuple[Suppression, ...] = ()


@dataclass(frozen=True, slots=True)
class RedactedDocument:
    """What the memoised function answers, and the only thing the memo ever holds.

    `counts` is pairs rather than a mapping for the same reason a suppression's set is:
    this value is serialised into the store, and one answer written two ways is two
    answers to anything comparing them.
    """

    text: str
    findings: tuple[Finding, ...]
    counts: tuple[tuple[str, int], ...]
    verdict: str | None
    version: str
    #: The hash of the **normalised text the seam was given**, which is the fact a later
    #: run compares against to answer *unchanged* — over the text after conversion and
    #: before redaction, as the catalogue column holds it. It is computed inside the
    #: memoised body and carried out on this value because that is the only place the
    #: pre-seam text exists: the caller holds the document's bytes, and the two are the
    #: same only for the types that pass through. A hash holds no value, so keeping one
    #: here asks nothing of ADR 0020 that the redacted text does not already ask.
    content_hash: str


@dataclass(frozen=True, slots=True)
class ReadDocument:
    """One landed copy as this run read it: the text, and the rows cut from it."""

    source_document_id: str
    normalised_key: str
    redacted: RedactedDocument
    chunks: tuple[Chunk, ...]


@dataclass(frozen=True, slots=True)
class LandedRun:
    """What one pass over a binding's landed copies read.

    `read_afresh` is how many of them the seam actually ran over; the rest were answered
    out of the memo. It is the figure that says whether a run did work or recognised
    that it had none, and the one a case about the memo can hold.
    """

    documents: tuple[ReadDocument, ...]
    read_afresh: int


class _Readings:
    """How many documents the seam has read, counted where the body runs.

    A counter rather than the engine's statistics because what matters here is the
    expensive thing — the detector — and not whether a component was visited. It is
    module-level state and safe as such for one reason the tier already enforces:
    `MAX_CONCURRENT_RUNS` is read and refused at anything but one (`config.py`), so a
    process has one run in flight and a reading taken around it belongs to that run. The
    lock is for the documents inside a run, which the engine does run at once.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._read = 0

    def read_one(self) -> None:
        with self._lock:
            self._read += 1

    def taken(self) -> int:
        with self._lock:
            return self._read


_READINGS = _Readings()


def _converted(body: bytes, media_type: str) -> str:
    """A landed copy's bytes as the document's normalised text.

    Markdown and plain text are the normalised text already, so the offsets a locator
    carries are offsets into what the reader uploaded. A type this tier cannot convert
    is named in the refusal rather than left to fail somewhere inside the seam, because
    the ticket that adds the other converters turns this refusal into the document's
    *quarantine* on its catalogue row and needs to know which document and which type.
    """
    if media_type not in PASSED_THROUGH:
        message = f"this tier converts no {media_type} document yet"
        raise ValueError(message)
    try:
        return body.decode(TEXT_ENCODING)
    except UnicodeDecodeError as cause:
        message = f"a {media_type} document that is not {TEXT_ENCODING}"
        raise ValueError(message) from cause


@coco.fn(memo=True)
def landed(
    body: bytes,
    media_type: str,
    rules_in_force: tuple[tuple[str, bool], ...],
    suppressions: tuple[Suppression, ...],
    seed: str,
    version: str,
) -> RedactedDocument:
    """Convert one landed copy and run the seam over it — the one memoised body.

    Everything the answer depends on is an argument, which is the whole of why the memo
    key means anything: the bytes, the type they are in, what the binding withholds, who
    has asked to be erased from this document, the binding's seed and the version of the
    rules and the detector that decided.
    """
    _READINGS.read_one()
    normalised = _converted(body, media_type)
    answer = redact(
        normalised,
        dict(rules_in_force),
        [suppression.as_set() for suppression in suppressions],
        seed,
    )
    return RedactedDocument(
        text=answer.text,
        findings=tuple(answer.findings),
        counts=tuple(sorted(answer.counts.items())),
        verdict=answer.verdict,
        version=answer.version,
        content_hash=hashlib.sha256(normalised.encode(TEXT_ENCODING)).hexdigest(),
    )


@coco.fn
async def _one_document(
    landing: tuple[LandedDocument, bytes],
    read: dict[str, ReadDocument],
    rules_in_force: tuple[tuple[str, bool], ...],
    seed: str,
    version: str,
    chunk_size: int,
) -> None:
    """One document's whole passage through this wave, as its own component.

    The memoised call is the middle of it: the bytes were read before the component was
    mounted and the normalised copy is written after the answer comes back, so neither
    end of the store is inside the memo. The document and its bytes arrive as one value
    because `mount_each` keys one value per item; everything after them is the run's and
    is the same for every document in it.
    """
    document, body = landing
    answer = await coco.use_mount(
        landed,
        body,
        document.media_type,
        rules_in_force,
        document.suppressions,
        seed,
        version,
    )
    read[document.source_document_id] = ReadDocument(
        source_document_id=document.source_document_id,
        normalised_key=document.normalised_key,
        redacted=answer,
        chunks=split_into_chunks(
            document.source_document_id, answer.text, chunk_size=chunk_size
        ),
    )


@coco.fn
async def _every_document(
    landings: tuple[tuple[LandedDocument, bytes], ...],
    read: dict[str, ReadDocument],
    rules_in_force: tuple[tuple[str, bool], ...],
    seed: str,
    version: str,
    chunk_size: int,
) -> int:
    """Fan the binding's documents, one component each.

    One per document and not one for the binding, because a document's conversion is
    where the next ticket puts its timeout and its quarantine — and a failure can only
    be one document's if the work was one document's to begin with.
    """
    await coco.mount_each(
        _one_document,
        [
            (document.source_document_id, (document, body))
            for document, body in landings
        ],
        read,
        rules_in_force,
        seed,
        version,
        chunk_size,
    )
    return len(landings)


def redact_landed_copies(
    host: Host,
    run: IndexRun,
    documents: Sequence[LandedDocument],
    copies: LandedCopies,
    rules_in_force: Mapping[str, bool],
    seed: str,
    *,
    chunk_size: int = CHUNK_SIZE_BYTES,
    memo_version: str = MEMO_VERSION,
) -> LandedRun:
    """Read this binding's landed copies, redact them and cut them into chunks.

    The originals are read here rather than inside the memoised function, so that the
    key covers a document's actual bytes: a landed copy replaced under the same key is
    read again rather than answered from a memo entry that was about different text. The
    normalised copies go out afterwards, one write per document per run.
    """
    with_bytes = tuple(
        (document, copies.read(document.original_key)) for document in documents
    )
    read: dict[str, ReadDocument] = {}
    before = _READINGS.taken()
    coco.App(
        host.app_config(run, LANDED_APP),
        _every_document,
        with_bytes,
        read,
        tuple(sorted(rules_in_force.items())),
        seed,
        memo_version,
        chunk_size,
    ).update_blocking()
    answered = tuple(
        read[document.source_document_id]
        for document in documents
        if document.source_document_id in read
    )
    for document in answered:
        copies.write(
            document.normalised_key, document.redacted.text.encode(TEXT_ENCODING)
        )
    outcome = LandedRun(documents=answered, read_afresh=_READINGS.taken() - before)
    logger.info(
        "the binding's landed copies were read",
        binding_id=run.binding_id,
        documents=len(answered),
        read_afresh=outcome.read_afresh,
    )
    return outcome
