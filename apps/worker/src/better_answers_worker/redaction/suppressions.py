"""What an erasure request's identifiers do to a document the next time it is read.

A suppression is the erasure routine's answer for a company document: the object store
is untouched and the file is not deleted, because it is the company's record of its own
work, but the identifiers the request named are kept out of everything derived from it
from that point on. So a suppression arrives here as the identifier set the subject
request holds — the emails, the names and the other identifiers the person gave — and
the seam's job is to make sure none of them survives into the redacted text.

**A suppressed span is raised at the always tier and takes that tier's word.** It is the
officer block's mechanism, and it is the only reading that works on both of the bindings
a document can be on. A pseudonym would not do: `[person U]` still marks where in the
document that person is, how often they are mentioned and which paragraphs are about
them, and marking where they are is what a suppression exists to prevent. Nor can the
answer be the category's own switchable tier, because a binding with names switched off
would then leave the name in the text of a document the person has asked to be erased
from.

**It reaches the spans the rules already raised, and does not go looking for more.** The
identifiers are matched against the text each finding claimed, so an identifier the
detector never raised a finding for is not withheld by this pass — the tier is what a
post-pass decides, the span is the recogniser's. That is the boundary the acceptance
line draws and the reason the same set is also written into the suppression rows the app
keeps: a reprocess that found nothing is a finding for review, not a silent pass.

**Kind-agnostic on purpose.** The set is read as one union of values rather than one
list per kind, because what decides the tier is that the value is one the request named,
and a name the requester listed under *other* is the same person's name. The kinds are
the request's shape for the person filling it in and the erasure map's for the finder;
here they would only be three ways to reach the same answer.
"""

from collections.abc import Mapping, Sequence

from .engine import Finding, raised_to_always
from .pseudonyms import normalised


def raised_by_a_suppression(
    findings: Sequence[Finding],
    text: str,
    suppressions: Sequence[Mapping[str, Sequence[str]]],
) -> tuple[Finding, ...]:
    """Every finding whose span is an identifier a request named, at the always tier."""
    named = _identifiers_in(suppressions)
    if not named:
        return tuple(findings)
    return raised_to_always(
        findings,
        lambda finding: normalised(text[finding.start : finding.end]) in named,
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
