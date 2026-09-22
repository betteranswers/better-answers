# The knowledge worker's image (ADR 0005). Built from `apps/worker/` — this tier is a uv
# workspace, not a pnpm one, and it shares four stores with the app tier and never code, so
# its image needs nothing from the rest of the repository.
#
# Versions read on 03/09/2026: `python:3.13.15-slim-bookworm` from Docker Hub's
# tag API — 3.13 is what `pyproject.toml` requires (`>=3.13,<3.14`) and `.python-version`
# names — and uv 0.12.9 from astral-sh/uv's releases. Both are pinned by digest as well as
# by tag: the tag is the label a person reads, the digest is what actually ships.
#
# uv arrives by `COPY --from` off Astral's own image, which is their documented way to add
# uv to a Python base. It puts the exact uv version in this file, where a reader looking for
# the pin finds it, rather than behind an installer script that resolves "latest" at build
# time — a version nobody read on the day, which is what pinning exists to stop.
#
# The redaction seam's model weights are part of this image (ADR 0020, `T-122`). They are
# fetched at build under `HF_HOME` and the runtime stage sets `HF_HUB_OFFLINE=1` over them,
# so the image is self-sufficient: a worker on a 4 GB box with no route to a registry still
# detects, and a weight nobody fetched here fails at once instead of being downloaded onto a
# production volume on a first document. The corollary belongs with the pin: **nothing may
# be mounted over `HF_HOME` in a deploy unit.** A host directory there masks every byte this
# build fetched, and with `HF_HUB_OFFLINE` set beside it the result is not a quiet
# re-download but a worker that cannot load a model at all — which is why
# `deploy/platform.compose.yaml` mounts the LMDB and the trees and nothing else, and why
# `apps/worker/tests/test_image.py` holds that file to it.
FROM ghcr.io/astral-sh/uv:0.12.9@sha256:8b940d3a9d65bed080436972241af2e21c84b5e8c9193f7014ed71479ee795ff AS uv

FROM python:3.14.7-slim-bookworm@sha256:82bc3c539b8813ada9d68c63b40158fa002f7f33de9bf3312a3dfdc0620dff56 AS build
COPY --from=uv /uv /uvx /usr/local/bin/
# `--no-dev` is what keeps ruff, mypy, pytest, mutmut and testcontainers — the
# `[dependency-groups] dev` list — out of the image. psycopg and dulwich are not on that
# list: the work loop opens a connection on every tick and reads a bare repository on every
# job, so both ship. `UV_PYTHON_DOWNLOADS=never` makes the
# base image's interpreter the only interpreter: a build that silently fetched its own would
# ship a Python nobody pinned.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app
# The lockfile's dependencies first, so a source edit does not re-resolve them. `--frozen`
# fails rather than updating `uv.lock`: the committed lockfile is the pin.
#
# Then the redaction seam, and only it. The weights step below fetches by loading the
# seam's own analyzer, so those modules have to be present before it runs — and nothing
# else does: no module under `redaction/` imports anything outside it. Copying the subtree
# here rather than the whole of `src` is what puts the weights above the source: an edit to
# a file outside the seam reuses roughly three gigabytes of weight layers, and an edit
# inside it rebuilds them, which is right, because a moved pin has to re-fetch. This stage
# reads nothing else from `src` after this point, and the runtime stage copies the tree
# from the build context rather than from here, so the rest of it never enters this stage.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src/better_answers_worker/__init__.py src/better_answers_worker/__init__.py
COPY src/better_answers_worker/redaction src/better_answers_worker/redaction
RUN uv sync --frozen --no-dev

# The weights, fetched by loading each pinned model through the seam's own analyzer —
# `redaction/weights.py` says why a load and not a snapshot, and holds the model ids, so no
# id is spelled in this file. The cache mount is why a source edit does not re-download
# nearly two gigabytes on every local rebuild, and the copy out of it is why the weights
# are in the image and not only in the builder's cache, which a `--mount=type=cache` does
# not ship. The module does that copy rather than a `cp` of the mount, and that is the
# point of the argument it is given: the mount is shared by every build on a machine, so
# copying the whole of it made the image whatever the mount held — a model dropped from the
# table kept shipping because an older build had fetched it — while the module copies the
# repositories the table declares and nothing beside them.
RUN --mount=type=cache,target=/hf-cache,uid=0 \
    HF_HOME=/hf-cache /app/.venv/bin/python -m better_answers_worker.redaction.weights \
    /data/worker/hf-cache

# The list of public suffixes, warmed the same way and shipped the same way, for a
# failure that is the weights' opposite. A weight the build missed raises on the first
# job. A suffix list the build missed costs two connection attempts and their timeouts
# inside the first email address every worker process matches, and then answers
# correctly off the copy bundled in `tldextract`'s own wheel — so nothing fails, nothing
# is logged where anyone looks, and the bill is paid again by the next process.
# `redaction/suffixes.py` carries the rest: why the fence has to be the `ENV` in the
# runtime stage rather than anything either tier could call, and why a cache hit is the
# only thing that reaches it through Presidio.
#
# Its own step, its own mount and its own target. The weights step above copies what the
# model table declares and nothing beside it, which is the point of that step; a second
# thing folded into it would be a second thing that table does not name.
RUN --mount=type=cache,target=/tldextract-cache,uid=0 \
    TLDEXTRACT_CACHE=/tldextract-cache \
    /app/.venv/bin/python -m better_answers_worker.redaction.suffixes \
    /data/worker/tldextract-cache

