"""The worker image's contents, read from one container started from it (`T-084`).

The image is asserted through the one interface a deploy unit has on it: a container.
Five failures are silent everywhere else in this repository — the Dockerfile parses,
the build succeeds, the container starts, and each of them still ships.

* ``uv sync --frozen --no-dev`` is the one thing keeping ruff, mypy, pytest, mutmut,
  psycopg and testcontainers out of the runtime. Drop ``--no-dev`` and nothing says so.
* ``UV_PYTHON_DOWNLOADS=never`` is the one thing making the base image's interpreter the
  only interpreter. Drop it and the image ships a Python nobody pinned.
* ``COPY src src`` is the one thing keeping ``tests/`` out — the analogue of the api
  image's ``contracts/`` (``apps/api/tests/image.test.ts``). ``.dockerignore`` excludes
  it too, and two fences are why this is worth asserting rather than assuming: a probe
  is what notices when one of them goes.
* The detector's **weights** are fetched at build under ``HF_HOME`` and never at run
  time (`T-122`, ADR 0020). Three ways that goes wrong and nothing else says so: a
  fetch that snapshots a model repository instead of loading the model leaves the base
  encoder's tokenizer — a second repository, four megabytes — cold; a deploy unit that
  mounts a host directory over ``HF_HOME`` masks every byte the image carries, and with
  ``HF_HUB_OFFLINE`` set beside it the result is a worker that detects nothing at all
  rather than one that quietly re-downloads; and a copy that lands outside the path the
  runtime stage reads ships an image whose weights are in the builder alone. The
  network-refused container below is what catches all three at once — and one more
  thing beside them that is not a weight and is not covered by ``HF_HUB_OFFLINE``: the
  list of public suffixes Presidio's email recogniser asks ``tldextract`` for on its
  first match. That one goes wrong silently by design, since the library falls back to
  the copy bundled in its own wheel and writes the two URLs it could not reach to a log
  nobody reads, so a page still redacts correctly while every worker process pays a
  connection attempt to find that out (`T-152`).
* The **engine's usage call** — cocoindex reaches ``cocoindex.gateway.scarf.sh`` when it
  starts, when an Environment opens and on every update, unless
  ``COCOINDEX_DISABLE_USAGE_TRACKING=1`` is in the process's environment (`T-163`).
  Nothing fails when it does: the request goes out, the worker indexes, and a third
  party is told the package, its version and the box's IP once per document of every
  run. It is the quietest of the five, because a call nobody refused leaves no trace
  here at all — which is why the case below holds the image and the deploy unit to the
  variable, and why its docblock carries the run that proved the value.

Everything the image is held to is derived. The development list comes from
``pyproject.toml``'s ``[dependency-groups] dev``, the interpreter from
``.python-version``, ``requires-python`` and the Dockerfile's own ``FROM``, the uid
from the compose file that chowns this tier's volumes, and the image itself from the
``build.yml`` matrix leg that builds it. Nothing here is a list someone has to remember
to edit.

**What the seam costs per page** (`T-122`, acceptance line 3; the spec's *A measurement,
not a budget*). Taken by the test below, on the image, with the network refused, over
the fixture page the seam's own suite reads — 405 words, 2,488 bytes. Read on **11
September 2026** on an Apple M4 Pro (14 cores, 24 GB) under Docker Desktop 29.4, so the
container is ``linux/arm64`` where ``build.yml`` builds ``linux/amd64`` and the two are
not one number. Each figure is the median of three runs in one container, and each
model's one-off load is taken before the first of them and reported apart from it.
Three readings, minutes apart, on a host shared with other agents' builds and suites:

* ``redact()``, the whole seam, under the pin ``urchade/gliner_multi_pii-v1`` — **2841,
  1910, 2646 ms per page**, over a load of 6351, 6714, 7137 ms paid once per process.
* That same model's detector alone — **4082, 2454, 2520 ms per page**.
* ``knowledgator/gliner-pii-base-v1.0``'s detector alone — **3138, 1340, 2146 ms per
  page**, over a load of 3143, 3512, 2909 ms paid once per process.

The second and third lines are the pair the pin is judged on: the same registry, the
same recognisers, the same thresholds and one model different, where ``redact`` also
resolves overlaps, writes placeholders and draws pseudonyms. The second model is the
faster of the two in all three readings, and by a margin that is not: the run-to-run
spread on one figure reaches 66 %, and the first reading put the whole seam *below* its
own detector, which the call graph forbids. An interleaved control in the same image —
``redact`` and ``analyze`` alternating rather than run in phases — put them back in
order, 1766-2198 ms against 1626-1898 ms, so the spread is the machine rather than the
seam. The two load figures are the steady ones.

That pair was judged once, and on those readings: the image stopped carrying
``knowledgator/gliner-pii-base-v1.0`` with `T-148`, so the third line above is no longer
re-runnable here — a container under ``HF_HUB_OFFLINE=1`` cannot load a model the build
never fetched, and the leg that timed it is gone from the probe below. The figures stand
as the record of a comparison already made, and the pin they chose is the pin the seam
runs. Re-taking them means putting the second model back in ``weights.py``'s table,
rebuilding, and carrying its repository again for the length of the question.

**S1 derives the seam's per-document timeout from the first line**, and nothing here is
asserted. The test below asserts only that each figure is a positive number: a ceiling
on a number with this spread would fail on a slower machine and tell its reader nothing
about the seam, which is the lesson ``packages/core/test/graph-budget.test.ts`` records
in its own docblock. To re-take the two figures the image can still answer — the whole
seam under the pin, and that model's detector alone — ``uv run --frozen pytest
tests/test_image.py -k measured --log-cli-level=INFO``.

**Sequenced before `T-006`.** The image runs a ``CMD`` that exits with a message
today: there is no work loop, so a wrong image is currently harmless. The moment
``T-006`` puts a loop in it, a wrong image stops being harmless, and a probe written
afterwards is a probe written to pass.
"""

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

