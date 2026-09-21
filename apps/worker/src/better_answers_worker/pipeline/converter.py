"""A landed copy's bytes as the document's normalised text: one converter per type.

**A media type has one converter, chosen once** (ADR 0013, amended 20/09/2026). The text
a converter writes is the address space every span (`<document id>/chars:<start>-<end>`)
and every `content_hash` is read against, so swapping one reprocesses every document of
its type and sends every citation into them to citation repair. The four types the
upload allow-list admits are the whole of what this module knows:

* **markdown and plain text** pass through — the bytes are the normalised text already,
  so a locator's offsets are offsets into what the reader uploaded;
* **`.docx`** converts to Markdown through `anydoc`;
* **PDF** converts to Markdown through `pdf-inspector`, and is `pdf-inspector`'s alone.
  `anydoc` bundles its own build of that engine and the two outputs differ, which the
  rule above forbids for one type; `pdf-inspector` is also the only one of the two that
  answers a PDF's page count, which the per-document timeout is derived from.

**No model, and nothing leaves the worker.** *Pure Python* was a proxy for *no model*:
the memory and the segfault it answered are torch's, and a Rust extension beside
cocoindex's own carries neither. Conversion runs **before** the redaction seam, so its
input is the document as it arrived (ADR 0020) — which is why `anydoc`'s `ocr` stays
`"reject"`, and why the call names `OCR_ANSWER` rather than leaning on the library's
own default: the other arm, `"hosted"`, posts those unredacted bytes to a third
party, and a default is a decision somebody else may change in a patch release.

**When OCR or a layout model is reached for.** Docling was S4's trigger and is off the
route: on CPU it wants more than twice the worker's 1.5 GB, at S4 as now. The trigger
that replaced it is a number an Admin reads, not a date — *OCR or a layout model is
reached for when a binding's share of documents quarantined for want of OCR is one an
Admin will not accept*, and the answer starts at ADR 0024's precondition for a model
host rather than at a library.

**A document this module cannot read raises `UnreadableError`, never a run failure.**
The name it carries is the converter's own — `NeedsOcrError`, `EncryptedError`,
`MalformedError` — and it is what the run writes beside the document's *quarantined*.
Per-document isolation is `mount_each`'s and lives one module up.
"""

from collections.abc import Callable, Mapping
from functools import partial
from importlib import metadata
from types import MappingProxyType
from typing import Literal

import anydoc
import pdf_inspector

#: The `.docx` media type as the bind act's allow-list writes it, spelled once.
DOCX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)
PDF_MEDIA_TYPE = "application/pdf"

#: The two types that need no conversion at all: their bytes are the normalised text.
PASSED_THROUGH = ("text/markdown", "text/plain")

#: How the bytes of a passed-through document are read, and how a converter's answer is
#: measured. One encoding and not a guess: the bind act takes what a reader uploaded and
#: a document that is not valid UTF-8 is one this tier cannot read, which is the same
#: answer as a media type it cannot convert.
TEXT_ENCODING = "utf-8"

#: The arm of `anydoc`'s `ocr` this repository takes, and the reason it is written down
#: rather than left to the library's default: the other arm, `"hosted"`, posts the
#: document's bytes to `api.firecrawl.dev` — and conversion runs before the seam, so
#: those bytes are unredacted (ADR 0020). A default is a decision somebody else may
#: change in a patch release; this is one this repository made.
OCR_ANSWER: Literal["reject"] = "reject"

#: The format `anydoc` is told the bytes are in, rather than left to sniff. The
#: catalogue row's media type is what the bind act read off the upload, and naming it
#: here is what
#: stops one of the other eleven formats this library also converts being reached by a
#: file whose bytes resemble it — `.docx` is the only one the allow-list admits, and PDF
#: is `pdf-inspector`'s alone.
DOCX_FORMAT: anydoc.Format = "docx"

#: The distributions the two converters ship as, by the names PyPI knows them under.
ANYDOC_DISTRIBUTION = "firecrawl-anydoc"
PDF_INSPECTOR_DISTRIBUTION = "pdf-inspector"


def converter_pin_of(anydoc_version: str, pdf_inspector_version: str) -> str:
    """Both converters' names and versions, in one token of the memo's version string.

    A plain function of its two arguments so that *a converter that moved changes the
    key* can be held as a fact about the string rather than as a fact about whatever
    happens to be installed while the suite runs. The shape is `DETECTOR_PIN`'s — names
    in the hyphens a package uses, joined by `+` — because both tokens end up in one
    version string and one spelling is easier to read than two.
    """
    return f"anydoc-{anydoc_version}+pdf-inspector-{pdf_inspector_version}"


#: The converters as this process actually loaded them, read from the installed
#: distributions rather than copied into a constant beside the manifest. A pinned
#: value belongs in one place, and the installed version is that place here: a literal
#: would be a second pin, and the one thing it could age into is a memo key saying a
#: document was converted by a version that did not convert it.
CONVERTER_PIN = converter_pin_of(
    metadata.version(ANYDOC_DISTRIBUTION), metadata.version(PDF_INSPECTOR_DISTRIBUTION)
)


