#!/usr/bin/env bash
set -euo pipefail

box=${1:-}; shift || true
usage() {
  cat >&2 <<'USAGE'
host-setup.sh vpc1 --mirror-host <VPC2 address> [--drill-pubkey <file>]
    the production box: /data, the 4 GB swap file, git, the git-mirror deploy keypair,
    known_hosts for VPC 2, and the host hardening. Prints the deploy key's public half,
    which vpc2 takes. Run it again with --drill-pubkey once vpc2 has printed root's key.

host-setup.sh vpc2 --mirror-pubkey <file> --repo <git URL> [--prod-host <VPC1 address>]
    the orchestrator box: the mirror user and /data/mirror, the deploy key restricted to
    mirror-shell, the checkout the drill runs from, the root-only env templates under
    /etc/better-answers, and the drill's host cron line.

Run as root on the box named. Both are idempotent, so either can be re-run safely. Every
value is an argument, nothing is read from the environment, and the two env files this
script creates are empty templates you fill.
USAGE
  exit 2
}
need_root() { [ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }; }

harden() {
  apt-get install -y --no-install-recommends unattended-upgrades fail2ban chrony >/dev/null
  install -d -m 755 /etc/ssh/sshd_config.d
  # A drop-in that sorts first: sshd keeps the first value it reads, and the image ships one.
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' > /etc/ssh/sshd_config.d/00-better-answers.conf
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
  dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null
  systemctl enable --now fail2ban chrony >/dev/null
  echo "hardened: password SSH off, unattended-upgrades, fail2ban, chrony"
}