#: Where ``COPY src src`` puts this tier's source, and the one directory beside it that
#: a wider ``COPY`` would bring: the image's ``WORKDIR`` is ``/app``.
TESTS_IN_THE_IMAGE = "/app/tests"

#: The prefix the official Python image installs its interpreter under. It cannot be
#: read off a file in this repository — it is that image's own convention — and it is
#: what makes the assertion below a statement about *whose* interpreter this is: one uv
#: downloaded would sit under uv's own managed-python directory instead.
BASE_IMAGE_PREFIX = "/usr/local"

#: The tier's package, and the committed generated view of the app's schema it reads and
#: never migrates (ADR 0032) — a file a ``COPY`` could lose without anything else
#: noticing.
REQUIRED_IMPORTS = ("better_answers_worker", "better_answers_worker.schema_view")

#: The redaction seam's own libraries (ADR 0020): the frame that runs the recognisers
#: and writes the placeholders, the model that stands in as the NER and its tensor
#: runtime, the pipeline the context enhancer reads lemmas from, and the client that
#: resolves a model id to bytes on disk. `uv sync --frozen --no-dev` installs every one
#: of them, so this asserts the manifest was honoured rather than that somebody
#: remembered a list.
DETECTOR_IMPORTS = (
    "presidio_analyzer",
    "presidio_anonymizer",
    "gliner",
    "spacy",
    "torch",
    "huggingface_hub",
)

#: What the worker composes as a host (ADR 0036): the engine the pipeline module is the
#: only importer of, the driver its Postgres target acquires its own connections through
#: and this tier's per-workspace pool is built from, and the object store client the
#: pipeline reads a landed copy with. Asserted for the same reason as the detector's
#: libraries above — `uv sync --frozen --no-dev` installs them from the manifest, and
#: nothing in the image imports one until a job asks it to, so a manifest, a lockfile or
#: a stage that stopped agreeing would not fail the build.
HOST_IMPORTS = (
    "cocoindex",
    "asyncpg",
    "boto3",
)

#: What the container is asked to import: the tier's own modules, the detector's and the
#: host's.
PROBED_IMPORTS = REQUIRED_IMPORTS + DETECTOR_IMPORTS + HOST_IMPORTS

#: The module the build runs to fetch the weights. It is named here and in the
#: Dockerfile and nowhere else, so the module cannot move without both moving.
WEIGHTS_MODULE = "better_answers_worker.redaction.weights"

#: A binding nobody configured, and one binding's seed — ``THE_SAFE_SET`` and ``SEED``
#: in ``tests/test_redaction.py``, spelled here as the JSON the probe is handed. Every
#: expectation below is derived from the parsed form rather than from a second
#: statement of the same binding, so a case cannot go on describing one binding while
#: the container is given another.
THE_SAFE_SET = '{"default_on": true, "default_off": false}'
SEED = "b0f3a1d2c4e5"
THE_RULES_IN_FORCE = cast("Mapping[str, bool]", json.loads(THE_SAFE_SET))

#: What the fixture planted that this binding therefore withholds, out of the one
#: declaration of the page's answers. The page's planted job title is absent from it
#: because ``default_off`` is false above and the agreement raises a title at that
#: tier; flip that key and the title joins the list of its own accord. They are still
#: literals this repository wrote rather than anything read back from the container:
#: what is being proved is that the image's seam answers what this repository's seam
#: answers, and a container asked to grade its own work proves nothing.
WITHHELD_SPANS = spans_withheld_under(THE_RULES_IN_FORCE)

#: Every placeholder this binding leaves in the text, by how many of it. The typed ones
#: are the shared declaration's — one word per finding at a switchable tier this binding
#: has on, the word the agreement's and the number the category's. The always tier's
#: single neutral word is written down instead, at the six spans of this page it covers;
#: ``planted_page.typed_placeholders_under`` says why that one total cannot be derived
#: and why ``tests/test_redaction.py`` counts the same word at seven.
PLACEHOLDERS_IN_THE_TEXT: Mapping[str, int] = {
    "[withheld]": 6,
    **typed_placeholders_under(THE_RULES_IN_FORCE),
}

#: The sensitivity the health sentence narrows the document to.
VERDICT = "Restricted"

#: Every pin whose version the seam's version string carries, by the name `pins.py`
#: declares it under. The string is assembled there and is not re-assembled here — what
#: this holds is that the image's is built from the constants this repository declares.
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
# A laptop without Docker still runs `check`; CI does not get that latitude. `build.yml`
# gates the push on this workflow, so a CI job that quietly skipped these tests would
# leave the image ungoverned while reporting green — the one outcome the gate exists to
# prevent. Skipped off CI, failed on it, and never silent on either.
DAEMON_IS_REQUIRED = os.environ.get("CI", "") != ""
# Set by `check.yml` when the workflow calling it has a job that pushes these images.
# That job loads its own build and runs this file against it, so probing here as well
# would build the image a second time on a second runner to learn what the first already
# knows. Exactly ``"true"`` and nothing looser: a value nobody meant to set leaves the
# probe running, which is the direction a mistake here has to fail in.
PROBE_DEFERRAL_VARIABLE = "IMAGE_PROBE_DEFERRED"
PROBE_RUNS_IN_THE_JOB_THAT_PUSHES = os.environ.get(PROBE_DEFERRAL_VARIABLE) == "true"

#: The name the image id arrives under, shared with the api's and the backup's probes so
#: `build.yml`'s probe step can hand every leg its id without naming a tier.
IMAGE_ID_VARIABLE = "IMAGE_ID"