class UnreadableError(Exception):
    """A document the converter refused, by the name of what refused it.

    The name is the whole point of this type: *quarantined* on a catalogue row says a
    run could not read a document, and an Admin deciding whether to buy OCR needs to
    know whether that was a page with no text layer, an encrypted file or a truncated
    upload. It is the refusing converter's own class name where one refused —
    `NeedsOcrError`, `EncryptedError`, `MalformedError` — and this module's word where
    no converter was reached at all, and never the document's content.
    """

    def __init__(self, name: str, message: str) -> None:
        super().__init__(message)
        self.name = name


def _unreadable_from(cause: Exception) -> UnreadableError:
    """One converter's refusal as this module's, keeping the error's own name."""
    return UnreadableError(type(cause).__name__, str(cause))


#: The fixture page S0 timed the seam against, by its byte length **on the day it was
#: timed** (`T-122`, 11/09/2026). It is a recorded figure and not a read of
#: `tests/fixtures/redaction/supplier-information-pack.md` as it stands, for the reason
#: the milliseconds beside it are: the two are halves of one measurement, and a page
#: that grew afterwards did not make the seam faster per byte. `src` cannot import
#: `tests` in any case.
BYTES_PER_PAGE = 2488


def pages_of(body: bytes, media_type: str) -> int:
    """How many pages this document has, for the per-document timeout to be cut from.

    **A PDF's pages are read, and the other three types' are estimated.** PDF is the one
    type that carries a page count, and `classify_pdf_bytes` answers it in single-digit
    milliseconds without extracting a word — so it is read here, before the conversion
    the timeout is wrapped around, rather than taken out of a conversion that may never
    return.

    The other three have no pages at all, so the estimate is the landed copy's byte
    length over the page S0 measured its milliseconds against. It **over-counts** a
    `.docx`, whose bytes are a zip holding images and styles as well as text, and it
    therefore errs long — which is the right direction for a ceiling: a timeout that
    fired early would quarantine a document the tier can read.

    A PDF is therefore classified twice per run that reads it afresh: once here, outside
    the memo, to set the ceiling, and once inside `converted` to find the pages with no
    text layer. They are two calls because they are on two sides of the memo, and the
    classification costs single-digit milliseconds against a seam that costs seconds.
    """
    if media_type == PDF_MEDIA_TYPE:
        return int(_classified(body).page_count)
    return max(1, -(-len(body) // BYTES_PER_PAGE))


def converted(body: bytes, media_type: str) -> str:
    """This document's normalised text, or `UnreadableError` naming what refused it.

    The dispatch is on the media type the catalogue row carries, which is what the bind
    act read off the upload — so a file renamed to `.docx` is refused by `anydoc` rather
    than half-converted by whichever converter its bytes resemble.
    """
    converter = CONVERTERS.get(media_type)
    if converter is None:
        raise UnreadableError(
            "UnsupportedMediaType", f"this tier converts no {media_type}"
        )
    return converter(body)


def _decoded(body: bytes, media_type: str) -> str:
    try:
        return body.decode(TEXT_ENCODING)
    except UnicodeDecodeError as cause:
        raise UnreadableError(
            type(cause).__name__, f"a {media_type} document that is not {TEXT_ENCODING}"
        ) from cause


def _docx(body: bytes) -> str:
    try:
        return anydoc.to_markdown_bytes(body, DOCX_FORMAT, ocr=OCR_ANSWER)
    except anydoc.ConvertError as cause:
        raise _unreadable_from(cause) from cause


def _pdf(body: bytes) -> str:
    """A PDF converted whole, or quarantined whole.

    **A page with no text layer quarantines the document**, and the classification is
    read before the conversion rather than after it: half a document's text would be an
    address space with a hole in it, and every citation into the pages that did convert
    would be a citation into a document nobody can see the whole of.
    """
    classified = _classified(body)
    if classified.pages_needing_ocr:
        raise UnreadableError(
            "NeedsOcrError",
            f"{len(classified.pages_needing_ocr)} of"
            f" {classified.page_count} pages have no text layer",
        )
    try:
        return str(pdf_inspector.process_pdf_bytes(body).markdown)
    except Exception as cause:  # every refusal is one quarantine
        raise _unreadable_from(cause) from cause


def _classified(body: bytes) -> pdf_inspector.PdfClassification:
    try:
        return pdf_inspector.classify_pdf_bytes(body)
    except Exception as cause:  # every refusal is one quarantine
        raise _unreadable_from(cause) from cause


#: A media type's one converter, which is the whole of `converted`'s dispatch — so its
#: keys are the whole of what this tier converts, and they are what the
#: `upload-media-types` agreement holds to the app's allow-list (ADR 0031,
#: `contracts/upload-media-types/`). A list written beside an `if` chain would be a
#: second list, free to drift from the chain it described; a type is converted here if
#: and only if it is a key here. It sits below the three converters because it holds the
#: functions themselves.
CONVERTERS: Mapping[str, Callable[[bytes], str]] = MappingProxyType(
    {
        **{
            media_type: partial(_decoded, media_type=media_type)
            for media_type in PASSED_THROUGH
        },
        DOCX_MEDIA_TYPE: _docx,
        PDF_MEDIA_TYPE: _pdf,
    }
)
