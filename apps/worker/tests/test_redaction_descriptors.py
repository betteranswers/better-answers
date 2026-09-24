import hashlib
import json
import re
import tomllib
from importlib.metadata import version as installed_version
from pathlib import Path
from typing import Any

import pytest

from better_answers_worker.redaction.consumer_domains import (
    CONSUMER_DOMAINS,
    READ_ON,
    SOURCE,
)
from better_answers_worker.redaction.descriptors import (
    CATEGORY_BY_ENTITY,
    DESCRIPTORS,
)
from better_answers_worker.redaction.engine import (
    DESCRIPTOR_BY_ENTITY,
    GLINER_LABELS,
    build_analyzer,
    refuse_unreachable_entities,
)
from better_answers_worker.redaction.pins import (
    DETECTOR_PIN,
    GLINER_VERSION,
    PRESIDIO_VERSION,
    RULE_VERSION,
    SPACY_MODEL,
    SPACY_MODEL_VERSION,
    SPACY_VERSION,
    TORCH_VERSION,
    VERSION_STRING,
)
from better_answers_worker.redaction.pseudonyms import (
    normalised,
    pseudonyms_for,
    written_as,
)

WORKER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = WORKER_ROOT.parents[1]
AGREEMENT = REPO_ROOT / "contracts" / "redaction" / "cases.json"
CHECK_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "check.yml"


HF_HOME_IN_CI = "${{ runner.temp }}/huggingface"


PINS_FILE = "apps/worker/src/better_answers_worker/redaction/pins.py"


def agreement() -> dict[str, Any]:
    raw = AGREEMENT.read_text(encoding="utf-8")
    return dict(json.loads(raw))


