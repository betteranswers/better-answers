import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import timedelta
from types import MappingProxyType

import cocoindex as coco

from ..log import logger
from ..redaction import Restore, redact
from ..redaction.engine import Finding
from ..redaction.withholdings import Withholding
from .chunks import CHUNK_SIZE_BYTES, Chunk, split_into_chunks
from .converter import (
    TEXT_ENCODING,
    UnreadableError,
    converted,
    pages_of,
)
from .detected import (
    THE_MEMOS_MODULE,
    THE_MEMOS_NAME,
    THE_MEMOS_VERSION,
    raised_by_the_detector,
)
from .host import FINDINGS_STORE, LANDED_APP, Host, IndexRun
from .objects import LandedCopies

# A function memo is fetched by a prefix scan of its calling component's path, so these
# names are as much its identity as its own.
A_DOCUMENTS_COMPONENT = "a-document"
THE_SEAMS_COMPONENT = "the-seam"


# Move any one and every page the estate holds is detected again; the suite pins six.
THE_MEMOS_IDENTITY: Mapping[str, str] = MappingProxyType(
    {
        "app": LANDED_APP,
        "directory": FINDINGS_STORE,
        "module": THE_MEMOS_MODULE,
        "mount_path": f"{A_DOCUMENTS_COMPONENT}/{THE_SEAMS_COMPONENT}",
        "qualified_name": THE_MEMOS_NAME,
        "version": str(THE_MEMOS_VERSION),
    }
)


SEAM_MS_PER_PAGE = 6453


TIMEOUT_MARGIN_MS = 93_000


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
    withholdings: tuple[Withholding, ...]
    counts: tuple[tuple[str, int], ...]
    verdict: str | None
    version: str

    content_hash: str
    detected_afresh: bool


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
    quarantined: tuple[QuarantinedDocument, ...] = ()

    @property
    def detected_afresh(self) -> tuple[str, ...]:
        return tuple(
            document.source_document_id
            for document in self.documents
            if document.redacted.detected_afresh
        )


def timeout_for(
    pages: int,
    *,
    ms_per_page: int = SEAM_MS_PER_PAGE,
    margin_ms: int = TIMEOUT_MARGIN_MS,
) -> timedelta:
    return timedelta(milliseconds=ms_per_page * pages + margin_ms)


@coco.fn
def landed(
    body: bytes,
    media_type: str,
    rules_in_force: tuple[tuple[str, bool], ...],
    suppressions: tuple[Suppression, ...],
    restores: tuple[Restore, ...],
    seed: str,
    detection_key: str,
) -> RedactedDocument:
    # Unmemoised, so a fix to the conversion, the block rule or the withholding reaches
    # every document on its next run with no version to remember.
    normalised = converted(body, media_type)
    raised = raised_by_the_detector(normalised, detection_key)
    answer = redact(
        normalised,
        raised.spans,
        dict(rules_in_force),
        [suppression.as_set() for suppression in suppressions],
        seed,
        restores,
    )
    return RedactedDocument(
        text=answer.text,
        findings=tuple(answer.findings),
        withholdings=tuple(answer.withholdings),
        counts=tuple(sorted(answer.counts.items())),
        verdict=answer.verdict,
        version=answer.version,
        content_hash=hashlib.sha256(normalised.encode(TEXT_ENCODING)).hexdigest(),
        detected_afresh=raised.afresh,
    )


@dataclass(frozen=True, slots=True)
class _Wave:
    rules_in_force: tuple[tuple[str, bool], ...]
    seed: str
    detection_key: str
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
                coco.component_subpath(THE_SEAMS_COMPONENT),
                landed,
                body,
                document.media_type,
                wave.rules_in_force,
                document.suppressions,
                document.restores,
                wave.seed,
                wave.detection_key,
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
        coco.component_subpath(A_DOCUMENTS_COMPONENT),
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
    detection_key: str | None = None,
    ms_per_page: int = SEAM_MS_PER_PAGE,
    margin_ms: int = TIMEOUT_MARGIN_MS,
) -> LandedRun:
    # Reading the key builds a recogniser of every rule, so presidio arrives with it. A
    # spawn that lands nothing must not pay that.
    from ..redaction.detection_key import detection_key as the_detection_key

    with_bytes = tuple(
        (document, copies.read(document.original_key)) for document in documents
    )
    read: dict[str, ReadDocument] = {}
    refused: dict[str, str] = {}
    coco.App(
        host.app_config(run, LANDED_APP),
        _every_document,
        with_bytes,
        read,
        refused,
        _Wave(
            rules_in_force=tuple(sorted(rules_in_force.items())),
            seed=seed,
            detection_key=(
                the_detection_key() if detection_key is None else detection_key
            ),
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
    outcome = LandedRun(documents=answered, quarantined=quarantined)
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
        detected_afresh=list(outcome.detected_afresh),
        quarantined=len(quarantined),
    )
    return outcome
