# The same base as the database, so pg_dump and the server never skew. A test holds this
# tag equal to the schema package's pin.
FROM pgvector/pgvector:0.8.6-pg18-trixie@sha256:78bf48b801e792f99e3ac62b5036fd3876e9be48afda16c1e331af1c75ceb2ff
RUN apt-get update && apt-get install -y --no-install-recommends cron git openssh-client curl jq unzip ca-certificates \
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
RUN chmod 0755 /usr/local/bin/backup.sh
RUN printf '%s\n' \
  '5 * * * * root /usr/local/bin/backup.sh hourly  >> /proc/1/fd/1 2>&1' \
  '0 2 * * * root /usr/local/bin/backup.sh nightly >> /proc/1/fd/1 2>&1' \
  > /etc/cron.d/backup && chmod 0644 /etc/cron.d/backup
# The one service that stays root: cron reads /etc/cron.d as root or not at all. The
# entrypoint is cleared so cron is the command.
USER root
ENTRYPOINT []
CMD ["cron", "-f"]
