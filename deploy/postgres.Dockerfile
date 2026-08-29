# The platform Postgres: Apache AGE's Postgres 18 image with pgvector compiled in (ADR 0023, ADR 0007).
# Built and pushed to ghcr.io/betteranswers/postgres by build.yml; the Coolify database resource
# runs it by digest. Versions read on 28/08/2026 ([DEPS1]): apache/age release_PG18_1.8.0
# (Docker Hub, pushed 28/08/2026), pgvector v0.8.6 (github.com/pgvector/pgvector tags).
# Renovate pins the FROM to a digest and bumps PGVECTOR_VERSION; the AGE line is frozen (a new
# Postgres major is an upgrade drill, never a bump).

FROM apache/age:release_PG18_1.8.0 AS build
ARG PGVECTOR_VERSION=v0.8.6
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential git postgresql-server-dev-18 ca-certificates \
    && git clone --depth 1 --branch "${PGVECTOR_VERSION}" https://github.com/pgvector/pgvector.git /src/pgvector \
    && make -C /src/pgvector OPTFLAGS="" \
    && make -C /src/pgvector install

FROM apache/age:release_PG18_1.8.0
COPY --from=build /usr/lib/postgresql/18/lib/vector.so /usr/lib/postgresql/18/lib/
COPY --from=build /usr/share/postgresql/18/extension/vector* /usr/share/postgresql/18/extension/
# AGE's entrypoint already sets shared_preload_libraries=age; extensions are created by the
# app's migrations (CREATE EXTENSION age; CREATE EXTENSION vector), never here.
