# pgvector builds each tag once, so the database image keeps the Debian packages from that
# day. Here the build cache keeps the apt layer below until this digest or its RUN line
# changes, so a security update waits until one of them changes.
FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4
# Debian 13 has no PostgreSQL 18, so the client comes from PGDG, whose signing key ships in
# Debian's postgresql-common. A test keeps its major version equal to the database image's.
# procps provides pgrep for the health check. The upgrade is needed because install leaves
# a package that the base already has at the base's version.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends ca-certificates postgresql-common \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get install -y --no-install-recommends postgresql-client-18 cron git openssh-client curl jq unzip procps \
 && rm -rf /var/lib/apt/lists/*
# Renovate's dockerfile manager reads only `FROM`, so a version fetched by name would never
# be updated. Each `# renovate:` line below annotates the `ARG` under it.
# renovate: datasource=github-releases depName=rclone/rclone
ARG RCLONE_VERSION=v1.75.2
RUN curl -fsSLo /tmp/rclone.zip "https://downloads.rclone.org/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-amd64.zip" \
 && unzip -j /tmp/rclone.zip '*/rclone' -d /usr/local/bin && chmod +x /usr/local/bin/rclone && rm /tmp/rclone.zip
# renovate: datasource=github-releases depName=FiloSottile/age
ARG AGE_VERSION=v1.3.2
RUN curl -fsSL "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-linux-amd64.tar.gz" \
 | tar -xz --strip-components=1 -C /usr/local/bin age/age age/age-keygen
# Copied in, not bind-mounted, so the image digest also pins the job scripts.
COPY backup.sh /usr/local/bin/backup.sh
COPY backup-env.sh /usr/local/bin/backup-env
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/backup-env
# The api's uid owns the workspace repositories, so root's git refuses them as dubious. The
# mount is read-only, so root cannot change them.
RUN git config --system safe.directory '/data/git/*'
# cron gives a job PATH=/usr/bin:/bin and nothing else, so backup-env supplies the variables.
RUN printf '%s\n' \
  '5 * * * * root /usr/local/bin/backup-env /usr/local/bin/backup.sh hourly  >> /proc/1/fd/1 2>&1' \
  '0 2 * * * root /usr/local/bin/backup-env /usr/local/bin/backup.sh nightly >> /proc/1/fd/1 2>&1' \
  > /etc/cron.d/backup && chmod 0644 /etc/cron.d/backup
# The only service that runs as root: cron reads /etc/cron.d only as root.
USER root
CMD ["cron", "-f"]
