from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType

from .descriptors import A_PERSON_NAME, DESCRIPTORS
from .dismissals import Dismissal, dismissed_among
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
    Policy,
    Withholding,
    WrittenSpan,
    withholdings_over,
    written_spans_of,
)

__all__ = ["Dismissal", "Redaction", "Restore", "redact"]


ALWAYS_PLACEHOLDER = next(
    iter({item.placeholder for item in DESCRIPTORS if item.tier == ALWAYS_TIER})
)


@dataclass(frozen=True, slots=True)
class Redaction:
    text: str
    findings: tuple[Finding, ...]
    withholdings: tuple[Withholding, ...]
    written_spans: tuple[WrittenSpan, ...]
    counts: Mapping[str, int]
    verdict: str | None
    lifted: bool
    version: str


def redact(
    text: str,
    spans: Sequence[Span],
    rules_in_force: Mapping[str, bool],
    suppressions: Sequence[Mapping[str, Sequence[str]]],
    seed: str,
    restores: Sequence[Restore] = (),
    dismissals: Sequence[Dismissal] = (),
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
    written_spans = written_spans_of(withholdings)
    narrowing = _findings_that_narrow(findings)
    dismissed = dismissed_among(narrowing, dismissals)
    return Redaction(
        text=_written(text, written_spans, letters),
        findings=findings,
        withholdings=withholdings,
        written_spans=written_spans,
        counts=_counted(findings),
        verdict=_verdict_of(narrowing, dismissed),
        lifted=bool(narrowing) and dismissed == frozenset(narrowing),
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
    text: str, written_spans: Sequence[WrittenSpan], letters: Mapping[str, str]
) -> str:

    # The spans arrive in offset order, so writing from the last keeps every earlier
    # offset true of the text being rewritten.
    redacted = text
    for span in reversed(written_spans):
        finding = span.withholding.finding
        redacted = (
            redacted[: span.start]
            + _placeholder_of(
                span.withholding, text[finding.start : finding.end], letters
            )
            + redacted[span.end :]
        )
    return redacted


def _counted(findings: Sequence[Finding]) -> Mapping[str, int]:
    counts: dict[str, int] = {}
    for finding in findings:
        counts[finding.category] = counts.get(finding.category, 0) + 1
    return MappingProxyType(dict(sorted(counts.items())))


def _findings_that_narrow(findings: Sequence[Finding]) -> tuple[Finding, ...]:
    return tuple(
        finding
        for finding in findings
        if DESCRIPTOR_BY_CATEGORY[finding.category].narrows_to is not None
    )


def _verdict_of(
    narrowing: Sequence[Finding], dismissed: frozenset[Finding]
) -> str | None:
    for finding in narrowing:
        if finding not in dismissed:
            return DESCRIPTOR_BY_CATEGORY[finding.category].narrows_to
    return None
