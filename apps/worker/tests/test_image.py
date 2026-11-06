import ast
import base64
import itertools
import json
import logging
import math
import os
import posixpath
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
from support.deploy_unit import worker_environment, worker_service
from support.planted_page import (
    FINDINGS_BY_CATEGORY,
    FIXTURE_PAGE,
    spans_withheld_under,
    typed_placeholders_under,
)
from support.roots import REPOSITORY_ROOT

pytestmark = pytest.mark.image

WORKSPACE = REPOSITORY_ROOT / "apps" / "worker"
BUILD_WORKFLOW = REPOSITORY_ROOT / ".github" / "workflows" / "build.yml"
CHECK_WORKFLOW = REPOSITORY_ROOT / ".github" / "workflows" / "check.yml"
STORES_COMPOSE = REPOSITORY_ROOT / "deploy" / "stores.compose.yaml"
REDACTION = WORKSPACE / "src" / "better_answers_worker" / "redaction"
PINS = REDACTION / "pins.py"
PIPELINE = WORKSPACE / "src" / "better_answers_worker" / "pipeline"
DOCKERFILE = WORKSPACE / "Dockerfile"


TESTS_IN_THE_IMAGE = "/app/tests"


PYTHON_IMAGE_PREFIX = "/usr/local"


DISTROLESS_CC = "gcr.io/distroless/cc-debian13"


PINNED_BASE = re.compile(r"[\w.-]+(?:/[\w.-]+)*:[\w.-]+@sha256:[0-9a-f]{64}")


RENOVATE = REPOSITORY_ROOT / "renovate.json"


ABSENT_TOOLS = (
    "sh",
    "bash",
    "dash",
    "ash",
    "busybox",
    "apt",
    "apt-get",
    "dpkg",
    "perl",
    "pip",
    "pip3",
)


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


DEFAULT_ON_RULES_JSON = '{"default_on": true, "default_off": false}'
SEED = "b0f3a1d2c4e5"
DEFAULT_ON_RULES = cast("Mapping[str, bool]", json.loads(DEFAULT_ON_RULES_JSON))


WITHHELD_SPANS = spans_withheld_under(DEFAULT_ON_RULES)


EXPECTED_PLACEHOLDER_COUNTS: Mapping[str, int] = {
    "[withheld]": 6,
    **typed_placeholders_under(DEFAULT_ON_RULES),
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
    "no Docker daemon answered, so these tests cannot inspect the worker image. On CI"
    " they fail instead of skipping, because build.yml pushes the image only when"
    " this workflow passes"
)


def _docker_is_running() -> bool:
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


DOCKER_IS_RUNNING = _docker_is_running()


DAEMON_IS_REQUIRED = os.environ.get("CI", "") != ""


PROBE_DEFERRAL_VARIABLE = "IMAGE_PROBE_DEFERRED"
IMAGE_PROBE_IS_DEFERRED = os.environ.get(PROBE_DEFERRAL_VARIABLE) == "true"


IMAGE_ID_VARIABLE = "IMAGE_ID"


def _lines_under_include() -> list[str]:
    lines = BUILD_WORKFLOW.read_text("utf-8").splitlines()
    starts = [index for index, line in enumerate(lines) if line.strip() == "include:"]
    if len(starts) != 1:
        message = (
            f"expected one `include:` list in {BUILD_WORKFLOW}, found {len(starts)}"
        )
        raise RuntimeError(message)
    start = starts[0]
    depth = len(lines[start]) - len(lines[start].lstrip())

    nested: list[str] = []
    for line in lines[start + 1 :]:
        body = line.strip()
        if not body:
            continue
        if len(line) - len(line.lstrip()) <= depth:
            break
        nested.append(body)
    return nested


def _matrix_legs() -> list[dict[str, str]]:
    legs: list[dict[str, str]] = []
    for body in _lines_under_include():
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
    message = f"build.yml's image job has no `{tier}` leg. It builds {built}"
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


def _group_requirements(group: str) -> list[str]:
    found = _pyproject_at("dependency-groups", group)
    if not isinstance(found, list):
        message = f"pyproject.toml's dependency group {group} is not a list"
        raise RuntimeError(message)
    requirements: list[str] = []
    for each in found:
        included = each.get("include-group") if isinstance(each, dict) else None
        if isinstance(included, str):
            requirements += _group_requirements(included)
        else:
            requirements.append(str(each))
    return requirements


def _distribution_name(requirement: str) -> str:
    named = re.match(r"[A-Za-z0-9._-]+", requirement)
    if named is None:
        message = f"no distribution name in the requirement {requirement!r}"
        raise RuntimeError(message)
    return named.group(0)


def development_only_distributions() -> list[str]:
    development = {_distribution_name(each) for each in _group_requirements("dev")}
    runtime = {
        _distribution_name(each) for each in _requirements("project", "dependencies")
    }
    return sorted(development - runtime)


def pinned_converter_versions() -> dict[str, str | None]:
    declared = {
        _distribution_name(each): each
        for each in _requirements("project", "dependencies")
    }
    exact = {
        name: re.fullmatch(rf"{re.escape(name)}==(\S+)", declared.get(name, ""))
        for name in CONVERTER_DISTRIBUTIONS
    }
    return {
        name: None if found is None else found.group(1) for name, found in exact.items()
    }


