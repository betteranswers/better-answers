import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import timedelta
from types import MappingProxyType

import cocoindex as coco

from ..log import logger
from ..redaction import Dismissal, Restore, redact
from ..redaction.engine import Finding
from ..redaction.withholdings import Withholding
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
from .host import FINDINGS_STORE, LANDED_APP, Host, Sync
from .objects import LandedCopies
from .passages import PASSAGE_SIZE_BYTES, Passage, split_into_passages

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
    """Kinds in sorted order, so the order they arrive in never changes the value."""
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

    dismissals: tuple[Dismissal, ...] = ()


@dataclass(frozen=True, slots=True)
class RedactedDocument:
    """`content_hash` is of the converted text before redaction;
    `version` is the rule version and detector pin, colon-joined."""

    text: str
    findings: tuple[Finding, ...]
    withholdings: tuple[Withholding, ...]
    counts: tuple[tuple[str, int], ...]
    verdict: str | None
    lifted: bool
    version: str

    content_hash: str
    detected_afresh: bool


@dataclass(frozen=True, slots=True)
class ReadDocument:
    source_document_id: str
    normalised_key: str
    redacted: RedactedDocument
    passages: tuple[Passage, ...]


@dataclass(frozen=True, slots=True)
class UnreadableDocument:
    """`reason` is the refusal's name, such as `NeedsOcrError`
    or `DeadlineExceededError`, never its message."""

    source_document_id: str
    reason: str


@dataclass(frozen=True, slots=True)
class LandedSync:
    documents: tuple[ReadDocument, ...]
    unreadable: tuple[UnreadableDocument, ...] = ()

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
    dismissals: tuple[Dismissal, ...],
    seed: str,
    detection_key: str,
) -> RedactedDocument:
    """Converts, detects and redacts one document. Raises `UnreadableError`
    when it cannot be converted; `seed` fixes the pseudonym letters."""
    # Unmemoised, so a fix to the conversion, the block rule or the withholding reaches
    # every document on its next sync with no version to remember.
    normalised = converted(body, media_type)
    raised = raised_by_the_detector(normalised, detection_key)
    answer = redact(
        normalised,
        raised.spans,
        dict(rules_in_force),
        [suppression.as_set() for suppression in suppressions],
        seed,
        restores,
        dismissals,
    )
    return RedactedDocument(
        text=answer.text,
        findings=tuple(answer.findings),
        withholdings=tuple(answer.withholdings),
        counts=tuple(sorted(answer.counts.items())),
        verdict=answer.verdict,
        lifted=answer.lifted,
        version=answer.version,
        content_hash=hashlib.sha256(normalised.encode(TEXT_ENCODING)).hexdigest(),
        detected_afresh=raised.afresh,
    )


@dataclass(frozen=True, slots=True)
class _Wave:
    rules_in_force: tuple[tuple[str, bool], ...]
    seed: str
    detection_key: str
    passage_size: int
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
                document.dismissals,
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
        passages=split_into_passages(
            document.source_document_id, answer.text, passage_size=wave.passage_size
        ),
    )


def _fail_the_sync(error: BaseException, _: coco.ExceptionContext) -> None:
    # The engine's default logs and carries on, so the sync would finish with the
    # document neither read nor unreadable and land_rows would delete its passages.
    raise error


@coco.fn
async def _every_document(
    landings: tuple[tuple[LandedDocument, bytes], ...],
    read: dict[str, ReadDocument],
    refused: dict[str, str],
    wave: _Wave,
) -> int:
    async with coco.exception_handler(_fail_the_sync):
        mounted = await coco.mount_each(
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
        # The handler's raise surfaces only here: unawaited, the sync still finishes.
        await mounted.ready()
    return len(landings)


def redact_landed_copies(
    host: Host,
    sync: Sync,
    documents: Sequence[LandedDocument],
    copies: LandedCopies,
    rules_in_force: Mapping[str, bool],
    seed: str,
    *,
    passage_size: int = PASSAGE_SIZE_BYTES,
    detection_key: str | None = None,
    ms_per_page: int = SEAM_MS_PER_PAGE,
    margin_ms: int = TIMEOUT_MARGIN_MS,
) -> LandedSync:
    """Writes each document's redacted text to its `normalised_key`; one that
    cannot be converted or runs past its time is marked unreadable rather than raised.
    `detection_key` defaults to the detector's own, which loads presidio."""
    # Reading the key builds a recogniser of every rule, so presidio arrives with it. A
    # spawn that lands nothing must not pay that.
    from ..redaction.detection_key import detection_key as the_detection_key

    with_bytes = tuple(
        (document, copies.read(document.original_key)) for document in documents
    )
    read: dict[str, ReadDocument] = {}
    refused: dict[str, str] = {}
    coco.App(
        host.app_config(sync, LANDED_APP),
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
            passage_size=passage_size,
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
    unreadable = tuple(
        UnreadableDocument(
            source_document_id=document.source_document_id,
            reason=refused[document.source_document_id],
        )
        for document in documents
        if document.source_document_id in refused
    )
    outcome = LandedSync(documents=answered, unreadable=unreadable)
    for refusal in unreadable:
        logger.warning(
            "the sync could not read a document and found it unreadable",
            connected_source_id=sync.connected_source_id,
            source_document_id=refusal.source_document_id,
            reason=refusal.reason,
        )
    logger.info(
        "the connected source's landed copies were read",
        connected_source_id=sync.connected_source_id,
        documents=len(answered),
        detected_afresh=list(outcome.detected_afresh),
        unreadable=len(unreadable),
    )
    return outcome
