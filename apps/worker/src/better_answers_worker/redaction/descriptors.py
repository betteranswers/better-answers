"""One declared descriptor per redaction category, and the tables derived from them.

Everything the seam does with a category is read off the declarations below: which
recogniser's answer raises it, how sure that answer has to be, the words the context
enhancer boosts on, the word written in place of the span, and whether a finding
narrows the document. The analyzer's registry and the entity table derive from this
one table, so a rule change is one record and one bump rather than an edit in four
places; the `redaction` agreement under `contracts/` is what the table is held to, and
the review screen's category list is the same record again.

The tier a category names is the tier it is *ordinarily* raised at, and one rule
outranks it: a name inside an officers block is raised at the always tier whatever a
binding says. The placeholder follows the tier a finding was raised at, never the
category — which is why such a name is withheld with its block instead of standing in
as a pseudonym.

Thresholds are policy rather than tuning. 0.6 is the floor of the band a finding is
worth putting in front of a reviewer at all; the always set drops below it because no
binding switches that set off and a miss there is the expensive direction; the
default-off tier asks for more, because rewriting a name into a pseudonym costs the
reader something and it is the tier a bid library least wants applied by accident.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType


@dataclass(frozen=True, slots=True)
class CategoryDescriptor:
    """One category of the agreement, with everything the seam needs to raise it.

    `raised_by` is the entity name each recogniser answers with — Presidio's own where
    a built-in raises the category, ours where one of the six recognisers does — and
    it is a tuple because a category can be reached two ways: personal contact is an
    email address or a telephone number, and a government identifier is an NHS number
    or a National Insurance number. `context` is the lemmas Presidio's context
    enhancer boosts a score on when they sit near the span, which is what "in context"
    means in the spec: a date beside *date of birth* is a finding and a bare date is
    not.
    """

    category: str
    tier: str
    raised_by: tuple[str, ...]
    threshold: float
    context: tuple[str, ...]
    placeholder: str
    narrows_to: str | None


DESCRIPTORS: tuple[CategoryDescriptor, ...] = (
    CategoryDescriptor(
        category="special-category",
        tier="always",
        raised_by=("HEALTH_CUE",),
        threshold=0.5,
        context=("health", "diagnosis", "condition", "medication", "sickness"),
        placeholder="[withheld]",
        narrows_to="Restricted",
    ),
    CategoryDescriptor(
        category="bank-details",
        tier="always",
        raised_by=("UK_BANK_ACCOUNT",),
        threshold=0.5,
        context=("account", "sort", "bank", "payment", "bacs"),
        placeholder="[withheld]",
        narrows_to=None,
    ),
    CategoryDescriptor(
        category="government-identifier",
        tier="always",
        raised_by=("UK_NHS", "UK_NINO"),
        threshold=0.5,
        context=("national", "insurance", "nhs", "number"),
        placeholder="[withheld]",
        narrows_to=None,
    ),
    CategoryDescriptor(
        category="date-of-birth",
        tier="default-on",
        raised_by=("DATE_OF_BIRTH",),
        threshold=0.6,
        context=("birth", "born", "dob"),
        placeholder="[date of birth withheld]",
        narrows_to=None,
    ),
    CategoryDescriptor(
        category="home-address",
        tier="default-on",
        raised_by=("UK_HOME_ADDRESS",),
        threshold=0.6,
        context=("address", "home", "residence", "postcode"),
        placeholder="[home address withheld]",
        narrows_to=None,
    ),
    CategoryDescriptor(
        category="personal-contact",
        tier="default-on",
        raised_by=("EMAIL_ADDRESS", "PHONE_NUMBER"),
        threshold=0.6,
        context=("personal", "mobile", "email", "telephone", "contact"),
        placeholder="[personal contact withheld]",
        narrows_to=None,
    ),
    CategoryDescriptor(
        category="person-name",
        tier="default-off",
        raised_by=("PERSON",),
        threshold=0.7,
        context=(),
        placeholder="[person A]",
        narrows_to=None,
    ),
    CategoryDescriptor(
        category="job-title",
        tier="default-off",
        raised_by=("JOB_TITLE",),
        threshold=0.7,
        context=("role", "title", "position"),
        placeholder="[job title withheld]",
        narrows_to=None,
    ),
)

#: The one category the rules above it speak about by name: the officer-block pass
#: raises it, a suppression raises it, and it is the only category written out as a
#: stable letter rather than as its declared word. Named here beside the declarations
#: rather than spelled in each of those three places.
A_PERSON_NAME = "person-name"

#: The table an analyzer's answer is read through: the inverse of `raised_by`, derived
#: rather than declared a second time, because a mapping written by hand beside the
#: declarations is the copy that stops agreeing with them.
CATEGORY_BY_ENTITY: Mapping[str, str] = MappingProxyType(
    {
        entity: descriptor.category
        for descriptor in DESCRIPTORS
        for entity in descriptor.raised_by
    }
)
