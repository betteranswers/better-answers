# The build context is `apps/worker/`, a uv workspace that shares no code with the rest of the
# repository.
#
# The runtime is Distroless because the worker needs no shell, package manager, or perl. It reads
# git through dulwich. On a slim Debian runtime, nearly every scan finding was in a package the
# worker never ran. `docs/operations/RUNBOOK.md` § A shell in the worker says how an operator gets
# a shell during an incident.
#
# uv comes from Astral's image so the exact version is pinned in this file, not resolved by an
# installer script at build time. `apps/worker/.tool-versions` pins the same uv for CI, and the
# `uv` group in `renovate.json` moves both together.
#
# The image carries the redaction models' weights, and the runtime sets `HF_HUB_OFFLINE=1`. A
# worker therefore needs no registry, and a weight the build did not fetch fails at once. Do not
# mount anything over `HF_HOME` in a deploy unit. The mount would hide the weights, and with
# `HF_HUB_OFFLINE` set the worker could not load a model. `apps/worker/tests/test_image.py`
# checks `deploy/platform.compose.yaml` for such a mount.
FROM ghcr.io/astral-sh/uv:0.13.0@sha256:cdc6093146eb3ff6a40107b38f008b789e050e77ad87865e381d9917da55a168 AS uv

# The `tree` stage reads this image's account files, so it is named before that stage. The
# runtime uses `cc`, not Distroless's `python3-debian13`, because that image carries Debian's
# older 3.13 at a path the venv does not point to.
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:08476c244888bfb425bae1ae4dd7c17f093e972aab8426883d97f3c6f280f7c1 AS distroless

# This is the only pin of the Python image. The build stage creates the venv with this
# interpreter, and the `tree` stage copies the same interpreter into the runtime, so the two
# cannot drift. The 3.13 line must match `requires-python` in `pyproject.toml` and
# `.python-version`. The image uses Debian 13 for the reason `apps/api/Dockerfile` gives above
# its `FROM`.
FROM python:3.13.16-slim-trixie@sha256:cf50a4f6ac4f026458b08d5222023d700ac806410dff5e9ca8728fa44f2b850f AS interpreter

FROM interpreter AS build
COPY --from=uv /uv /uvx /usr/local/bin/
# `--no-dev` keeps the `[dependency-groups] dev` tools out of the image.
# `UV_PYTHON_DOWNLOADS=never` makes the base image's interpreter the only one the build can use,
# so the build fails instead of fetching an unpinned Python.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app
# The locked dependencies install before the source is copied, so a source edit does not
# re-resolve them. `--frozen` fails instead of updating `uv.lock`. The project install reads only
# `__init__.py`, so that file is copied alone.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src/better_answers_worker/__init__.py src/better_answers_worker/__init__.py
RUN uv sync --frozen --no-dev
COPY src/better_answers_worker/redaction src/better_answers_worker/redaction

# `redaction/weights.py` holds the model ids and says why it loads each model instead of
# downloading a snapshot. The cache mount stops a local rebuild from downloading about 2 GB again.
# A cache mount does not ship, so the module copies the weights out to /data/worker/hf-cache. It
# copies only the repositories its model table declares, because every build on a machine shares
# the mount, and the mount can hold models the table has dropped.
RUN --mount=type=cache,target=/hf-cache,uid=0 \
    HF_HOME=/hf-cache /app/.venv/bin/python -m better_answers_worker.redaction.weights \
    /data/worker/hf-cache

# The public suffix list is warmed and shipped the same way. If the build misses the list,
# nothing fails. Each worker process instead spends two connection timeouts on its first email
# match, then falls back to the copy in `tldextract`'s wheel. `redaction/suffixes.py` explains
# the rest. The list has its own step and mount so the weights step copies only what its model
# table names.
RUN --mount=type=cache,target=/tldextract-cache,uid=0 \
    TLDEXTRACT_CACHE=/tldextract-cache \
    /app/.venv/bin/python -m better_answers_worker.redaction.suffixes \
    /data/worker/tldextract-cache

