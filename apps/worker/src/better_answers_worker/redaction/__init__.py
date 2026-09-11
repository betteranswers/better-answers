"""The redaction seam: what a document's text must not carry past this point.

The package is one module from the outside. Its one public function takes the
normalised text of a document, the rules in force on its binding, the suppressions that
apply to it and a per-binding seed, and answers the redacted text with the findings,
the counts, the narrowing verdict and the version string. It reads nothing but its
arguments and memoises nothing: the memoised wrap around it belongs to the pipeline,
and a seam that cached anything of its own would be a second cache with a second
lifetime. The analyzer it runs is brought up once per process, which is a resource and
not a memo — `engine.py` says why at length.

**A finding and a withholding are two different things.** Every span the rules raise is
a finding, whatever the binding says, because a finding is the row an Admin reviews and
the evidence the erasure map is read from. What the binding decides is which of those
findings are written out of the text: the always tier always, the two switchable tiers
as the binding's own column says. So a name left in the text on a bid library is still
a finding, and switching that tier on later withholds it without re-detecting anything.

**The placeholder follows the tier the finding was raised at, not its category.** The
always tier has one neutral word for everything in it, because a typed placeholder for
that set would tell the audience what class of data the document held; the two
switchable tiers say what was taken, because a reader has to know that a way of
reaching somebody was removed rather than a name.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType

from .descriptors import A_PERSON_NAME, DESCRIPTORS
from .engine import ALWAYS_TIER, DESCRIPTOR_BY_CATEGORY, Finding, detect
from .officers import raised_by_the_block_rule
from .pins import VERSION_STRING
from .pseudonyms import normalised, pseudonyms_for, written_as
from .suppressions import raised_by_a_suppression

#: Each tier a binding can switch, as the key it is switched by on `source_binding` and
#: what an unconfigured binding does with it. The always tier is not here because it is
#: not switchable: that is the whole of what "always" means.
SWITCHABLE_TIERS: Mapping[str, tuple[str, bool]] = MappingProxyType(
    {"default-on": ("default_on", True), "default-off": ("default_off", False)}
)

#: The one word the always tier is written out as, taken from the declarations rather
#: than spelled again here. Every category in that tier declares the same word, and a
#: table where they did not would be a table that could not keep this promise.
ALWAYS_PLACEHOLDER = next(
    iter({item.placeholder for item in DESCRIPTORS if item.tier == ALWAYS_TIER})
)


@dataclass(frozen=True, slots=True)
class Redaction:
    """What the seam answers: one document read two ways, and what it cost to read it.

    `text` is the document with every withheld span replaced; `findings` are offsets
    into the text the seam was **given**, whose length differs from `text` by every
    placeholder written. `verdict` is the sensitivity this document must be narrowed
    to, or nothing when no finding narrows it, and `version` is what rides on every
    finding row so a re-detection can tell what moved.
    """

    text: str
    findings: tuple[Finding, ...]
    counts: Mapping[str, int]
    verdict: str | None
    version: str


def redact(
    text: str,
    rules_in_force: Mapping[str, bool],
    suppressions: Sequence[Mapping[str, Sequence[str]]],
    seed: str,
) -> Redaction:
    """One document's text, with what its binding withholds written out of it.

    `rules_in_force` is the shape of the `source_binding` column: a flag per switchable
    tier, and a key it does not carry takes the safe set's answer, so a binding nobody
    configured withholds more rather than less. `suppressions` are the identifier sets
    of the erasure requests that reach this document, each of them the shape the
    `subject_request` row holds, and `seed` is the binding's own, from which a name's
    pseudonym is drawn. Both are taken here and given effect by the rules that read
    them: a suppressed identifier is raised at the always tier, and a name is written
    as a stable letter.

    Plain types in and plain types out, and nothing read that was not passed in.
    """
    # Two post-passes over one detection, each of which only ever raises a tier, so the
    # order they run in cannot change the answer. The letters are drawn afterwards and
    # over every name the document holds, whatever tier it ended at: a name that gives
    # up its place in the queue when it is withheld would move everybody met after it
    # onto a different letter, and a suppression has to change the output for the person
    # it names and for nobody else.
    findings = raised_by_a_suppression(
        raised_by_the_block_rule(detect(text), text), text, suppressions
    )
    letters = pseudonyms_for(_names_in(text, findings), seed)
    withheld = tuple(
        finding for finding in findings if _in_force(finding.tier, rules_in_force)
    )
    return Redaction(
        text=_written(text, withheld, letters),
        findings=findings,
        counts=_counted(findings),
        verdict=_verdict_of(findings),
        version=VERSION_STRING,
    )


def _in_force(tier: str, rules_in_force: Mapping[str, bool]) -> bool:
    switch = SWITCHABLE_TIERS.get(tier)
    if switch is None:
        return True
    key, unconfigured = switch
    return rules_in_force.get(key, unconfigured)


def _names_in(text: str, findings: Sequence[Finding]) -> tuple[str, ...]:
    # Every person-name finding, in reading order and whatever tier it ended up at, so
    # that the queue a letter is drawn from is the document's and neither the binding's
    # nor an erasure request's.
    return tuple(
        text[finding.start : finding.end]
        for finding in findings
        if finding.category == A_PERSON_NAME
    )


def _placeholder_of(finding: Finding, name: str, letters: Mapping[str, str]) -> str:
    if finding.tier == ALWAYS_TIER:
        return ALWAYS_PLACEHOLDER
    descriptor = DESCRIPTOR_BY_CATEGORY[finding.category]
    if descriptor.category != A_PERSON_NAME:
        return descriptor.placeholder
    return written_as(letters[normalised(name)], descriptor.placeholder)


def _written(text: str, withheld: Sequence[Finding], letters: Mapping[str, str]) -> str:
    # Right to left, so that every offset still points at the same character when its
    # span is reached: a replacement changes the length of everything after it. The name
    # a placeholder is chosen by is read out of the text the seam was given, never out
    # of the text being written, whose spans have already moved.
    redacted = text
    for finding in sorted(withheld, key=lambda it: it.start, reverse=True):
        redacted = (
            redacted[: finding.start]
            + _placeholder_of(finding, text[finding.start : finding.end], letters)
            + redacted[finding.end :]
        )
    return redacted


def _counted(findings: Sequence[Finding]) -> Mapping[str, int]:
    counts: dict[str, int] = {}
    for finding in findings:
        counts[finding.category] = counts.get(finding.category, 0) + 1
    return MappingProxyType(dict(sorted(counts.items())))


def _verdict_of(findings: Sequence[Finding]) -> str | None:
    for finding in findings:
        narrows_to = DESCRIPTOR_BY_CATEGORY[finding.category].narrows_to
        if narrows_to is not None:
            return narrows_to
    return None
