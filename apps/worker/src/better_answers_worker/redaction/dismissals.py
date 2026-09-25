from collections.abc import Sequence
from dataclasses import dataclass

from .engine import Finding


@dataclass(frozen=True, slots=True)
class Dismissal:
    """Matched to a finding by rule and exact offsets,
    so a span that moves is no longer dismissed."""

    rule_id: str
    start: int
    end: int


def dismissed_among(
    findings: Sequence[Finding], dismissals: Sequence[Dismissal]
) -> frozenset[Finding]:
    named = frozenset(dismissals)
    return frozenset(
        finding
        for finding in findings
        if Dismissal(finding.rule_id, finding.start, finding.end) in named
    )
