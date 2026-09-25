import pytest

from planted_page import (
    A_CONSUMER_ADDRESS,
    A_HEALTH_AND_SAFETY_SENTENCE,
    A_PLANTED_JOB_TITLE,
    FIXTURE_PAGE,
    PLANTED_SPANS,
    spans_withheld_under,
    typed_placeholders_under,
)

THE_SAFE_SET = {"default_on": True, "default_off": False}
AN_HR_SHAPED_BINDING = {"default_on": True, "default_off": True}
NOTHING_SWITCHABLE = {"default_on": False, "default_off": False}


def test_every_span_the_declaration_plants_is_on_the_page_once() -> None:
    page = FIXTURE_PAGE.read_text(encoding="utf-8")

    for category, planted in PLANTED_SPANS:
        assert page.count(planted) == 1, f"{category}: {planted!r}"


def test_the_page_holds_the_kept_sentence_once() -> None:

    page = FIXTURE_PAGE.read_text(encoding="utf-8")

    assert page.count(A_HEALTH_AND_SAFETY_SENTENCE) == 1


def test_a_span_goes_only_when_its_tier_is_switched_on() -> None:

    unconfigured = spans_withheld_under(THE_SAFE_SET)

    assert A_CONSUMER_ADDRESS in unconfigured
    assert A_PLANTED_JOB_TITLE not in unconfigured
    assert A_PLANTED_JOB_TITLE in spans_withheld_under(AN_HR_SHAPED_BINDING)


def test_writes_a_typed_word_for_each_switched_on_tier() -> None:

    assert set(typed_placeholders_under(THE_SAFE_SET)) == {
        "[date of birth withheld]",
        "[home address withheld]",
        "[personal contact withheld]",
    }

    assert typed_placeholders_under(NOTHING_SWITCHABLE) == {}


def test_refuses_a_binding_whose_tier_the_page_cannot_count() -> None:

    with pytest.raises(RuntimeError, match="no count"):
        typed_placeholders_under(AN_HR_SHAPED_BINDING)