def _matrix_legs() -> list[dict[str, str]]:
    """The ``include:`` legs of ``build.yml``'s image job.

    Read with a reader rather than a YAML parser, for the reason
    ``apps/api/tests/workspaces.ts`` gives for ``pnpm-workspace.yaml``: this tier has
    no YAML dependency, and the shape being read is a list of plain ``key: value``
    lines. It raises rather than answering with nothing, because every caller asserts
    over what it returns and an empty list asserts nothing.
    """
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
    """The leg that builds a tier's image, or a failure naming what the matrix has."""
    legs = _matrix_legs()
    for leg in legs:
        if leg.get("tier") == tier:
            return leg
    built = ", ".join(leg.get("tier", "?") for leg in legs)
    message = f"build.yml's image job has no `{tier}` leg; it builds {built}"
    raise RuntimeError(message)


def _pyproject_at(*path: str) -> object:
    """The value at a path in ``pyproject.toml``, unnarrowed.

    ``tomllib`` answers ``dict[str, Any]`` and can answer nothing narrower, so this
    claims nothing about what it found. Its callers narrow with ``isinstance`` and
    refuse what they cannot use, which is § TYPES (Python)'s review question answered
    rather than an ``Any`` handed on.
    """
    with (WORKSPACE / "pyproject.toml").open("rb") as handle:
        found: object = tomllib.load(handle)
    for step in path:
        if not isinstance(found, dict):
            message = f"pyproject.toml has no table at {'.'.join(path)}"
            raise RuntimeError(message)
        found = found[step]
    return found


def _requirements(*path: str) -> list[str]:
    """A requirement list out of ``pyproject.toml``, refusing anything that is not."""
    found = _pyproject_at(*path)
    if not isinstance(found, list):
        message = f"pyproject.toml's {'.'.join(path)} is not a list of requirements"
        raise RuntimeError(message)
    return [str(each) for each in found]


def _distribution_name(requirement: str) -> str:
    """``psycopg[binary]==3.3.5`` → ``psycopg``: the name an installed distribution
    carries."""
    named = re.match(r"[A-Za-z0-9._-]+", requirement)
    if named is None:
        message = f"no distribution name in the requirement {requirement!r}"
        raise RuntimeError(message)
    return named.group(0)


def development_only_distributions() -> list[str]:
    """Every name in ``[dependency-groups] dev`` that the tier does not also run on.

    The second half is what keeps this honest the day a development dependency becomes a
    runtime one: a name under both is in the image on purpose, and asserting its absence
    would be asserting a bug.
    """
    development = {
        _distribution_name(each) for each in _requirements("dependency-groups", "dev")
    }
    runtime = {
        _distribution_name(each) for each in _requirements("project", "dependencies")
    }
    return sorted(development - runtime)


def pinned_python_version() -> tuple[int, int]:
    """The version ``.python-version`` names."""
    pinned = (WORKSPACE / ".python-version").read_text("utf-8").strip()
    major, _, minor = pinned.partition(".")
    return int(major), int(minor)


def required_python_floor() -> tuple[int, int]:
    """The version ``requires-python``'s lower bound names."""
    declared = _pyproject_at("project", "requires-python")
    floor = re.search(r">=\s*(\d+)\.(\d+)", str(declared))
    if floor is None:
        message = "pyproject.toml's requires-python has no lower bound this can read"
        raise RuntimeError(message)
    return int(floor.group(1)), int(floor.group(2))


def base_image_python_version() -> tuple[int, int, int]:
    """The interpreter the Dockerfile's runtime stage is built on, off its own ``FROM``.

    The patch is the point: a build that fetched its own Python would satisfy
    ``requires-python`` and ``.python-version`` and still not be this one.
    """
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
    """One constant's value out of ``redaction/pins.py``, read as text.

    This file imports nothing from ``src/better_answers_worker`` in-process and this is
    how it keeps that promise for the pins. The constraint is stated in
    ``pyproject.toml``'s ``[tool.mutmut]``: a mutant of the seam whose stats pass had
    imported this file would build the worker image, and the same constraint is what
    ``apps/api/tests/image-probe.ts`` states for Stryker. So a pin reaches this file the
    way the Dockerfile's Python version and the compose file's uid do — by reading the
    file that declares it.
    """
    found = re.search(rf'^{name} = "([^"]+)"', PINS.read_text("utf-8"), re.M)
    if found is None:
        message = f"{PINS} declares no {name} this can read"
        raise RuntimeError(message)
    return found.group(1)


def pinned_model_ids() -> tuple[str, ...]:
    """Both GLiNER models the seam pins: the one it runs, and the one S0 measured.

    Two ids and one of them in the image. `pins.py` still declares both — the second is
    what the version-string guard below names to assert its absence — and the probe is
    still asked about both, because an ask narrowed to the one the image carries could
    prove presence and never absence.
    """
    return (_pin("GLINER_MODEL_ID"), _pin("GLINER_MODEL_ID_MEASURED"))


def worker_mounts_over(path: str) -> list[str]:
    """Every volume the worker's deploy unit mounts over a path inside the container.

    The terminator admits an optional third, colon-prefixed field, then trailing
    whitespace, then an optional ``#`` comment to the end of the line — a real mount
    written with a comment on it (``deploy/platform.compose.yaml``'s own lmdb line) must
    still be seen, or a guard built on this helper proves nothing about a commented
    mount. ``(:\\S*)?`` is anchored on the literal path first, so a path that is only a
    *prefix* of a longer one (``/data/worker/lmdb`` against a line ending
    ``/data/worker/lmdb-extra``) still fails to match: the extra characters have no
    colon, whitespace or ``#`` to be absorbed by, so ``$`` never lands.
    """
    return [
        line.strip()
        for line in worker_service().splitlines()
        if re.match(rf"\s*- \S+:{re.escape(path)}(:\S*)?\s*(#.*)?$", line)
    ]


