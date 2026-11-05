import re
from dataclasses import fields, replace

from better_answers_worker.pipeline import CONVERTER_PIN
from better_answers_worker.redaction import detector, engine, officers, recognisers
from better_answers_worker.redaction.consumer_domains import CONSUMER_DOMAINS
from better_answers_worker.redaction.descriptors import DESCRIPTORS, CategoryDescriptor
from better_answers_worker.redaction.detection_key import (
    DETECTOR_LITERALS,
    RAISED_AFTER_THE_DETECTOR,
    canonically,
    detection_key,
    detection_key_of,
    what_the_detector_reads,
)
from better_answers_worker.redaction.pins import RULE_VERSION

DETECTOR_FIELDS = frozenset({"raised_by", "threshold", "context", "cues"})


POLICY_FIELDS = frozenset({"category", "tier", "placeholder", "narrows_to"})


ENGINE_CONSTANTS_IN_KEY = frozenset({"GLINER_LABELS"})


ENGINE_CONSTANTS_COVERED_BY_PIN_OR_RULES = frozenset(
    {
        "ANALYSED_ENTITIES",
        "CATEGORY_BY_ENTITY",
        "DESCRIPTORS",
        "DESCRIPTOR_BY_CATEGORY",
        "DESCRIPTOR_BY_ENTITY",
        "GLINER_MODEL_ID",
        "SPACY_MODEL",
    }
)


ENGINE_CONSTANTS_READ_AFTER_DETECTION = frozenset({"ALWAYS_TIER", "TIER_PRECEDENCE"})


DETECTOR_CONSTANTS_IN_KEY = frozenset(
    {"PHONE_LENIENCY", "PHONE_REGIONS", "WINDOWS_A_RUN_IS_READ_WHOLE_IN"}
)


DETECTOR_CONSTANTS_OUTSIDE_KEY = frozenset({"MODEL_RULE_NAME", "RECOGNISERS"})


TYPE_CHECKING_CONSTANTS = frozenset({"TYPE_CHECKING"})


def key_over(
    descriptors: tuple[CategoryDescriptor, ...] = DESCRIPTORS,
    consumer_domains: frozenset[str] = CONSUMER_DOMAINS,
) -> str:
    return detection_key_of(what_the_detector_reads(descriptors, consumer_domains))


def category_called(category: str) -> CategoryDescriptor:
    return next(item for item in DESCRIPTORS if item.category == category)


def descriptors_with(moved: CategoryDescriptor) -> tuple[CategoryDescriptor, ...]:
    return tuple(
        moved if item.category == moved.category else item for item in DESCRIPTORS
    )


def constants_of(module: object) -> set[str]:
    return {
        name for name in vars(module) if name.isupper() and not name.startswith("_")
    }


FIRST_CATEGORY = DESCRIPTORS[0]


def test_detection_key_and_rule_version_are_pinned() -> None:

    assert detection_key() == (
        "dc180502a0092bddf484da4199800e7c3b0e755af6bc8d8b152e4f3f420c6b8b"
    )
    assert RULE_VERSION == "7"


def test_each_category_field_is_detector_input_or_policy_only() -> None:

    declared = {field.name for field in fields(CategoryDescriptor)}

    assert declared == (DETECTOR_FIELDS | POLICY_FIELDS)
    assert DETECTOR_FIELDS.isdisjoint(POLICY_FIELDS)


def test_changing_a_category_tier_keeps_the_detection_key() -> None:

    assert FIRST_CATEGORY.tier == "always"

    moved = replace(FIRST_CATEGORY, tier="default-on")

    assert key_over(descriptors_with(moved)) == detection_key()


def test_rewording_a_placeholder_keeps_the_detection_key() -> None:

    moved = replace(FIRST_CATEGORY, placeholder="[kept back]")

    assert key_over(descriptors_with(moved)) == detection_key()


def test_changing_a_category_narrowing_keeps_the_detection_key() -> None:

    moved = replace(FIRST_CATEGORY, narrows_to="Internal")

    assert key_over(descriptors_with(moved)) == detection_key()


def test_renaming_every_category_keeps_the_detection_key() -> None:

    renamed = tuple(
        replace(descriptor, category=f"a-category-{at}")
        for at, descriptor in enumerate(DESCRIPTORS)
    )

    assert key_over(renamed) == detection_key()


def test_changing_a_threshold_changes_the_detection_key() -> None:

    moved = replace(FIRST_CATEGORY, threshold=0.55)

    assert key_over(descriptors_with(moved)) != detection_key()


