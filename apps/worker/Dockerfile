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
FROM ghcr.io/astral-sh/uv:0.12.10@sha256:2bb3ebca0a796a155094a27773d290c4b074572e6107f171d88d086682fd2500 AS uv

FROM python:3.14.7-slim-bookworm@sha256:9ab8d9c8514b44f90cf0029dd42fdd7e9e211e639c8b995304cc04568dee900f AS build
COPY --from=uv /uv /uvx /usr/local/bin/
# `--no-dev` is what keeps ruff, mypy, pytest, mutmut, psycopg and testcontainers — the
# `[dependency-groups] dev` list — out of the image. `UV_PYTHON_DOWNLOADS=never` makes the
# base image's interpreter the only interpreter: a build that silently fetched its own would
# ship a Python nobody pinned.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app
# The lockfile's dependencies first, so a source edit does not re-resolve them. `--frozen`
# fails rather than updating `uv.lock`: the committed lockfile is the pin.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src src
RUN uv sync --frozen --no-dev

FROM python:3.14.7-slim-bookworm@sha256:9ab8d9c8514b44f90cf0029dd42fdd7e9e211e639c8b995304cc04568dee900f AS runtime

# uid 1000, the uid `init` in `deploy/stores.compose.yaml` chowns /data/worker/{lmdb,trees,hf-cache}
# to; nothing runs as root to own a volume. The Python base ships no non-root
# user, so this is where the worker's gets made.
RUN groupadd --system --gid 1000 worker \
 && useradd --system --uid 1000 --gid worker --home-dir /home/worker --create-home worker

WORKDIR /app
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
COPY --from=build /app/.venv /app/.venv
# The project is installed into the venv editable, so the tier's source is read from here —
# including `schema_view.py`, the committed, generated view of the app's schema the worker
# reads and never migrates (ADR 0032).
COPY src src

USER worker

# A process-level check, not an HTTP one, and deliberately: this tier exposes no HTTP
# surface at all. It has no server, no port and no `/health` — the app↔worker control plane
# is rows in Postgres, never HTTP (ADR 0005) — so there is nothing to GET. What can be
# checked without inventing a surface is that this container's interpreter is alive and the
# tier's package imports in it. This is the rationale for both copies of the probe: the
# `worker` service in `deploy/platform.compose.yaml` runs the same command, and points here.
# When a run claimant exists it will have a liveness signal of its own — a claimed lease with
# a fresh heartbeat (ADR 0036) — and this line becomes a query for it.
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=8 \
  CMD ["python", "-c", "import better_answers_worker"]

# There is no work loop in this tier yet: nothing claims a job, and the claim/lease/heartbeat
# functions are the app's to migrate (`T-006`). This image is the runtime that loop will run
# in, and its default command says exactly that rather than idling and reporting health it
# does not have. The day the loop lands it replaces this line; until then a deploy unit that
# starts this image is told why it stopped.
CMD ["python", "-c", "import sys; sys.exit('better-answers-worker has no work loop yet (T-006): this image carries the tier and its dependencies, and takes an explicit command until one exists.')"]
