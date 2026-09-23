from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
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


UNDER_ITS_OWN_PLACEHOLDER = "its-own-placeholder"


UNDER_ANOTHER_FINDINGS_PLACEHOLDER = "another-findings-placeholder"


NOT_WRITTEN_AT_ALL = "not-at-all"


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
    written: str


def withholdings_over(
    findings: Sequence[Finding], text: str, policy: Policy
) -> tuple[Withholding, ...]:
    erased = suppressed_among(findings, text, policy.suppressions)
    restored = restored_among(findings, policy.restores)
    answered = tuple(
        _answered(finding, finding in erased, finding in restored, policy)
        for finding in findings
    )
    written = _without_overlaps(tuple(one for one in answered if one.withheld))
    return tuple(replace(one, written=_how_written(one, written)) for one in answered)


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
        written=NOT_WRITTEN_AT_ALL,
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


def _how_written(withholding: Withholding, written: Sequence[Withholding]) -> str:
    if not withholding.withheld:
        return NOT_WRITTEN_AT_ALL
    finding = withholding.finding
    if any(one.finding == finding for one in written):
        return UNDER_ITS_OWN_PLACEHOLDER
    under_another = any(
        one.finding.start <= finding.start and finding.end <= one.finding.end
        for one in written
    )
    return UNDER_ANOTHER_FINDINGS_PLACEHOLDER if under_another else NOT_WRITTEN_AT_ALL


def _without_overlaps(raised: Sequence[Withholding]) -> tuple[Withholding, ...]:
    competing = [one for one in raised if not _inside_another(one, raised)]
    taken: list[Withholding] = []
    for one in sorted(competing, key=_precedence):
        if any(
            one.finding.start < other.finding.end
            and other.finding.start < one.finding.end
            for other in taken
        ):
            continue
        taken.append(one)
    return tuple(sorted(taken, key=_where))


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


def _where(withholding: Withholding) -> tuple[int, int, str]:
    finding = withholding.finding
    return (finding.start, finding.end, finding.rule_id)
