"""The post-pass that outranks a tier: a name inside a block of officers.

A persons-with-significant-control block, an officers or directors list, a page of
signatories — these name people in their own right, and a company filing that reached a
bid library carries them whether or not the binding it arrived on has anything to do
with people. So the rule is not the binding's to switch: a name inside one of those
blocks is raised at the always tier whatever the rules in force say, and takes that
tier's one neutral word rather than the letter its category would have given it. That
is the agreement's own sentence — *the placeholder follows the tier the finding was
raised at, not the category* — read at the one place it bites hardest, because a
pseudonym would leave the officer list readable as a list of distinct people.

It is a post-pass and not a recogniser: the span is already found, and what this decides
is which tier the finding was raised at. The ranges it reads are `recognisers`' own, so
this rule and the review screen answer the same question about where a block ends.

The rule reaches names alone. A date of birth or a home address inside the same block is
the category it always was, on the tier a binding may switch, because those are what the
default-on tier is for and a company filing is where they are most expected.
"""

from collections.abc import Sequence

from .descriptors import A_PERSON_NAME
from .engine import Finding, raised_to_always
from .recognisers import officer_blocks


def raised_by_the_block_rule(
    findings: Sequence[Finding], text: str
) -> tuple[Finding, ...]:
    """Every person-name finding inside a block of officers, at the always tier."""
    blocks = officer_blocks(text)
    return raised_to_always(
        findings,
        lambda finding: finding.category == A_PERSON_NAME and _inside(finding, blocks),
    )


def _inside(finding: Finding, blocks: Sequence[tuple[int, int]]) -> bool:
    return any(
        opened <= finding.start and finding.end <= shut for opened, shut in blocks
    )
