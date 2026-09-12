"""The recognisers this repository writes, and the block rule that outranks a tier.

Presidio's built-ins answer for everything a standard already decides — an email
address, a telephone number a national numbering plan knows, an NHS number with its
mod-11 checksum — and a model answers for what no pattern can bound, a person's name
and their job title. What is left is the four rules below, each of them a United
Kingdom shape a bid library is full of and none of them shipped by anybody:

* a **sort code with an account number** beside it. There is no public checksum for a
  United Kingdom account number, so the pair itself is most of the evidence and the
  words around it are the rest: the pair alone scores under the category's threshold
  and the context enhancer is what carries it over.
* a **date in context**. A bid library is dates all the way down, so a date is only a
  person's date when the words around it say so — the same mechanism, and the reason
  the pattern's own score is deliberately low.
* a **health cue at sentence level**. The span is the sentence and never the word,
  because a cue withheld out of its sentence leaves the sentence saying it anyway. The
  cues are the special-category descriptor's own context lemmas, matched against
  spaCy's lemmas rather than the surface form, so *diagnosed* and *diagnosis* are one
  rule; widening the cue list is an edit to that descriptor and a bump of the rule
  version, which is the point of declaring it there.
* a **home address**, which in the United Kingdom is recognised from the postcode
  outward. A postcode on its own is worth almost nothing — Presidio scores it 0.1, and
  a company's own registered office is an address and not a home one — so the rule is
  the promotion: a postcode with a street line within two lines above it is a home
  address, and the span is the whole of it, from the street number to the end of the
  postcode, because that is what the placeholder stands in for.

**The email built-in is wrapped rather than registered**, which is less a rule of its
own than a narrowing of the first sentence above. A standard decides the shape of an
address and says nothing about whose mailbox is behind it, and whose it is is the whole
of what the default-on tier turns on: a supplier's owner writes from a provider anybody
may open an account with, and the same supplier's bid team writes from the company.
Registered bare, the built-in withholds both, and a reader entitled to the supplier's
own contact details loses them to a rule meant to protect a person. So the wrapper
keeps the answers whose domain is on the consumer-domain list and drops the rest. The
list is part of what the seam withholds and is bumped with the rule version exactly as
a pattern here is.

The **officer block** is the fifth rule and is not a recogniser: it is a post-pass over
whatever the others found, and what it decides is a tier rather than a span. A name
inside a persons-with-significant-control, officers, directors or signatories block is
raised at the always tier whatever a binding says, and takes that tier's word. The
ranges are found here; the pass that reads them lands with the pseudonyms it outranks.

The sixth is the entity-to-category table, which is `descriptors.CATEGORY_BY_ENTITY` —
derived from the declarations rather than written out again.
"""

import re
from abc import abstractmethod
from collections.abc import Iterator, Sequence

from presidio_analyzer import AnalysisExplanation, LocalRecognizer, RecognizerResult
from presidio_analyzer.nlp_engine import NlpArtifacts
from presidio_analyzer.predefined_recognizers import EmailRecognizer

from .consumer_domains import is_a_consumer_address
from .descriptors import CategoryDescriptor

#: A sort code and an account number close enough together to be one instruction: six
#: digits in the three pairs a sort code is written in, then an eight-digit account
#: number within the same sentence. The score is under every threshold on the table on
#: purpose — the words beside the pair are the validator, and the context enhancer is
#: what applies them.
A_SORT_CODE_WITH_AN_ACCOUNT = re.compile(
    r"\b\d{2}[- ]?\d{2}[- ]?\d{2}\b.{0,40}?\b\d{8}\b", re.DOTALL
)
A_PAIR_ON_ITS_OWN = 0.2

#: The date shapes a United Kingdom document writes, long form first because that is
#: what a company filing uses. Scored low for the same reason as the pair above: it is
#: the words beside it that make a date a person's.
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

#: A United Kingdom postcode in any of its formats, and the street line that promotes
#: one. The street words are the long list rather than research 65's short one because
#: *Rise*, *Gate* and *Crescent* are as ordinary as *Street* on a company filing.
A_POSTCODE = re.compile(r"\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b")
A_STREET_LINE = re.compile(
    r"\b\d+[A-Za-z]?\s+(?:[A-Z][a-z]+\s+){1,3}"
    r"(?:Street|Road|Avenue|Lane|Close|Drive|Way|Court|Place|Gardens|Rise|Gate"
    r"|Terrace|Crescent|Grove|Hill|Row|Walk|Mews|Park)\b"
)
A_PROMOTED_POSTCODE = 0.8

#: A cue is the detection here rather than the evidence for one, so the sentence it
#: sits in is raised well clear of the always tier's threshold.
A_SENTENCE_WITH_A_CUE = 0.85

#: Where one sentence ends and the next begins: a full stop, question mark or
#: exclamation mark with whitespace after it, or a blank line between paragraphs.
A_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+|\n\s*\n")

