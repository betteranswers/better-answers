from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType

from .descriptors import A_PERSON_NAME, DESCRIPTORS
from .engine import (
    ALWAYS_TIER,
    DESCRIPTOR_BY_CATEGORY,
    Finding,
    Span,
    findings_of,
)
from .officers import raised_by_the_block_rule
from .pins import VERSION_STRING
from .pseudonyms import normalised, pseudonyms_for, written_as
from .restores import Restore
from .withholdings import (
    UNDER_ITS_OWN_PLACEHOLDER,
    Policy,
    Withholding,
    withholdings_over,
)

__all__ = ["Redaction", "Restore", "redact"]


ALWAYS_PLACEHOLDER = next(
    iter({item.placeholder for item in DESCRIPTORS if item.tier == ALWAYS_TIER})
)


@dataclass(frozen=True, slots=True)
class Redaction:
    text: str
    findings: tuple[Finding, ...]
    withholdings: tuple[Withholding, ...]
    counts: Mapping[str, int]
    verdict: str | None
    version: str


def redact(
    text: str,
    spans: Sequence[Span],
    rules_in_force: Mapping[str, bool],
    suppressions: Sequence[Mapping[str, Sequence[str]]],
    seed: str,
    restores: Sequence[Restore] = (),
) -> Redaction:

    policy = Policy(
        rules_in_force=rules_in_force,
        suppressions=suppressions,
        restores=restores,
        seed=seed,
    )

    # Both outside the detector's memo, so a fix to either re-detects nothing.
    findings = raised_by_the_block_rule(findings_of(spans), text)

    letters = pseudonyms_for(_names_in(text, findings), policy.seed)

    withholdings = withholdings_over(findings, text, policy)
    return Redaction(
        text=_written(text, withholdings, letters),
        findings=findings,
        withholdings=withholdings,
        counts=_counted(findings),
        verdict=_verdict_of(findings),
        version=VERSION_STRING,
    )


def _names_in(text: str, findings: Sequence[Finding]) -> tuple[str, ...]:

    return tuple(
        text[finding.start : finding.end]
        for finding in findings
        if finding.category == A_PERSON_NAME
    )


def _placeholder_of(
    withholding: Withholding, name: str, letters: Mapping[str, str]
) -> str:
    if withholding.tier == ALWAYS_TIER:
        return ALWAYS_PLACEHOLDER
    descriptor = DESCRIPTOR_BY_CATEGORY[withholding.finding.category]
    if descriptor.category != A_PERSON_NAME:
        return descriptor.placeholder
    return written_as(letters[normalised(name)], descriptor.placeholder)


def _written(
    text: str, withholdings: Sequence[Withholding], letters: Mapping[str, str]
) -> str:

    redacted = text
    for withholding in sorted(
        (one for one in withholdings if one.written == UNDER_ITS_OWN_PLACEHOLDER),
        key=lambda it: it.finding.start,
        reverse=True,
    ):
        finding = withholding.finding
        redacted = (
            redacted[: finding.start]
            + _placeholder_of(withholding, text[finding.start : finding.end], letters)
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