FROM python:3.14.7-slim-bookworm@sha256:82bc3c539b8813ada9d68c63b40158fa002f7f33de9bf3312a3dfdc0620dff56 AS runtime

# uid 1000, the uid `init` in `deploy/stores.compose.yaml` chowns /data/worker/{lmdb,trees}
# to; nothing runs as root to own a volume. The Python base ships no non-root
# user, so this is where the worker's gets made. The weights below are chowned to the same
# uid by their own `COPY`, since they come out of the build stage rather than off a host.
RUN groupadd --system --gid 1000 worker \
 && useradd --system --uid 1000 --gid worker --home-dir /home/worker --create-home worker

WORKDIR /app
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
COPY --from=build /app/.venv /app/.venv

# The weights the build fetched, at the path the deploy unit already names, owned by the
# user that reads them. `HF_HUB_OFFLINE` is the fence over them: the seam loads what is
# here or it raises, and a running worker never reaches a registry.
COPY --from=build --chown=worker:worker /data/worker/hf-cache /data/worker/hf-cache

# The suffix list the build warmed, and the variable that makes the container read it.
# It is owned by the worker rather than merely readable by it because `tldextract` takes
# a lock file beside a cache entry before reading it, so a directory this user cannot
# write to is a cache it cannot use — and the way it reports that is to fetch instead,
# which is the thing being stopped. There is no `OFFLINE` switch to set beside this one:
# the library has no such mode, and a cache hit is what stands in for it.
COPY --from=build --chown=worker:worker /data/worker/tldextract-cache /data/worker/tldextract-cache
# The two caches above, and one thing that is not a cache at all: the engine's call
# home. cocoindex reaches `cocoindex.gateway.scarf.sh` when it starts, when an
# Environment opens and on every update — an outbound request per document of every
# index run, telling a third party the package, its version and this box's IP. What
# makes it worth a line here rather than a firewall rule somebody has to remember is
# that nothing fails when it goes out: the worker indexes either way, so the only place
# the call is visible is the wire. The variable is the native core's, nothing in the
# Python package holds it, and `1` is a value a run proved rather than one a document
# asserted — `apps/worker/tests/test_image.py` carries that run beside the case that
# holds this line and `deploy/platform.compose.yaml`'s to each other.
ENV HF_HOME=/data/worker/hf-cache \
    HF_HUB_OFFLINE=1 \
    TLDEXTRACT_CACHE=/data/worker/tldextract-cache \
    COCOINDEX_DISABLE_USAGE_TRACKING=1

# The project is installed into the venv editable, so the tier's source is read from here —
# including `schema_view.py`, the committed, generated view of the app's schema the worker
# reads and never migrates (ADR 0032).
#
# Last of this stage's copies, and on purpose (`T-223`). BuildKit re-runs every instruction
# below the first one whose input moved, and a `COPY` it re-runs is a new layer even when
# every byte it copies is the same. This line is the one a source edit moves, and it stood
# above the weights: each edit re-made a layer of about 950 MB, which a pull request's ref
# and then `main` each wrote to a 10 GB cache. Below the venv, the weights and the suffix
# list, an edit outside `redaction/` re-makes this layer and nothing else — the build
# stage says what an edit inside it costs, and why. `apps/worker/tests/test_image.py`
# holds the order, since no container started from the image can tell the two apart.
COPY src src

USER worker

# A process-level check, not an HTTP one, and deliberately: this tier exposes no HTTP
# surface at all. It has no server, no port and no `/health` — the app↔worker control plane
# is rows in Postgres, never HTTP (ADR 0005) — so there is nothing to GET. What the probe
# asks instead is the two halves of "is this worker working": it holds a claimed lease whose
# heartbeat is fresh, or nothing anywhere has been waiting longer than a lease. Idle is
# healthy — an empty queue is most of a day — while a job left waiting while nothing
# heartbeats is a worker that has stopped claiming, which is the failure worth restarting
# for. The module's own docblock carries that reasoning; this is the rationale for both
# copies of the probe, since the `worker` service in `deploy/platform.compose.yaml` runs the
# same command and points here. Eight retries at fifteen seconds is longer than one lease,
# so a claimant that goes quiet is given the lease's own grace before the container is.
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=8 \
  CMD ["python", "-m", "better_answers_worker.health"]

# The work loop: claim a job, run it, keep its lease alive, record what it found — over
# every workspace in turn, for ever. It refuses to claim anything while its committed schema
# view and the database's migration stamp disagree, and says so once rather than exiting,
# because a container that exited on a mismatch would be restarted straight back into it.
CMD ["better-answers-worker"]