#: The headings that open a block of officers. A name inside one is personal data of a
#: named officer whatever the document is otherwise about.
AN_OFFICER_HEADING = re.compile(
    r"^#{1,6}[^\n]*\b(?:persons? with significant control|officers?|directors?"
    r"|signator(?:y|ies))\b[^\n]*$",
    re.IGNORECASE | re.MULTILINE,
)
ANY_HEADING = re.compile(r"^#{1,6}\s", re.MULTILINE)


class SeamRecogniser(LocalRecognizer):
    """One of this repository's rules, as Presidio's registry expects to hold it.

    A subclass says only where its spans are; everything else — which entity the rule
    answers with, which words the context enhancer boosts a span on, and the metadata
    that lets the enhancer find the rule again after the registry has run it — is read
    off the category descriptor the rule was built from. That is what keeps the
    registry derived from the one declared table rather than a second copy of it.
    """

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
        """Nothing to load: every rule here is a pattern or a list of lemmas."""

    @abstractmethod
    def spans(
        self, text: str, nlp_artifacts: NlpArtifacts | None
    ) -> Iterator[tuple[int, int, float]]:
        """Where this rule fires, as start, end and the score before any context."""

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
            # The enhancer writes into this object when a context word lifts a score,
            # so a result that arrived without one would end the run rather than the
            # rule.
            analysis_explanation=AnalysisExplanation(
                recognizer=self.rule_name, original_score=score
            ),
        )
        # Without this the context enhancer cannot match the result back to the rule
        # that raised it, and every score stays where the pattern left it.
        result.recognition_metadata = {
            RecognizerResult.RECOGNIZER_NAME_KEY: self.rule_name,
            RecognizerResult.RECOGNIZER_IDENTIFIER_KEY: self.id,
        }
        return result


class SortCodeWithAccountRecogniser(SeamRecogniser):
    """A sort code with an account number beside it, waiting on its context words."""

    def spans(
        self, text: str, nlp_artifacts: NlpArtifacts | None
    ) -> Iterator[tuple[int, int, float]]:
        for match in A_SORT_CODE_WITH_AN_ACCOUNT.finditer(text):
            yield match.start(), match.end(), A_PAIR_ON_ITS_OWN


class DateInContextRecogniser(SeamRecogniser):
    """Every date in the document, at a score only its context words can lift."""

    def spans(
        self, text: str, nlp_artifacts: NlpArtifacts | None
    ) -> Iterator[tuple[int, int, float]]:
        for match in A_DATE.finditer(text):
            yield match.start(), match.end(), A_DATE_ON_ITS_OWN


class HealthCueRecogniser(SeamRecogniser):
    """The sentence around a health cue, found by lemma rather than by surface form."""

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
    """A postcode promoted to a home address by the street line above it."""

    def spans(
        self, text: str, nlp_artifacts: NlpArtifacts | None
    ) -> Iterator[tuple[int, int, float]]:
        for postcode in A_POSTCODE.finditer(text):
            opened = two_lines_above(text, postcode.start())
            streets = list(A_STREET_LINE.finditer(text, opened, postcode.start()))
            if streets:
                yield streets[-1].start(), postcode.end(), A_PROMOTED_POSTCODE


class ConsumerEmailRecogniser(SeamRecogniser):
    """An address Presidio matched, kept only where its domain is a consumer provider's.

    The built-in is held rather than subclassed because what is wanted of it is its
    answers and not its pattern. Each answer it keeps is re-made through this rule's
    own result-builder so that the context enhancer can match it back to a recogniser
    the registry actually holds — the built-in, wrapped, is in no registry, and an
    enhancer that cannot find the rule behind a result leaves every score where it was.
    Nothing is lost in the re-making: Presidio scores an address it has validated at its
    maximum, so there is no score left for a context word to lift.
    """

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
    """The sentence one character sits in, trimmed of the whitespace around it."""
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


def two_lines_above(text: str, at: int) -> int:
    """Where the window a street line may sit in opens: two line breaks back."""
    opened = at
    for _ in range(2):
        break_before = text.rfind("\n", 0, opened)
        if break_before == -1:
            return 0
        opened = break_before
    return opened + 1


def officer_blocks(text: str) -> tuple[tuple[int, int], ...]:
    """Every range a persons-with-significant-control or officers heading opens.

    A block runs from its heading to the next heading of any level, or to the end of
    the document. The post-pass that raises a name inside one of these to the always
    tier lands with the pseudonyms it outranks; what is settled here is where the
    ranges are, so that rule and the review screen read the same boundaries.
    """
    blocks: list[tuple[int, int]] = []
    for heading in AN_OFFICER_HEADING.finditer(text):
        following = ANY_HEADING.search(text, heading.end())
        blocks.append((heading.start(), following.start() if following else len(text)))
    return tuple(blocks)
