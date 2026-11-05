import hashlib
import json
import re
import tomllib
from importlib.metadata import version as installed_version
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
from support.roots import REPOSITORY_ROOT, WORKER_ROOT

REDACTION_CASES = REPOSITORY_ROOT / "contracts" / "redaction" / "cases.json"
CHECK_WORKFLOW = REPOSITORY_ROOT / ".github" / "workflows" / "check.yml"
BUILD_WORKFLOW = REPOSITORY_ROOT / ".github" / "workflows" / "build.yml"


HF_HOME_IN_CI = "${{ runner.temp }}/huggingface"


PINS_FILE = "apps/worker/src/better_answers_worker/redaction/pins.py"


def redaction_cases() -> dict[str, Any]:
    raw = REDACTION_CASES.read_text(encoding="utf-8")
    return dict(json.loads(raw))


def manifest() -> dict[str, Any]:
    raw = (WORKER_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    return dict(tomllib.loads(raw))


def _public_version(installed: str) -> str:
    return installed.partition("+")[0]


def pyproject_pins() -> dict[str, str]:
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


def test_descriptors_and_the_cases_file_list_the_same_categories() -> None:
    declared = sorted(descriptor.category for descriptor in DESCRIPTORS)
    agreed = sorted(
        category["category"] for category in redaction_cases()["categories"]
    )

    assert declared == agreed


def test_descriptor_tier_placeholder_and_narrowing_match_the_cases_file() -> None:
    by_category = {descriptor.category: descriptor for descriptor in DESCRIPTORS}

    for category in redaction_cases()["categories"]:
        descriptor = by_category[category["category"]]
        assert descriptor.tier == category["tier"], descriptor.category
        assert descriptor.placeholder == category["placeholder"], descriptor.category
        assert descriptor.narrows_to == category["narrows_to"], descriptor.category


def test_category_by_entity_maps_each_entity_to_its_one_category() -> None:

    raised = [
        (entity, descriptor.category)
        for descriptor in DESCRIPTORS
        for entity in descriptor.raised_by
    ]

    assert sorted(CATEGORY_BY_ENTITY.items()) == sorted(raised)
    assert len(raised) == len({entity for entity, _ in raised})


def test_always_tier_categories_have_the_lowest_thresholds() -> None:

    always = [item.threshold for item in DESCRIPTORS if item.tier == "always"]
    switchable = [item.threshold for item in DESCRIPTORS if item.tier != "always"]

    assert max(always) <= min(switchable)
    for descriptor in DESCRIPTORS:
        assert 0.0 < descriptor.threshold <= 1.0, descriptor.category


def test_only_pattern_raised_categories_declare_enhancer_words() -> None:
    without_context = [
        descriptor.category for descriptor in DESCRIPTORS if not descriptor.context
    ]

    assert without_context == ["special-category", "person-name", "job-title"]


def test_only_the_special_category_declares_cues() -> None:
    with_cues = {
        descriptor.category: descriptor.cues
        for descriptor in DESCRIPTORS
        if descriptor.cues
    }

    assert with_cues == {
        "special-category": ("diagnose", "diagnosis", "medication", "sickness")
    }


def test_analyzer_recognisers_support_exactly_the_declared_entities() -> None:

    registry = build_analyzer().registry

    supported = {
        entity
        for recogniser in registry.recognizers
        for entity in recogniser.supported_entities
    }

    assert sorted(supported) == sorted(CATEGORY_BY_ENTITY)


def test_rejects_a_category_no_recogniser_raises_before_building_analyzer() -> None:

    refuse_unreachable_entities(DESCRIPTOR_BY_ENTITY, GLINER_LABELS)
    unrelated_model_labels = {"vehicle": "VEHICLE_REGISTRATION"}

    with pytest.raises(ValueError) as refusal:
        refuse_unreachable_entities(DESCRIPTOR_BY_ENTITY, unrelated_model_labels)

    assert "PERSON" in str(refusal.value)
    assert "JOB_TITLE" in str(refusal.value)
    assert "EMAIL_ADDRESS" not in str(refusal.value)


def test_rejects_an_undeclared_model_label_before_building_an_analyzer() -> None:

    model_labels = {"person": "PERSON", "job title": "JOB_TITLE"}

    refuse_unreachable_entities(DESCRIPTOR_BY_ENTITY, model_labels)

    with pytest.raises(ValueError) as refusal:
        refuse_unreachable_entities(
            DESCRIPTOR_BY_ENTITY,
            {**model_labels, "vehicle": "VEHICLE_REGISTRATION"},
        )

    assert "VEHICLE_REGISTRATION" in str(refusal.value)
    assert "PERSON" not in str(refusal.value)
    assert "JOB_TITLE" not in str(refusal.value)


def test_the_twenty_seventh_pseudonym_matches_the_placeholder_shape() -> None:

    shape = re.compile(redaction_cases()["placeholder_shape"])
    names_in_order = [f"Person Number {index}" for index in range(27)]

    assigned = pseudonyms_for(names_in_order, "a-connected-source-seed")

    assert len(assigned) == 27
    first = assigned[normalised(names_in_order[0])]
    twenty_seventh = assigned[normalised(names_in_order[26])]
    assert len(first) == 1
    assert twenty_seventh == first * 2
    assert shape.fullmatch(written_as(twenty_seventh, "[person A]")) is not None


def test_the_version_string_joins_rule_version_and_detector_pin() -> None:
    written = VERSION_STRING

    assert written == (
        "7:presidio-2.2.364+gliner-0.2.29+torch-2.14.0"
        "+spacy-3.8.16+en-core-web-sm-3.8.0+gliner-multi-pii-v1"
    )
    assert RULE_VERSION == "7"
    assert VERSION_STRING.count(":") == 1
    assert VERSION_STRING.split(":") == [RULE_VERSION, DETECTOR_PIN]


def test_the_version_string_matches_the_cases_file_pattern() -> None:
    pattern = re.compile(redaction_cases()["version_string"]["pattern"])

    assert pattern.fullmatch(VERSION_STRING) is not None


def test_descriptor_digest_is_pinned_beside_the_rule_version() -> None:

    digest = "e2244c397c2677efaa5017848d17d8d7a499394902b73585bb67f090231b4d8d"

    assert descriptor_digest() == digest
    assert RULE_VERSION == "7"


def test_consumer_domain_list_has_a_date_and_a_matching_source() -> None:

    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", READ_ON) is not None
    assert CONSUMER_DOMAINS

    cited = {
        word.strip(",:")
        for line in SOURCE
        for word in line.split()
        if "." in word and not word.startswith("http")
    }

    assert cited == set(CONSUMER_DOMAINS)


def test_every_pin_matches_the_version_in_pyproject() -> None:
    pins = pyproject_pins()

    assert pins["presidio-analyzer"] == PRESIDIO_VERSION
    assert pins["presidio-anonymizer"] == PRESIDIO_VERSION
    assert pins["gliner"] == GLINER_VERSION
    assert pins["spacy"] == SPACY_VERSION
    assert pins["torch"] == TORCH_VERSION


def test_spacy_model_download_url_names_the_pinned_version() -> None:

    source = manifest()["tool"]["uv"]["sources"]["en-core-web-sm"]

    assert f"{SPACY_MODEL}-{SPACY_MODEL_VERSION}" in str(source["url"])


def test_a_wheel_local_version_segment_is_ignored_when_comparing_pins() -> None:

    assert _public_version("2.14.0+cpu") == TORCH_VERSION
    assert _public_version("2.14.0") == TORCH_VERSION
    assert _public_version("2.13.0+cpu") != TORCH_VERSION


def test_every_pin_matches_the_installed_version() -> None:

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


def test_check_workflow_restores_model_weights_into_hf_home() -> None:

    workflow = CHECK_WORKFLOW.read_text(encoding="utf-8")

    assert f"HF_HOME={HF_HOME_IN_CI}" in workflow
    assert f"path: {HF_HOME_IN_CI}" in workflow
    assert "uses: actions/cache/restore@" in workflow
    assert PINS_FILE in workflow


def _weights_keys(workflow: str) -> set[str]:
    return set(re.findall(r"^\s+key: (hugging-face-.*)$", workflow, re.MULTILINE))


def test_build_workflow_saves_weights_under_the_key_check_restores() -> None:
    # GitHub scopes a pull request's cache entry to its own ref, which no later
    # run reads.
    check = CHECK_WORKFLOW.read_text(encoding="utf-8")
    build = BUILD_WORKFLOW.read_text(encoding="utf-8")

    assert "uses: actions/cache@" not in check
    assert "uses: actions/cache/save@" not in check
    assert "uses: actions/cache/save@" in build
    assert f"HF_HOME={HF_HOME_IN_CI}" in build
    assert f"path: {HF_HOME_IN_CI}" in build
    assert len(_weights_keys(check)) == 1
    assert _weights_keys(build) == _weights_keys(check)
