import re
from collections.abc import Sequence

from .descriptors import A_PERSON_NAME
from .engine import Finding, raised_to_always

AN_OFFICER_HEADING = re.compile(
    r"^#{1,6}[^\n]*\b(?:persons? with significant control|officers?|directors?"
    r"|signator(?:y|ies))\b[^\n]*$",
    re.IGNORECASE | re.MULTILINE,
)
ANY_HEADING = re.compile(r"^#{1,6}\s", re.MULTILINE)


def officer_blocks(text: str) -> tuple[tuple[int, int], ...]:
    blocks: list[tuple[int, int]] = []
    for heading in AN_OFFICER_HEADING.finditer(text):
        following = ANY_HEADING.search(text, heading.end())
        blocks.append((heading.start(), following.start() if following else len(text)))
    return tuple(blocks)


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
