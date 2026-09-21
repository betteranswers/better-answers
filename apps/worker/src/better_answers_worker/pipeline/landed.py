import hashlib
import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import timedelta

import cocoindex as coco

from ..log import logger
from ..redaction import Restore, redact
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

MEMO_VERSION = f"{VERSION_STRING}+{CONVERTER_PIN}"


SEAM_MS_PER_PAGE = 2841


TIMEOUT_MARGIN_MS = 30_000


@dataclass(frozen=True, slots=True)
class Suppression:
    identifiers: tuple[tuple[str, tuple[str, ...]], ...]

    def as_set(self) -> Mapping[str, Sequence[str]]:
        return dict(self.identifiers)


def suppression_of(identifiers: Mapping[str, Sequence[str]]) -> Suppression:
    return Suppression(
        identifiers=tuple(
            (kind, tuple(named)) for kind, named in sorted(identifiers.items())
        )
    )


@dataclass(frozen=True, slots=True)
class LandedDocument:
    source_document_id: str
    media_type: str
    original_key: str
    normalised_key: str
    suppressions: tuple[Suppression, ...] = ()

    restores: tuple[Restore, ...] = ()


@dataclass(frozen=True, slots=True)
class RedactedDocument:
    text: str
    findings: tuple[Finding, ...]
    counts: tuple[tuple[str, int], ...]
    verdict: str | None
    version: str

    content_hash: str

    overridden: tuple[Finding, ...]


@dataclass(frozen=True, slots=True)
class ReadDocument:
    source_document_id: str
    normalised_key: str
    redacted: RedactedDocument
    chunks: tuple[Chunk, ...]


@dataclass(frozen=True, slots=True)
class QuarantinedDocument:
    source_document_id: str
    error: str


@dataclass(frozen=True, slots=True)
class LandedRun:
    documents: tuple[ReadDocument, ...]
    read_afresh: int
    quarantined: tuple[QuarantinedDocument, ...] = ()


class _Readings:
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
    return timedelta(milliseconds=ms_per_page * pages + margin_ms)


@coco.fn(memo=True)
def landed(
    body: bytes,
    media_type: str,
    rules_in_force: tuple[tuple[str, bool], ...],
    suppressions: tuple[Suppression, ...],
    restores: tuple[Restore, ...],
    seed: str,
    version: str,
) -> RedactedDocument:
    _READINGS.read_one()
    normalised = converted(body, media_type)
    answer = redact(
        normalised,
        dict(rules_in_force),
        [suppression.as_set() for suppression in suppressions],
        seed,
        restores,
    )
    return RedactedDocument(
        text=answer.text,
        findings=tuple(answer.findings),
        counts=tuple(sorted(answer.counts.items())),
        verdict=answer.verdict,
        version=answer.version,
        content_hash=hashlib.sha256(normalised.encode(TEXT_ENCODING)).hexdigest(),
        overridden=tuple(answer.overridden),
    )


@dataclass(frozen=True, slots=True)
class _Wave:
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
                document.restores,
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
