import base64
import json
import logging
import math
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
PIPELINE = WORKSPACE / "src" / "better_answers_worker" / "pipeline"
DOCKERFILE = WORKSPACE / "Dockerfile"


TESTS_IN_THE_IMAGE = "/app/tests"


PYTHON_IMAGE_PREFIX = "/usr/local"


DISTROLESS_CC = "gcr.io/distroless/cc-debian13"


PINNED_BASE = re.compile(r"[\w.-]+(?:/[\w.-]+)*:[\w.-]+@sha256:[0-9a-f]{64}")


RENOVATE = REPO_ROOT / "renovate.json"


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
            message = f"a FROM this cannot read in {DOCKERFILE}: {line!r}"
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
        message = f"the Dockerfile has {len(lines)} {instruction} lines; expected one"
        raise RuntimeError(message)
    written = lines[0].partition(" CMD ")[2] if instruction == "HEALTHCHECK" else ""
    return _json_list(written or lines[0].split(maxsplit=1)[1])


def worker_health_check() -> list[str] | None:
    found = re.findall(r"^\s*test: (\[.*\])\s*$", worker_service(), re.M)
    if len(found) != 1:
        message = f"the worker service sets {len(found)} health checks; expected one"
        raise RuntimeError(message)
    return _json_list(found[0])


def _declared(path: Path, name: str, value: str) -> str:
    found = re.findall(rf"^{name} = {value}$", path.read_text("utf-8"), re.M)
    if len(found) != 1:
        message = f"{path} declares {len(found)} {name} this can read; expected one"
        raise RuntimeError(message)
    return str(found[0])


def _pin(name: str) -> str:
    return _declared(PINS, name, r'"([^"]+)"')


def _pipeline_constant(module: str, name: str) -> int:
    return int(_declared(PIPELINE / module, name, r"([\d_]+)").replace("_", ""))


def _worker_limit(key: str) -> str:
    found = re.findall(rf"\b{key}: (\w+)", worker_service())
    if len(found) != 1:
        message = f"the worker service sets {len(found)} {key}; expected one"
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

SEARCHED = os.pathsep.join(
    [os.environ["PATH"], "/bin", "/sbin", "/usr/bin", "/usr/sbin", "/busybox"]
)
RECORDS = "/var/lib/dpkg/status.d"

def unresolved():
    # The loader's own trace mode, which is what `ldd` runs: the image carries no `ldd`,
    # and `--list` stops at the first library it cannot find.
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
    "command_interpreter": interpreter_of(os.environ["PROBE_COMMAND"]),
    "shared_object_count": shared_object_count,
    "unresolved_shared_objects": unresolved_shared_objects,
    "library_file_count": library_file_count,
    "unrecorded_library_files": unrecorded_library_files,
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
from better_answers_worker.redaction.engine import spans_detected

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


THE_CEILINGS_READING = "T-222"


# The margin carries the first document's model load plus conversion and the
# engine's own work, which nothing times; four loads errs long on purpose.
LOADS_IN_THE_MARGIN = 4


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
        home=str(answered["home"]),
        home_is_writable=bool(answered["home_is_writable"]),
        tools_present=tuple(str(name) for name in answered["tools_present"]),
        bundled_wheels=tuple(str(path) for path in answered["bundled_wheels"]),
        command_interpreter=str(answered["command_interpreter"]),
        shared_object_count=int(answered["shared_object_count"]),
        unresolved_shared_objects={
            str(path): tuple(str(name) for name in absent)
            for path, absent in answered["unresolved_shared_objects"].items()
        },
        library_file_count=int(answered["library_file_count"]),
        unrecorded_library_files=tuple(
            str(path) for path in answered["unrecorded_library_files"]
        ),
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
                "PROBE_TOOLS": json.dumps(list(ABSENT_TOOLS)),
                "PROBE_COMMAND": (
                    exec_form(DOCKERFILE.read_text("utf-8"), "CMD") or [""]
                )[0],
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


def test_the_interpreter_is_the_python_images_and_not_one_the_build_fetched(
    contents: ImageContents,
) -> None:

    assert contents.version == python_image_version()
    assert contents.base_prefix == PYTHON_IMAGE_PREFIX


def test_the_runtime_is_distroless_and_renovate_moves_every_pinned_base() -> None:
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


def test_the_image_carries_no_shell_no_package_manager_and_no_wheel_to_install_one(
    contents: ImageContents,
) -> None:
    assert contents.tools_present == ()
    assert contents.bundled_wheels == ()


def test_the_health_check_and_the_command_run_without_a_shell(
    contents: ImageContents,
) -> None:
    dockerfile = DOCKERFILE.read_text("utf-8")
    health = exec_form(dockerfile, "HEALTHCHECK")
    major, minor = pinned_python_version()

    assert health is not None
    assert exec_form(dockerfile, "CMD") is not None
    assert worker_health_check() == ["CMD", *health]
    assert contents.command_interpreter == f"/usr/local/bin/python{major}.{minor}"


def test_a_health_check_or_a_command_in_string_form_reads_as_no_exec_form() -> None:
    written = (
        "FROM scratch AS runtime\n"
        "HEALTHCHECK --interval=15s \\\n"
        "  CMD python -m better_answers_worker.health\n"
        "CMD better-answers-worker\n"
    )

    assert exec_form(written, "HEALTHCHECK") is None
    assert exec_form(written, "CMD") is None


def test_every_shared_object_the_image_carries_resolves_on_its_own_loader(
    contents: ImageContents,
) -> None:
    assert contents.shared_object_count > 0
    assert dict(contents.unresolved_shared_objects) == {}


def test_every_library_the_image_carries_has_a_package_record_a_scanner_reads(
    contents: ImageContents,
) -> None:
    assert contents.library_file_count > 0
    assert contents.unrecorded_library_files == ()


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
        "pdf-inspector==1.24.0",
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


def test_the_lmdb_mount_is_caught_with_a_trailing_comment_and_a_longer_path_is_not(
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
    out_of_a_stage = [words for words in copies if words[1].startswith("--from=")]

    assert copies[-1:] == [["COPY", "src", "src"]]
    assert copies[:-1] == out_of_a_stage
    assert {words[-1] for words in out_of_a_stage} >= {
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


def test_a_documents_ceiling_is_cut_from_the_slowest_reading_under_the_cap() -> None:
    reading = SEAM_READINGS[THE_CEILINGS_READING]
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


def test_the_container_runs_as_the_uid_that_owns_this_tiers_volumes_with_its_own_home(
    contents: ImageContents,
) -> None:
    assert contents.uid == chowned_worker_uid()
    assert contents.uid != 0
    assert contents.home != "/"
    assert contents.home_is_writable is True


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
