from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType


@dataclass(frozen=True, slots=True)
class CategoryDescriptor:
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
        context=("diagnosis", "medication", "sickness"),
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


A_PERSON_NAME = "person-name"


CATEGORY_BY_ENTITY: Mapping[str, str] = MappingProxyType(
    {
        entity: descriptor.category
        for descriptor in DESCRIPTORS
        for entity in descriptor.raised_by
    }
)
