from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType

from .engine import ALWAYS_TIER, TIER_PRECEDENCE, Finding
from .restores import Restore, restored_among
from .suppressions import ErasureMatch, suppressed_among

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
    withholding: Withholding | ErasureMatch


def withholdings_over(
    findings: Sequence[Finding], text: str, policy: Policy
) -> tuple[Withholding, ...]:
    erased = suppressed_among(findings, text, policy.suppressions)
    restored = restored_among(findings, policy.restores)
    return tuple(
        _answered(finding, finding in erased, finding in restored, policy)
        for finding in findings
    )


def written_spans_of(
    withholdings: Sequence[Withholding], erasure_matches: Sequence[ErasureMatch]
) -> tuple[WrittenSpan, ...]:
    withheld = tuple(_competitor_of(one) for one in withholdings if one.withheld)
    # How a finding was written is read off the spans, so a finding keeps its own span
    # from a match it already covers.
    uncovered = tuple(
        _competitor_of_the_match(match)
        for match in erasure_matches
        if not any(
            one.start <= match.start and match.end <= one.end for one in withheld
        )
    )
    return _without_overlaps((*withheld, *uncovered))


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


@dataclass(frozen=True, slots=True)
class _Competitor:
    start: int
    end: int
    precedence: tuple[int, int, float, int, str]
    withholding: Withholding | ErasureMatch


def _competitor(
    withholding: Withholding | ErasureMatch,
    at: tuple[int, int],
    tier: str,
    score: float,
    rule_id: str,
) -> _Competitor:
    start, end = at
    return _Competitor(
        start=start,
        end=end,
        precedence=(TIER_PRECEDENCE[tier], start - end, -score, start, rule_id),
        withholding=withholding,
    )


def _competitor_of(withholding: Withholding) -> _Competitor:
    finding = withholding.finding
    return _competitor(
        withholding,
        (finding.start, finding.end),
        withholding.tier,
        finding.score,
        finding.rule_id,
    )


# No detector's score is surer than an identifier a request named.
_CERTAIN = 1.0


def _competitor_of_the_match(match: ErasureMatch) -> _Competitor:
    return _competitor(match, (match.start, match.end), ALWAYS_TIER, _CERTAIN, "")


def _without_overlaps(raised: Sequence[_Competitor]) -> tuple[WrittenSpan, ...]:
    """Containment first, then precedence: a span inside a longer one writes none,
    and a loser gives up only the characters the winner takes."""
    competing = sorted(
        (one for one in raised if not _inside_another(one, raised)),
        key=lambda one: one.precedence,
    )
    remainders = (
        _remainder(one, competing[:place]) for place, one in enumerate(competing)
    )
    return tuple(sorted((one for one in remainders if one is not None), key=_where))


def _remainder(
    competitor: _Competitor, ahead: Sequence[_Competitor]
) -> WrittenSpan | None:
    # Nothing ahead lies strictly inside this span once containment has run, so each
    # overlap takes a prefix or a suffix and one run is left.
    start, end = competitor.start, competitor.end
    for winner in ahead:
        if winner.end <= competitor.start or competitor.end <= winner.start:
            continue
        if winner.start <= competitor.start:
            start = max(start, winner.end)
        else:
            end = min(end, winner.start)
    return WrittenSpan(start, end, competitor.withholding) if start < end else None


def _inside_another(competitor: _Competitor, raised: Sequence[_Competitor]) -> bool:

    return any(
        other.start <= competitor.start
        and competitor.end <= other.end
        and other.end - other.start > competitor.end - competitor.start
        for other in raised
    )


def _where(span: WrittenSpan) -> int:
    return span.start