def chowned_worker_uid() -> int:
    """The uid ``deploy/stores.compose.yaml``'s ``init`` chowns this tier's volumes to.

    Nothing runs as root to own a volume (`[OPS1]`), so a lost ``USER`` line does not
    merely ship a root container — it ships one that cannot write the directories the
    stores stack prepared for it.
    """
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


# Read inside the container by the image's own interpreter, so every answer means what
# it means to the process the deploy unit starts. The development list is asked both
# ways and a name counts as present under either: the criterion is what the app could
# *import*, and `uv sync` installs *distributions* — a distribution whose module is
# named something else is still bytes nobody patches, and a module importable without a
# distribution record is still an install that stopped being production-only.
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

# The second container's probe. It takes the page out of its environment by name, runs
# the seam over it and writes down what the seam answered; it asserts nothing, because
# the answers it is held to are the ones `tests/planted_page.py` declares for that page.
# The suppressions are empty here: no erasure request applies to a fixture, and the
# seam's argument for one is exercised by `tests/test_redaction.py` and not by a
# container.
#
# It also watches one third-party logger and reads one directory, and both are about the
# same thing: the list of public suffixes `tldextract` wants the first time the seam
# matches an email address. `tldextract` logs a warning for each list URL it fails to
# reach and then falls back to the copy bundled in its own wheel, so a container with no
# route out redacts the page and answers correctly either way — which is exactly why
# "the seam returned" cannot tell a reader whether the list came off the image or off a
# fetch that timed out. The warnings can.
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

#: How many times each figure below is taken before its median is kept. Three, because
#: the first run of anything on a cold container pays for a page fault the second does
#: not, and a median of three throws that one away without turning a measurement into a
#: benchmark run.
MEASUREMENT_RUNS = 3

# The third container's probe, and the only one here that answers numbers. It times two
# things over the same page: the whole seam under the pinned model, and that model's
# detector alone. The difference between them is what `redact` adds to a detection —
# resolving overlaps, writing placeholders, drawing pseudonyms — and S1 derives its
# per-document timeout from the first of the two.
#
# It timed a third thing until `T-148`: the detector of the model the pin was chosen
# against, which made the comparison the docblock above records. The image stopped
# carrying that model once the comparison was made, and a container under
# `HF_HUB_OFFLINE=1` cannot load a model the build never fetched, so the leg would now
# raise rather than measure. The figures are the record; the leg is gone.
#
# The model's one-off load is taken before the first timed page and reported apart from
# it: `analyzer()` brings the process-wide engine up the first time it is asked for, so
# a `redact` that paid for it would be reporting a start-up as a page, and S1 sets a
# per-document timeout off the page.
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


@dataclass(frozen=True)
class ImageContents:
    """What one container answered about the image it was started from."""

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
    # The container's answer, narrowed on the very next statement and never held as
    # `Any` past it: what a subprocess wrote to stdout has no type until this reads one
    # out of it (§ TYPES (Python)).
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
    """What one container answered about what the seam costs it to read a page.

    Four numbers and one name, never a threshold: the module docblock records them and
    nothing asserts them. The model carries its one-off load apart from its cost per
    page, because the two are spent once and once per document respectively and S1's
    timeout is derived from the second of them.
    """

    runs: int
    pinned_model: str
    pinned_load_ms: float
    seam_ms: float
    pinned_ms: float


def _read_measurement(stdout: str) -> Measurement:
    # Narrowed on the statement after the read, like `_read_contents` above and for the
    # same reason (§ TYPES (Python)).
    answered = _answered(stdout)
    return Measurement(
        runs=int(answered["runs"]),
        pinned_model=str(answered["pinned_model"]),
        pinned_load_ms=float(answered["pinned_load_ms"]),
        seam_ms=float(answered["seam_ms"]),
        pinned_ms=float(answered["pinned_ms"]),
    )


#: What the `type=gha` build cache reads its credentials out of. The token is the same
#: one on either version of that backend; the endpoint moved from the first name below
#: to the second when the Actions cache service went to v2, so both are read and either
#: will do (Docker, *GitHub Actions cache*, 13/09/2026). A runner hands these to an
#: **action's** own process and to nothing else — which is why
#: `docker/build-push-action` needs nothing extra, a `docker buildx build` run from
#: inside this suite does, and a workflow step has to copy them into the job's
#: environment before `check` runs.
SHARED_CACHE_TOKEN = "ACTIONS_RUNTIME_TOKEN"
SHARED_CACHE_URLS = ("ACTIONS_RESULTS_URL", "ACTIONS_CACHE_URL")

#: The driver a plain daemon answers with, and the one driver that can export a cache
#: nowhere: it builds straight into the daemon's image store, so a build handed
#: `--cache-to` on it stops with an error rather than ignoring the flag. Every other
#: driver — the container one a runner's setup step creates — can.
DRIVER_WITHOUT_AN_EXPORT = "docker"


