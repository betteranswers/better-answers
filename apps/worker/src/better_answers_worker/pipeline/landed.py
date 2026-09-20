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
its own rather than the run's. Two things rest on that and arrive with T-130: a document
the converter cannot read is *quarantined* on its own catalogue row and never a run
failure, and each document's conversion carries a **cooperative timeout of its own**, so
a conversion that sticks is that document's quarantine rather than the binding's.
"""

import hashlib
import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import timedelta

import cocoindex as coco

from ..log import logger
from ..redaction import redact
from ..redaction.engine import Finding
from ..redaction.pins import VERSION_STRING
from .chunks import CHUNK_SIZE_BYTES, Chunk, split_into_chunks
from .converter import (
    CONVERTER_PIN,
    TEXT_ENCODING,
    UnreadableError,
    converted,
    pages_of,
)
from .host import LANDED_APP, Host, IndexRun
from .objects import LandedCopies

#: What invalidates every memo entry in every binding: this repository's rule version
#: and the pin it decided with, and beside them the converters that wrote the text the
#: seam read. Taken from each module's own constant rather than composed again here, so
#: a detector or a converter that moves cannot move in one place and not the other.
#:
#: **The converters belong in this key and not on the document's row.** A converter's
#: output is the span address space, so an upgrade misses the memo for every document of
#: its media type and is a reprocess somebody chose rather than a drift nobody saw. The
#: catalogue's `redaction_version` column keeps the seam's string alone, which is what a
#: locator's offsets are read against once the text exists.
MEMO_VERSION = f"{VERSION_STRING}+{CONVERTER_PIN}"

#: What S0 measured the seam at, per page, on the worker image (`T-122`, 11/09/2026;
#: `tests/test_image.py`'s docblock carries the three readings and the machine). The
#: **slowest** of them is the one taken, because this number is a ceiling and not a
#: budget: a timeout cut from the fastest reading would quarantine documents a busier
#: box could have read.
SEAM_MS_PER_PAGE = 2841

#: What is added to every document's ceiling whatever its length: the one-off model load
#: the first document of a process pays (6351-7137 ms in the same readings), the
#: conversion in front of the seam, and the engine's own work around both. Thirty
#: seconds is four times the slowest load recorded, which is the margin's whole job —
#: nothing here is measured against it, and a document that needs more than its pages
#: plus this is a document the run gives up on rather than holds the binding for.
TIMEOUT_MARGIN_MS = 30_000


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
class QuarantinedDocument:
    """One document the run could not read, and the name of what refused it.

    The name is a converter's own class name — `NeedsOcrError`, `EncryptedError`,
    `MalformedError`, `DeadlineExceededError` — and never a line of the document. It is
    what an Admin reads to tell a scan from a corrupt upload, and what decides whether a
    binding's share of documents quarantined *for want of OCR* is one they will accept.
    """

    source_document_id: str
    error: str


@dataclass(frozen=True, slots=True)
class LandedRun:
    """What one pass over a binding's landed copies read.

    `read_afresh` is how many of them the seam actually ran over; the rest were answered
    out of the memo. It is the figure that says whether a run did work or recognised
    that it had none, and the one a case about the memo can hold.

    `quarantined` is the other half of the binding: the documents the run reached and
    could not read. They are answered rather than raised, because an exception here
    would make one unreadable upload the whole binding's failure.
    """

    documents: tuple[ReadDocument, ...]
    read_afresh: int
    quarantined: tuple[QuarantinedDocument, ...] = ()


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


def timeout_for(
    pages: int,
    *,
    ms_per_page: int = SEAM_MS_PER_PAGE,
    margin_ms: int = TIMEOUT_MARGIN_MS,
) -> timedelta:
    """How long one document of this many pages is given, conversion and seam together.

    S0's milliseconds per page times the document's pages plus a fixed margin, which is
    the whole of it. Per **document** and not per run, because a run's ceiling would let
    one stuck conversion take the binding with it — and per **page** because the seam's
    cost is the page's, so a ceiling that ignored length would be generous to a note and
    mean to a contract.

    Both figures are parameters with the shipped constants as defaults: what a case
    about the ceiling needs is to shrink it, and a case that reached inside this
    function to do that would be a case about something else.
    """
    return timedelta(milliseconds=ms_per_page * pages + margin_ms)


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
    normalised = converted(body, media_type)
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


@dataclass(frozen=True, slots=True)
class _Wave:
    """Everything one pass over a binding holds that is the same for every document.

    One value rather than six arguments, and it travels as one from the main function
    to each component. The document and its bytes are the only thing that differs per
    component, which is exactly what `mount_each` keys on — so this is the other half of
    that split, stated once instead of restated in every signature it passes through.
    Plain types throughout, as everything crossing this package's seams is.
    """

    rules_in_force: tuple[tuple[str, bool], ...]
    seed: str
    version: str
    chunk_size: int
    ms_per_page: int
    margin_ms: int


@coco.fn
async def _one_document(
    landing: tuple[LandedDocument, bytes],
    read: dict[str, ReadDocument],
    refused: dict[str, str],
    wave: _Wave,
) -> None:
    """One document's whole passage through this wave, as its own component.

    The memoised call is the middle of it: the bytes were read before the component was
    mounted and the normalised copy is written after the answer comes back, so neither
    end of the store is inside the memo. The document and its bytes arrive as one value
    because `mount_each` keys one value per item; the wave beside them is the run's and
    is the same for every document in it.

    **Three things are caught here and two of them are the same fact.** A converter that
    refuses the document and a ceiling the document ran past are both *this document is
    not going to be read*, and both are answered into `refused` under the name of what
    refused it rather than raised — an exception at this point would make one unreadable
    upload the whole binding's failure, which is the one thing fanning a component per
    document exists to prevent.

    **The pages are counted before the ceiling is set and before the call is made.** A
    PDF's page count comes out of its own header in single-digit milliseconds; taking it
    from a conversion would mean knowing how long to allow only once the conversion the
    allowance is for had already returned.
    """
    document, body = landing
    try:
        pages = pages_of(body, document.media_type)
    except UnreadableError as refusal:
        refused[document.source_document_id] = refusal.name
        return

    ceiling = timeout_for(pages, ms_per_page=wave.ms_per_page, margin_ms=wave.margin_ms)
    try:
        with coco.timeout(ceiling):
            answer = await coco.use_mount(
                landed,
                body,
                document.media_type,
                wave.rules_in_force,
                document.suppressions,
                wave.seed,
                wave.version,
            )
    except UnreadableError as refusal:
        refused[document.source_document_id] = refusal.name
        return
    except coco.DeadlineExceededError as expiry:
        refused[document.source_document_id] = type(expiry).__name__
        return

    read[document.source_document_id] = ReadDocument(
        source_document_id=document.source_document_id,
        normalised_key=document.normalised_key,
        redacted=answer,
        chunks=split_into_chunks(
            document.source_document_id, answer.text, chunk_size=wave.chunk_size
        ),
    )


@coco.fn
async def _every_document(
    landings: tuple[tuple[LandedDocument, bytes], ...],
    read: dict[str, ReadDocument],
    refused: dict[str, str],
    wave: _Wave,
) -> int:
    """Fan the binding's documents, one component each.

    One per document and not one for the binding, because a document's conversion is
    where its timeout and its quarantine live — and a failure can only be one
    document's if the work was one document's to begin with.
    """
    await coco.mount_each(
        _one_document,
        [
            (document.source_document_id, (document, body))
            for document, body in landings
        ],
        read,
        refused,
        wave,
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
    ms_per_page: int = SEAM_MS_PER_PAGE,
    margin_ms: int = TIMEOUT_MARGIN_MS,
) -> LandedRun:
    """Read this binding's landed copies, redact them and cut them into chunks.

    The originals are read here rather than inside the memoised function, so that the
    key covers a document's actual bytes: a landed copy replaced under the same key is
    read again rather than answered from a memo entry that was about different text. The
    normalised copies go out afterwards, one write per document per run.

    A document the converter refused, or one that ran past its own ceiling, comes back
    on `quarantined` with the error's name and is logged here by name and document. The
    run goes on and answers the rest.
    """
    with_bytes = tuple(
        (document, copies.read(document.original_key)) for document in documents
    )
    read: dict[str, ReadDocument] = {}
    refused: dict[str, str] = {}
    before = _READINGS.taken()
    coco.App(
        host.app_config(run, LANDED_APP),
        _every_document,
        with_bytes,
        read,
        refused,
        _Wave(
            rules_in_force=tuple(sorted(rules_in_force.items())),
            seed=seed,
            version=memo_version,
            chunk_size=chunk_size,
            ms_per_page=ms_per_page,
            margin_ms=margin_ms,
        ),
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
    quarantined = tuple(
        QuarantinedDocument(
            source_document_id=document.source_document_id,
            error=refused[document.source_document_id],
        )
        for document in documents
        if document.source_document_id in refused
    )
    outcome = LandedRun(
        documents=answered,
        read_afresh=_READINGS.taken() - before,
        quarantined=quarantined,
    )
    for refusal in quarantined:
        logger.warning(
            "the run could not read a document and quarantined it",
            binding_id=run.binding_id,
            source_document_id=refusal.source_document_id,
            error=refusal.error,
        )
    logger.info(
        "the binding's landed copies were read",
        binding_id=run.binding_id,
        documents=len(answered),
        read_afresh=outcome.read_afresh,
        quarantined=len(quarantined),
    )
    return outcome
