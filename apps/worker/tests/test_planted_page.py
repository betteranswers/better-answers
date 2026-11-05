import pytest

from support.planted_page import (
    A_CONSUMER_ADDRESS,
    A_HEALTH_AND_SAFETY_SENTENCE,
    A_PLANTED_JOB_TITLE,
    FIXTURE_PAGE,
    PLANTED_SPANS,
    spans_withheld_under,
    typed_placeholders_under,
)

DEFAULT_ON_ONLY = {"default_on": True, "default_off": False}
DEFAULT_ON_AND_OFF = {"default_on": True, "default_off": True}
ALL_TIERS_OFF = {"default_on": False, "default_off": False}


def test_each_planted_span_appears_once_on_the_fixture_page() -> None:
    page = FIXTURE_PAGE.read_text(encoding="utf-8")

    for category, planted in PLANTED_SPANS:
        assert page.count(planted) == 1, (
            f"the {category} span {planted!r} is not on the page exactly once"
        )


def test_the_fixture_page_contains_the_health_and_safety_sentence_once() -> None:

    page = FIXTURE_PAGE.read_text(encoding="utf-8")

    assert page.count(A_HEALTH_AND_SAFETY_SENTENCE) == 1


def test_a_span_is_withheld_only_when_its_tier_is_on() -> None:

    withheld = spans_withheld_under(DEFAULT_ON_ONLY)

    assert A_CONSUMER_ADDRESS in withheld
    assert A_PLANTED_JOB_TITLE not in withheld
    assert A_PLANTED_JOB_TITLE in spans_withheld_under(DEFAULT_ON_AND_OFF)


def test_writes_a_typed_placeholder_for_each_tier_that_is_on() -> None:

    assert set(typed_placeholders_under(DEFAULT_ON_ONLY)) == {
        "[date of birth withheld]",
        "[home address withheld]",
        "[personal contact withheld]",
    }

    assert typed_placeholders_under(ALL_TIERS_OFF) == {}


def test_raises_when_a_withheld_category_has_no_declared_count() -> None:

    with pytest.raises(RuntimeError, match="no count"):
        typed_placeholders_under(DEFAULT_ON_AND_OFF)
