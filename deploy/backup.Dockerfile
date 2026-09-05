# The `backup` service's image — the third image `build.yml` pushes to ghcr.io by digest
# (ADR 0022 A11: a compose file refuses to start without a digest, and that rule
# has no exception for a service built on the host). `deploy/stores.compose.yaml` runs it as
# `ghcr.io/betteranswers/backup@${BACKUP_IMAGE_DIGEST}`; the digest is set once in the stores
# resource's env and moved only when this file or `backup.sh` changes, because the stores
# stack is redeployed for a store's upgrade and never for a release.
#
# What it carries: pg_dump 18 on the SAME base as the database (the one pinned
# reference in `packages/schema/src/postgres-image.ts`, restated here because a Dockerfile
# cannot import a constant — `apps/api/tests/deploy-tree.test.ts` holds the two equal), so
# client and server never skew; rclone; age; git and an SSH client for the push mirror to
# VPC 2 (ADR 0024); curl, jq, cron. `backup.sh` is baked in, not bind-mounted: an image by
# digest that read its job from the checkout beside it would be half an image.
#
# Versions: pgvector 0.8.6-pg18-trixie by digest, read 01/09/2026 (the schema
# package's pin); rclone v1.75.0, read 28/08/2026 (research 68 §1); age v1.3.2, read from
# github.com/FiloSottile/age/releases on 03/09/2026 (T-005).
FROM pgvector/pgvector:0.8.6-pg18-trixie@sha256:78bf48b801e792f99e3ac62b5036fd3876e9be48afda16c1e331af1c75ceb2ff
RUN apt-get update && apt-get install -y --no-install-recommends cron git openssh-client curl jq unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ARG RCLONE_VERSION=v1.75.0
RUN curl -fsSLo /tmp/rclone.zip "https://downloads.rclone.org/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-amd64.zip" \
 && unzip -j /tmp/rclone.zip '*/rclone' -d /usr/local/bin && chmod +x /usr/local/bin/rclone && rm /tmp/rclone.zip
ARG AGE_VERSION=v1.3.2
RUN curl -fsSL "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-linux-amd64.tar.gz" \
 | tar -xz --strip-components=1 -C /usr/local/bin age/age age/age-keygen
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod 0755 /usr/local/bin/backup.sh
# hourly Postgres dump (tier by clock); nightly object-store mirror + git bundles + git push mirror (BACKUPS.md)
RUN printf '%s\n' \
  '5 * * * * root /usr/local/bin/backup.sh hourly  >> /proc/1/fd/1 2>&1' \
  '0 2 * * * root /usr/local/bin/backup.sh nightly >> /proc/1/fd/1 2>&1' \
  > /etc/cron.d/backup && chmod 0644 /etc/cron.d/backup
USER root
ENTRYPOINT []
CMD ["cron", "-f"]