# The runtime base has no shell, so this stage builds under /runtime what the runtime adds.
#
# The interpreter sits at the path the venv's `python` names, so the venv runs unchanged. pip and
# the `ensurepip` wheels stay out because nothing installs at runtime, and pip's vendored
# libraries carried high-severity scan findings.
#
# The standard library needs five Debian libraries that the base lacks: libffi, bzip2, xz,
# SQLite, and libuuid. Each library is copied with its package record into `status.d`, where
# Distroless keeps its own records, so a scanner can name it. The curses, readline, dbm, and Tk
# modules are deleted, not shipped unable to load. The worker uses none of them.
#
# tini comes the same way. `environment_gate` starts it as PID 1 in place of Docker's `init`,
# which would hold every variable the orchestrator hands the container.
#
# `init` in `deploy/stores.compose.yaml` chowns /data/worker/lmdb and /data/worker/trees to
# uid 1000. The user has a home directory because libraries write caches under `~`.
FROM interpreter AS tree
COPY --from=distroless /etc/passwd /etc/group /runtime/etc/
RUN set -eu \
 && apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && cp -a --parents /usr/local/bin/python3 /usr/local/bin/python3.13 \
      /usr/local/lib/libpython3.13.so.1.0 /usr/local/lib/python3.13 /runtime \
 && rm -rf /runtime/usr/local/lib/python3.13/site-packages/* \
      /runtime/usr/local/lib/python3.13/ensurepip/_bundled \
 && for module in _curses _curses_panel _dbm _gdbm _tkinter readline; do \
      rm /runtime/usr/local/lib/python3.13/lib-dynload/"$module".cpython-313-*.so; \
    done \
 && mkdir -p /runtime/var/lib/dpkg/status.d \
 && for package in libbz2-1.0 libffi8 liblzma5 libsqlite3-0 libuuid1 tini; do \
      dpkg-query --listfiles "$package" | while read -r path; do \
        if [ -f "$path" ] || [ -L "$path" ]; then cp -a --parents "$path" /runtime; fi; \
      done; \
      dpkg-query --status "$package" > /runtime/var/lib/dpkg/status.d/"$package"; \
      cp "$(dpkg-query --control-path "$package" md5sums)" \
        /runtime/var/lib/dpkg/status.d/"$package".md5sums; \
    done \
 && echo 'worker:x:1000:1000:worker:/home/worker:/sbin/nologin' >> /runtime/etc/passwd \
 && echo 'worker:x:1000:' >> /runtime/etc/group \
 && install -d -o 1000 -g 1000 /runtime/home/worker

FROM distroless AS runtime

COPY --from=tree /runtime/ /
WORKDIR /app
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
COPY --from=build /app/.venv /app/.venv

# With `HF_HUB_OFFLINE` set, the seam loads these weights or raises, so a running worker never
# contacts a registry.
COPY --from=build --chown=worker:worker /data/worker/hf-cache /data/worker/hf-cache

# `tldextract` takes a lock file beside a cache entry before it reads the entry, so the worker
# must own this directory. If it cannot write there, it fetches the list from the network
# instead. The library has no offline mode, so the warmed cache is the only guard.
COPY --from=build --chown=worker:worker /data/worker/tldextract-cache /data/worker/tldextract-cache
# `COCOINDEX_DISABLE_USAGE_TRACKING=1` stops cocoindex from calling `cocoindex.gateway.scarf.sh`
# at start, on each Environment open, and on every update. Each call sends a third party the
# package, its version, and this host's IP, and nothing fails when it goes out. The variable
# belongs to the native core. `apps/worker/tests/test_image.py` records the run that proved
# the value `1` and checks that this image and `deploy/platform.compose.yaml` agree.
ENV HF_HOME=/data/worker/hf-cache \
    HF_HUB_OFFLINE=1 \
    TLDEXTRACT_CACHE=/data/worker/tldextract-cache \
    COCOINDEX_DISABLE_USAGE_TRACKING=1

# The project is installed editable, so the worker reads its source from here, including the
# generated `schema_view.py`. This is the stage's last `COPY` because BuildKit reruns every
# instruction below the first changed input. A source edit then rebuilds only this layer.
COPY src src

# The image starts as root, and `environment_gate` drops to uid 1000 before it starts any
# process. Docker runs health checks and `docker exec` as this user, and each one holds every
# variable the orchestrator hands the container. As root, the worker's uid cannot read them.
# Docker would set `HOME` to root's, so `ENV` names the worker's.
ENV HOME=/home/worker
USER root

# The worker serves no HTTP, so the probe runs a Python module. The probe passes while the
# worker holds a lease with a fresh heartbeat, or while no job has waited longer than a lease.
# An idle worker is healthy. Eight retries at 15 seconds outlast one lease, so a quiet claimant
# gets the lease's grace before a restart. The `worker` service in `deploy/platform.compose.yaml`
# runs the same probe, so change both together. The image has no shell, so the probe and `CMD`
# use exec form. Both start through `environment_gate`, which passes each process only the keys
# it reads.
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=8 \
  CMD ["python", "-m", "better_answers_worker.environment_gate", "health"]

# The work loop refuses to claim jobs while its committed schema view and the database's
# migration stamp disagree. It logs once and keeps running, because a restarted container would
# hit the same mismatch.
CMD ["python", "-m", "better_answers_worker.environment_gate", "worker"]
