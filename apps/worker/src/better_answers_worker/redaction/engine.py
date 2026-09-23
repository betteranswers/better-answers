from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from itertools import pairwise
from types import MappingProxyType

from presidio_analyzer import (
    AnalyzerEngine,
    EntityRecognizer,
    RecognizerRegistry,
    RecognizerResult,
)
from presidio_analyzer.chunkers import CharacterBasedTextChunker, TextChunk
from presidio_analyzer.nlp_engine import NlpArtifacts, NlpEngineProvider
from presidio_analyzer.predefined_recognizers import (
    GLiNERRecognizer,
    NhsRecognizer,
    PhoneRecognizer,
    UkNinoRecognizer,
)

from .descriptors import CATEGORY_BY_ENTITY, DESCRIPTORS, CategoryDescriptor
from .pins import GLINER_MODEL_ID, SPACY_MODEL
from .recognisers import (
    ConsumerEmailRecogniser,
    DateInContextRecogniser,
    HealthCueRecogniser,
    HomeAddressRecogniser,
    SortCodeWithAccountRecogniser,
)

PHONE_REGIONS = ("GB", "US")


PHONE_LENIENCY = 0


MODEL_RULE_NAME = "GLiNER (better-answers)"


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


RECOGNISERS: Mapping[str, Callable[[CategoryDescriptor], EntityRecognizer]] = (
    MappingProxyType(
        {
            "EMAIL_ADDRESS": lambda it: ConsumerEmailRecogniser(it, "EMAIL_ADDRESS"),
            "PHONE_NUMBER": lambda it: PhoneRecognizer(
                supported_regions=PHONE_REGIONS,
                leniency=PHONE_LENIENCY,
                context=list(it.context),
            ),
            "UK_NHS": lambda it: NhsRecognizer(context=list(it.context)),
            "UK_NINO": lambda it: UkNinoRecognizer(context=list(it.context)),
            "UK_BANK_ACCOUNT": lambda it: SortCodeWithAccountRecogniser(
                it, "UK_BANK_ACCOUNT"
            ),
            "DATE_OF_BIRTH": lambda it: DateInContextRecogniser(it, "DATE_OF_BIRTH"),
            "HEALTH_CUE": lambda it: HealthCueRecogniser(it, "HEALTH_CUE"),
            "UK_HOME_ADDRESS": lambda it: HomeAddressRecogniser(it, "UK_HOME_ADDRESS"),
        }
    )
)


WINDOWS_A_RUN_IS_READ_WHOLE_IN = 2


class AnchoredWindows(CharacterBasedTextChunker):
    def chunk(self, text: str) -> list[TextChunk]:
        if not text:
            return []
        windows: list[TextChunk] = []
        for begins, ends in self._runs_under_each_heading(text):
            windows.extend(self._windows_in(text, begins, ends))
        return windows

    def _read_whole_to(self) -> int:
        return self.chunk_size * WINDOWS_A_RUN_IS_READ_WHOLE_IN

    def _runs_under_each_heading(self, text: str) -> list[tuple[int, int]]:

        begins = sorted({0} | self._headings_in(text))
        return list(zip(begins, [*begins[1:], len(text)], strict=True))

    def _headings_in(self, text: str) -> set[int]:

        headings: set[int] = set()
        fenced = False
        at = 0
        for line in text.splitlines(keepends=True):
            if line.lstrip().startswith(("```", "~~~")):
                fenced = not fenced
            elif not fenced and line.startswith("#"):
                headings.add(at)
            at += len(line)
        return headings

    def _windows_in(self, text: str, begins: int, ends: int) -> list[TextChunk]:
        if ends - begins <= self._read_whole_to():
            return [TextChunk(text=text[begins:ends], start=begins, end=ends)]

        cuts = [begins, *self._paragraphs_in(text, begins, ends), ends]
        windows: list[TextChunk] = []
        for opens, closes in pairwise(cuts):
            if closes - opens <= self._read_whole_to():
                windows.append(
                    TextChunk(text=text[opens:closes], start=opens, end=closes)
                )
            else:
                windows.extend(self._stepped_through(text, opens, closes))
        return windows

    def _paragraphs_in(self, text: str, begins: int, ends: int) -> list[int]:
        starts: list[int] = []
        at = text.find("\n\n", begins)
        while at != -1 and at + 2 < ends:
            starts.append(at + 2)
            at = text.find("\n\n", at + 2)
        return starts

    def _stepped_through(self, text: str, begins: int, ends: int) -> list[TextChunk]:

        windows: list[TextChunk] = []
        start = begins
        while start < ends:
            end = min(start + self.chunk_size, ends)
            while end < ends and text[end] not in self.boundary_chars:
                end += 1
            windows.append(TextChunk(text=text[start:end], start=start, end=end))
            if end >= ends:
                break

            stepped = self._word_containing(text, end - self.chunk_overlap)
            # Never past the window it steps from: a run longer than the overlap with no
            # boundary would send the start backwards and the loop nowhere.
            start = end if stepped <= start else stepped
        return windows

    def _word_containing(self, text: str, at: int) -> int:

        start = at
        while start > 0 and text[start - 1] not in self.boundary_chars:
            start -= 1
        return start


class ModelRecogniser(EntityRecognizer):
    def __init__(
        self, labels: Mapping[str, str], model_name: str, threshold: float
    ) -> None:
        self.gliner = GLiNERRecognizer(
            model_name=model_name,
            map_location="cpu",
            threshold=threshold,
            entity_mapping=dict(labels),
            text_chunker=AnchoredWindows(),
        )
        super().__init__(
            supported_entities=sorted(set(labels.values())),
            name=MODEL_RULE_NAME,
        )

    def load(self) -> None:
        pass

    def analyze(
        self,
        text: str,
        entities: Sequence[str],
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        asked = [
            entity for entity in entities if entity in set(self.supported_entities)
        ]
        if not asked:
            return []
        return list(self.gliner.analyze(text, asked, nlp_artifacts))


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


def build_analyzer(model_id: str = GLINER_MODEL_ID) -> AnalyzerEngine:
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


_ANALYZER: AnalyzerEngine | None = None


def analyzer() -> AnalyzerEngine:
    global _ANALYZER
    if _ANALYZER is None:
        _ANALYZER = build_analyzer()
    return _ANALYZER


def detect(text: str) -> tuple[Finding, ...]:
    raised = [
        finding
        for finding in (
            _finding_of(result)
            for result in analyzer().analyze(
                text=text, language="en", entities=list(ANALYSED_ENTITIES)
            )
        )
        if finding is not None
    ]
    return tuple(sorted(raised, key=lambda it: (it.start, it.end, it.rule_id)))


def _finding_of(result: RecognizerResult) -> Finding | None:
    descriptor = DESCRIPTOR_BY_ENTITY.get(result.entity_type)
    if descriptor is None or result.score < descriptor.threshold:
        return None
    return Finding(
        category=descriptor.category,
        tier=descriptor.tier,
        rule_id=result.entity_type,
        start=result.start,
        end=result.end,
        score=result.score,
    )
