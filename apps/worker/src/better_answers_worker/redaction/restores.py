"""What an Admin's restore does to a document the next time it is read.

The always tier is policy and no binding switches it off, so the one way a span it
withheld returns is an Admin saying, of that span, why it is a business fact: the
company's own sort code on the company's own supplier pack (ADR 0020). The act marks the
finding's row; the run reads which spans of a document were restored and hands them here
as an argument, by the road a suppression takes.

**A restore names a finding, and a finding is its rule and its two offsets.** That is
what the row is unique on and all the run is told of it — never the category, never a
reason and never who. The rule is part of the name because two rules may claim one run
of characters: an Admin restored one of them, and a restore that matched on the offsets
alone would let back a span nobody reviewed.

**A restored finding is still a finding.** It is raised, counted and answered exactly as
it was, because the row is what a review reads and what the erasure map is read from.
What a restore changes is the one thing a binding's rules change: whether the span is
written out of the text.

**It takes a span out of what is withheld, and gives no cover to anything else.** Two
findings may claim the same characters, and an unrestored one that is in force still
writes its own span out, over the restored one where they meet. And an erasure outranks
it: a suppression raises the tier of the finding that is already there, so the span a
person asked to be erased from may be the very finding an Admin restored long before —
and an identifier a request named is kept out of everything derived from the document,
whatever was said about it earlier.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from .engine import Finding


@dataclass(frozen=True, slots=True)
class Restore:
    """One finding an Admin let back into the text: its rule, and its span."""

    rule_id: str
    start: int
    end: int


def restored_among(
    findings: Sequence[Finding], restores: Sequence[Restore]
) -> frozenset[Finding]:
    """The findings a restore names, each by its rule and its two offsets."""
    named = frozenset(restores)
    return frozenset(
        finding
        for finding in findings
        if Restore(finding.rule_id, finding.start, finding.end) in named
    )
