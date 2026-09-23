from collections.abc import Mapping, Sequence

from .engine import Finding
from .pseudonyms import normalised


def suppressed_among(
    findings: Sequence[Finding],
    text: str,
    suppressions: Sequence[Mapping[str, Sequence[str]]],
) -> frozenset[Finding]:
    named = _identifiers_in(suppressions)
    return frozenset(
        finding
        for finding in findings
        if normalised(text[finding.start : finding.end]) in named
    )


def _identifiers_in(
    suppressions: Sequence[Mapping[str, Sequence[str]]],
) -> frozenset[str]:
    return frozenset(
        normalised(value)
        for suppression in suppressions
        for values in suppression.values()
        for value in values
    )
