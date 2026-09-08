"""The worker image's contents, read from one container started from it (`T-084`).

The image is asserted through the one interface a deploy unit has on it: a container.
Three failures are silent everywhere else in this repository — the Dockerfile parses,
the build succeeds, the container starts, and each of them still ships.

* ``uv sync --frozen --no-dev`` is the one thing keeping ruff, mypy, pytest, mutmut,
  psycopg and testcontainers out of the runtime. Drop ``--no-dev`` and nothing says so.
* ``UV_PYTHON_DOWNLOADS=never`` is the one thing making the base image's interpreter the
  only interpreter. Drop it and the image ships a Python nobody pinned.
* ``COPY src src`` is the one thing keeping ``tests/`` out — the analogue of the api
  image's ``contracts/`` (``apps/api/tests/image.test.ts``). ``.dockerignore`` excludes
  it too, and two fences are why this is worth asserting rather than assuming: a probe
  is what notices when one of them goes.

Everything the image is held to is derived. The development list comes from
``pyproject.toml``'s ``[dependency-groups] dev``, the interpreter from
``.python-version``, ``requires-python`` and the Dockerfile's own ``FROM``, the uid
from the compose file that chowns this tier's volumes, and the image itself from the
``build.yml`` matrix leg that builds it. Nothing here is a list someone has to remember
to edit.

**Sequenced before `T-006`.** The image runs a ``CMD`` that exits with a message
today: there is no work loop, so a wrong image is currently harmless. The moment
``T-006`` puts a loop in it, a wrong image stops being harmless, and a probe written
afterwards is a probe written to pass.
"""

import json
import os
import re
import subprocess
import tomllib
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKSPACE = REPO_ROOT / "apps" / "worker"
BUILD_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "build.yml"
STORES_COMPOSE = REPO_ROOT / "deploy" / "stores.compose.yaml"

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
PROBE_RUNS_IN_THE_JOB_THAT_PUSHES = os.environ.get("IMAGE_PROBE_DEFERRED") == "true"

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


def _pyproject() -> dict[str, Any]:
    with (WORKSPACE / "pyproject.toml").open("rb") as handle:
        loaded: dict[str, Any] = tomllib.load(handle)
    return loaded


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
    project = _pyproject()
    development = {
        _distribution_name(each) for each in project["dependency-groups"]["dev"]
    }
    runtime = {_distribution_name(each) for each in project["project"]["dependencies"]}
    return sorted(development - runtime)


def pinned_python_version() -> tuple[int, int]:
    """The version ``.python-version`` names."""
    pinned = (WORKSPACE / ".python-version").read_text("utf-8").strip()
    major, _, minor = pinned.partition(".")
    return int(major), int(minor)


def required_python_floor() -> tuple[int, int]:
    """The version ``requires-python``'s lower bound names."""
    floor = re.search(r">=\s*(\d+)\.(\d+)", _pyproject()["project"]["requires-python"])
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
# it means to the process the deploy unit starts. A distribution rather than an import
# is what is asked of the development list: `uv sync` installs distributions, and a name
# that imports under something else would still be bytes nobody patches.
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

sys.stdout.write(json.dumps({
    "development": [
        n for n in json.loads(os.environ["PROBE_DEVELOPMENT"]) if installed(n)
    ],
    "version": list(sys.version_info[:3]),
    "base_prefix": sys.base_prefix,
    "uid": os.getuid(),
    "imports": {n: imports(n) for n in json.loads(os.environ["PROBE_IMPORTS"])},
    "has_tests": os.path.isdir(os.environ["PROBE_TESTS"]),
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


def _read_contents(stdout: str) -> ImageContents:
    answered: dict[str, Any] = json.loads(stdout)
    major, minor, patch = answered["version"]
    return ImageContents(
        development=tuple(str(name) for name in answered["development"]),
        version=(int(major), int(minor), int(patch)),
        base_prefix=str(answered["base_prefix"]),
        uid=int(answered["uid"]),
        imports={str(name): bool(found) for name, found in answered["imports"].items()},
        has_tests=bool(answered["has_tests"]),
    )


def _build_the_image(leg: Mapping[str, str]) -> str:
    """The image `build.yml` builds for this tier, by the id its build printed."""
    built = subprocess.run(
        ["docker", "build", "--quiet", "--file", leg["dockerfile"], leg["context"]],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=900,
    )
    return built.stdout.strip()


def _run_the_image(image: str, environment: dict[str, str]) -> str:
    arguments = ["docker", "run", "--rm"]
    # By name and never by value: `docker run --env NAME` takes the value out of this
    # process's environment, so a derived list never reaches another user's `ps`.
    for name in environment:
        arguments += ["--env", name]
    arguments += [image, "python", "-c", PROBE]
    started = subprocess.run(
        arguments,
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
        env={**os.environ, **environment},
    )
    return started.stdout


@pytest.fixture(scope="module")
def contents() -> Iterator[ImageContents]:
    """One container, started from the image this repository ships as the worker.

    Two ways this runs. Given no image id it builds the image and reads what it built,
    which is what a laptop and a pull request do. Given one it reads that image and
    builds nothing: `build.yml`'s image job loads its own build, hands the id here and
    pushes only if these tests pass, so the artefact that ships is the artefact that was
    read (`T-043`).
    """
    if PROBE_RUNS_IN_THE_JOB_THAT_PUSHES:
        pytest.skip(
            "the job that pushes this image runs this file against its own build"
        )
    if not DOCKER_ANSWERS:
        if DAEMON_IS_REQUIRED:
            raise RuntimeError(NO_DAEMON)
        pytest.skip("no Docker daemon answered")

    supplied = os.environ.get(IMAGE_ID_VARIABLE, "").strip()
    # The image is run by the id the build prints, and is never tagged. A tag is a name
    # on the daemon, and the daemon is shared: two worktrees running `check` at once
    # would overwrite each other's tag and one would read the other's image. A supplied
    # id is the same kind of thing — the id the workflow's own load printed — for the
    # same reason.
    built_here = _build_the_image(matrix_leg("worker")) if not supplied else None
    try:
        yield _read_contents(
            _run_the_image(
                built_here or supplied,
                {
                    "PROBE_DEVELOPMENT": json.dumps(development_only_distributions()),
                    "PROBE_IMPORTS": json.dumps(list(REQUIRED_IMPORTS)),
                    "PROBE_TESTS": TESTS_IN_THE_IMAGE,
                },
            )
        )
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
    assert dict(contents.imports) == dict.fromkeys(REQUIRED_IMPORTS, True)


def test_the_container_runs_as_the_uid_that_owns_this_tiers_volumes(
    contents: ImageContents,
) -> None:
    assert contents.uid == chowned_worker_uid()
    assert contents.uid != 0


def test_the_image_leaves_this_tiers_tests_out_of_the_runtime(
    contents: ImageContents,
) -> None:
    assert contents.has_tests is False


def test_the_worker_leg_of_the_image_job_names_this_file_as_its_probe() -> None:
    """So the file cannot move without the workflow that runs it moving too."""
    leg = matrix_leg("worker")
    here = Path(__file__).resolve().relative_to(WORKSPACE)

    assert str(here) in leg["probe"]
    assert "apps/worker" in leg["probe"]
