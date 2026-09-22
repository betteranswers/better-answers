import base64
import json
import logging
import os
import re
import subprocess
import tempfile
import tomllib
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import pytest

from conftest import DAEMON_SKIP_REASON
from deploy_unit import worker_environment, worker_service
from planted_page import (
    FINDINGS_BY_CATEGORY,
    FIXTURE_PAGE,
    spans_withheld_under,
    typed_placeholders_under,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKSPACE = REPO_ROOT / "apps" / "worker"
BUILD_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "build.yml"
CHECK_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "check.yml"
STORES_COMPOSE = REPO_ROOT / "deploy" / "stores.compose.yaml"
PINS = WORKSPACE / "src" / "better_answers_worker" / "redaction" / "pins.py"
DOCKERFILE = WORKSPACE / "Dockerfile"


TESTS_IN_THE_IMAGE = "/app/tests"


BASE_IMAGE_PREFIX = "/usr/local"


REQUIRED_IMPORTS = ("better_answers_worker", "better_answers_worker.schema_view")


DETECTOR_IMPORTS = (
    "presidio_analyzer",
    "presidio_anonymizer",
    "gliner",
    "spacy",
    "torch",
    "huggingface_hub",
)


HOST_IMPORTS = (
    "cocoindex",
    "asyncpg",
    "boto3",
)


CONVERTER_IMPORTS = (
    "anydoc",
    "pdf_inspector",
)


CONVERTER_DISTRIBUTIONS = (
    "firecrawl-anydoc",
    "pdf-inspector",
)


PROBED_IMPORTS = REQUIRED_IMPORTS + DETECTOR_IMPORTS + HOST_IMPORTS + CONVERTER_IMPORTS


WEIGHTS_MODULE = "better_answers_worker.redaction.weights"


THE_SAFE_SET = '{"default_on": true, "default_off": false}'
SEED = "b0f3a1d2c4e5"
THE_RULES_IN_FORCE = cast("Mapping[str, bool]", json.loads(THE_SAFE_SET))


WITHHELD_SPANS = spans_withheld_under(THE_RULES_IN_FORCE)


PLACEHOLDERS_IN_THE_TEXT: Mapping[str, int] = {
    "[withheld]": 6,
    **typed_placeholders_under(THE_RULES_IN_FORCE),
}


VERDICT = "Restricted"


PINNED_IN_THE_VERSION_STRING = (
    "PRESIDIO_VERSION",
    "GLINER_VERSION",
    "TORCH_VERSION",
    "SPACY_VERSION",
    "SPACY_MODEL_VERSION",
)

NO_DAEMON = (
    "no Docker daemon answered, so the worker image cannot be read: on CI these tests"
    " fail rather than skip, because build.yml gates the image push on this workflow"
)


def _docker_answers() -> bool:
    try:
        subprocess.run(
            ["docker", "info", "--format", "{{.ServerVersion}}"],
            check=True,
            capture_output=True,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return True


DOCKER_ANSWERS = _docker_answers()


DAEMON_IS_REQUIRED = os.environ.get("CI", "") != ""


PROBE_DEFERRAL_VARIABLE = "IMAGE_PROBE_DEFERRED"
PROBE_RUNS_IN_THE_JOB_THAT_PUSHES = os.environ.get(PROBE_DEFERRAL_VARIABLE) == "true"


IMAGE_ID_VARIABLE = "IMAGE_ID"


def _matrix_legs() -> list[dict[str, str]]:
    lines = BUILD_WORKFLOW.read_text("utf-8").splitlines()
    starts = [index for index, line in enumerate(lines) if line.strip() == "include:"]
    if len(starts) != 1:
        message = (
            f"expected one `include:` list in {BUILD_WORKFLOW}, found {len(starts)}"
        )
        raise RuntimeError(message)
    start = starts[0]
    depth = len(lines[start]) - len(lines[start].lstrip())

    legs: list[dict[str, str]] = []
    for line in lines[start + 1 :]:
        body = line.strip()
        if not body:
            continue
        if len(line) - len(line.lstrip()) <= depth:
            break
        if body.startswith("#"):
            continue
        if body.startswith("- "):
            legs.append({})
            body = body[2:]
        key, separator, value = body.partition(": ")
        if legs and separator:
            legs[-1][key] = value.strip()
    if not legs:
        message = f"no matrix legs read out of {BUILD_WORKFLOW}"
        raise RuntimeError(message)
    return legs


def matrix_leg(tier: str) -> dict[str, str]:
    legs = _matrix_legs()
    for leg in legs:
        if leg.get("tier") == tier:
            return leg
    built = ", ".join(leg.get("tier", "?") for leg in legs)
    message = f"build.yml's image job has no `{tier}` leg; it builds {built}"
    raise RuntimeError(message)


def _pyproject_at(*path: str) -> object:
    with (WORKSPACE / "pyproject.toml").open("rb") as handle:
        found: object = tomllib.load(handle)
    for step in path:
        if not isinstance(found, dict):
            message = f"pyproject.toml has no table at {'.'.join(path)}"
            raise RuntimeError(message)
        found = found[step]
    return found


def _requirements(*path: str) -> list[str]:
    found = _pyproject_at(*path)
    if not isinstance(found, list):
        message = f"pyproject.toml's {'.'.join(path)} is not a list of requirements"
        raise RuntimeError(message)
    return [str(each) for each in found]


def _distribution_name(requirement: str) -> str:
    named = re.match(r"[A-Za-z0-9._-]+", requirement)
    if named is None:
        message = f"no distribution name in the requirement {requirement!r}"
        raise RuntimeError(message)
    return named.group(0)


def development_only_distributions() -> list[str]:
    development = {
        _distribution_name(each) for each in _requirements("dependency-groups", "dev")
    }
    runtime = {
        _distribution_name(each) for each in _requirements("project", "dependencies")
    }
    return sorted(development - runtime)


def pinned_python_version() -> tuple[int, int]:
    pinned = (WORKSPACE / ".python-version").read_text("utf-8").strip()
    major, _, minor = pinned.partition(".")
    return int(major), int(minor)


def required_python_floor() -> tuple[int, int]:
    declared = _pyproject_at("project", "requires-python")
    floor = re.search(r">=\s*(\d+)\.(\d+)", str(declared))
    if floor is None:
        message = "pyproject.toml's requires-python has no lower bound this can read"
        raise RuntimeError(message)
    return int(floor.group(1)), int(floor.group(2))


def base_image_python_version() -> tuple[int, int, int]:
    tags = re.findall(
        r"^FROM python:(\d+)\.(\d+)\.(\d+)-",
        WORKSPACE.joinpath("Dockerfile").read_text("utf-8"),
        re.M,
    )
    versions = {tuple(int(part) for part in tag) for tag in tags}
    if len(versions) != 1:
        message = (
            f"expected one pinned Python base image in the Dockerfile,"
            f" found {len(versions)}"
        )
        raise RuntimeError(message)
    major, minor, patch = versions.pop()
    return major, minor, patch


def _pin(name: str) -> str:
    found = re.search(rf'^{name} = "([^"]+)"', PINS.read_text("utf-8"), re.M)
    if found is None:
        message = f"{PINS} declares no {name} this can read"
        raise RuntimeError(message)
    return found.group(1)


def pinned_model_ids() -> tuple[str, ...]:
    return (_pin("GLINER_MODEL_ID"), _pin("GLINER_MODEL_ID_MEASURED"))


def worker_mounts_over(path: str) -> list[str]:
    return [
        line.strip()
        for line in worker_service().splitlines()
        if re.match(rf"\s*- \S+:{re.escape(path)}(:\S*)?\s*(#.*)?$", line)
    ]


def chowned_worker_uid() -> int:
    uids = {
        int(found)
        for found in re.findall(
            r"worker/[\w-]+:(\d+)", STORES_COMPOSE.read_text("utf-8")
        )
    }
    if len(uids) != 1:
        message = (
            f"expected one uid for the worker's volumes in {STORES_COMPOSE},"
            f" found {len(uids)}"
        )
        raise RuntimeError(message)
    return uids.pop()


PROBE = """
import importlib, json, os, sys
from importlib import metadata

def installed(name):
    try:
        metadata.distribution(name)
    except metadata.PackageNotFoundError:
        return False
    return True

def imports(name):
    try:
        importlib.import_module(name)
    except ImportError:
        return False
    return True

def cached(model_id):
    # `local_files_only` is the whole of the question: it answers a path when the cache
    # holds the model and raises when it would have to reach the network for it, which
    # is exactly the difference between a weight the build fetched and one the first
    # run would.
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(model_id, local_files_only=True)
    except Exception:
        return False
    return True

def pipeline(name):
    try:
        import spacy
        spacy.load(name)
    except Exception:
        return False
    return True

sys.stdout.write(json.dumps({
    "development": [
        n
        for n in json.loads(os.environ["PROBE_DEVELOPMENT"])
        if installed(n) or imports(n)
    ],
    "version": list(sys.version_info[:3]),
    "base_prefix": sys.base_prefix,
    "uid": os.getuid(),
    "imports": {n: imports(n) for n in json.loads(os.environ["PROBE_IMPORTS"])},
    "has_tests": os.path.isdir(os.environ["PROBE_TESTS"]),
    "weights": {m: cached(m) for m in json.loads(os.environ["PROBE_MODEL_IDS"])},
    "spacy_pipeline": pipeline(os.environ["PROBE_SPACY_PIPELINE"]),
    "hf_home": os.environ.get("HF_HOME", ""),
    "usage_tracking": os.environ.get("COCOINDEX_DISABLE_USAGE_TRACKING", ""),
}))
"""


REDACTION_PROBE = """
import json, logging, os, sys

from better_answers_worker.redaction import redact

reached_out = []

class Caught(logging.Handler):
    def emit(self, record):
        reached_out.append(record.getMessage())

# The load is lazy — importing the library builds its extractor, and the list is read on
# the first address it is asked about — so a handler attached after the import above
# still sees every attempt the seam makes.
watched = logging.getLogger("tldextract")
watched.setLevel(logging.WARNING)
watched.addHandler(Caught(level=logging.WARNING))

# Listed before the seam runs, so what is answered is what the image was carrying and
# never something this container wrote on its way through.
cache = os.environ.get("TLDEXTRACT_CACHE", "")
warmed = sorted(
    os.path.relpath(os.path.join(where, name), cache)
    for where, _, names in os.walk(cache)
    for name in names
)

found = redact(
    os.environ["PROBE_PAGE"],
    json.loads(os.environ["PROBE_RULES"]),
    (),
    os.environ["PROBE_SEED"],
)
sys.stdout.write(json.dumps({
    "text": found.text,
    "counts": dict(found.counts),
    "verdict": found.verdict,
    "version": found.version,
    "suffix_cache": cache,
    "suffix_cache_entries": warmed,
    "reached_out": reached_out,
}))
"""


MEASUREMENT_RUNS = 3


MEASUREMENT_PROBE = """
import json, os, statistics, sys, time

from better_answers_worker.redaction import redact
from better_answers_worker.redaction.engine import ANALYSED_ENTITIES, analyzer
from better_answers_worker.redaction.pins import GLINER_MODEL_ID

page = os.environ["PROBE_PAGE"]
rules = json.loads(os.environ["PROBE_RULES"])
seed = os.environ["PROBE_SEED"]
runs = int(os.environ["PROBE_RUNS"])
entities = list(ANALYSED_ENTITIES)

def median(work):
    taken = []
    for _ in range(runs):
        started = time.perf_counter()
        work()
        taken.append((time.perf_counter() - started) * 1000)
    return statistics.median(taken)

started = time.perf_counter()
analyzer()
pinned_load = (time.perf_counter() - started) * 1000

seam = median(lambda: redact(page, rules, (), seed))
pinned = median(lambda: analyzer().analyze(text=page, language="en", entities=entities))

sys.stdout.write(json.dumps({
    "runs": runs,
    "pinned_model": GLINER_MODEL_ID,
    "pinned_load_ms": pinned_load,
    "seam_ms": seam,
    "pinned_ms": pinned,
}))
"""


CONVERSION_FIXTURES = WORKSPACE / "tests" / "fixtures" / "conversion"
PROBED_FIXTURES = ("expenses-policy.docx", "rate-card.pdf")


CONVERTERS_MAY_ADD_MB = 100


CONVERTER_PROBE = """
import base64, json, os, resource, sys, tempfile

import cocoindex as coco
from better_answers_worker.pipeline import converted

def peak_mb():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024

@coco.fn(memo=True)
def convert(body: bytes, media_type: str, version: str) -> str:
    return converted(body, media_type)

@coco.fn
async def one(landing, read, version):
    name, body, media_type = landing
    read[name] = await coco.use_mount(convert, body, media_type, version)

@coco.fn
async def every(landings, read, version) -> int:
    await coco.mount_each(
        one, [(one_of[0], one_of) for one_of in landings], read, version
    )
    return len(landings)

def pass_over(landings, store, version):
    read = {}
    coco.App(
        coco.AppConfig(
            name="converters",
            environment=coco.Environment(
                coco.Settings(db_path=store), name="converters:" + version
            ),
        ),
        every,
        landings,
        read,
        version,
    ).update_blocking()
    return read

landings = tuple(
    (name, base64.b64decode(body), media_type)
    for name, body, media_type in json.loads(os.environ["PROBE_FIXTURES"])
)
before = peak_mb()
with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
    once = pass_over(landings, first, "once")
    twice = pass_over(landings, second, "twice")
after = peak_mb()

sys.stdout.write(json.dumps({
    "converted": once,
    "deterministic": once == twice,
    "added_mb": after - before,
}))
"""


@dataclass(frozen=True)
class Conversion:
    converted: Mapping[str, str]
    deterministic: bool
    added_mb: float


def probed_fixtures() -> list[list[str]]:
    by_suffix = {
        ".docx": (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
        ".pdf": "application/pdf",
    }
    return [
        [
            name,
            base64.b64encode((CONVERSION_FIXTURES / name).read_bytes()).decode("ascii"),
            by_suffix[Path(name).suffix],
        ]
        for name in PROBED_FIXTURES
    ]


def _read_conversion(stdout: str) -> Conversion:

    answered = _answered(stdout)
    return Conversion(
        converted={
            str(name): str(text) for name, text in answered["converted"].items()
        },
        deterministic=bool(answered["deterministic"]),
        added_mb=float(answered["added_mb"]),
    )


@dataclass(frozen=True)
class ImageContents:
    development: tuple[str, ...]
    version: tuple[int, int, int]
    base_prefix: str
    uid: int
    imports: Mapping[str, bool]
    has_tests: bool
    weights: Mapping[str, bool]
    spacy_pipeline: bool
    hf_home: str
    usage_tracking: str


def _read_contents(stdout: str) -> ImageContents:

    answered = _answered(stdout)
    major, minor, patch = answered["version"]
    return ImageContents(
        development=tuple(str(name) for name in answered["development"]),
        version=(int(major), int(minor), int(patch)),
        base_prefix=str(answered["base_prefix"]),
        uid=int(answered["uid"]),
        imports={str(name): bool(found) for name, found in answered["imports"].items()},
        has_tests=bool(answered["has_tests"]),
        weights={
            str(model): bool(found) for model, found in answered["weights"].items()
        },
        spacy_pipeline=bool(answered["spacy_pipeline"]),
        hf_home=str(answered["hf_home"]),
        usage_tracking=str(answered["usage_tracking"]),
    )


@dataclass(frozen=True)
class Measurement:
    runs: int
    pinned_model: str
    pinned_load_ms: float
    seam_ms: float
    pinned_ms: float


def _read_measurement(stdout: str) -> Measurement:

    answered = _answered(stdout)
    return Measurement(
        runs=int(answered["runs"]),
        pinned_model=str(answered["pinned_model"]),
        pinned_load_ms=float(answered["pinned_load_ms"]),
        seam_ms=float(answered["seam_ms"]),
        pinned_ms=float(answered["pinned_ms"]),
    )


SHARED_CACHE_TOKEN = "ACTIONS_RUNTIME_TOKEN"
SHARED_CACHE_URLS = ("ACTIONS_RESULTS_URL", "ACTIONS_CACHE_URL")


DRIVER_WITHOUT_AN_EXPORT = "docker"


def _builder_that_can_export(inspected: str) -> str | None:
    read: dict[str, str] = {}
    for line in inspected.splitlines():
        name, separator, value = line.partition(":")
        if separator and not line.startswith((" ", "\t")):
            read.setdefault(name.strip(), value.strip())
    named = read.get("Name", "")
    driver = read.get("Driver", "")
    if not named or not driver or driver == DRIVER_WITHOUT_AN_EXPORT:
        return None
    return named


def _shared_cache_builder() -> str | None:
    if not os.environ.get(SHARED_CACHE_TOKEN, "").strip():
        return None
    if not any(os.environ.get(name, "").strip() for name in SHARED_CACHE_URLS):
        return None
    try:
        inspected = subprocess.run(
            ["docker", "buildx", "inspect"],
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if inspected.returncode != 0:
        return None
    return _builder_that_can_export(inspected.stdout)


def _build_command(
    leg: Mapping[str, str], *, builder: str | None, iidfile: Path
) -> list[str]:
    if builder is None:
        return [
            "docker",
            "build",
            "--quiet",
            "--file",
            leg["dockerfile"],
            leg["context"],
        ]
    return [
        "docker",
        "buildx",
        "build",
        "--builder",
        builder,
        "--cache-from",
        f"type=gha,scope={leg['tier']}",
        "--load",
        "--iidfile",
        str(iidfile),
        "--file",
        leg["dockerfile"],
        leg["context"],
    ]


def _build_the_image(leg: Mapping[str, str]) -> str:
    builder = _shared_cache_builder()
    with tempfile.TemporaryDirectory() as scratch:
        iidfile = Path(scratch) / "image-id"
        built = subprocess.run(
            _build_command(leg, builder=builder, iidfile=iidfile),
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
            timeout=900,
        )
        if builder is None:
            return built.stdout.strip()
        return iidfile.read_text(encoding="utf-8").strip()


def _run_the_image(
    image: str,
    environment: dict[str, str],
    *,
    probe: str = PROBE,
    network: str | None = None,
    timeout: int = 300,
) -> str:
    arguments = ["docker", "run", "--rm"]
    if network is not None:
        arguments += ["--network", network]

    # By name and never by value: `--env NAME` takes the value out of this process's
    # environment, so a derived list never reaches another user's `ps`.
    for name in environment:
        arguments += ["--env", name]
    arguments += [image, "python", "-c", probe]
    started = subprocess.run(
        arguments,
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout,
        env={**os.environ, **environment},
    )
    return started.stdout


def _answered(stdout: str) -> dict[str, Any]:
    lines = [line for line in stdout.splitlines() if line.strip()]
    if not lines:
        message = "the container wrote nothing to stdout"
        raise RuntimeError(message)
    answered: dict[str, Any] = json.loads(lines[-1])
    return answered


@pytest.fixture(scope="module")
def image() -> Iterator[str]:
    if PROBE_RUNS_IN_THE_JOB_THAT_PUSHES:
        pytest.skip(
            "the job that pushes this image runs this file against its own build"
        )
    if not DOCKER_ANSWERS:
        if DAEMON_IS_REQUIRED:
            raise RuntimeError(NO_DAEMON)
        pytest.skip(DAEMON_SKIP_REASON)

    supplied = os.environ.get(IMAGE_ID_VARIABLE, "").strip()

    # Run by id, never tagged: the daemon is shared, so two worktrees running `check`
    # at once would overwrite the tag and read each other's image.
    built_here = _build_the_image(matrix_leg("worker")) if not supplied else None
    try:
        yield built_here or supplied
    finally:
        if built_here is not None:
            subprocess.run(
                ["docker", "rmi", "--force", built_here],
                check=False,
                capture_output=True,
                timeout=120,
            )


@pytest.fixture(scope="module")
def contents(image: str) -> ImageContents:
    return _read_contents(
        _run_the_image(
            image,
            {
                "PROBE_DEVELOPMENT": json.dumps(development_only_distributions()),
                "PROBE_IMPORTS": json.dumps(list(PROBED_IMPORTS)),
                "PROBE_TESTS": TESTS_IN_THE_IMAGE,
                "PROBE_MODEL_IDS": json.dumps(list(pinned_model_ids())),
                "PROBE_SPACY_PIPELINE": _pin("SPACY_MODEL"),
            },
        )
    )


def test_the_image_gives_the_worker_no_development_dependency_it_could_load(
    contents: ImageContents,
) -> None:
    assert development_only_distributions()
    assert list(contents.development) == []


def test_the_image_runs_the_interpreter_this_tier_says_it_requires(
    contents: ImageContents,
) -> None:

    assert pinned_python_version() == required_python_floor()
    assert contents.version[:2] == pinned_python_version()


def test_the_interpreter_is_the_base_images_and_not_one_the_build_fetched(
    contents: ImageContents,
) -> None:

    assert contents.version == base_image_python_version()
    assert contents.base_prefix == BASE_IMAGE_PREFIX


def test_the_image_carries_the_tier_and_its_generated_schema_view(
    contents: ImageContents,
) -> None:
    assert {name: contents.imports[name] for name in REQUIRED_IMPORTS} == dict.fromkeys(
        REQUIRED_IMPORTS, True
    )


def test_the_image_carries_every_library_the_detector_runs_on(
    contents: ImageContents,
) -> None:

    assert {name: contents.imports[name] for name in DETECTOR_IMPORTS} == dict.fromkeys(
        DETECTOR_IMPORTS, True
    )

    assert set(contents.imports) == set(PROBED_IMPORTS)


def test_the_image_carries_both_converters_at_the_versions_this_tier_pins(
    contents: ImageContents,
) -> None:

    assert {
        name: contents.imports[name] for name in CONVERTER_IMPORTS
    } == dict.fromkeys(CONVERTER_IMPORTS, True)

    pinned = {
        _distribution_name(each): each
        for each in _requirements("project", "dependencies")
    }
    assert [pinned.get(name) for name in CONVERTER_DISTRIBUTIONS] == [
        "firecrawl-anydoc==0.2.4",
        "pdf-inspector==1.22.0",
    ]


def test_the_image_carries_every_library_the_host_composes(
    contents: ImageContents,
) -> None:

    assert {name: contents.imports[name] for name in HOST_IMPORTS} == dict.fromkeys(
        HOST_IMPORTS, True
    )


def test_the_image_carries_the_model_the_seam_runs_and_not_the_one_it_was_measured_on(
    contents: ImageContents,
) -> None:

    assert dict(contents.weights) == {
        _pin("GLINER_MODEL_ID"): True,
        _pin("GLINER_MODEL_ID_MEASURED"): False,
    }
    assert len(pinned_model_ids()) == 2
    assert contents.spacy_pipeline is True


def test_the_image_holds_its_weights_where_the_deploy_unit_says_they_are(
    contents: ImageContents,
) -> None:

    assert contents.hf_home == worker_environment("HF_HOME")
    assert contents.hf_home != ""


def test_the_image_stops_the_engine_calling_its_gateway_and_the_deploy_unit_agrees(
    contents: ImageContents,
) -> None:
    assert contents.usage_tracking == worker_environment(
        "COCOINDEX_DISABLE_USAGE_TRACKING"
    )
    assert contents.usage_tracking == "1"


def test_the_deploy_unit_mounts_nothing_over_the_weights_the_image_carries() -> None:
    assert worker_mounts_over(worker_environment("HF_HOME")) == []


def test_the_lmdb_mount_with_its_trailing_comment_is_caught_and_a_longer_path_is_not(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert worker_mounts_over("/data/worker/lmdb") == [
        "- /data/worker/lmdb:/data/worker/lmdb        "
        "# one LMDB per binding — personal data on disk; never backed up"
    ]

    monkeypatch.setattr(
        f"{__name__}.worker_service",
        lambda: "  - /data/worker/lmdb-extra:/data/worker/lmdb-extra",
    )
    assert worker_mounts_over("/data/worker/lmdb") == []


def test_the_deploy_unit_mounts_nothing_over_the_suffix_list_in_the_image() -> None:
    assert worker_mounts_over(worker_environment("TLDEXTRACT_CACHE")) == []


def test_the_build_fetches_the_weights_by_running_the_module_that_names_them(
    contents: ImageContents,
) -> None:

    dockerfile = DOCKERFILE.read_text("utf-8")

    assert WEIGHTS_MODULE in dockerfile
    assert contents.hf_home in dockerfile


def test_the_runtime_stage_copies_the_source_last() -> None:
    runtime = DOCKERFILE.read_text("utf-8").rpartition("\nFROM ")[2]
    copies = [line.split() for line in runtime.splitlines() if line.startswith("COPY ")]
    out_of_the_build = [words for words in copies if words[1] == "--from=build"]

    assert copies[-1:] == [["COPY", "src", "src"]]
    assert copies[:-1] == out_of_the_build
    assert {words[-1] for words in out_of_the_build} >= {
        "/app/.venv",
        worker_environment("HF_HOME"),
    }


def test_the_image_redacts_the_fixture_with_its_network_refused_and_fetches_nothing(
    image: str,
) -> None:
    found = _answered(
        _run_the_image(
            image,
            {
                "PROBE_PAGE": FIXTURE_PAGE.read_text("utf-8"),
                "PROBE_RULES": THE_SAFE_SET,
                "PROBE_SEED": SEED,
            },
            probe=REDACTION_PROBE,
            network="none",
            timeout=900,
        )
    )
    redacted = str(found["text"])
    answered: Mapping[str, Any] = found["counts"]
    version = str(found["version"])

    for planted in WITHHELD_SPANS:
        assert planted not in redacted, planted
    for placeholder, written in PLACEHOLDERS_IN_THE_TEXT.items():
        assert redacted.count(placeholder) == written, placeholder
    assert {
        category: int(answered[category]) for category in FINDINGS_BY_CATEGORY
    } == dict(FINDINGS_BY_CATEGORY)
    assert found["verdict"] == VERDICT

    assert version.startswith(f"{_pin('RULE_VERSION')}:")
    for pinned in PINNED_IN_THE_VERSION_STRING:
        assert _pin(pinned) in version, pinned
    assert _pin("GLINER_MODEL_ID_MEASURED").rsplit("/", 1)[-1] not in version

    assert found["suffix_cache"] == worker_environment("TLDEXTRACT_CACHE")
    assert found["suffix_cache_entries"] != []
    assert found["reached_out"] == []


def test_what_the_seam_costs_per_page_is_measured_on_the_image_and_never_budgeted(
    image: str,
) -> None:
    measured = _read_measurement(
        _run_the_image(
            image,
            {
                "PROBE_PAGE": FIXTURE_PAGE.read_text("utf-8"),
                "PROBE_RULES": THE_SAFE_SET,
                "PROBE_SEED": SEED,
                "PROBE_RUNS": str(MEASUREMENT_RUNS),
            },
            probe=MEASUREMENT_PROBE,
            network="none",
            timeout=1800,
        )
    )
    logging.getLogger(__name__).info(
        "T-122 · the seam on the fixture page, median of %d runs on this image: "
        "redact() %.0f ms/page under %s, whose load costs %.0f ms once; "
        "its detector alone %.0f ms/page",
        measured.runs,
        measured.seam_ms,
        measured.pinned_model,
        measured.pinned_load_ms,
        measured.pinned_ms,
    )

    assert measured.runs == MEASUREMENT_RUNS
    assert measured.pinned_model == _pin("GLINER_MODEL_ID")
    assert measured.seam_ms > 0
    assert measured.pinned_ms > 0


def test_both_converters_hold_on_the_image_under_the_engines_own_runtime(
    image: str,
) -> None:
    if not DOCKER_ANSWERS:
        pytest.skip(DAEMON_SKIP_REASON)

    answered = _read_conversion(
        _run_the_image(
            image,
            {"PROBE_FIXTURES": json.dumps(probed_fixtures())},
            probe=CONVERTER_PROBE,
            network="none",
        )
    )

    assert answered.deterministic, "the same bytes must give the same text twice"
    assert answered.added_mb < CONVERTERS_MAY_ADD_MB

    assert "| Hotel | 120 |" in answered.converted["expenses-policy.docx"]
    assert "|Survey|450|" in answered.converted["rate-card.pdf"]
    logging.getLogger(__name__).info(
        "the converters added %.1f MB to the image's peak RSS", answered.added_mb
    )


def test_the_container_runs_as_the_uid_that_owns_this_tiers_volumes(
    contents: ImageContents,
) -> None:
    assert contents.uid == chowned_worker_uid()
    assert contents.uid != 0


def test_the_image_leaves_this_tiers_tests_out_of_the_runtime(
    contents: ImageContents,
) -> None:
    assert contents.has_tests is False


JOB_OPENS = re.compile(r"^ {2}(?P<job>[\w-]+):\s*$")
# A step's own `if:` pushes its `run:` onto a line of its own, so the dash is optional.
RUNS_A_ROOT_SCRIPT = re.compile(r"^ +(?:- )?run: pnpm (?P<script>[\w:.-]+)\s*$")
THIS_TIERS_GATE = "check:worker"


def _legs_of_check() -> dict[str, list[str]]:
    legs: dict[str, list[str]] = {}
    job = ""
    under_jobs = False
    for line in CHECK_WORKFLOW.read_text("utf-8").splitlines():
        if line.rstrip() == "jobs:":
            under_jobs = True
        elif not under_jobs:
            continue
        elif opened := JOB_OPENS.match(line):
            job = opened.group("job")
            legs[job] = []
        elif job:
            legs[job].append(line)
    return legs


def _gates_of(lines: list[str]) -> list[str]:
    return [
        found.group("script")
        for line in lines
        if (found := RUNS_A_ROOT_SCRIPT.match(line))
    ]


def _root_scripts() -> dict[str, str]:
    manifest: dict[str, dict[str, str]] = json.loads(
        (REPO_ROOT / "package.json").read_text("utf-8")
    )
    return manifest.get("scripts", {})


def test_this_tier_reads_the_names_the_workflows_actually_hand_it() -> None:
    handed = [
        line
        for line in BUILD_WORKFLOW.read_text("utf-8").splitlines()
        if re.search(rf"\b{IMAGE_ID_VARIABLE}:.*outputs\.imageid", line)
    ]
    legs = _legs_of_check()
    scripts = _root_scripts()
    deferred = {
        job
        for job, lines in legs.items()
        if any(f"{PROBE_DEFERRAL_VARIABLE}:" in line for line in lines)
    }
    # This tier's legs, found by the gate they run rather than by their names.
    mine = {job for job, lines in legs.items() if THIS_TIERS_GATE in _gates_of(lines)}
    # A leg running named files rather than a workspace's whole check builds no image.
    misread = {
        job
        for job in deferred
        if not any(
            scripts.get(gate, "").rstrip().endswith("check")
            for gate in _gates_of(legs[job])
        )
    }

    assert len(handed) == 1, BUILD_WORKFLOW
    assert mine, CHECK_WORKFLOW
    # One leg per lane, so no run of any lane pays for this tier's gates twice.
    assert len(mine) == len({job.split("-", 1)[0] for job in mine}), CHECK_WORKFLOW
    assert mine <= deferred, CHECK_WORKFLOW
    assert misread == set(), CHECK_WORKFLOW


def test_the_runner_refuses_the_engines_gateway_call_the_way_the_image_does() -> None:
    legs = _legs_of_check()
    running = {
        job for job, lines in legs.items() if THIS_TIERS_GATE in _gates_of(lines)
    }
    declaring = {
        job
        for job, lines in legs.items()
        if any("COCOINDEX_DISABLE_USAGE_TRACKING:" in line for line in lines)
    }
    declared = {
        line.split(":", 1)[1].strip().strip('"')
        for lines in legs.values()
        for line in lines
        if "COCOINDEX_DISABLE_USAGE_TRACKING:" in line
    }

    assert running, CHECK_WORKFLOW
    # Every leg that runs the pipeline suite on the runner refuses the call.
    assert declaring == running, CHECK_WORKFLOW
    assert declared == {worker_environment("COCOINDEX_DISABLE_USAGE_TRACKING")}, (
        CHECK_WORKFLOW
    )


def test_the_worker_leg_of_the_image_job_names_this_file_as_its_probe() -> None:
    leg = matrix_leg("worker")
    here = Path(__file__).resolve().relative_to(WORKSPACE)

    assert str(here) in leg["probe"]
    assert "apps/worker" in leg["probe"]


def test_a_runner_builds_through_buildx_and_a_laptop_builds_as_it_always_did() -> None:
    leg = {
        "tier": "worker",
        "dockerfile": "apps/worker/Dockerfile",
        "context": "apps/worker",
    }
    written_to = Path("/tmp/the-id-this-build-wrote")

    assert _build_command(leg, builder="the-container-builder", iidfile=written_to) == [
        "docker",
        "buildx",
        "build",
        "--builder",
        "the-container-builder",
        "--cache-from",
        "type=gha,scope=worker",
        "--load",
        "--iidfile",
        "/tmp/the-id-this-build-wrote",
        "--file",
        "apps/worker/Dockerfile",
        "apps/worker",
    ]
    assert _build_command(leg, builder=None, iidfile=written_to) == [
        "docker",
        "build",
        "--quiet",
        "--file",
        "apps/worker/Dockerfile",
        "apps/worker",
    ]


def test_only_a_builder_that_can_export_a_cache_is_taken_for_one() -> None:
    assert (
        _builder_that_can_export(
            "Name:          builder-1c0ffee\n"
            "Driver:        docker-container\n"
            "Last Activity: 2026-09-13 09:14:22 +0000 UTC\n"
            "\n"
            "Nodes:\n"
            "Name:      builder-1c0ffee0\n"
            "Endpoint:  unix:///var/run/docker.sock\n"
            "Status:    running\n"
        )
        == "builder-1c0ffee"
    )
    assert (
        _builder_that_can_export(
            "Name:          default\n"
            "Driver:        docker\n"
            "Last Activity: 2026-09-13 09:14:22 +0000 UTC\n"
            "\n"
            "Nodes:\n"
            "Name:      default\n"
            "Endpoint:  default\n"
            "Status:    running\n"
        )
        is None
    )


def test_a_machine_without_the_cache_credentials_asks_the_daemon_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in (SHARED_CACHE_TOKEN, *SHARED_CACHE_URLS):
        monkeypatch.delenv(name, raising=False)

    def refuse_to_run(*_arguments: object, **_keywords: object) -> None:
        message = "the probe asked the daemon for a builder it could not have used"
        raise AssertionError(message)

    monkeypatch.setattr(subprocess, "run", refuse_to_run)

    assert _shared_cache_builder() is None