def _builder_that_can_export(inspected: str) -> str | None:
    """The builder ``docker buildx inspect`` described, if it can export a cache.

    ``inspect`` answers a block of ``Name: value`` lines for the builder and then a
    ``Nodes:`` block that repeats several of those names for each node, so the first
    reading of a name is the builder's own and the rest are a node's. Nothing here
    parses further than that: what this has to decide is one thing, and a driver this
    repository has never seen is treated as able rather than unable, since the only
    driver that cannot is the default one every machine already has.
    """
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
    """The builder this machine may export a ``type=gha`` cache to, or ``None``.

    Two questions in this order and both must answer. The credentials are asked for
    first because they are what a laptop never has and because the answer costs
    nothing; only then is the daemon asked which builder it would use. Either question
    coming back empty is the plain build — failing closed, because the cached arm is
    not a faster build on a machine that cannot reach the cache, it is a failed one.
    """
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
    """The argv that builds this tier's image, with the shared cache or without it.

    A pure function of the two things that decide it, so that both commands can be read
    on any machine and neither has to be run to be held. Four flags make the cached arm
    what it is: the two halves of the cache, ``mode=max`` so every layer of a
    multi-stage build is exported and not only the last stage's, and ``--load``, which
    the container driver needs before the image is in the daemon at all — the suite
    starts containers from what this returns. ``--quiet`` is not asked of that arm
    because it is not the id's source there: buildx writes the id to ``--iidfile``,
    which is a file this run owns rather than a line to be picked out of a build log.
    """
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
        "type=gha",
        "--cache-to",
        "type=gha,mode=max",
        "--load",
        "--iidfile",
        str(iidfile),
        "--file",
        leg["dockerfile"],
        leg["context"],
    ]


def _build_the_image(leg: Mapping[str, str]) -> str:
    """The image `build.yml` builds for this tier, by the id its build printed."""
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
    """One container, one probe, and what it wrote to stdout.

    The probe and the wait are parameters because more than one question is asked of
    this image and they are not the same size of question: one imports a module and
    answers, another brings up hundreds of megabytes of weights first. ``network`` is
    what turns the second of those into a proof rather than a rehearsal — given
    ``"none"`` the container has no interface to reach a registry on, so a model it
    loads is a model the image was carrying.
    """
    arguments = ["docker", "run", "--rm"]
    if network is not None:
        arguments += ["--network", network]
    # By name and never by value: `docker run --env NAME` takes the value out of this
    # process's environment, so a derived list never reaches another user's `ps`.
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
    """The JSON object a probe wrote, taken as the last line it wrote.

    A library brought up inside the container may write to stdout before the probe does
    — a deprecation notice, a download bar that found nothing to draw — and the probe's
    own answer is one line with no newline in it, written last. Narrowed by its callers
    on the statement after this (§ TYPES (Python)).
    """
    lines = [line for line in stdout.splitlines() if line.strip()]
    if not lines:
        message = "the container wrote nothing to stdout"
        raise RuntimeError(message)
    answered: dict[str, Any] = json.loads(lines[-1])
    return answered


@pytest.fixture(scope="module")
def image() -> Iterator[str]:
    """The image this repository ships as the worker, by its id.

    Two ways this runs. Given no image id it builds the image and reads what it built,
    which is what a laptop and a pull request do. Given one it reads that image and
    builds nothing: `build.yml`'s image job loads its own build, hands the id here and
    pushes only if these tests pass, so the artefact that ships is the artefact that was
    read (`T-043`).

    It is a fixture of its own so that more than one container can be started from the
    one image: reading the contents and refusing the network are two runs of two probes,
    and a build for each would be a second image to say the same thing about.
    """
    if PROBE_RUNS_IN_THE_JOB_THAT_PUSHES:
        pytest.skip(
            "the job that pushes this image runs this file against its own build"
        )
    if not DOCKER_ANSWERS:
        if DAEMON_IS_REQUIRED:
            raise RuntimeError(NO_DAEMON)
        pytest.skip(DAEMON_SKIP_REASON)

    supplied = os.environ.get(IMAGE_ID_VARIABLE, "").strip()
    # The image is run by the id the build prints, and is never tagged. A tag is a name
    # on the daemon, and the daemon is shared: two worktrees running `check` at once
    # would overwrite each other's tag and one would read the other's image. A supplied
    # id is the same kind of thing — the id the workflow's own load printed — for the
    # same reason.
    built_here = _build_the_image(matrix_leg("worker")) if not supplied else None
    try:
        yield built_here or supplied
    finally:
        # An untagged image left behind is a dangling quarter-gigabyte for every run
        # whose source differed from the last. Failure to remove it is not a failure of
        # the suite: another run may hold the same id.
        if built_here is not None:
            subprocess.run(
                ["docker", "rmi", "--force", built_here],
                check=False,
                capture_output=True,
                timeout=120,
            )


@pytest.fixture(scope="module")
def contents(image: str) -> ImageContents:
    """One container, started from that image, asked what it is made of."""
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
    # Both files name the same version or one of them is lying, and the container agrees
    # with them or the build resolved a Python this repository never chose.
    assert pinned_python_version() == required_python_floor()
    assert contents.version[:2] == pinned_python_version()


def test_the_interpreter_is_the_base_images_and_not_one_the_build_fetched(
    contents: ImageContents,
) -> None:
    # `UV_PYTHON_DOWNLOADS=never` is the only thing that makes this true, and it is a
    # line in an `ENV` that nothing else would miss.
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
    # Acceptance line 2's first clause. `uv sync --frozen --no-dev` installs these from
    # the manifest, so what this catches is a manifest, a lockfile or a stage that
    # stopped agreeing with the seam — none of which the build would fail on, because
    # nothing in the image imports the seam until a job asks it to.
    assert {name: contents.imports[name] for name in DETECTOR_IMPORTS} == dict.fromkeys(
        DETECTOR_IMPORTS, True
    )
    # And the container was asked about all of them: a name dropped from the ask would
    # leave the assertion above passing over a smaller list.
    assert set(contents.imports) == set(PROBED_IMPORTS)


def test_the_image_carries_every_library_the_host_composes(
    contents: ImageContents,
) -> None:
    # The same reading as the detector's above, for the half of the image the worker
    # needs to be a host rather than a reader: without these three the tier still
    # builds, still starts and still claims, and fails the first `index` job it is
    # handed.
    assert {name: contents.imports[name] for name in HOST_IMPORTS} == dict.fromkeys(
        HOST_IMPORTS, True
    )


