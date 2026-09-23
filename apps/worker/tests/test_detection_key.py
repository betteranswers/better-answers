import re
from dataclasses import fields, replace

from better_answers_worker.pipeline import CONVERTER_PIN
from better_answers_worker.redaction import engine, recognisers
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

WHAT_THE_DETECTOR_READS_OF_A_CATEGORY = frozenset({"raised_by", "threshold", "context"})


WHAT_ONLY_THE_RULE_VERSION_STANDS_FOR = frozenset(
    {"category", "tier", "placeholder", "narrows_to"}
)


THE_ENGINE_S_OWN_IN_THE_KEY = frozenset(
    {
        "GLINER_LABELS",
        "PHONE_LENIENCY",
        "PHONE_REGIONS",
        "WINDOWS_A_RUN_IS_READ_WHOLE_IN",
    }
)


THE_ENGINE_S_OWN_CARRIED_BY_THE_PIN_OR_THE_RULES = frozenset(
    {
        "ANALYSED_ENTITIES",
        "CATEGORY_BY_ENTITY",
        "DESCRIPTORS",
        "DESCRIPTOR_BY_CATEGORY",
        "DESCRIPTOR_BY_ENTITY",
        "GLINER_MODEL_ID",
        "RECOGNISERS",
        "SPACY_MODEL",
    }
)


THE_ENGINE_S_OWN_READ_AFTER_THE_DETECTOR = frozenset(
    {"ALWAYS_TIER", "MODEL_RULE_NAME", "TIER_PRECEDENCE"}
)


def key_over(
    descriptors: tuple[CategoryDescriptor, ...] = DESCRIPTORS,
    consumer_domains: frozenset[str] = CONSUMER_DOMAINS,
) -> str:
    return detection_key_of(what_the_detector_reads(descriptors, consumer_domains))


def category_called(category: str) -> CategoryDescriptor:
    return next(item for item in DESCRIPTORS if item.category == category)


def the_table_with(moved: CategoryDescriptor) -> tuple[CategoryDescriptor, ...]:
    return tuple(
        moved if item.category == moved.category else item for item in DESCRIPTORS
    )


def constants_of(module: object) -> set[str]:
    return {
        name for name in vars(module) if name.isupper() and not name.startswith("_")
    }


THE_FIRST_CATEGORY = DESCRIPTORS[0]


def test_the_key_is_pinned_beside_the_rule_version_it_implies_a_move_of() -> None:

    assert detection_key() == (
        "0917c5a29900111457ee127ebecb99363531765a0d7e7108851ef1a95a444d59"
    )
    assert RULE_VERSION == "4"


def test_every_field_a_category_declares_is_the_detector_s_or_policy_s_alone() -> None:

    declared = {field.name for field in fields(CategoryDescriptor)}

    assert declared == (
        WHAT_THE_DETECTOR_READS_OF_A_CATEGORY | WHAT_ONLY_THE_RULE_VERSION_STANDS_FOR
    )
    assert WHAT_THE_DETECTOR_READS_OF_A_CATEGORY.isdisjoint(
        WHAT_ONLY_THE_RULE_VERSION_STANDS_FOR
    )


def test_moving_a_category_to_default_on_re_reads_no_page() -> None:

    assert THE_FIRST_CATEGORY.tier == "always"

    moved = replace(THE_FIRST_CATEGORY, tier="default-on")

    assert key_over(the_table_with(moved)) == detection_key()


def test_rewording_a_placeholder_re_reads_no_page() -> None:

    moved = replace(THE_FIRST_CATEGORY, placeholder="[kept back]")

    assert key_over(the_table_with(moved)) == detection_key()


def test_changing_what_a_category_narrows_a_document_to_re_reads_no_page() -> None:

    moved = replace(THE_FIRST_CATEGORY, narrows_to="Internal")

    assert key_over(the_table_with(moved)) == detection_key()


def test_renaming_every_category_in_the_table_re_reads_no_page() -> None:

    renamed = tuple(
        replace(descriptor, category=f"a-category-{at}")
        for at, descriptor in enumerate(DESCRIPTORS)
    )

    assert key_over(renamed) == detection_key()


