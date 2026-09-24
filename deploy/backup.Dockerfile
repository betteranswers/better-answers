# pgvector builds each tag once, so the database's image keeps the Debian packages of that
# day. Debian's slim image takes a new digest every few weeks, and each one rebuilds the
# layer below from current packages.
FROM debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a
# Debian 13 carries no PostgreSQL 18, so the client comes from PGDG, whose signing key
# Debian's own postgresql-common ships; a test holds its major to the database image's.
# procps is the health check's pgrep.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates postgresql-common \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get install -y --no-install-recommends postgresql-client-18 cron git openssh-client curl jq unzip procps \
 && rm -rf /var/lib/apt/lists/*
# The dockerfile manager sees `FROM` alone, so a version fetched by name ages in
# silence. Each line below sits above its `ARG`.
# renovate: datasource=github-releases depName=rclone/rclone
ARG RCLONE_VERSION=v1.75.1
RUN curl -fsSLo /tmp/rclone.zip "https://downloads.rclone.org/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-amd64.zip" \
 && unzip -j /tmp/rclone.zip '*/rclone' -d /usr/local/bin && chmod +x /usr/local/bin/rclone && rm /tmp/rclone.zip
# renovate: datasource=github-releases depName=FiloSottile/age
ARG AGE_VERSION=v1.3.2
RUN curl -fsSL "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-linux-amd64.tar.gz" \
 | tar -xz --strip-components=1 -C /usr/local/bin age/age age/age-keygen
# Baked in, not bind-mounted: an image by digest that read its job from the checkout beside
# it would be half an image.
COPY backup.sh /usr/local/bin/backup.sh
COPY backup-env.sh /usr/local/bin/backup-env
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/backup-env
# The api's uid owns the workspace repositories, so root's git refuses them as dubious. The
# mount is read-only, so root can leave nothing behind in them.
RUN git config --system safe.directory '/data/git/*'
# cron hands a job PATH=/usr/bin:/bin and nothing else, so backup-env gives it the variables.
RUN printf '%s\n' \
  '5 * * * * root /usr/local/bin/backup-env /usr/local/bin/backup.sh hourly  >> /proc/1/fd/1 2>&1' \
  '0 2 * * * root /usr/local/bin/backup-env /usr/local/bin/backup.sh nightly >> /proc/1/fd/1 2>&1' \
  > /etc/cron.d/backup && chmod 0644 /etc/cron.d/backup
# The one service that stays root: cron reads /etc/cron.d as root or not at all.
USER root
CMD ["cron", "-f"]