vpc1() {
  local mirror_host="" drill_pubkey=""
  while [ $# -gt 0 ]; do case "$1" in --mirror-host) mirror_host=$2; shift 2 ;; --drill-pubkey) drill_pubkey=$2; shift 2 ;; *) usage ;; esac; done
  [ -n "${mirror_host}" ] || usage
  need_root
  # restore-production.sh clones bundles on the host; its other tools are in the image.
  apt-get install -y --no-install-recommends git >/dev/null
  mkdir -p /data && chmod 755 /data
  if ! swapon --show | grep -q '^/swapfile'; then
    fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf && sysctl -p /etc/sysctl.d/99-swap.conf >/dev/null
    echo "swap: 4 GB file created"
  fi
  # The private half is escrowed by the owner, never by this script, which writes no secret.
  install -d -m 700 /data/backup/mirror-ssh
  [ -f /data/backup/mirror-ssh/id_ed25519 ] || ssh-keygen -q -t ed25519 -N '' -C better-answers-mirror -f /data/backup/mirror-ssh/id_ed25519
  ssh-keyscan -t ed25519 "${mirror_host}" 2>/dev/null > /data/backup/mirror-ssh/known_hosts
  chmod 600 /data/backup/mirror-ssh/*
  if [ -n "${drill_pubkey}" ]; then
    install -d -m 700 /root/.ssh; touch /root/.ssh/authorized_keys; chmod 600 /root/.ssh/authorized_keys
    grep -qF "$(cat "${drill_pubkey}")" /root/.ssh/authorized_keys || cat "${drill_pubkey}" >> /root/.ssh/authorized_keys
  fi
  harden
  echo; echo "deploy key PUBLIC half — give it to: host-setup.sh vpc2 --mirror-pubkey <file>"; cat /data/backup/mirror-ssh/id_ed25519.pub
  echo; echo "still yours: the provider firewall (SSH from your IP and from ${mirror_host} only; nothing else inbound), and escrowing /data/backup/mirror-ssh/id_ed25519"
}

vpc2() {
  local pubkey="" repo="" prod_host=""
  while [ $# -gt 0 ]; do case "$1" in
    --mirror-pubkey) pubkey=$2; shift 2 ;; --repo) repo=$2; shift 2 ;; --prod-host) prod_host=$2; shift 2 ;; *) usage ;; esac; done
  [ -n "${pubkey}" ] && [ -n "${repo}" ] || usage
  need_root
  apt-get install -y --no-install-recommends git rclone age postgresql-common jq >/dev/null
  # The client must match the dump's major: pg_restore 16 refuses a pg18 archive.
  YES=yes /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null
  apt-get install -y --no-install-recommends postgresql-client-18 >/dev/null
  id mirror >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash mirror
  install -d -m 750 -o mirror -g mirror /data/mirror
  install -m 755 "$(dirname "$0")/mirror-shell.sh" /usr/local/bin/mirror-shell
  install -d -m 700 -o mirror -g mirror /home/mirror/.ssh
  printf 'command="/usr/local/bin/mirror-shell /data/mirror",restrict %s\n' "$(cat "${pubkey}")" > /home/mirror/.ssh/authorized_keys
  chown mirror:mirror /home/mirror/.ssh/authorized_keys && chmod 600 /home/mirror/.ssh/authorized_keys
  [ -d /opt/better-answers/.git ] || git clone --quiet "${repo}" /opt/better-answers
  install -d -m 700 /etc/better-answers
  if [ ! -f /etc/better-answers/drill.env ]; then
    cat > /etc/better-answers/drill.env <<ENV
# Read by root's cron for restore-drill.sh (set -a). Root-only. Fill every value; none is a default.
REPO_DIR=/opt/better-answers
STAGING_ENV_FILE=/etc/better-answers/staging.env
STAGING_DATABASE_URL=
STAGING_API_URL=http://127.0.0.1:3000
BACKUP_DUMPS_BUCKET=
BACKUP_MIRROR_BUCKET=
BACKUP_AGE_IDENTITY_FILE=/etc/better-answers/backup-age.key
STAGING_OBJECTSTORE_ROOT_KEY=
STAGING_OBJECTSTORE_ROOT_SECRET=
# The platform's bucket inside the staging Garage: it must equal S3_BUCKET in staging.env.
STAGING_S3_BUCKET=better-answers
# Named by the database resource's UUID, not its display name. No Postgres port is open to the internet.
PROD_PSQL="ssh -o BatchMode=yes root@${prod_host:-<VPC1 IP>} docker exec -i <pg-resource-uuid> psql -U postgres -d better_answers"
DRILL_WORKSPACE=
HEALTHCHECKS_PING_URL_DRILL=
HEALTHCHECKS_PING_URL_STAGING_WIPED=
# The write-and-list credential: the report upload is the one write the drill makes.
RCLONE_CONFIG_DRILLSINK_TYPE=s3
RCLONE_CONFIG_DRILLSINK_PROVIDER=
RCLONE_CONFIG_DRILLSINK_ENDPOINT=
RCLONE_CONFIG_DRILLSINK_ACCESS_KEY_ID=
RCLONE_CONFIG_DRILLSINK_SECRET_ACCESS_KEY=
RCLONE_CONFIG_DUMPS_TYPE=s3
RCLONE_CONFIG_DUMPS_PROVIDER=
RCLONE_CONFIG_DUMPS_ENDPOINT=
RCLONE_CONFIG_DUMPS_ACCESS_KEY_ID=
RCLONE_CONFIG_DUMPS_SECRET_ACCESS_KEY=
ENV
    chmod 600 /etc/better-answers/drill.env
  fi
  [ -f /etc/better-answers/staging.env ] || { : > /etc/better-answers/staging.env; chmod 600 /etc/better-answers/staging.env; }
  [ -f /etc/better-answers/backup-age.key ] || { : > /etc/better-answers/backup-age.key; chmod 600 /etc/better-answers/backup-age.key; }
  [ -f /root/.ssh/id_ed25519 ] || { install -d -m 700 /root/.ssh; ssh-keygen -q -t ed25519 -N '' -C better-answers-drill -f /root/.ssh/id_ed25519; }
  [ -z "${prod_host}" ] || { ssh-keyscan -t ed25519 "${prod_host}" 2>/dev/null >> /root/.ssh/known_hosts; sort -u -o /root/.ssh/known_hosts /root/.ssh/known_hosts; }
  # Host cron and not a Coolify task: the drill wipes the stacks such a task would run inside.
  cat > /etc/cron.d/better-answers-drill <<'CRON'
# The monthly restore drill: host cron as root, env from the root-only file.
0 3 1 * * root set -a; . /etc/better-answers/drill.env; set +a; /opt/better-answers/deploy/restore-drill.sh >> /var/log/better-answers-drill.log 2>&1
CRON
  chmod 644 /etc/cron.d/better-answers-drill
  harden
  echo; echo "fill, as root, mode 0600: /etc/better-answers/drill.env · staging.env (every key the two compose files require, staging values) · backup-age.key (the identity, from escrow — resident here; SECRETS.md says what that means)"
  echo; echo "root's PUBLIC key for the drill — give it to: host-setup.sh vpc1 --mirror-host <this box> --drill-pubkey <file>"; cat /root/.ssh/id_ed25519.pub
  echo "still yours: Coolify itself (the wizard's stage 7), and the provider firewall (SSH from your IP and from VPC 1 only)"
}

case "${box}" in vpc1) vpc1 "$@" ;; vpc2) vpc2 "$@" ;; *) usage ;; esac
