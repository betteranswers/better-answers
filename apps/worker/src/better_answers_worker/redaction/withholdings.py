from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType

from .engine import ALWAYS_TIER, TIER_PRECEDENCE, Finding
from .restores import Restore, restored_among
from .suppressions import suppressed_among

OVERRIDDEN_BY_THE_ERASURE = "overridden-by-the-erasure"


AN_ERASURE = "erasure"


RESTORED = "restored"


SWITCHED_OFF = "switched-off"


IN_FORCE = "in-force"


WITHHELD_FOR: Mapping[str, bool] = MappingProxyType(
    {
        OVERRIDDEN_BY_THE_ERASURE: True,
        AN_ERASURE: True,
        RESTORED: False,
        SWITCHED_OFF: False,
        IN_FORCE: True,
    }
)


SWITCHABLE_TIERS: Mapping[str, tuple[str, bool]] = MappingProxyType(
    {"default-on": ("default_on", True), "default-off": ("default_off", False)}
)


@dataclass(frozen=True, slots=True)
class Policy:
    rules_in_force: Mapping[str, bool]
    suppressions: Sequence[Mapping[str, Sequence[str]]]
    restores: Sequence[Restore]
    seed: str


@dataclass(frozen=True, slots=True)
class Withholding:
    finding: Finding
    withheld: bool
    tier: str
    reason: str


@dataclass(frozen=True, slots=True)
class WrittenSpan:
    start: int
    end: int
    withholding: Withholding


def withholdings_over(
    findings: Sequence[Finding], text: str, policy: Policy
) -> tuple[Withholding, ...]:
    erased = suppressed_among(findings, text, policy.suppressions)
    restored = restored_among(findings, policy.restores)
    return tuple(
        _answered(finding, finding in erased, finding in restored, policy)
        for finding in findings
    )


def written_spans_of(withholdings: Sequence[Withholding]) -> tuple[WrittenSpan, ...]:
    return _without_overlaps(tuple(one for one in withholdings if one.withheld))


def overridden_in(withholdings: Sequence[Withholding]) -> tuple[Finding, ...]:
    return tuple(
        one.finding for one in withholdings if one.reason == OVERRIDDEN_BY_THE_ERASURE
    )


def _answered(
    finding: Finding, erased: bool, restored: bool, policy: Policy
) -> Withholding:
    tier = ALWAYS_TIER if erased else finding.tier
    reason = _reason(erased, restored, _in_force(tier, policy.rules_in_force))
    return Withholding(
        finding=finding,
        withheld=WITHHELD_FOR[reason],
        tier=tier,
        reason=reason,
    )


def _reason(erased: bool, restored: bool, in_force: bool) -> str:
    if erased:
        return OVERRIDDEN_BY_THE_ERASURE if restored else AN_ERASURE
    if restored:
        return RESTORED
    return IN_FORCE if in_force else SWITCHED_OFF


def _in_force(tier: str, rules_in_force: Mapping[str, bool]) -> bool:
    switch = SWITCHABLE_TIERS.get(tier)
    if switch is None:
        return True
    key, unconfigured = switch
    return rules_in_force.get(key, unconfigured)


def _without_overlaps(raised: Sequence[Withholding]) -> tuple[WrittenSpan, ...]:
    """Containment first, then precedence: a finding inside a longer one takes no
    span, and a loser gives up only the characters the winner takes."""
    competing = sorted(
        (one for one in raised if not _inside_another(one, raised)), key=_precedence
    )
    remainders = (
        _remainder(one, competing[:place]) for place, one in enumerate(competing)
    )
    return tuple(sorted((one for one in remainders if one is not None), key=_where))


def _remainder(
    withholding: Withholding, ahead: Sequence[Withholding]
) -> WrittenSpan | None:
    # Nothing ahead lies strictly inside this finding once containment has run, so each
    # overlap takes a prefix or a suffix and one run is left.
    finding = withholding.finding
    start, end = finding.start, finding.end
    for winner in ahead:
        taken = winner.finding
        if taken.end <= finding.start or finding.end <= taken.start:
            continue
        if taken.start <= finding.start:
            start = max(start, taken.end)
        else:
            end = min(end, taken.start)
    return WrittenSpan(start, end, withholding) if start < end else None


def _inside_another(withholding: Withholding, raised: Sequence[Withholding]) -> bool:

    finding = withholding.finding
    return any(
        other.finding.start <= finding.start
        and finding.end <= other.finding.end
        and other.finding.end - other.finding.start > finding.end - finding.start
        for other in raised
    )


def _precedence(withholding: Withholding) -> tuple[int, int, float, int, str]:
    finding = withholding.finding
    return (
        TIER_PRECEDENCE[withholding.tier],
        finding.start - finding.end,
        -finding.score,
        finding.start,
        finding.rule_id,
    )


def _where(span: WrittenSpan) -> int:
    return span.start