def test_the_image_carries_the_model_the_seam_runs_and_not_the_one_it_was_measured_on(
    contents: ImageContents,
) -> None:
    # Acceptance line 2's second clause, asked the way a run-time load asks it: the
    # cache holds the model, offline. The container is still asked about both pinned ids
    # and the answer is a literal pair, one true and one false, because the image is now
    # held to two things rather than one — the model the seam runs is there, and the
    # model S0 measured it against is not, having left `weights.py`'s table with `T-148`
    # once the comparison was made. Asking for both is what makes the second provable;
    # an ask narrowed to the pin could only ever prove presence, and would keep passing
    # the day a second repository of unread weights came back. The spaCy pipeline is
    # the other half of what the seam loads — a pinned wheel in the venv rather than an
    # entry under `HF_HOME`, which is why it is asked for by loading it.
    assert dict(contents.weights) == {
        _pin("GLINER_MODEL_ID"): True,
        _pin("GLINER_MODEL_ID_MEASURED"): False,
    }
    assert len(pinned_model_ids()) == 2
    assert contents.spacy_pipeline is True


def test_the_image_holds_its_weights_where_the_deploy_unit_says_they_are(
    contents: ImageContents,
) -> None:
    # The image sets `HF_HOME` so that a container started from it is self-sufficient,
    # and the deploy unit sets it because the location of this tier's caches is the
    # deploy unit's to state. Two places, one value, or the worker looks somewhere the
    # weights are not.
    assert contents.hf_home == worker_environment("HF_HOME")
    assert contents.hf_home != ""


def test_the_image_stops_the_engine_calling_its_gateway_and_the_deploy_unit_agrees(
    contents: ImageContents,
) -> None:
    """The engine's usage call, refused in the image and declared by the deploy unit.

    cocoindex reaches ``https://cocoindex.gateway.scarf.sh`` when it starts, when an
    Environment opens and on every update, which for this tier is an outbound call per
    document of every index run — a request that names the package, its version and the
    box's IP to a third party nobody chose. The call is the native core's alone: nothing
    in the Python package holds either the host or the variable below, so no setting of
    ours stands in for it and the deploy unit is the only place it can be answered.

    **The value was probed before it was written down**, because a truthy string is an
    assumption until a run says otherwise. On **19 September 2026**, against the pinned
    engine — cocoindex **1.0.22**, ``pyproject.toml`` — this tier's pipeline suite
    (``test_pipeline_host.py``, ``test_pipeline_index.py``, ``test_pipeline_landed.py``)
    was run twice through a proxy of the run's own, which wrote down every host it was
    asked to reach and reached none. The proxy was named to the run in ``HTTPS_PROXY``,
    ``HTTP_PROXY`` and ``ALL_PROXY``, with the loopback and Hugging Face in ``NO_PROXY``
    so that Testcontainers and the detector's weights went their usual way and the
    engine's own call was the only thing in view. Without the variable: 33 passed, and
    **93 CONNECTs to cocoindex.gateway.scarf.sh:443**. With
    ``COCOINDEX_DISABLE_USAGE_TRACKING=1``: 33 passed, and **none**. So ``1`` is the
    value proved and the only one: the run has two arms and neither of them is another
    spelling of truth, so ``true``, ``yes`` and ``0`` are all untested here — and ``0``
    reads to a person as the call switched back on.

    Which is why the assertions are two and not one. The first is ``HF_HOME``'s shape
    above, and says the image and the deploy unit have not drifted apart; it would hold
    just as well with all three places moved together to a word nobody has run. The
    second writes the proved value down, and is what makes the first a statement about
    silence rather than about agreement.
    """
    assert contents.usage_tracking == worker_environment(
        "COCOINDEX_DISABLE_USAGE_TRACKING"
    )
    assert contents.usage_tracking == "1"


def test_the_deploy_unit_mounts_nothing_over_the_weights_the_image_carries() -> None:
    """A host directory over ``HF_HOME`` masks every byte the build fetched.

    It is worth a test of its own because no container test can catch it: this file
    mounts nothing, so the weights are there whatever the compose file says. And the
    failure it would cause is not a quiet re-download — the worker's environment sets
    ``HF_HUB_OFFLINE`` beside it, so a masked cache is a worker that cannot load a model
    at all, on a box whose first job is the one that would have warmed it.
    """
    assert worker_mounts_over(worker_environment("HF_HOME")) == []


