from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType

from .descriptors import A_PERSON_NAME, DESCRIPTORS
from .engine import (
    ALWAYS_TIER,
    DESCRIPTOR_BY_CATEGORY,
    Finding,
    detect,
    without_overlaps,
)
from .officers import raised_by_the_block_rule
from .pins import VERSION_STRING
from .pseudonyms import normalised, pseudonyms_for, written_as
from .restores import Restore, restored_among
from .suppressions import raised_by_a_suppression, suppressed_among

__all__ = ["Redaction", "Restore", "redact"]


SWITCHABLE_TIERS: Mapping[str, tuple[str, bool]] = MappingProxyType(
    {"default-on": ("default_on", True), "default-off": ("default_off", False)}
)


ALWAYS_PLACEHOLDER = next(
    iter({item.placeholder for item in DESCRIPTORS if item.tier == ALWAYS_TIER})
)


@dataclass(frozen=True, slots=True)
class Redaction:
    text: str
    findings: tuple[Finding, ...]
    counts: Mapping[str, int]
    verdict: str | None
    version: str
    overridden: tuple[Finding, ...]


def redact(
    text: str,
    rules_in_force: Mapping[str, bool],
    suppressions: Sequence[Mapping[str, Sequence[str]]],
    seed: str,
    restores: Sequence[Restore] = (),
) -> Redaction:

    findings = raised_by_a_suppression(
        raised_by_the_block_rule(detect(text), text), text, suppressions
    )

    letters = pseudonyms_for(_names_in(text, findings), seed)

    restored = restored_among(findings, restores)
    erased = suppressed_among(findings, text, suppressions)
    left_in = restored - erased
    withheld = without_overlaps(
        [
            finding
            for finding in findings
            if _in_force(finding.tier, rules_in_force) and finding not in left_in
        ]
    )
    return Redaction(
        text=_written(text, withheld, letters),
        findings=findings,
        counts=_counted(findings),
        verdict=_verdict_of(findings),
        version=VERSION_STRING,
        overridden=tuple(
            finding for finding in findings if finding in restored and finding in erased
        ),
    )


def _in_force(tier: str, rules_in_force: Mapping[str, bool]) -> bool:
    switch = SWITCHABLE_TIERS.get(tier)
    if switch is None:
        return True
    key, unconfigured = switch
    return rules_in_force.get(key, unconfigured)


def _names_in(text: str, findings: Sequence[Finding]) -> tuple[str, ...]:

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
