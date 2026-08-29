# The `backup` service: pg_dump 18 (same base as the database, so client and server never skew),
# rclone, age, git + an SSH client (the push mirror to VPC 2 — ADR 0024), curl, jq, cron. Versions read 28/08/2026 (research 68 §1): pgvector 0.8.6-pg18,
# rclone v1.75.0. age: <read on the day — not in research 68>.
FROM pgvector/pgvector:0.8.6-pg18
RUN apt-get update && apt-get install -y --no-install-recommends cron git openssh-client curl jq unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ARG RCLONE_VERSION=v1.75.0
RUN curl -fsSLo /tmp/rclone.zip "https://downloads.rclone.org/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-amd64.zip" \
 && unzip -j /tmp/rclone.zip '*/rclone' -d /usr/local/bin && chmod +x /usr/local/bin/rclone && rm /tmp/rclone.zip
ARG AGE_VERSION=<read on the day>
RUN curl -fsSL "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-linux-amd64.tar.gz" \
 | tar -xz --strip-components=1 -C /usr/local/bin age/age age/age-keygen
# hourly Postgres dump (tier by clock); nightly object-store mirror + git bundles + git push mirror (deploy/BACKUPS.md)
RUN printf '%s\n' \
  '5 * * * * root /usr/local/bin/backup.sh hourly  >> /proc/1/fd/1 2>&1' \
  '0 2 * * * root /usr/local/bin/backup.sh nightly >> /proc/1/fd/1 2>&1' \
  > /etc/cron.d/backup && chmod 0644 /etc/cron.d/backup
USER root
ENTRYPOINT []
CMD ["cron", "-f"]
