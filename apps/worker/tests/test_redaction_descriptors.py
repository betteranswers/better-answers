"""The category descriptors against the agreement, and the pins against what is there.

One declared descriptor per category is what the analyzer registry, the entity table
and the version string are all built from, so this suite holds that one declaration to
the two things outside it that have to agree with it: the ``redaction`` agreement in
``contracts/``, which is what the other tier reads, and the versions the installer and
the running interpreter report.

Both directions are asserted (`[TEST7]`): a category in the agreement with no
descriptor would be a word the worker cannot raise, and a descriptor with no category
in the agreement would be a finding the app has no word for. Every expectation is
written down (`[TEST9]`) — the version string and the digest of the descriptor table
are literals here, so a pin or a rule edited without its bump turns this suite red,
which is what makes "one record and one bump" a rule rather than a habit.
"""

import hashlib
import json
import re
import tomllib
from importlib.metadata import version as installed_version
from pathlib import Path
from typing import Any

from better_answers_worker.redaction.consumer_domains import (
    CONSUMER_DOMAINS,
    READ_ON,
    SOURCE,
)
from better_answers_worker.redaction.descriptors import (
    CATEGORY_BY_ENTITY,
    DESCRIPTORS,
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

WORKER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = WORKER_ROOT.parents[1]
AGREEMENT = REPO_ROOT / "contracts" / "redaction" / "cases.json"
CHECK_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "check.yml"

#: Where the check workflow puts the detector's weights, spelled as that file spells
#: it.
HF_HOME_IN_CI = "${{ github.workspace }}/.cache/huggingface"

#: The pins module by the path the workflow's cache key hashes.
PINS_FILE = "apps/worker/src/better_answers_worker/redaction/pins.py"


def agreement() -> dict[str, Any]:
    raw = AGREEMENT.read_text(encoding="utf-8")
    return dict(json.loads(raw))


def manifest() -> dict[str, Any]:
    raw = (WORKER_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    return dict(tomllib.loads(raw))


def pinned_by_the_installer() -> dict[str, str]:
    """Every `name==version` the worker's manifest pins, by the name a distribution has.

    The extras in brackets are part of what to install and no part of what it is
    called.
    """
    pins: dict[str, str] = {}
    for requirement in manifest()["project"]["dependencies"]:
        name, _, pinned = str(requirement).partition("==")
        if pinned:
            pins[name.split("[")[0].strip().lower().replace("_", "-")] = pinned
    return pins


def descriptor_digest() -> str:
    """A digest of everything a rule version stands for, computed here, never by it.

    The rendering is this suite's own, so the literal below cannot drift with a change
    to how the worker spells a descriptor: only a change to what one *says* moves it.

    The consumer-domain list is in the digest because it is part of the rule and not a
    reference table the rule happens to read. Which domains count decides which
    addresses are withheld exactly as a threshold or a placeholder does, so a domain
    added or dropped without a bump of ``RULE_VERSION`` would leave findings written
    under two different rules claiming the same version. Sorted rather than taken in
    the order the module spells them, because a ``frozenset`` has no order to hash.
    """
    canonical = json.dumps(
        {
            "categories": [
                {
                    "category": descriptor.category,
                    "tier": descriptor.tier,
                    "raised_by": list(descriptor.raised_by),
                    "threshold": descriptor.threshold,
                    "context": list(descriptor.context),
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
    # The table a recogniser's answer is read through is derived from the declarations
    # and never written twice, so this holds the derivation both ways: every entity a
    # descriptor names is in the table under that category, and the table names no
    # entity no descriptor raises. An entity claimed by two categories would collapse
    # silently into whichever was declared last, so the count is asserted as well.
    raised = [
        (entity, descriptor.category)
        for descriptor in DESCRIPTORS
        for entity in descriptor.raised_by
    ]

    assert sorted(CATEGORY_BY_ENTITY.items()) == sorted(raised)
    assert len(raised) == len({entity for entity, _ in raised})


def test_the_always_set_is_raised_at_least_as_readily_as_a_switchable_one() -> None:
    # A threshold is policy and not a tuning knob: the set no binding switches off is
    # the set a miss costs most, so it may never ask for more confidence than a tier a
    # binding can turn off. Every threshold is a Presidio score, which is a
    # probability.
    always = [item.threshold for item in DESCRIPTORS if item.tier == "always"]
    switchable = [item.threshold for item in DESCRIPTORS if item.tier != "always"]

    assert max(always) <= min(switchable)
    for descriptor in DESCRIPTORS:
        assert 0.0 < descriptor.threshold <= 1.0, descriptor.category


def test_every_category_declares_the_words_its_context_enhancer_boosts_on() -> None:
    # "In context" in the spec is Presidio's context enhancer, named: a date beside
    # *date of birth* is a finding and a bare date is not. The two tiers a binding can
    # switch off are the ones that need the word beside the span; a name is raised by
    # the model itself, so `person-name` is the one category that declares none.
    without_context = [
        descriptor.category for descriptor in DESCRIPTORS if not descriptor.context
    ]

    assert without_context == ["person-name"]


def test_the_version_string_is_the_rule_version_and_the_detector_pin() -> None:
    written = VERSION_STRING

    assert written == (
        "2:presidio-2.2.364+gliner-0.2.29+torch-2.14.0"
        "+spacy-3.8.16+en-core-web-sm-3.8.0+gliner-multi-pii-v1"
    )
    assert RULE_VERSION == "2"
    assert VERSION_STRING.count(":") == 1
    assert VERSION_STRING.split(":") == [RULE_VERSION, DETECTOR_PIN]


def test_the_version_string_is_written_the_way_the_agreement_says() -> None:
    pattern = re.compile(agreement()["version_string"]["pattern"])

    assert pattern.fullmatch(VERSION_STRING) is not None


def test_the_rule_version_is_bumped_with_the_table_it_stands_for() -> None:
    # `rule_version` is one constant bumped whenever a rule, the category table, the
    # consumer-domain list or a recogniser changes. Edit a descriptor or a domain
    # without bumping it and this literal stops matching: they are changed together or
    # the suite is red.
    digest = "4aa310ea6ac1671c693d411c9f2dd5c8bf1b8a1c70dd1e361689dd66a6d94cb0"

    assert descriptor_digest() == digest
    assert RULE_VERSION == "2"


def test_the_consumer_domain_list_carries_its_date_and_its_source() -> None:
    # What acceptance asks of a list that decides what is withheld: it is a tracked
    # file, it says when it was settled, and it says where each domain on it was read.
    # Membership is asserted both ways (`[TEST7]`) — a domain with no source line is a
    # rule nobody can check, and a source line naming a domain that is not on the list
    # is a citation for a rule that is not there.
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
    # The English pipeline is a release asset rather than a PyPI package, so the
    # download URL is its pin and the two constants have to be the URL's own two
    # halves.
    source = manifest()["tool"]["uv"]["sources"]["en-core-web-sm"]

    assert f"{SPACY_MODEL}-{SPACY_MODEL_VERSION}" in str(source["url"])


def test_every_pin_is_the_version_the_interpreter_reports() -> None:
    # The half that stops a constant ageing alone: the manifest above says what to
    # install and this says what is installed, so a lock refreshed without the
    # constant, or a constant edited without the lock, is caught on the next run.
    reported = {
        "presidio-analyzer": PRESIDIO_VERSION,
        "presidio-anonymizer": PRESIDIO_VERSION,
        "gliner": GLINER_VERSION,
        "spacy": SPACY_VERSION,
        "torch": TORCH_VERSION,
        "en-core-web-sm": SPACY_MODEL_VERSION,
    }

    for distribution, pinned in reported.items():
        assert installed_version(distribution) == pinned, distribution


def test_the_check_workflow_caches_the_weights_where_the_detector_reads_them() -> None:
    # A model downloaded on every run is a minute a run does not have; one cached
    # under a key that does not name the pins is a stale hit nobody would notice.
    workflow = CHECK_WORKFLOW.read_text(encoding="utf-8")

    assert f"HF_HOME: {HF_HOME_IN_CI}" in workflow
    assert f"path: {HF_HOME_IN_CI}" in workflow
    assert "uses: actions/cache@" in workflow
    assert PINS_FILE in workflow
