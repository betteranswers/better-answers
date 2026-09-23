from collections.abc import Callable, Mapping
from functools import partial
from importlib import metadata
from types import MappingProxyType
from typing import Literal

import anydoc
import pdf_inspector

DOCX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)
PDF_MEDIA_TYPE = "application/pdf"


PASSED_THROUGH = ("text/markdown", "text/plain")


TEXT_ENCODING = "utf-8"


OCR_ANSWER: Literal["reject"] = "reject"


DOCX_FORMAT: anydoc.Format = "docx"


ANYDOC_DISTRIBUTION = "firecrawl-anydoc"
PDF_INSPECTOR_DISTRIBUTION = "pdf-inspector"


def converter_pin_of(anydoc_version: str, pdf_inspector_version: str) -> str:
    return f"anydoc-{anydoc_version}+pdf-inspector-{pdf_inspector_version}"


CONVERTER_PIN = converter_pin_of(
    metadata.version(ANYDOC_DISTRIBUTION), metadata.version(PDF_INSPECTOR_DISTRIBUTION)
)


class UnreadableError(Exception):
    def __init__(self, name: str, message: str) -> None:
        super().__init__(message)
        self.name = name


def _unreadable_from(cause: Exception) -> UnreadableError:
    return UnreadableError(type(cause).__name__, str(cause))


BYTES_PER_PAGE = 3107


def pages_of(body: bytes, media_type: str) -> int:
    if media_type == PDF_MEDIA_TYPE:
        return int(_classified(body).page_count)
    return max(1, -(-len(body) // BYTES_PER_PAGE))


def converted(body: bytes, media_type: str) -> str:
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
    classified = _classified(body)
    if classified.pages_needing_ocr:
        raise UnreadableError(
            "NeedsOcrError",
            f"{len(classified.pages_needing_ocr)} of"
            f" {classified.page_count} pages have no text layer",
        )
    try:
        return str(pdf_inspector.process_pdf_bytes(body).markdown)
    except Exception as cause:
        raise _unreadable_from(cause) from cause


def _classified(body: bytes) -> pdf_inspector.PdfClassification:
    try:
        return pdf_inspector.classify_pdf_bytes(body)
    except Exception as cause:
        raise _unreadable_from(cause) from cause


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
