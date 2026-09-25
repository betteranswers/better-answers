from contextvars import ContextVar
from dataclasses import dataclass

import cocoindex as coco

from ..redaction.engine import Span, spans_detected

# Read in place of the body's syntax tree, so a body edit is a non-event and a bump is
# a reprocess somebody chose.
THE_MEMOS_VERSION = 1


@dataclass(frozen=True, slots=True)
class Raised:
    """`afresh` is True when the detector read
    the text, and False when the memo answered."""

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
    """`detection_key` is never read by the detector: it
    keys the memo, so moving it detects every text afresh."""
    # A missed body runs inline on this thread, so it appends here; a hit leaves it
    # empty.
    read: list[bool] = []
    token = _READ_AFRESH.set(read)
    try:
        spans = detected(normalised_text, detection_key)
    finally:
        _READ_AFRESH.reset(token)
    return Raised(spans=tuple(spans), afresh=bool(read))


# Read off the function the engine fingerprints: a literal here would let a rename move
# the memo while the suite still read the old word.
THE_MEMOS_MODULE: str = detected._fn.__module__
THE_MEMOS_NAME: str = detected._fn.__qualname__
