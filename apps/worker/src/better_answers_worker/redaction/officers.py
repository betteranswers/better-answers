from collections.abc import Sequence

from .descriptors import A_PERSON_NAME
from .engine import Finding, raised_to_always
from .recognisers import officer_blocks


def raised_by_the_block_rule(
    findings: Sequence[Finding], text: str
) -> tuple[Finding, ...]:
    blocks = officer_blocks(text)
    return raised_to_always(
        findings,
        lambda finding: finding.category == A_PERSON_NAME and _inside(finding, blocks),
    )


def _inside(finding: Finding, blocks: Sequence[tuple[int, int]]) -> bool:
    return any(
        opened <= finding.start and finding.end <= shut for opened, shut in blocks
    )