def manifest() -> dict[str, Any]:
    raw = (WORKER_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    return dict(tomllib.loads(raw))


def _public_version(installed: str) -> str:
    return installed.partition("+")[0]


def pinned_by_the_installer() -> dict[str, str]:
    pins: dict[str, str] = {}
    for requirement in manifest()["project"]["dependencies"]:
        name, _, pinned = str(requirement).partition("==")
        if pinned:
            pins[name.split("[")[0].strip().lower().replace("_", "-")] = pinned
    return pins


def descriptor_digest() -> str:
    canonical = json.dumps(
        {
            "categories": [
                {
                    "category": descriptor.category,
                    "tier": descriptor.tier,
                    "raised_by": list(descriptor.raised_by),
                    "threshold": descriptor.threshold,
                    "context": list(descriptor.context),
                    "cues": list(descriptor.cues),
                    "placeholder": descriptor.placeholder,
                    "narrows_to": descriptor.narrows_to,
                }
                for descriptor in DESCRIPTORS
            ],
            "consumer_domains": sorted(CONSUMER_DOMAINS),
        },
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def test_the_descriptors_and_the_agreement_name_the_same_categories() -> None:
    declared = sorted(descriptor.category for descriptor in DESCRIPTORS)
    agreed = sorted(category["category"] for category in agreement()["categories"])

    assert declared == agreed


def test_each_descriptor_takes_its_tier_word_and_narrowing_from_the_agreement() -> None:
    by_category = {descriptor.category: descriptor for descriptor in DESCRIPTORS}

    for category in agreement()["categories"]:
        descriptor = by_category[category["category"]]
        assert descriptor.tier == category["tier"], descriptor.category
        assert descriptor.placeholder == category["placeholder"], descriptor.category
        assert descriptor.narrows_to == category["narrows_to"], descriptor.category


def test_the_entity_table_is_the_inverse_of_what_raises_each_category() -> None:

    raised = [
        (entity, descriptor.category)
        for descriptor in DESCRIPTORS
        for entity in descriptor.raised_by
    ]

    assert sorted(CATEGORY_BY_ENTITY.items()) == sorted(raised)
    assert len(raised) == len({entity for entity, _ in raised})


def test_the_always_set_is_raised_at_least_as_readily_as_a_switchable_one() -> None:

    always = [item.threshold for item in DESCRIPTORS if item.tier == "always"]
    switchable = [item.threshold for item in DESCRIPTORS if item.tier != "always"]

    assert max(always) <= min(switchable)
    for descriptor in DESCRIPTORS:
        assert 0.0 < descriptor.threshold <= 1.0, descriptor.category


def test_only_a_category_a_pattern_raises_declares_words_its_enhancer_boosts_on() -> (
    None
):
    without_context = [
        descriptor.category for descriptor in DESCRIPTORS if not descriptor.context
    ]

    # A cue's sentence scores a fixed figure and the model is handed no context, so
    # neither has a score a lemma could boost.
    assert without_context == ["special-category", "person-name", "job-title"]


def test_the_special_category_row_alone_declares_cues_and_they_are_what_withholds() -> (
    None
):
    with_cues = {
        descriptor.category: descriptor.cues
        for descriptor in DESCRIPTORS
        if descriptor.cues
    }

    assert with_cues == {
        "special-category": ("diagnose", "diagnosis", "medication", "sickness")
    }


def test_the_analyzer_is_asked_for_exactly_the_entities_the_descriptors_declare() -> (
    None
):

    registry = build_analyzer().registry

    answered_for = {
        entity
        for recogniser in registry.recognizers
        for entity in recogniser.supported_entities
    }

    assert sorted(answered_for) == sorted(CATEGORY_BY_ENTITY)


def test_a_category_nothing_can_raise_is_refused_before_an_analyzer_is_built() -> None:

    refuse_unreachable_entities(DESCRIPTOR_BY_ENTITY, GLINER_LABELS)
    asking_the_model_for_something_else = {"vehicle": "VEHICLE_REGISTRATION"}

    with pytest.raises(ValueError) as refusal:
        refuse_unreachable_entities(
            DESCRIPTOR_BY_ENTITY, asking_the_model_for_something_else
        )

    assert "PERSON" in str(refusal.value)
    assert "JOB_TITLE" in str(refusal.value)
    assert "EMAIL_ADDRESS" not in str(refusal.value)


def test_a_label_no_descriptor_declares_is_refused_before_an_analyzer_is_built() -> (
    None
):

    the_two_the_model_raises = {"person": "PERSON", "job title": "JOB_TITLE"}

    refuse_unreachable_entities(DESCRIPTOR_BY_ENTITY, the_two_the_model_raises)

    with pytest.raises(ValueError) as refusal:
        refuse_unreachable_entities(
            DESCRIPTOR_BY_ENTITY,
            {**the_two_the_model_raises, "vehicle": "VEHICLE_REGISTRATION"},
        )

    assert "VEHICLE_REGISTRATION" in str(refusal.value)
    assert "PERSON" not in str(refusal.value)
    assert "JOB_TITLE" not in str(refusal.value)


def test_the_twenty_seventh_name_keeps_the_shape_the_agreement_pins() -> None:

    shape = re.compile(agreement()["placeholder_shape"])
    met_in_order = [f"Person Number {index}" for index in range(27)]

    letters = pseudonyms_for(met_in_order, "a-binding-seed")

    assert len(letters) == 27
    first = letters[normalised(met_in_order[0])]
    twenty_seventh = letters[normalised(met_in_order[26])]
    assert len(first) == 1
    assert twenty_seventh == first * 2
    assert shape.fullmatch(written_as(twenty_seventh, "[person A]")) is not None


def test_the_version_string_is_the_rule_version_and_the_detector_pin() -> None:
    written = VERSION_STRING

    assert written == (
        "6:presidio-2.2.364+gliner-0.2.29+torch-2.14.0"
        "+spacy-3.8.16+en-core-web-sm-3.8.0+gliner-multi-pii-v1"
    )
    assert RULE_VERSION == "6"
    assert VERSION_STRING.count(":") == 1
    assert VERSION_STRING.split(":") == [RULE_VERSION, DETECTOR_PIN]


def test_the_version_string_is_written_the_way_the_agreement_says() -> None:
    pattern = re.compile(agreement()["version_string"]["pattern"])

    assert pattern.fullmatch(VERSION_STRING) is not None


def test_the_rule_version_is_bumped_with_the_table_it_stands_for() -> None:

    digest = "e2244c397c2677efaa5017848d17d8d7a499394902b73585bb67f090231b4d8d"

    assert descriptor_digest() == digest
    assert RULE_VERSION == "6"


def test_the_consumer_domain_list_carries_its_date_and_its_source() -> None:

    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", READ_ON) is not None
    assert CONSUMER_DOMAINS

    cited = {
        word.strip(",:")
        for line in SOURCE
        for word in line.split()
        if "." in word and not word.startswith("http")
    }

    assert cited == set(CONSUMER_DOMAINS)


def test_every_pin_is_the_version_the_installer_pins() -> None:
    pins = pinned_by_the_installer()

    assert pins["presidio-analyzer"] == PRESIDIO_VERSION
    assert pins["presidio-anonymizer"] == PRESIDIO_VERSION
    assert pins["gliner"] == GLINER_VERSION
    assert pins["spacy"] == SPACY_VERSION
    assert pins["torch"] == TORCH_VERSION


def test_the_spacy_pipeline_is_pinned_by_the_url_it_is_downloaded_from() -> None:

    source = manifest()["tool"]["uv"]["sources"]["en-core-web-sm"]

    assert f"{SPACY_MODEL}-{SPACY_MODEL_VERSION}" in str(source["url"])


def test_the_local_version_segment_a_wheel_reports_never_moves_the_pin() -> None:

    assert _public_version("2.14.0+cpu") == TORCH_VERSION
    assert _public_version("2.14.0") == TORCH_VERSION
    assert _public_version("2.13.0+cpu") != TORCH_VERSION


def test_every_pin_is_the_version_the_interpreter_reports() -> None:

    reported = {
        "presidio-analyzer": PRESIDIO_VERSION,
        "presidio-anonymizer": PRESIDIO_VERSION,
        "gliner": GLINER_VERSION,
        "spacy": SPACY_VERSION,
        "torch": TORCH_VERSION,
        "en-core-web-sm": SPACY_MODEL_VERSION,
    }

    for distribution, pinned in reported.items():
        assert _public_version(installed_version(distribution)) == pinned, distribution


def test_the_check_workflow_caches_the_weights_where_the_detector_reads_them() -> None:

    workflow = CHECK_WORKFLOW.read_text(encoding="utf-8")

    assert f"HF_HOME={HF_HOME_IN_CI}" in workflow
    assert f"path: {HF_HOME_IN_CI}" in workflow
    assert "uses: actions/cache@" in workflow
    assert PINS_FILE in workflow
