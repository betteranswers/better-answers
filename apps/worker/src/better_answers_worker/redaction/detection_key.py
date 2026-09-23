import hashlib
import json
import re
from collections.abc import Collection, Sequence
from dataclasses import asdict, dataclass
from functools import cache

from .consumer_domains import CONSUMER_DOMAINS
from .descriptors import DESCRIPTORS, CategoryDescriptor
from .engine import (
    GLINER_LABELS,
    PHONE_LENIENCY,
    PHONE_REGIONS,
    RECOGNISERS,
    WINDOWS_A_RUN_IS_READ_WHOLE_IN,
    AnchoredWindows,
    ModelRecogniser,
)
from .pins import DETECTOR_PIN
from .recognisers import (
    A_DATE,
    A_DATE_ON_ITS_OWN,
    A_PAIR_ON_ITS_OWN,
    A_POSTCODE,
    A_PROMOTED_POSTCODE,
    A_SENTENCE_BREAK,
    A_SENTENCE_WITH_A_CUE,
    A_SORT_CODE_WITH_AN_ACCOUNT,
    A_STREET_LINE,
    LINES_ABOVE_A_POSTCODE,
)

RAISED_BY_THE_MODEL = ModelRecogniser.__name__


# The officers-block rule reads the text on the finding side, after the detector has
# answered, so a fix to it re-detects nothing.
RAISED_AFTER_THE_DETECTOR: tuple[str, ...] = ("AN_OFFICER_HEADING", "ANY_HEADING")


def as_read(value: re.Pattern[str] | int | float | str) -> str:
    if isinstance(value, re.Pattern):
        return f"{value.pattern} flags={value.flags}"
    return str(value)


DETECTOR_LITERALS: tuple[tuple[str, str], ...] = (
    ("A_DATE", as_read(A_DATE)),
    ("A_DATE_ON_ITS_OWN", as_read(A_DATE_ON_ITS_OWN)),
    ("A_PAIR_ON_ITS_OWN", as_read(A_PAIR_ON_ITS_OWN)),
    ("A_POSTCODE", as_read(A_POSTCODE)),
    ("A_PROMOTED_POSTCODE", as_read(A_PROMOTED_POSTCODE)),
    ("A_SENTENCE_BREAK", as_read(A_SENTENCE_BREAK)),
    ("A_SENTENCE_WITH_A_CUE", as_read(A_SENTENCE_WITH_A_CUE)),
    ("A_SORT_CODE_WITH_AN_ACCOUNT", as_read(A_SORT_CODE_WITH_AN_ACCOUNT)),
    ("A_STREET_LINE", as_read(A_STREET_LINE)),
    ("GLINER_LABELS", str(sorted(GLINER_LABELS.items()))),
    ("LINES_ABOVE_A_POSTCODE", as_read(LINES_ABOVE_A_POSTCODE)),
    ("PHONE_LENIENCY", as_read(PHONE_LENIENCY)),
    ("PHONE_REGIONS", str(sorted(PHONE_REGIONS))),
)


@dataclass(frozen=True, slots=True)
class RuleReading:
    rule_id: str
    recogniser: str
    threshold: float
    context: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class DetectorReading:
    detector_pin: str
    rules: tuple[RuleReading, ...]
    consumer_domains: tuple[str, ...]
    literals: tuple[tuple[str, str], ...]
    window_rule: tuple[tuple[str, str], ...]


def reading_of(rule_id: str, descriptor: CategoryDescriptor) -> RuleReading:
    build = RECOGNISERS.get(rule_id)
    if build is None:
        # The model recogniser is handed no context, so a model-raised rule's lemmas
        # reach no enhancer and are read by nothing.
        return RuleReading(
            rule_id=rule_id,
            recogniser=RAISED_BY_THE_MODEL,
            threshold=descriptor.threshold,
            context=(),
        )
    return RuleReading(
        rule_id=rule_id,
        recogniser=type(build(descriptor)).__name__,
        threshold=descriptor.threshold,
        context=tuple(sorted(descriptor.context)),
    )


def rules_read_by(descriptors: Sequence[CategoryDescriptor]) -> tuple[RuleReading, ...]:
    return tuple(
        sorted(
            (
                reading_of(rule_id, descriptor)
                for descriptor in descriptors
                for rule_id in descriptor.raised_by
            ),
            key=lambda reading: reading.rule_id,
        )
    )


def window_rule_read_by_the_model() -> tuple[tuple[str, str], ...]:
    windows = AnchoredWindows()
    return (
        ("WINDOWS_A_RUN_IS_READ_WHOLE_IN", as_read(WINDOWS_A_RUN_IS_READ_WHOLE_IN)),
        ("chunk_size", as_read(windows.chunk_size)),
        ("chunk_overlap", as_read(windows.chunk_overlap)),
        ("boundary_chars", "".join(sorted(windows.boundary_chars))),
    )


def what_the_detector_reads(
    descriptors: Sequence[CategoryDescriptor] = DESCRIPTORS,
    consumer_domains: Collection[str] = CONSUMER_DOMAINS,
) -> DetectorReading:
    return DetectorReading(
        detector_pin=DETECTOR_PIN,
        rules=rules_read_by(descriptors),
        consumer_domains=tuple(sorted(consumer_domains)),
        literals=DETECTOR_LITERALS,
        window_rule=window_rule_read_by_the_model(),
    )


def canonically(reading: DetectorReading) -> str:
    return json.dumps(asdict(reading), sort_keys=True)


def detection_key_of(reading: DetectorReading) -> str:
    return hashlib.sha256(canonically(reading).encode("utf-8")).hexdigest()


@cache
def detection_key() -> str:
    return detection_key_of(what_the_detector_reads())