def test_moving_a_threshold_re_reads_every_page() -> None:

    moved = replace(THE_FIRST_CATEGORY, threshold=0.55)

    assert key_over(the_table_with(moved)) != detection_key()


def test_moving_a_context_lemma_re_reads_every_page() -> None:

    lemmas = THE_FIRST_CATEGORY.context

    gained = replace(THE_FIRST_CATEGORY, context=(*lemmas, "unwell"))
    reordered = replace(THE_FIRST_CATEGORY, context=lemmas[::-1])

    assert key_over(the_table_with(gained)) != detection_key()
    assert key_over(the_table_with(reordered)) == detection_key()


def test_a_lemma_the_model_is_never_handed_re_reads_no_page() -> None:
    job_title = category_called("job-title")
    raised = {item.rule_id: item for item in what_the_detector_reads().rules}

    assert job_title.context == ("role", "title", "position")
    assert raised["JOB_TITLE"].recogniser == "ModelRecogniser"
    assert raised["JOB_TITLE"].context == ()

    moved = replace(job_title, context=("grade", "rank"))

    assert key_over(the_table_with(moved)) == detection_key()


def test_moving_the_consumer_domain_list_re_reads_every_page() -> None:

    assert (
        key_over(consumer_domains=CONSUMER_DOMAINS | {"example.com"}) != detection_key()
    )


def test_swapping_the_recogniser_a_rule_is_raised_by_re_reads_every_page() -> None:

    moved = replace(THE_FIRST_CATEGORY, raised_by=("PERSON",))

    assert key_over(the_table_with(moved)) != detection_key()


def test_a_recogniser_s_own_pattern_and_flags_reach_the_key() -> None:
    read = dict(what_the_detector_reads().literals)

    assert read["A_POSTCODE"] == r"\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b flags=32"
    assert read["A_SORT_CODE_WITH_AN_ACCOUNT"].endswith(" flags=48")
    assert read["A_SENTENCE_WITH_A_CUE"] == "0.85"
    assert read["LINES_ABOVE_A_POSTCODE"] == "2"
    assert re.compile("a", re.DOTALL).flags == 48


def test_the_window_rule_s_own_numbers_reach_the_key() -> None:
    read = dict(what_the_detector_reads().window_rule)

    assert read["WINDOWS_A_RUN_IS_READ_WHOLE_IN"] == "2"
    assert read["chunk_size"] == "250"
    assert read["chunk_overlap"] == "50"


def test_the_converter_pin_is_in_no_detection_key() -> None:

    read = canonically(what_the_detector_reads())

    assert CONVERTER_PIN not in read
    assert "anydoc" not in read
    assert "pdf-inspector" not in read


def test_every_literal_a_recogniser_holds_is_read_but_the_officers_blocks_own() -> None:
    named = {name for name, _ in DETECTOR_LITERALS}

    held = constants_of(recognisers)

    assert set(RAISED_AFTER_THE_DETECTOR) <= held
    assert held - set(RAISED_AFTER_THE_DETECTOR) == named & held
    assert named.isdisjoint(RAISED_AFTER_THE_DETECTOR)


def test_every_constant_the_engine_holds_is_placed_on_one_side_of_the_key() -> None:
    held = constants_of(engine)
    in_the_key = {name for name, _ in DETECTOR_LITERALS} | {
        name for name, _ in what_the_detector_reads().window_rule
    }

    assert held == (
        THE_ENGINE_S_OWN_IN_THE_KEY
        | THE_ENGINE_S_OWN_CARRIED_BY_THE_PIN_OR_THE_RULES
        | THE_ENGINE_S_OWN_READ_AFTER_THE_DETECTOR
    )
    assert held & in_the_key == THE_ENGINE_S_OWN_IN_THE_KEY
    assert in_the_key.isdisjoint(
        THE_ENGINE_S_OWN_CARRIED_BY_THE_PIN_OR_THE_RULES
        | THE_ENGINE_S_OWN_READ_AFTER_THE_DETECTOR
    )
