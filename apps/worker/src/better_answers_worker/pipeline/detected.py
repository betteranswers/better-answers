from contextvars import ContextVar
from dataclasses import dataclass

import cocoindex as coco

from ..redaction.engine import Span, spans_detected

# cocoindex keys the memo on this version instead of the function body. Editing the
# body reprocesses no document. Bump the version to reprocess every document.
THE_MEMOS_VERSION = 1


@dataclass(frozen=True, slots=True)
class Raised:
    spans: tuple[Span, ...]
    afresh: bool


_READ_AFRESH: ContextVar[list[bool] | None] = ContextVar(
    "the detector read this text", default=None
)


@coco.fn(memo=True, version=THE_MEMOS_VERSION)
def detected(normalised_text: str, detection_key: str) -> tuple[Span, ...]:
    read = _READ_AFRESH.get()
    if read is not None:
        read.append(True)
    return spans_detected(normalised_text)


def raised_by_the_detector(normalised_text: str, detection_key: str) -> Raised:
    # On a memo miss, cocoindex runs `detected` on this thread, and `detected` appends
    # to `read`. A memo hit leaves `read` empty.
    read: list[bool] = []
    token = _READ_AFRESH.set(read)
    try:
        spans = detected(normalised_text, detection_key)
    finally:
        _READ_AFRESH.reset(token)
    return Raised(spans=tuple(spans), afresh=bool(read))


THE_MEMOS_MODULE: str = detected._fn.__module__
THE_MEMOS_NAME: str = detected._fn.__qualname__