def test_the_lmdb_mount_with_its_trailing_comment_is_caught_and_a_longer_path_is_not(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The positive control the guard above needed: written first, red against the
    helper as it stood, so the guard's own passing was proof of something rather than
    an accident of a terminator that could not see a commented line.

    ``worker_mounts_over``'s terminator used to require a line to end at the path or
    continue with a third, colon-prefixed field. A mount with a trailing comment ends
    neither way, so the helper matched nothing on such a line — which is exactly the
    shape of ``deploy/platform.compose.yaml``'s real lmdb mount, and exactly why the
    guard above passed whether or not a stray ``HF_HOME`` bind existed: a helper that
    cannot see a commented mount cannot see one added over the weights either. This
    reads the compose file's own lmdb line for real, so the finding is provable without
    ever editing that file.
    """
    assert worker_mounts_over("/data/worker/lmdb") == [
        "- /data/worker/lmdb:/data/worker/lmdb        "
        "# one LMDB per binding — personal data on disk; never backed up"
    ]

    # Widening the terminator must not widen what counts as "the same path": a bind
    # mount over a longer, merely-prefixed path is a different volume and must still
    # not match.
    monkeypatch.setattr(
        f"{__name__}.worker_service",
        lambda: "  - /data/worker/lmdb-extra:/data/worker/lmdb-extra",
    )
    assert worker_mounts_over("/data/worker/lmdb") == []


def test_the_deploy_unit_mounts_nothing_over_the_suffix_list_in_the_image() -> None:
    """A host directory over ``TLDEXTRACT_CACHE`` masks the list the build warmed.

    The same class as the weights guard two above, and the quieter of the two. A masked
    ``HF_HOME`` raises on the first load, because ``HF_HUB_OFFLINE`` is set beside it; a
    masked suffix list raises nothing at all. ``tldextract`` given an empty directory
    tries two URLs, logs a warning for each, falls back to the copy in its own wheel and
    answers correctly — so a bind mount here is a fetch per container, out to two hosts
    nothing else in this tier reaches, and the only outward sign of it is a warning
    nobody reads.

    What an empty list here rests on is the case above, cited rather than repeated:
    ``test_the_lmdb_mount_with_its_trailing_comment_is_caught_and_a_longer_path_is_not``
    is where ``worker_mounts_over`` is shown seeing a mount when there is one. Without
    that case this would pass just as readily against a helper that can see none.
    """
    assert worker_mounts_over(worker_environment("TLDEXTRACT_CACHE")) == []


def test_the_build_fetches_the_weights_by_running_the_module_that_names_them(
    contents: ImageContents,
) -> None:
    # Two stages and two paths: the build fetches under a cache mount and copies what it
    # fetched to the path the runtime stage reads from. The module is named here so it
    # cannot move without this moving, and the path is the container's own answer rather
    # than a literal, so a copy that landed elsewhere fails rather than passes.
    dockerfile = DOCKERFILE.read_text("utf-8")

    assert WEIGHTS_MODULE in dockerfile
    assert contents.hf_home in dockerfile


def test_the_image_redacts_the_fixture_with_its_network_refused_and_fetches_nothing(
    image: str,
) -> None:
    """Acceptance line 1's second half, and the strongest thing this file says.

    Every assertion above is a statement about what is in the image. This one is the
    statement that what is in it is enough: a container with no network interface loads
    the seam and redacts a page with it, so every entry the load touches — the model,
    its configuration, and the base encoder's tokenizer out of a second repository —
    was already there. It is also the only test here that would fail on the four
    megabytes of that tokenizer, which is the whole reason the build fetches by loading.

    **And it is the one place a fetch that fails quietly can be seen.** The weights fail
    loudly when they are missing, because ``HF_HUB_OFFLINE`` makes a cache miss an
    exception. The list of public suffixes does not: ``tldextract`` tries two URLs, logs
    a warning for each, falls back to the copy in its own wheel and answers correctly —
    so every assertion above this one passed before the image carried that list at all,
    and would pass again the day it stopped carrying it. What that costs is not
    correctness but a connection attempt and its timeout, paid inside the first email
    match of every process the deploy unit starts, on a box that may have no route out
    to time out against. So this asks for the silence rather than for the answer
    (`T-152`).

    The page reaches the container by the name of an environment variable and never by
    its value, the same way the derived lists above do: it is synthetic, but it is
    PII-shaped, and a value on a command line is a value in somebody else's ``ps``. The
    address planted in it is at a consumer provider's UK domain, which is what drives
    Presidio's email recogniser into ``tldextract`` and makes the silence below mean
    something.
    """
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
    # Both halves of the version string, and the pin that is not in it (`[TEST7]`): the
    # image runs the model the seam pins, and the model that pin was measured against
    # reaches no finding. Since `T-148` the image does not carry that model either,
    # which makes this the weaker of the two statements about it — the contents test
    # above is where its absence from the image is asserted — and still the one that
    # matters to a reader of a finding, who is told which detector answered.
    assert version.startswith(f"{_pin('RULE_VERSION')}:")
    for pinned in PINNED_IN_THE_VERSION_STRING:
        assert _pin(pinned) in version, pinned
    assert _pin("GLINER_MODEL_ID_MEASURED").rsplit("/", 1)[-1] not in version

    # Nothing was reached for while that ran. Each of these three says something the
    # other two cannot: the container and the deploy unit point the library at one
    # directory, that directory arrived in the image with something in it, and the
    # library therefore never went looking. Drop the `ENV` and the first fails; drop the
    # `COPY` and the second does; get either subtly wrong — a path off by a directory, a
    # `--chown` that left the files unreadable — and the third does, because a library
    # that cannot read its cache fetches instead of saying so.
    #
    # The first is held against the deploy unit rather than against a path written down
    # here, for the reason `worker_environment` gives: where this tier's caches live is
    # the deploy unit's to state. It is also what makes the mount guard above worth
    # having, since that guard asks the compose file for the path it protects: a compose
    # line naming a directory the image does not bake would leave it guarding nothing
    # the container reads, and this is the assertion that catches that. The path is
    # still spelled out once — `test_redaction_suffixes.py` reads both halves of it off
    # the Dockerfile — so this being agreement rather than a pin costs nothing.
    assert found["suffix_cache"] == worker_environment("TLDEXTRACT_CACHE")
    assert found["suffix_cache_entries"] != []
    assert found["reached_out"] == []


def test_what_the_seam_costs_per_page_is_measured_on_the_image_and_never_budgeted(
    image: str,
) -> None:
    """Acceptance line 3. A measurement, not a budget — the spec's words.

    The numbers this takes are recorded in the module docblock above and asserted
    nowhere. A ceiling here would be a test whose failure told a reader about the
    machine it ran on rather than about the seam:
    ``packages/core/test/graph-budget.test.ts`` carries that scar in its own docblock,
    where a budget with threefold headroom had to become eightfold and a third budget
    had to go. So the only assertion is that each figure is a positive number, which is
    what catches a probe that timed nothing, and the figures themselves go to a reader
    through the log.

    It runs on the image and with the network refused for the same reason the test
    above does: what S1 needs is what a page costs the worker where the worker runs,
    and a container that could reach a registry might be timing a download.
    """
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
            # One model brought up and six timed pages, where the test above brings up
            # one model and reads one page. Long enough that a slower machine finishes,
            # short enough that a container which has stopped making progress is killed
            # rather than waited on. It is unchanged from when this probe timed a
            # second model as well: the headroom was the point of the number, and a
            # ceiling that tracked the work would be a budget, which the docstring
            # above refuses.
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


def test_the_container_runs_as_the_uid_that_owns_this_tiers_volumes(
    contents: ImageContents,
) -> None:
    assert contents.uid == chowned_worker_uid()
    assert contents.uid != 0


def test_the_image_leaves_this_tiers_tests_out_of_the_runtime(
    contents: ImageContents,
) -> None:
    assert contents.has_tests is False


def test_this_tier_reads_the_names_the_workflows_actually_hand_it() -> None:
    """The two variables above are the app tier's to define and this tier's to obey.

    This tier shares four stores with that one and never code (ADR 0005), so no import
    can hold the two spellings together and each is a second pin. They are held against
    the workflows that supply them instead, which is the shape `[DEPS2]` names and the
    one ``pg_harness.py`` uses for ``POSTGRES_IMAGE``. Without this, renaming either
    variable leaves this file building an image of its own and calling it the shipped
    one, green.
    """
    handed = [
        line
        for line in BUILD_WORKFLOW.read_text("utf-8").splitlines()
        if re.search(rf"\b{IMAGE_ID_VARIABLE}:.*outputs\.imageid", line)
    ]
    deferred = [
        line
        for line in CHECK_WORKFLOW.read_text("utf-8").splitlines()
        if f"{PROBE_DEFERRAL_VARIABLE}:" in line
    ]

    assert len(handed) == 1, BUILD_WORKFLOW
    assert len(deferred) == 1, CHECK_WORKFLOW


def test_the_runner_refuses_the_engines_gateway_call_the_way_the_image_does() -> None:
    """The place in CI where this tier's suite runs outside a configured container.

    The image's ``ENV`` reaches a container and nothing else, and the job that runs this
    tier's suite starts none: ``pnpm check`` runs it on the runner itself, where the
    engine is the same engine and the call is the same call — once per update, on every
    pull request, from a machine the deploy unit has never configured. The value is read
    off the compose file rather than written here, so the runner cannot come to disagree
    with what ships.

    **This covers the runner and not a laptop.** ``uv run --frozen check`` sets nothing,
    and neither does one suite run by file, so neither is covered from out here. What
    covers them is the pipeline package, which sets the variable ahead of its own
    import of the engine (`T-204`); ``tests/test_pipeline_usage_tracking.py`` holds that
    against the same line of the compose file, and says why no later line would do.
    """
    declared = [
        line
        for line in CHECK_WORKFLOW.read_text("utf-8").splitlines()
        if "COCOINDEX_DISABLE_USAGE_TRACKING:" in line
    ]

    assert len(declared) == 1, CHECK_WORKFLOW
    assert declared[0].split(":", 1)[1].strip().strip('"') == worker_environment(
        "COCOINDEX_DISABLE_USAGE_TRACKING"
    )


def test_the_worker_leg_of_the_image_job_names_this_file_as_its_probe() -> None:
    """So the file cannot move without the workflow that runs it moving too."""
    leg = matrix_leg("worker")
    here = Path(__file__).resolve().relative_to(WORKSPACE)

    assert str(here) in leg["probe"]
    assert "apps/worker" in leg["probe"]


def test_a_runner_builds_through_buildx_and_a_laptop_builds_as_it_always_did() -> None:
    """The one build this suite runs, read as the two commands it can be.

    On a runner the layers this build makes are worth keeping — the weights step alone
    fetches over a gigabyte — and the only place to keep them is a cache the runner
    does not own, which is what ``type=gha`` is. Everywhere else that cache is
    unreachable and asking for it fails the build rather than skipping it, so the
    choice is made once, here, and the argv is the whole of it. Both arms are literals
    and neither needs a daemon: what this holds is that the fallback is *exactly* the
    command that ran before the cache existed, and that the cached arm carries all four
    of the things it cannot work without.
    """
    leg = {"dockerfile": "apps/worker/Dockerfile", "context": "apps/worker"}
    written_to = Path("/tmp/the-id-this-build-wrote")

    assert _build_command(leg, builder="the-container-builder", iidfile=written_to) == [
        "docker",
        "buildx",
        "build",
        "--builder",
        "the-container-builder",
        "--cache-from",
        "type=gha",
        "--cache-to",
        "type=gha,mode=max",
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
    """What `docker buildx inspect` answers, read both ways as two literals.

    A driver is not a detail here. The `docker` driver builds into the daemon's own
    store and has nowhere at all to put an export, so a build handed `--cache-to` on it
    stops with an error; the container driver a runner's setup step creates is the one
    that can. Every machine with Docker on it answers this question, and only one kind
    of answer may take the cached arm above — a reading that said yes to the daemon's
    own builder would turn every laptop's build into a failure.
    """
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
    """The order the probe asks its two questions in, which is the fail-closed half.

    A builder that can export is no use without somewhere to export to, and the
    credentials are the half that is missing on every machine but a runner mid-job. So
    they are read first and the daemon is never asked — asserted by making the ask
    itself a failure, because ``None`` is also what a machine with no Docker at all
    would answer and the two would be indistinguishable.
    """
    for name in (SHARED_CACHE_TOKEN, *SHARED_CACHE_URLS):
        monkeypatch.delenv(name, raising=False)

    def refuse_to_run(*_arguments: object, **_keywords: object) -> None:
        message = "the probe asked the daemon for a builder it could not have used"
        raise AssertionError(message)

    monkeypatch.setattr(subprocess, "run", refuse_to_run)

    assert _shared_cache_builder() is None
