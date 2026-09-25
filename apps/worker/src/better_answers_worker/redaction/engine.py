from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import TYPE_CHECKING

from .descriptors import CATEGORY_BY_ENTITY, DESCRIPTORS, CategoryDescriptor
from .pins import GLINER_MODEL_ID, SPACY_MODEL

# Presidio drags spaCy and torch behind it, three seconds warm. A pass that redacts
# nothing must not pay for the import.
if TYPE_CHECKING:
    from presidio_analyzer import AnalyzerEngine, EntityRecognizer, RecognizerResult

GLINER_LABELS: Mapping[str, str] = MappingProxyType(
    {"person": "PERSON", "job title": "JOB_TITLE"}
)


DESCRIPTOR_BY_CATEGORY: Mapping[str, CategoryDescriptor] = MappingProxyType(
    {descriptor.category: descriptor for descriptor in DESCRIPTORS}
)
DESCRIPTOR_BY_ENTITY: Mapping[str, CategoryDescriptor] = MappingProxyType(
    {
        entity: descriptor
        for descriptor in DESCRIPTORS
        for entity in descriptor.raised_by
    }
)


ANALYSED_ENTITIES: tuple[str, ...] = tuple(sorted(CATEGORY_BY_ENTITY))


ALWAYS_TIER = "always"


TIER_PRECEDENCE: Mapping[str, int] = MappingProxyType(
    {ALWAYS_TIER: 0, "default-on": 1, "default-off": 2}
)


@dataclass(frozen=True, slots=True)
class Span:
    rule_id: str
    start: int
    end: int
    score: float


@dataclass(frozen=True, slots=True)
class Finding:
    category: str
    tier: str
    rule_id: str
    start: int
    end: int
    score: float


def raised_to_always(
    findings: Sequence[Finding], outranked: Callable[[Finding], bool]
) -> tuple[Finding, ...]:
    return tuple(
        replace(finding, tier=ALWAYS_TIER) if outranked(finding) else finding
        for finding in findings
    )


def refuse_unreachable_entities(
    entity_table: Mapping[str, CategoryDescriptor],
    labels: Mapping[str, str],
) -> None:
    """Raises `ValueError` naming each entity nothing
    raises and each model label no descriptor declares."""
    # Only the builder below and its suite ask this, so the stack arrives here rather
    # than at the top.
    from .detector import RECOGNISERS

    asked_of_the_model = set(labels.values())
    faults: list[str] = []
    unreachable = sorted(
        entity
        for entity in entity_table
        if entity not in RECOGNISERS and entity not in asked_of_the_model
    )
    if unreachable:
        faults.append(
            "the category table declares entities nothing raises: "
            + ", ".join(unreachable)
        )
    undeclared = sorted(
        entity for entity in asked_of_the_model if entity not in entity_table
    )
    if undeclared:
        faults.append(
            "the model is asked for entities no descriptor declares: "
            + ", ".join(undeclared)
        )
    if faults:
        raise ValueError("; ".join(faults))


def build_analyzer(model_id: str = GLINER_MODEL_ID) -> "AnalyzerEngine":
    """A new engine each call, loading spaCy and the
    model; `analyzer` holds one for the process."""
    from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
    from presidio_analyzer.nlp_engine import NlpEngineProvider

    from .detector import RECOGNISERS, ModelRecogniser

    refuse_unreachable_entities(DESCRIPTOR_BY_ENTITY, GLINER_LABELS)
    recognisers: list[EntityRecognizer] = [
        RECOGNISERS[entity](descriptor)
        for entity, descriptor in DESCRIPTOR_BY_ENTITY.items()
        if entity in RECOGNISERS
    ]
    recognisers.append(
        ModelRecogniser(
            labels=GLINER_LABELS,
            model_name=model_id,
            threshold=min(
                DESCRIPTOR_BY_ENTITY[entity].threshold
                for entity in GLINER_LABELS.values()
            ),
        )
    )
    nlp = NlpEngineProvider(
        nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": SPACY_MODEL}],
        }
    ).create_engine()
    return AnalyzerEngine(
        registry=RecognizerRegistry(recognizers=recognisers),
        nlp_engine=nlp,
        supported_languages=["en"],
    )


_ANALYZER: "AnalyzerEngine | None" = None


def analyzer() -> "AnalyzerEngine":
    global _ANALYZER
    if _ANALYZER is None:
        _ANALYZER = build_analyzer()
    return _ANALYZER


def spans_detected(text: str) -> tuple[Span, ...]:
    """Spans at or above their rule's threshold, in offset
    order. The first call loads the detector's stack."""
    # No category and no tier: caching a pure function of the rule id would put the
    # category table in the memo's key.
    raised = [
        span
        for span in (
            _span_of(result)
            for result in analyzer().analyze(
                text=text, language="en", entities=list(ANALYSED_ENTITIES)
            )
        )
        if span is not None
    ]
    return tuple(sorted(raised, key=lambda it: (it.start, it.end, it.rule_id)))


def findings_of(spans: Sequence[Span]) -> tuple[Finding, ...]:
    return tuple(
        Finding(
            category=DESCRIPTOR_BY_ENTITY[span.rule_id].category,
            tier=DESCRIPTOR_BY_ENTITY[span.rule_id].tier,
            rule_id=span.rule_id,
            start=span.start,
            end=span.end,
            score=span.score,
        )
        for span in spans
    )


def _span_of(result: "RecognizerResult") -> Span | None:
    descriptor = DESCRIPTOR_BY_ENTITY.get(result.entity_type)
    if descriptor is None or result.score < descriptor.threshold:
        return None
    return Span(
        rule_id=result.entity_type,
        start=result.start,
        end=result.end,
        score=result.score,
    )
