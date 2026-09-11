"""The analyzer the seam runs, assembled from the one declared table of categories.

Nothing here decides anything about a category. Which entity raises it, how sure the
answer has to be and which words lift a score are all read off `descriptors.py`, and a
recogniser this module cannot find a declaration for is an error at build time rather
than a rule that quietly stops firing. That is what "the registry derives from the
table" means in practice: the registry is a list comprehension over the declarations.

**What is in the registry, and what is deliberately not.** It is built from nothing
rather than from Presidio's predefined set, so spaCy's own NER recogniser is never in
it — spaCy is here for tokenisation and the lemmas the context enhancer reads, and its
NER was weighed against GLiNER in ADR 0020 and lost. The phone recogniser is restricted
to the two numbering plans this estate's documents use, at the leniency that still sees
a number a numbering plan has reserved rather than assigned. Presidio's United Kingdom
built-ins answer for the government identifiers. The four rules of ours answer for the
United Kingdom shapes nobody ships.

**What the model is asked for, and why it is so little.** GLiNER answers for a person's
name and their job title, and for nothing else on the table. Every other category has a
shape a pattern can bound — an address from its street line to its postcode, a sort
code with its account number, a date, an email, a telephone number, an NHS number with
its checksum — and where a pattern can bound the span, the pattern decides, because the
recall the fixture proves must not move the next time a model does. The evidence for
drawing the line there is the model's own answers on that fixture: asked for dates of
birth it returned three tender dates from a contract-history paragraph, and asked for
addresses it returned the reference of an architecture decision record. Asked only for
names and titles it is the best thing available, which is the tier a binding has to
switch on before any of it is written out of the text.

**The analyzer is loaded once per process, and that is a resource and not a memo.** The
model is hundreds of megabytes of weights and takes seconds to bring up; holding one
copy of it is the same kind of decision as holding one connection pool. It is not a
cache of any answer: no text, no result and no document identifier is kept between
calls, so two calls with the same text do the whole of the work twice and agree because
the rules are the same, not because the second one was served from anywhere. The one
memoised function in this estate is the pipeline's, it wraps this seam from outside,
and its key is the version string rather than anything held here (ADR 0036).
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from types import MappingProxyType

from presidio_analyzer import (
    AnalyzerEngine,
    EntityRecognizer,
    RecognizerRegistry,
    RecognizerResult,
)
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

#: The two numbering plans this estate's documents write telephone numbers in.
PHONE_REGIONS = ("GB", "US")

#: `phonenumbers`' loosest reading, which is the only one that sees a number from a
#: range a regulator has reserved and never assigned — the range every fixture and
#: every test document in this repository is written in (ADR 0027). The score it comes
#: back with is far under the category's threshold, so it is the words beside the
#: number that decide, exactly as they do for the other two patterns of ours.
PHONE_LENIENCY = 0

#: What the model's rule is called in the registry and in a decision process, spelled
#: here rather than read back off the recogniser it wraps.
MODEL_RULE_NAME = "GLiNER (better-answers)"

#: The labels asked of the model, and the entity each answer is read as. Two, for the
#: reason the module docblock gives, and both of them entities the table declares.
GLINER_LABELS: Mapping[str, str] = MappingProxyType(
    {"person": "PERSON", "job title": "JOB_TITLE"}
)

#: Every category by its name, and every descriptor by the entity that raises it: the
#: two readings of the one table that the steps below need.
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

#: What the analyzer is asked for, which is everything the table declares and nothing
#: else: an entity with no category has no word to be written out as.
ANALYSED_ENTITIES: tuple[str, ...] = tuple(sorted(CATEGORY_BY_ENTITY))

#: The tier no binding switches off, named once here so that the two post-passes which
#: raise a finding to it and the rule that reads a placeholder off it cannot spell it
#: differently from one another.
ALWAYS_TIER = "always"

#: Which tier outranks which when two spans overlap. The always tier wins because it is
#: the tier no binding switches off, so a span it claimed must not be written out under
#: a word a binding could have turned off.
TIER_PRECEDENCE: Mapping[str, int] = MappingProxyType(
    {ALWAYS_TIER: 0, "default-on": 1, "default-off": 2}
)

#: One factory per entity a recogniser of ours or a built-in answers for. The rest of
#: the table is the model's, and an entity in neither is a declaration nobody can act
#: on. An email address is the one entry that is both: the built-in finds the address
#: and a rule of ours decides whether the domain it sits at is a person's own provider,
#: because the shape of an address is all a standard settles and whose mailbox it is is
#: what the tier is about. This entry is the whole of that surface — the model is never
#: asked for an email — so the list is reached from here and from nowhere else.
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


class ModelRecogniser(EntityRecognizer):
    """GLiNER, asked for the labels the table maps and for nothing else.

    Presidio's own wrapper treats every entity the analyzer is asked for as one more
    label to put to the model, because the model is zero-shot and will answer for any
    words at all. On this table that is a trap: asked for a home address it named the
    reference of an architecture decision record, asked for a sort code it named the
    phrase *project account*, and asked for an NHS number it named the three letters.
    Each of those came back above the category's threshold and would have been written
    out of the document. So the analyzer's list is narrowed here to the entities the
    mapping actually covers, and the model is never asked a question the mapping has no
    answer for.
    """

    def __init__(
        self, labels: Mapping[str, str], model_name: str, threshold: float
    ) -> None:
        self.gliner = GLiNERRecognizer(
            model_name=model_name,
            map_location="cpu",
            threshold=threshold,
            entity_mapping=dict(labels),
        )
        super().__init__(
            supported_entities=sorted(set(labels.values())),
            name=MODEL_RULE_NAME,
        )

    def load(self) -> None:
        """Nothing: the recogniser inside this one loads in its own constructor."""

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
    """One span the seam raised, as the row the app will later review it through.

    The offsets are code points into the text the seam was given and never into the
    text it returns, and the rule id is the entity the recogniser answered with, which
    is the name the category's declaration raises it under.
    """

    category: str
    tier: str
    rule_id: str
    start: int
    end: int
    score: float


def raised_to_always(
    findings: Sequence[Finding], outranked: Callable[[Finding], bool]
) -> tuple[Finding, ...]:
    """Every finding a post-pass claims, at the tier no binding switches off.

    Two rules outrank the tier a category is ordinarily raised at — a name inside an
    officers block, and an identifier an erasure request suppressed — and each does the
    same single thing to a finding, which is why both do it through here: a pass that
    raised a tier its own way could come to disagree with the other about what the
    always tier is. Nothing else about the finding moves. The category, the span and the
    score stay what the recogniser answered, because they are the row an Admin reviews
    and the evidence the erasure map is read from; what the tier decides is only whether
    a binding is allowed a say in writing the span out.
    """
    return tuple(
        replace(finding, tier=ALWAYS_TIER) if outranked(finding) else finding
        for finding in findings
    )


def build_analyzer(model_id: str = GLINER_MODEL_ID) -> AnalyzerEngine:
    """The analyzer, assembled once from the declarations and the pinned model.

    The model is a defaulted argument and not a second table: every caller in the tier
    takes the default, which is the pin, and the two that do not are the image's weight
    fetch and S0's measurement (`T-122`). Both want the whole analyzer — the same
    registry, the same recognisers, the same thresholds — with one thing different, and
    a measurement of two models through two registries would be a measurement of the
    registries. Nothing downstream of here knows which model answered: `analyzer()`,
    `detect()` and `redact()` are unchanged, and the version string still names the pin.
    """
    recognisers: list[EntityRecognizer] = []
    unreachable: list[str] = []
    for entity, descriptor in DESCRIPTOR_BY_ENTITY.items():
        build = RECOGNISERS.get(entity)
        if build is not None:
            recognisers.append(build(descriptor))
        elif entity not in GLINER_LABELS.values():
            unreachable.append(entity)
    if unreachable:
        raise ValueError(
            "the category table declares entities nothing raises: "
            + ", ".join(sorted(unreachable))
        )
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
    """The one analyzer this process runs, brought up the first time it is asked for.

    A resource, not a memo: see the module docblock. It is built lazily so that
    importing the seam — which the tier does to read a constant off it — does not pull
    hundreds of megabytes of weights into a process that will never detect anything.
    """
    global _ANALYZER
    if _ANALYZER is None:
        _ANALYZER = build_analyzer()
    return _ANALYZER


def detect(text: str) -> tuple[Finding, ...]:
    """Every span the rules raise in one document's normalised text, in reading order.

    Overlaps are resolved here rather than left to the caller: two rules that claim the
    same run of characters would otherwise write two placeholders over one span, and
    which of them survived would depend on the order the registry happened to answer
    in. The tier decides first, then the longer span, then the surer answer — so a
    health sentence keeps the name inside it, and the name is not written out twice.
    """
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
    return _without_overlaps(raised)


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


def _without_overlaps(raised: list[Finding]) -> tuple[Finding, ...]:
    taken: list[Finding] = []
    for finding in sorted(raised, key=_precedence):
        if any(
            finding.start < other.end and other.start < finding.end for other in taken
        ):
            continue
        taken.append(finding)
    return tuple(sorted(taken, key=lambda it: (it.start, it.end, it.rule_id)))


def _precedence(finding: Finding) -> tuple[int, int, float, int, str]:
    return (
        TIER_PRECEDENCE[finding.tier],
        finding.start - finding.end,
        -finding.score,
        finding.start,
        finding.rule_id,
    )