def test_context_lemmas_change_the_key_but_their_order_does_not() -> None:
    bank_details = category_called("bank-details")
    lemmas = bank_details.context

    gained = replace(bank_details, context=(*lemmas, "iban"))
    reordered = replace(bank_details, context=lemmas[::-1])

    assert key_over(descriptors_with(gained)) != detection_key()
    assert key_over(descriptors_with(reordered)) == detection_key()


def test_cues_change_the_key_but_their_order_does_not() -> None:
    cues = FIRST_CATEGORY.cues

    gained = replace(FIRST_CATEGORY, cues=(*cues, "unwell"))
    reordered = replace(FIRST_CATEGORY, cues=cues[::-1])

    assert key_over(descriptors_with(gained)) != detection_key()
    assert key_over(descriptors_with(reordered)) == detection_key()


def test_lemmas_on_a_model_raised_category_keep_the_detection_key() -> None:
    job_title = category_called("job-title")
    raised = {item.rule_id: item for item in what_the_detector_reads().rules}

    assert job_title.context == ()
    assert raised["JOB_TITLE"].recogniser == "ModelRecogniser"
    assert raised["JOB_TITLE"].context == ()

    moved = replace(job_title, context=("grade", "rank"))

    assert key_over(descriptors_with(moved)) == detection_key()


def test_changing_the_consumer_domains_changes_the_detection_key() -> None:

    assert (
        key_over(consumer_domains=CONSUMER_DOMAINS | {"example.com"}) != detection_key()
    )


def test_changing_what_raises_a_category_changes_the_detection_key() -> None:

    moved = replace(FIRST_CATEGORY, raised_by=("PERSON",))

    assert key_over(descriptors_with(moved)) != detection_key()


def test_recogniser_patterns_and_flags_are_in_the_detection_key() -> None:
    read = dict(what_the_detector_reads().literals)

    assert read["A_POSTCODE"] == r"\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b flags=32"
    assert read["A_SORT_CODE_WITH_AN_ACCOUNT"].endswith(" flags=48")
    assert read["A_SENTENCE_WITH_A_CUE"] == "0.85"
    assert read["LINES_ABOVE_A_POSTCODE"] == "2"
    assert re.compile("a", re.DOTALL).flags == 48


def test_window_rule_numbers_are_in_the_detection_key() -> None:
    read = dict(what_the_detector_reads().window_rule)

    assert read["WINDOWS_A_RUN_IS_READ_WHOLE_IN"] == "2"
    assert read["chunk_size"] == "250"
    assert read["chunk_overlap"] == "50"


def test_the_converter_pin_is_not_in_the_detection_key() -> None:

    read = canonically(what_the_detector_reads())

    assert CONVERTER_PIN not in read
    assert "anydoc" not in read
    assert "pdf-inspector" not in read


def test_key_includes_every_recogniser_constant_and_no_officer_constant() -> None:
    named = {name for name, _ in DETECTOR_LITERALS}

    defined = constants_of(recognisers)

    assert set(RAISED_AFTER_THE_DETECTOR) <= constants_of(officers)
    assert defined == named & defined
    assert named.isdisjoint(RAISED_AFTER_THE_DETECTOR)


def test_every_engine_constant_is_listed_as_inside_or_outside_key() -> None:
    defined = constants_of(engine)
    in_the_key = {name for name, _ in DETECTOR_LITERALS} | {
        name for name, _ in what_the_detector_reads().window_rule
    }

    assert defined == (
        ENGINE_CONSTANTS_IN_KEY
        | ENGINE_CONSTANTS_COVERED_BY_PIN_OR_RULES
        | ENGINE_CONSTANTS_READ_AFTER_DETECTION
        | TYPE_CHECKING_CONSTANTS
    )
    assert defined & in_the_key == ENGINE_CONSTANTS_IN_KEY
    assert in_the_key.isdisjoint(
        ENGINE_CONSTANTS_COVERED_BY_PIN_OR_RULES
        | ENGINE_CONSTANTS_READ_AFTER_DETECTION
        | TYPE_CHECKING_CONSTANTS
    )


def test_every_detector_constant_is_listed_as_inside_or_outside_key() -> None:
    defined = constants_of(detector)
    in_the_key = {name for name, _ in DETECTOR_LITERALS} | {
        name for name, _ in what_the_detector_reads().window_rule
    }

    assert defined == DETECTOR_CONSTANTS_IN_KEY | DETECTOR_CONSTANTS_OUTSIDE_KEY
    assert defined & in_the_key == DETECTOR_CONSTANTS_IN_KEY
    assert in_the_key.isdisjoint(DETECTOR_CONSTANTS_OUTSIDE_KEY)
