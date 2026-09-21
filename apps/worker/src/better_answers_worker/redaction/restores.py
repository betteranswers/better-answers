from collections.abc import Sequence
from dataclasses import dataclass

from .engine import Finding


@dataclass(frozen=True, slots=True)
class Restore:
    rule_id: str
    start: int
    end: int


def restored_among(
    findings: Sequence[Finding], restores: Sequence[Restore]
) -> frozenset[Finding]:
    named = frozenset(restores)
    return frozenset(
        finding
        for finding in findings
        if Restore(finding.rule_id, finding.start, finding.end) in named
    )
