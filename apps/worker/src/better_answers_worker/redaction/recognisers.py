import re
from abc import abstractmethod
from collections.abc import Iterator, Sequence

from presidio_analyzer import AnalysisExplanation, LocalRecognizer, RecognizerResult
from presidio_analyzer.nlp_engine import NlpArtifacts
from presidio_analyzer.predefined_recognizers import EmailRecognizer

from .consumer_domains import is_a_consumer_address
from .descriptors import CategoryDescriptor

A_SORT_CODE_WITH_AN_ACCOUNT = re.compile(
    r"\b\d{2}[- ]?\d{2}[- ]?\d{2}\b.{0,40}?\b\d{8}\b", re.DOTALL
)
A_PAIR_ON_ITS_OWN = 0.2


_MONTHS = (
    "January|February|March|April|May|June|July|August|September|October|November"
    "|December"
)
A_DATE = re.compile(
    rf"\b(?:\d{{1,2}}\s+(?:{_MONTHS})\s+\d{{4}}"
    rf"|(?:{_MONTHS})\s+\d{{1,2}},?\s+\d{{4}}"
    r"|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b"
)
A_DATE_ON_ITS_OWN = 0.3


A_POSTCODE = re.compile(r"\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b")
A_STREET_LINE = re.compile(
    r"\b\d+[A-Za-z]?\s+(?:[A-Z][a-z]+\s+){1,3}"
    r"(?:Street|Road|Avenue|Lane|Close|Drive|Way|Court|Place|Gardens|Rise|Gate"
    r"|Terrace|Crescent|Grove|Hill|Row|Walk|Mews|Park)\b"
)
A_PROMOTED_POSTCODE = 0.8
LINES_ABOVE_A_POSTCODE = 2


A_SENTENCE_WITH_A_CUE = 0.85


A_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+|\n\s*\n")


AN_OFFICER_HEADING = re.compile(
    r"^#{1,6}[^\n]*\b(?:persons? with significant control|officers?|directors?"
    r"|signator(?:y|ies))\b[^\n]*$",
    re.IGNORECASE | re.MULTILINE,
)
ANY_HEADING = re.compile(r"^#{1,6}\s", re.MULTILINE)


class SeamRecogniser(LocalRecognizer):
    def __init__(self, descriptor: CategoryDescriptor, entity: str) -> None:
        self.descriptor = descriptor
        self.entity = entity
        self.rule_name = f"{entity} (better-answers)"
        super().__init__(
            supported_entities=[entity],
            name=self.rule_name,
            context=list(descriptor.context),
        )

    def load(self) -> None:
        pass

    @abstractmethod
    def spans(
        self, text: str, nlp_artifacts: NlpArtifacts | None
    ) -> Iterator[tuple[int, int, float]]:
        pass

    def analyze(
        self,
        text: str,
        entities: Sequence[str],
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        if self.entity not in entities:
            return []
        return [
            self._found(start, end, score)
            for start, end, score in self.spans(text, nlp_artifacts)
        ]

    def _found(self, start: int, end: int, score: float) -> RecognizerResult:
        result = RecognizerResult(
            entity_type=self.entity,
            start=start,
            end=end,
            score=score,
            analysis_explanation=AnalysisExplanation(
                recognizer=self.rule_name, original_score=score
            ),
        )

        result.recognition_metadata = {
            RecognizerResult.RECOGNIZER_NAME_KEY: self.rule_name,
            RecognizerResult.RECOGNIZER_IDENTIFIER_KEY: self.id,
        }
        return result


class SortCodeWithAccountRecogniser(SeamRecogniser):
    def spans(
        self, text: str, nlp_artifacts: NlpArtifacts | None
    ) -> Iterator[tuple[int, int, float]]:
        for match in A_SORT_CODE_WITH_AN_ACCOUNT.finditer(text):
            yield match.start(), match.end(), A_PAIR_ON_ITS_OWN


class DateInContextRecogniser(SeamRecogniser):
    def spans(
        self, text: str, nlp_artifacts: NlpArtifacts | None
    ) -> Iterator[tuple[int, int, float]]:
        for match in A_DATE.finditer(text):
            yield match.start(), match.end(), A_DATE_ON_ITS_OWN


class HealthCueRecogniser(SeamRecogniser):
    def spans(
        self, text: str, nlp_artifacts: NlpArtifacts | None
    ) -> Iterator[tuple[int, int, float]]:
        if nlp_artifacts is None:
            return
        cues = set(self.descriptor.context)
        raised: set[tuple[int, int]] = set()
        for lemma, at in zip(
            nlp_artifacts.lemmas, nlp_artifacts.tokens_indices, strict=False
        ):
            if lemma.lower() not in cues:
                continue
            sentence = sentence_around(text, at)
            if sentence not in raised:
                raised.add(sentence)
                yield sentence[0], sentence[1], A_SENTENCE_WITH_A_CUE


class HomeAddressRecogniser(SeamRecogniser):
    def spans(
        self, text: str, nlp_artifacts: NlpArtifacts | None
    ) -> Iterator[tuple[int, int, float]]:
        for postcode in A_POSTCODE.finditer(text):
            opened = lines_above_a_postcode(text, postcode.start())
            streets = list(A_STREET_LINE.finditer(text, opened, postcode.start()))
            if streets:
                yield streets[-1].start(), postcode.end(), A_PROMOTED_POSTCODE


class ConsumerEmailRecogniser(SeamRecogniser):
    def __init__(self, descriptor: CategoryDescriptor, entity: str) -> None:
        super().__init__(descriptor, entity)
        self.built_in = EmailRecognizer(context=list(descriptor.context))

    def spans(
        self, text: str, nlp_artifacts: NlpArtifacts | None
    ) -> Iterator[tuple[int, int, float]]:
        for found in self.built_in.analyze(text, [self.entity], nlp_artifacts):
            start, end = int(found.start), int(found.end)
            if is_a_consumer_address(text[start:end]):
                yield start, end, float(found.score)


def sentence_around(text: str, at: int) -> tuple[int, int]:
    start = 0
    end = len(text)
    for like_a_full_stop in A_SENTENCE_BREAK.finditer(text):
        if like_a_full_stop.end() <= at:
            start = like_a_full_stop.end()
        elif like_a_full_stop.start() > at:
            end = like_a_full_stop.start()
            break
    sentence = text[start:end]
    return start + len(sentence) - len(sentence.lstrip()), end - (
        len(sentence) - len(sentence.rstrip())
    )


def lines_above_a_postcode(text: str, at: int) -> int:
    opened = at
    for _ in range(LINES_ABOVE_A_POSTCODE):
        break_before = text.rfind("\n", 0, opened)
        if break_before == -1:
            return 0
        opened = break_before
    return opened + 1


def officer_blocks(text: str) -> tuple[tuple[int, int], ...]:
    blocks: list[tuple[int, int]] = []
    for heading in AN_OFFICER_HEADING.finditer(text):
        following = ANY_HEADING.search(text, heading.end())
        blocks.append((heading.start(), following.start() if following else len(text)))
    return tuple(blocks)