def locked_versions() -> dict[str, set[str]]:
    with (WORKSPACE / "uv.lock").open("rb") as handle:
        packages = tomllib.load(handle)["package"]
    locked: dict[str, set[str]] = {}
    for package in packages:
        versions = locked.setdefault(str(package["name"]), set())
        versions.add(str(package.get("version", "")))
    return locked


def pinned_python_version() -> tuple[int, int]:
    pinned = (WORKSPACE / ".python-version").read_text("utf-8").strip()
    major, _, minor = pinned.partition(".")
    return int(major), int(minor)


def required_python_floor() -> tuple[int, int]:
    declared = _pyproject_at("project", "requires-python")
    floor = re.search(r">=\s*(\d+)\.(\d+)", str(declared))
    if floor is None:
        message = "pyproject.toml's requires-python has no >= lower bound"
        raise RuntimeError(message)
    return int(floor.group(1)), int(floor.group(2))


def python_image_version() -> tuple[int, int, int]:
    tags = re.findall(
        r"^FROM python:(\d+)\.(\d+)\.(\d+)-",
        DOCKERFILE.read_text("utf-8"),
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


def _instructions(dockerfile: str) -> list[str]:
    joined = re.sub(r"\\\n", " ", dockerfile)
    return [
        line.strip()
        for line in joined.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def dockerfile_stages() -> list[tuple[str, str]]:
    stages: list[tuple[str, str]] = []
    for line in _instructions(DOCKERFILE.read_text("utf-8")):
        if line.split()[0] != "FROM":
            continue
        found = re.fullmatch(r"FROM (\S+) AS (\S+)", line)
        if found is None:
            message = f"cannot parse a FROM line in {DOCKERFILE}: {line!r}"
            raise RuntimeError(message)
        stages.append((found.group(1), found.group(2)))
    return stages


def runtime_base() -> str:
    stages = dockerfile_stages()
    images = {name: image for image, name in stages}
    base = stages[-1][0]
    while base in images:
        base = images[base]
    return base


def _json_list(written: str) -> list[str] | None:
    try:
        found = json.loads(written)
    except json.JSONDecodeError:
        return None
    return [str(each) for each in found] if isinstance(found, list) else None


def exec_form(dockerfile: str, instruction: str) -> list[str] | None:
    lines = [
        line for line in _instructions(dockerfile) if line.split()[0] == instruction
    ]
    if len(lines) != 1:
        message = f"the Dockerfile has {len(lines)} {instruction} lines, expected one"
        raise RuntimeError(message)
    written = lines[0].partition(" CMD ")[2] if instruction == "HEALTHCHECK" else ""
    return _json_list(written or lines[0].split(maxsplit=1)[1])


def worker_health_check() -> list[str] | None:
    found = re.findall(r"^\s*test: (\[.*\])\s*$", worker_service(), re.M)
    if len(found) != 1:
        message = f"the worker service sets {len(found)} health checks, expected one"
        raise RuntimeError(message)
    return _json_list(found[0])


def _declared(path: Path, name: str, value: str) -> str:
    found = re.findall(rf"^{name} = {value}$", path.read_text("utf-8"), re.M)
    if len(found) != 1:
        message = (
            f"{path} declares {name} in the expected form {len(found)} times, not once"
        )
        raise RuntimeError(message)
    return str(found[0])


def _pin(name: str) -> str:
    return _declared(PINS, name, r'"([^"]+)"')


def _pipeline_constant(module: str, name: str) -> int:
    return int(_declared(PIPELINE / module, name, r"([\d_]+)").replace("_", ""))


def _worker_limit(key: str) -> str:
    found = re.findall(rf"\b{key}: (\w+)", worker_service())
    if len(found) != 1:
        message = f"the worker service sets {key} {len(found)} times, expected once"
        raise RuntimeError(message)
    return str(found[0])


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
import glob, importlib, json, os, re, shutil, subprocess, sys
from importlib import metadata
from better_answers_worker.environment_gate import PROCESSES

SEARCHED = os.pathsep.join(
    [os.environ["PATH"], "/bin", "/sbin", "/usr/bin", "/usr/sbin", "/busybox"]
)
RECORDS = "/var/lib/dpkg/status.d"

def unresolved():
    # The image has no `ldd`, so run the loader in trace mode as `ldd` does.
    # `--list` would stop at the first missing library.
    loader = sorted(glob.glob("/lib*/ld-linux*.so*"))[0]
    count, missing = 0, {}
    for root in sorted({sys.base_prefix, sys.prefix}):
        for where, _, names in os.walk(root):
            for name in names:
                path = os.path.join(where, name)
                if os.path.islink(path) or not re.search(r"[.]so([.][0-9]+)*$", name):
                    continue
                count += 1
                traced = subprocess.run(
                    [loader, path],
                    capture_output=True,
                    text=True,
                    env={"LD_TRACE_LOADED_OBJECTS": "1"},
                )
                absent = [
                    line.split()[0]
                    for line in traced.stdout.splitlines()
                    if "not found" in line
                ]
                if absent:
                    missing[path] = absent
    return count, missing

def unrecorded():
    owned = set()
    for name in os.listdir(RECORDS) if os.path.isdir(RECORDS) else ():
        package = name.removesuffix(".md5sums")
        if package == name or not os.path.isfile(os.path.join(RECORDS, package)):
            continue
        with open(os.path.join(RECORDS, name), encoding="utf-8") as sums:
            owned.update(
                "/" + line.split(maxsplit=1)[1].strip() for line in sums if line.strip()
            )
    carried = [
        os.path.join(where, name)
        for where, _, names in os.walk("/usr/lib")
        for name in names
        if not os.path.islink(os.path.join(where, name))
    ]
    return len(carried), sorted(path for path in carried if path not in owned)

def interpreter_of(command):
    found = shutil.which(command)
    if found is None:
        return ""
    with open(found, "rb") as script:
        line = script.readline().decode("utf-8", "replace").strip()
    named = line.removeprefix("#!").split()
    if not line.startswith("#!") or not named or not os.path.exists(named[0]):
        return ""
    return os.path.realpath(named[0])

def installed(name):
    try:
        metadata.distribution(name)
    except metadata.PackageNotFoundError:
        return False
    return True

def version_of(name):
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return ""

def imports(name):
    try:
        importlib.import_module(name)
    except ImportError:
        return False
    return True

def cached(model_id):
    # With `local_files_only`, snapshot_download raises when the model is not in the
    # cache, so a model the build did not fetch returns False.
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

shared_object_count, unresolved_shared_objects = unresolved()
library_file_count, unrecorded_library_files = unrecorded()
home = os.path.expanduser("~")
sys.stdout.write(json.dumps({
    "development": [
        n
        for n in json.loads(os.environ["PROBE_DEVELOPMENT"])
        if installed(n) or imports(n)
    ],
    "version": list(sys.version_info[:3]),
    "base_prefix": sys.base_prefix,
    "uid": os.getuid(),
    "home": home,
    "home_is_writable": os.path.isdir(home) and os.access(home, os.W_OK),
    "tools_present": [
        n
        for n in json.loads(os.environ["PROBE_TOOLS"])
        if shutil.which(n, path=SEARCHED)
    ],
    "bundled_wheels": sorted(
        glob.glob(os.path.join(sys.base_prefix, "**", "*.whl"), recursive=True)
    ),
    "command_interpreter": interpreter_of(PROCESSES["worker"][0]),
    "shared_object_count": shared_object_count,
    "unresolved_shared_objects": unresolved_shared_objects,
    "library_file_count": library_file_count,
    "unrecorded_library_files": unrecorded_library_files,
    "imports": {n: imports(n) for n in json.loads(os.environ["PROBE_IMPORTS"])},
    "versions": {
        n: version_of(n) for n in json.loads(os.environ["PROBE_DISTRIBUTIONS"])
    },
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
from better_answers_worker.redaction.engine import spans_detected

reached_out = []

class Caught(logging.Handler):
    def emit(self, record):
        reached_out.append(record.getMessage())

# tldextract reads the suffix list on the first lookup, not on import, so this handler
# still sees every fetch that redact() attempts.
watched = logging.getLogger("tldextract")
watched.setLevel(logging.WARNING)
watched.addHandler(Caught(level=logging.WARNING))

# List the cache before redaction runs, so the result shows what the image shipped
# and not files this container wrote.
cache = os.environ.get("TLDEXTRACT_CACHE", "")
warmed = sorted(
    os.path.relpath(os.path.join(where, name), cache)
    for where, _, names in os.walk(cache)
    for name in names
)

page = os.environ["PROBE_PAGE"]
found = redact(
    page,
    spans_detected(page),
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
from better_answers_worker.redaction.engine import (
    ANALYSED_ENTITIES,
    analyzer,
    spans_detected,
)
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

seam = median(lambda: redact(page, spans_detected(page), rules, (), seed))
pinned = median(lambda: analyzer().analyze(text=page, language="en", entities=entities))

sys.stdout.write(json.dumps({
    "runs": runs,
    "pinned_model": GLINER_MODEL_ID,
    "pinned_load_ms": pinned_load,
    "seam_ms": seam,
    "pinned_ms": pinned,
}))
"""


@dataclass(frozen=True)
class SeamReading:
    taken_on: str
    machine: str
    platform: str
    memory_and_memswap: tuple[str, str] | None
    page_bytes: int
    ms_per_page: tuple[int, int, int]
    load_ms: tuple[int, int, int]


AN_M4_PRO = "Apple M4 Pro (14 cores, 24 GB) under Docker Desktop"
ROSETTA = f"{AN_M4_PRO} 29.8, the image emulated by Rosetta 2"


SEAM_READINGS: Mapping[str, SeamReading] = {
    "T-122": SeamReading(
        "2026-09-11",
        AN_M4_PRO,
        "linux/arm64",
        None,
        2488,
        (2841, 1910, 2646),
        (6351, 6714, 7137),
    ),
    "T-177": SeamReading(
        "2026-09-21",
        AN_M4_PRO,
        "linux/arm64",
        None,
        3107,
        (4447, 4345, 5022),
        (13078, 15961, 7514),
    ),
    "T-222": SeamReading(
        "2026-09-23",
        ROSETTA,
        "linux/amd64",
        ("1536m", "3072m"),
        3107,
        (5579, 6453, 5273),
        (20358, 23058, 19798),
    ),
}


SLOWEST_CAPPED_READING = "T-222"


LOADS_IN_THE_MARGIN = 4


CONVERSION_FIXTURES = WORKSPACE / "tests" / "fixtures" / "conversion"
PROBED_FIXTURES = ("expenses-policy.docx", "rate-card.pdf")


CONVERTER_MEMORY_LIMIT_MB = 100


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

    parsed = _last_json_line(stdout)
    return Conversion(
        converted={str(name): str(text) for name, text in parsed["converted"].items()},
        deterministic=bool(parsed["deterministic"]),
        added_mb=float(parsed["added_mb"]),
    )


@dataclass(frozen=True)
class ImageContents:
    development: tuple[str, ...]
    version: tuple[int, int, int]
    base_prefix: str
    uid: int
    home: str
    home_is_writable: bool
    tools_present: tuple[str, ...]
    bundled_wheels: tuple[str, ...]
    command_interpreter: str
    shared_object_count: int
    unresolved_shared_objects: Mapping[str, tuple[str, ...]]
    library_file_count: int
    unrecorded_library_files: tuple[str, ...]
    imports: Mapping[str, bool]
    versions: Mapping[str, str]
    has_tests: bool
    weights: Mapping[str, bool]
    spacy_pipeline: bool
    hf_home: str
    usage_tracking: str


def _read_contents(stdout: str) -> ImageContents:

    parsed = _last_json_line(stdout)
    major, minor, patch = parsed["version"]
    return ImageContents(
        development=tuple(str(name) for name in parsed["development"]),
        version=(int(major), int(minor), int(patch)),
        base_prefix=str(parsed["base_prefix"]),
        uid=int(parsed["uid"]),
        home=str(parsed["home"]),
        home_is_writable=bool(parsed["home_is_writable"]),
        tools_present=tuple(str(name) for name in parsed["tools_present"]),
        bundled_wheels=tuple(str(path) for path in parsed["bundled_wheels"]),
        command_interpreter=str(parsed["command_interpreter"]),
        shared_object_count=int(parsed["shared_object_count"]),
        unresolved_shared_objects={
            str(path): tuple(str(name) for name in absent)
            for path, absent in parsed["unresolved_shared_objects"].items()
        },
        library_file_count=int(parsed["library_file_count"]),
        unrecorded_library_files=tuple(
            str(path) for path in parsed["unrecorded_library_files"]
        ),
        imports={str(name): bool(found) for name, found in parsed["imports"].items()},
        versions={
            str(name): str(version) for name, version in parsed["versions"].items()
        },
        has_tests=bool(parsed["has_tests"]),
        weights={str(model): bool(found) for model, found in parsed["weights"].items()},
        spacy_pipeline=bool(parsed["spacy_pipeline"]),
        hf_home=str(parsed["hf_home"]),
        usage_tracking=str(parsed["usage_tracking"]),
    )


@dataclass(frozen=True)
class Measurement:
    runs: int
    pinned_model: str
    pinned_load_ms: float
    seam_ms: float
    pinned_ms: float


def _read_measurement(stdout: str) -> Measurement:

    parsed = _last_json_line(stdout)
    return Measurement(
        runs=int(parsed["runs"]),
        pinned_model=str(parsed["pinned_model"]),
        pinned_load_ms=float(parsed["pinned_load_ms"]),
        seam_ms=float(parsed["seam_ms"]),
        pinned_ms=float(parsed["pinned_ms"]),
    )


CACHE_REGISTRY_VARIABLE = "IMAGE_CACHE_REGISTRY"


CACHE_TAG = "buildcache"


DRIVER_WITHOUT_AN_EXPORT = "docker"


@dataclass(frozen=True)
class SharedCache:
    builder: str
    registry: str


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


def _shared_cache() -> SharedCache | None:
    registry = os.environ.get(CACHE_REGISTRY_VARIABLE, "").strip()
    if not registry:
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
    builder = _builder_that_can_export(inspected.stdout)
    return None if builder is None else SharedCache(builder=builder, registry=registry)


def _build_command(
    leg: Mapping[str, str], *, cache: SharedCache | None, iidfile: Path
) -> list[str]:
    if cache is None:
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
        cache.builder,
        "--cache-from",
        f"type=registry,ref={cache.registry}/{leg['tier']}:{CACHE_TAG}",
        "--load",
        "--iidfile",
        str(iidfile),
        "--file",
        leg["dockerfile"],
        leg["context"],
    ]


def _build_the_image(leg: Mapping[str, str]) -> str:
    cache = _shared_cache()
    with tempfile.TemporaryDirectory() as scratch:
        iidfile = Path(scratch) / "image-id"
        built = subprocess.run(
            _build_command(leg, cache=cache, iidfile=iidfile),
            cwd=REPOSITORY_ROOT,
            check=True,
            capture_output=True,
            text=True,
            timeout=900,
        )
        if cache is None:
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

    # Pass each variable by name only. `--env NAME` reads the value from this process's
    # environment, so the value does not appear in `ps` output.
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


def _last_json_line(stdout: str) -> dict[str, Any]:
    lines = [line for line in stdout.splitlines() if line.strip()]
    if not lines:
        message = "the container wrote nothing to stdout"
        raise RuntimeError(message)
    parsed: dict[str, Any] = json.loads(lines[-1])
    return parsed


@pytest.fixture(scope="module")
def image() -> Iterator[str]:
    if IMAGE_PROBE_IS_DEFERRED:
        pytest.skip(
            f"{PROBE_DEFERRAL_VARIABLE} is set, so the job that pushes the image runs"
            " these tests on its own build"
        )
    if not DOCKER_IS_RUNNING:
        if DAEMON_IS_REQUIRED:
            raise RuntimeError(NO_DAEMON)
        pytest.skip(DAEMON_SKIP_REASON)

    supplied = os.environ.get(IMAGE_ID_VARIABLE, "").strip()

    # A Docker tag is shared across the daemon, so two `check` runs on one daemon would
    # overwrite it. Run the image by id instead.
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
                "PROBE_DISTRIBUTIONS": json.dumps(list(CONVERTER_DISTRIBUTIONS)),
                "PROBE_TESTS": TESTS_IN_THE_IMAGE,
                "PROBE_MODEL_IDS": json.dumps(list(pinned_model_ids())),
                "PROBE_SPACY_PIPELINE": _pin("SPACY_MODEL"),
                "PROBE_TOOLS": json.dumps(list(ABSENT_TOOLS)),
            },
        )
    )


def test_the_image_carries_no_development_dependency(
    contents: ImageContents,
) -> None:
    assert development_only_distributions()
    assert list(contents.development) == []


def test_the_dev_group_includes_requirements_from_its_included_groups() -> None:
    assert "pytest" in development_only_distributions()


def test_python_version_file_matches_the_requires_python_minimum() -> None:
    assert pinned_python_version() == required_python_floor()


def test_the_image_python_matches_the_python_version_file(
    contents: ImageContents,
) -> None:

    assert contents.version[:2] == pinned_python_version()


def test_the_interpreter_comes_from_the_python_base_image(
    contents: ImageContents,
) -> None:

    assert contents.version == python_image_version()
    assert contents.base_prefix == PYTHON_IMAGE_PREFIX


def test_the_runtime_is_distroless_and_renovate_updates_every_pinned_base() -> None:
    stages = dockerfile_stages()
    named = {name for _, name in stages}
    renovate = json.loads(RENOVATE.read_text("utf-8"))

    assert [
        image
        for image, _ in stages
        if image not in named and PINNED_BASE.fullmatch(image) is None
    ] == []
    assert runtime_base().startswith(f"{DISTROLESS_CC}:")
    assert "dockerfile" in renovate["enabledManagers"]
    assert any(
        "dockerfile" in rule.get("matchManagers", ())
        and rule.get("groupName") == "images"
        and rule.get("pinDigests") is True
        for rule in renovate["packageRules"]
    )


def test_the_image_has_no_shell_package_manager_or_installer_wheel(
    contents: ImageContents,
) -> None:
    assert contents.tools_present == ()
    assert contents.bundled_wheels == ()


def test_the_health_check_and_command_are_written_in_exec_form() -> None:
    dockerfile = DOCKERFILE.read_text("utf-8")
    health = exec_form(dockerfile, "HEALTHCHECK")

    assert health is not None
    assert exec_form(dockerfile, "CMD") is not None
    assert worker_health_check() == ["CMD", *health]


def test_the_command_runs_on_the_images_python_not_a_shell(
    contents: ImageContents,
) -> None:
    major, minor = pinned_python_version()

    assert contents.command_interpreter == f"/usr/local/bin/python{major}.{minor}"


def test_a_string_form_healthcheck_or_command_has_no_exec_form() -> None:
    written = (
        "FROM scratch AS runtime\n"
        "HEALTHCHECK --interval=15s \\\n"
        "  CMD python -m better_answers_worker.health\n"
        "CMD better-answers-worker\n"
    )

    assert exec_form(written, "HEALTHCHECK") is None
    assert exec_form(written, "CMD") is None


def test_every_shared_object_in_the_image_finds_all_its_dependencies(
    contents: ImageContents,
) -> None:
    assert contents.shared_object_count > 0
    assert dict(contents.unresolved_shared_objects) == {}


def test_every_library_file_in_the_image_has_a_dpkg_record(
    contents: ImageContents,
) -> None:
    assert contents.library_file_count > 0
    assert contents.unrecorded_library_files == ()


def test_the_image_can_import_the_worker_and_its_schema_view(
    contents: ImageContents,
) -> None:
    assert {name: contents.imports[name] for name in REQUIRED_IMPORTS} == dict.fromkeys(
        REQUIRED_IMPORTS, True
    )


def test_the_image_can_import_every_detector_library(
    contents: ImageContents,
) -> None:

    assert {name: contents.imports[name] for name in DETECTOR_IMPORTS} == dict.fromkeys(
        DETECTOR_IMPORTS, True
    )

    assert set(contents.imports) == set(PROBED_IMPORTS)


def test_the_image_has_both_converters_at_their_pinned_versions(
    contents: ImageContents,
) -> None:

    assert {
        name: contents.imports[name] for name in CONVERTER_IMPORTS
    } == dict.fromkeys(CONVERTER_IMPORTS, True)
    assert dict(contents.versions) == pinned_converter_versions()


def test_each_converter_is_pinned_exactly_at_the_locked_version() -> None:
    pinned = pinned_converter_versions()
    locked = locked_versions()

    assert None not in pinned.values(), (
        f"a converter is not pinned with == in pyproject.toml: {pinned}"
    )
    assert {name: locked.get(name) for name in CONVERTER_DISTRIBUTIONS} == {
        name: {version} for name, version in pinned.items()
    }


def test_the_image_can_import_cocoindex_asyncpg_and_boto3(
    contents: ImageContents,
) -> None:

    assert {name: contents.imports[name] for name in HOST_IMPORTS} == dict.fromkeys(
        HOST_IMPORTS, True
    )


def test_the_image_caches_the_pinned_model_not_the_measured_one(
    contents: ImageContents,
) -> None:

    assert dict(contents.weights) == {
        _pin("GLINER_MODEL_ID"): True,
        _pin("GLINER_MODEL_ID_MEASURED"): False,
    }
    assert contents.spacy_pipeline is True


def test_the_image_hf_home_matches_the_deploy_unit(
    contents: ImageContents,
) -> None:

    assert contents.hf_home == worker_environment("HF_HOME")
    assert contents.hf_home != ""


def test_the_image_and_deploy_unit_refuse_the_engines_gateway_call(
    contents: ImageContents,
) -> None:
    assert contents.usage_tracking == worker_environment(
        "COCOINDEX_DISABLE_USAGE_TRACKING"
    )
    assert contents.usage_tracking == "1"


def test_no_deploy_unit_volume_mounts_over_the_images_hf_home() -> None:
    assert worker_mounts_over(worker_environment("HF_HOME")) == []


def test_finds_a_commented_lmdb_mount_but_not_a_longer_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert worker_mounts_over("/data/worker/lmdb") == [
        "- /data/worker/lmdb:/data/worker/lmdb"
    ]

    monkeypatch.setattr(
        f"{__name__}.worker_service",
        lambda: "  - /data/worker/lmdb:/data/worker/lmdb   # a trailing comment",
    )
    assert worker_mounts_over("/data/worker/lmdb") == [
        "- /data/worker/lmdb:/data/worker/lmdb   # a trailing comment"
    ]

    monkeypatch.setattr(
        f"{__name__}.worker_service",
        lambda: "  - /data/worker/lmdb-extra:/data/worker/lmdb-extra",
    )
    assert worker_mounts_over("/data/worker/lmdb") == []


def test_no_deploy_unit_volume_mounts_over_the_images_tldextract_cache() -> None:
    assert worker_mounts_over(worker_environment("TLDEXTRACT_CACHE")) == []


def test_the_dockerfile_runs_the_weights_module_and_sets_hf_home() -> None:
    dockerfile = DOCKERFILE.read_text("utf-8")

    assert WEIGHTS_MODULE in dockerfile
    assert worker_environment("HF_HOME") in dockerfile


def test_the_runtime_stage_copies_the_source_last() -> None:
    runtime = DOCKERFILE.read_text("utf-8").rpartition("\nFROM ")[2]
    copies = [line.split() for line in runtime.splitlines() if line.startswith("COPY ")]
    out_of_a_stage = [words for words in copies if words[1].startswith("--from=")]

    assert copies[-1:] == [["COPY", "src", "src"]]
    assert copies[:-1] == out_of_a_stage
    assert {words[-1] for words in out_of_a_stage} >= {
        "/app/.venv",
        worker_environment("HF_HOME"),
    }


def build_stage() -> list[str]:
    instructions = _instructions(DOCKERFILE.read_text("utf-8"))
    rest = instructions[instructions.index("FROM interpreter AS build") + 1 :]
    return list(itertools.takewhile(lambda step: not step.startswith("FROM "), rest))


def copied_from_the_context(step: str) -> list[str]:
    keyword, *words = step.split()
    if keyword not in {"COPY", "ADD"} or any(w.startswith("--from=") for w in words):
        return []
    paths = [word for word in words if not word.startswith("--")]
    return (_json_list(" ".join(paths)) or paths)[:-1]


def reaches_a_module(path: str) -> bool:
    written = posixpath.normpath("/" + path).lstrip("/") or "."
    return written != "src/better_answers_worker/__init__.py" and (
        written in {".", "src"}
        or written.startswith("src/")
        or any(glob in written for glob in "*?[")
    )


def test_the_build_stage_copies_no_module_before_the_project_install() -> None:
    steps = build_stage()
    install = steps.index("RUN uv sync --frozen --no-dev")
    copies = [
        index
        for index, step in enumerate(steps)
        for path in copied_from_the_context(step)
        if reaches_a_module(path)
    ]

    assert copies != []
    assert install < min(copies)


def imported_by(path: Path) -> list[str]:
    package = [
        "better_answers_worker",
        "redaction",
        *path.relative_to(REDACTION).parent.parts,
    ]
    names: list[str] = []
    for node in ast.walk(ast.parse(path.read_text("utf-8"), filename=str(path))):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = package[: len(package) - node.level + 1] if node.level else []
            module = [*base, *node.module.split(".")] if node.module else base
            names.extend(".".join([*module, alias.name]) for alias in node.names)
    return names


def test_the_redaction_package_imports_no_other_worker_module() -> None:
    worker = [
        name
        for path in sorted(REDACTION.rglob("*.py"))
        for name in imported_by(path)
        if name.startswith("better_answers_worker.")
    ]

    seam = "better_answers_worker.redaction."

    assert worker != []
    assert [name for name in worker if not name.startswith(seam)] == []


def test_the_image_redacts_the_fixture_page_with_no_network_access(
    image: str,
) -> None:
    found = _last_json_line(
        _run_the_image(
            image,
            {
                "PROBE_PAGE": FIXTURE_PAGE.read_text("utf-8"),
                "PROBE_RULES": DEFAULT_ON_RULES_JSON,
                "PROBE_SEED": SEED,
            },
            probe=REDACTION_PROBE,
            network="none",
            timeout=900,
        )
    )
    redacted = str(found["text"])
    counts: Mapping[str, Any] = found["counts"]
    version = str(found["version"])

    for planted in WITHHELD_SPANS:
        assert planted not in redacted, f"the redacted page still contains {planted!r}"
    for placeholder, written in EXPECTED_PLACEHOLDER_COUNTS.items():
        assert redacted.count(placeholder) == written, (
            f"the redacted page has the wrong number of {placeholder!r}"
        )
    assert {
        category: int(counts[category]) for category in FINDINGS_BY_CATEGORY
    } == dict(FINDINGS_BY_CATEGORY)
    assert found["verdict"] == VERDICT

    assert version.startswith(f"{_pin('RULE_VERSION')}:")
    for pinned in PINNED_IN_THE_VERSION_STRING:
        assert _pin(pinned) in version, f"the rule version string lacks {pinned}"
    assert _pin("GLINER_MODEL_ID_MEASURED").rsplit("/", 1)[-1] not in version

    assert found["suffix_cache"] == worker_environment("TLDEXTRACT_CACHE")
    assert found["suffix_cache_entries"] != []
    assert found["reached_out"] == []


def test_logs_redact_timing_per_page_without_asserting_a_limit(
    image: str,
) -> None:
    measured = _read_measurement(
        _run_the_image(
            image,
            {
                "PROBE_PAGE": FIXTURE_PAGE.read_text("utf-8"),
                "PROBE_RULES": DEFAULT_ON_RULES_JSON,
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


def test_pipeline_timing_constants_match_the_slowest_memory_capped_reading() -> None:
    reading = SEAM_READINGS[SLOWEST_CAPPED_READING]
    margin_s = math.ceil(LOADS_IN_THE_MARGIN * max(reading.load_ms) / 1000)

    assert reading.platform == "linux/amd64"
    assert reading.memory_and_memswap == (
        _worker_limit("memory"),
        _worker_limit("memswap_limit"),
    )
    assert _pipeline_constant("landed.py", "SEAM_MS_PER_PAGE") == max(
        reading.ms_per_page
    )
    assert _pipeline_constant("converter.py", "BYTES_PER_PAGE") == reading.page_bytes
    assert _pipeline_constant("landed.py", "TIMEOUT_MARGIN_MS") == margin_s * 1000


def test_both_converters_hold_on_the_image_under_the_engines_runtime(
    image: str,
) -> None:
    if not DOCKER_IS_RUNNING:
        pytest.skip(DAEMON_SKIP_REASON)

    conversion = _read_conversion(
        _run_the_image(
            image,
            {"PROBE_FIXTURES": json.dumps(probed_fixtures())},
            probe=CONVERTER_PROBE,
            network="none",
        )
    )

    assert conversion.deterministic, (
        "converting the same fixtures twice gave different text"
    )
    assert conversion.added_mb < CONVERTER_MEMORY_LIMIT_MB

    assert "| Hotel | 120 |" in conversion.converted["expenses-policy.docx"]
    assert "|Survey|450|" in conversion.converted["rate-card.pdf"]
    logging.getLogger(__name__).info(
        "the converters added %.1f MB to the image's peak RSS", conversion.added_mb
    )


def test_runs_as_the_volume_owner_uid_with_a_writable_home(
    contents: ImageContents,
) -> None:
    assert contents.uid == chowned_worker_uid()
    assert contents.uid != 0
    assert contents.home != "/"
    assert contents.home_is_writable is True


def test_the_image_does_not_contain_the_worker_tests(
    contents: ImageContents,
) -> None:
    assert contents.has_tests is False


JOB_HEADER = re.compile(r"^ {2}(?P<job>[\w-]+):\s*$")
PNPM_RUN_LINE = re.compile(r"^ +(?:- )?run: pnpm (?P<script>[\w:.-]+)\s*$")
WORKER_GATE = "check:worker"
WORKER_IMAGE_GATE = "check:images:worker"
CHECK_RUNNER_PREFIX = "node scripts/check.mjs "


def _check_workflow_jobs() -> dict[str, list[str]]:
    legs: dict[str, list[str]] = {}
    job = ""
    under_jobs = False
    for line in CHECK_WORKFLOW.read_text("utf-8").splitlines():
        if line.rstrip() == "jobs:":
            under_jobs = True
        elif not under_jobs:
            continue
        elif opened := JOB_HEADER.match(line):
            job = opened.group("job")
            legs[job] = []
        elif job:
            legs[job].append(line)
    return legs


def _pnpm_scripts_run_by(lines: list[str]) -> list[str]:
    return [
        found.group("script") for line in lines if (found := PNPM_RUN_LINE.match(line))
    ]


def _root_scripts() -> dict[str, str]:
    manifest: dict[str, dict[str, str]] = json.loads(
        (REPOSITORY_ROOT / "package.json").read_text("utf-8")
    )
    return manifest.get("scripts", {})


def _check_steps_of(gates: list[str], scripts: dict[str, str]) -> list[str]:
    steps: list[str] = []
    for gate in gates:
        command = scripts.get(gate, "")
        steps += (
            command.removeprefix(CHECK_RUNNER_PREFIX).split()
            if command.startswith(CHECK_RUNNER_PREFIX)
            else [gate]
        )
    return steps


def test_reads_a_run_line_with_or_without_its_dash() -> None:
    a_step_of_its_own = "      - run: pnpm check:worker"
    a_step_whose_if_comes_first = "        run: pnpm check:worker"

    assert _pnpm_scripts_run_by([a_step_of_its_own, a_step_whose_if_comes_first]) == [
        WORKER_GATE,
        WORKER_GATE,
    ]


def test_the_workflows_set_the_variables_this_test_file_reads() -> None:
    image_id_lines = [
        line
        for line in BUILD_WORKFLOW.read_text("utf-8").splitlines()
        if re.search(rf"\b{IMAGE_ID_VARIABLE}:.*outputs\.imageid", line)
    ]
    legs = _check_workflow_jobs()
    scripts = _root_scripts()
    deferred_jobs = {
        job
        for job, lines in legs.items()
        if any(f"{PROBE_DEFERRAL_VARIABLE}:" in line for line in lines)
    }
    image_test_jobs = {
        job
        for job, lines in legs.items()
        if WORKER_IMAGE_GATE in _check_steps_of(_pnpm_scripts_run_by(lines), scripts)
    }

    assert len(image_id_lines) == 1, (
        f"{BUILD_WORKFLOW} does not set {IMAGE_ID_VARIABLE} from outputs.imageid once"
    )
    assert image_test_jobs, f"no job in {CHECK_WORKFLOW} runs {WORKER_IMAGE_GATE}"
    lanes = {job.split("-", 1)[0] for job in image_test_jobs}
    assert len(image_test_jobs) == len(lanes), (
        f"{CHECK_WORKFLOW}: more than one job in a lane runs the worker image tests"
    )
    assert image_test_jobs == deferred_jobs, (
        f"{CHECK_WORKFLOW}: the jobs that set {PROBE_DEFERRAL_VARIABLE} are not "
        "exactly the jobs that run the worker image tests"
    )
    assert scripts[WORKER_IMAGE_GATE].rstrip().endswith("images"), (
        f"{WORKER_IMAGE_GATE} runs more than the worker image tests"
    )


def test_the_ci_runner_disables_cocoindex_usage_tracking_like_the_image() -> None:
    legs = _check_workflow_jobs()
    running = {
        job for job, lines in legs.items() if WORKER_GATE in _pnpm_scripts_run_by(lines)
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

    assert running, f"no job in {CHECK_WORKFLOW} runs {WORKER_GATE}"
    assert declaring == running, (
        f"{CHECK_WORKFLOW}: the jobs that set COCOINDEX_DISABLE_USAGE_TRACKING are not "
        f"the jobs that run {WORKER_GATE}"
    )
    assert declared == {worker_environment("COCOINDEX_DISABLE_USAGE_TRACKING")}, (
        f"{CHECK_WORKFLOW} sets COCOINDEX_DISABLE_USAGE_TRACKING to a different value "
        "from the worker service"
    )


def test_uses_buildx_with_a_cache_and_docker_build_without_one() -> None:
    leg = {
        "tier": "worker",
        "dockerfile": "apps/worker/Dockerfile",
        "context": "apps/worker",
    }
    written_to = Path("/tmp/the-id-this-build-wrote")
    cache = SharedCache(builder="the-container-builder", registry="ghcr.io/an-owner")

    assert _build_command(leg, cache=cache, iidfile=written_to) == [
        "docker",
        "buildx",
        "build",
        "--builder",
        "the-container-builder",
        "--cache-from",
        "type=registry,ref=ghcr.io/an-owner/worker:buildcache",
        "--load",
        "--iidfile",
        "/tmp/the-id-this-build-wrote",
        "--file",
        "apps/worker/Dockerfile",
        "apps/worker",
    ]
    assert _build_command(leg, cache=None, iidfile=written_to) == [
        "docker",
        "build",
        "--quiet",
        "--file",
        "apps/worker/Dockerfile",
        "apps/worker",
    ]


def test_takes_only_a_builder_that_can_export_a_cache() -> None:
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


def test_skips_docker_buildx_inspect_when_no_cache_registry_is_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(CACHE_REGISTRY_VARIABLE, raising=False)

    def refuse_to_run(*_arguments: object, **_keywords: object) -> None:
        message = "_shared_cache ran docker buildx inspect with no cache registry set"
        raise AssertionError(message)

    monkeypatch.setattr(subprocess, "run", refuse_to_run)

    assert _shared_cache() is None
