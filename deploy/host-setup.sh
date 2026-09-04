#!/usr/bin/env bash
# Better Answers — the host-side shell work of wizard stages 3 and 7, extracted so it is run and not
# retyped (ticket 79 op F9; `deploy/wizard-41.sh` calls out to it). Run as root on the box named.
#
#   host-setup.sh vpc1 --mirror-host <VPC2 public IP> [--drill-pubkey <file>]
#       the production box: /data, the 4 GB swap file (RUNBOOK.md § Swap), git for the restore, the
#       git-mirror deploy keypair in a root-only directory, known_hosts for VPC 2, the host hardening.
#       Prints the public half of the deploy key, which `vpc2` takes. Run it AGAIN with
#       --drill-pubkey once `vpc2` has printed root's key there: that is how the drill reads
#       production's counts over SSH without a Postgres port (ticket 79 A12). Idempotent throughout.
#
#   host-setup.sh vpc2 --mirror-pubkey <file with the public half> --repo <git URL> [--prod-host <VPC1 IP>]
#       the orchestrator box: the `mirror` user and /data/mirror, the deploy key restricted to
#       `deploy/mirror-shell.sh` (init-repo and git-receive-pack — nothing else; the earlier
#       "git-receive-pack only" restriction broke the first push to a new workspace), the repository
#       checkout at /opt/better-answers the drill runs from, the root-only env files under
#       /etc/better-answers/ the drill and the age identity live in, and the drill's host cron line.
#
# Every value comes in as an argument; nothing is read from the environment and no secret is written
# by this script — the two files it creates under /etc/better-answers/ are TEMPLATES the owner fills
# by hand, mode 0600, and they sit outside /data/coolify on purpose: Coolify's instance backup takes
# its own database and .env and nothing under /etc, so the backup identity never rides that backup
# (SECRETS.md § The backup identity).
set -euo pipefail

box=${1:-}; shift || true
usage() { sed -n '2,20p' "$0" >&2; exit 2; }
need_root() { [ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }; }

harden() {
  # Password SSH off, security upgrades unattended, fail2ban on, the clock trusted (object-lock dates
  # and token iat checks read it). Idempotent; each line is a no-op the second time.
  apt-get install -y --no-install-recommends unattended-upgrades fail2ban chrony >/dev/null
  # A drop-in that sorts FIRST: sshd keeps the first value it reads, and Ubuntu's cloud image
  # ships sshd_config.d/50-cloud-init.conf with PasswordAuthentication yes.
  install -d -m 755 /etc/ssh/sshd_config.d
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
  apt-get install -y --no-install-recommends git >/dev/null   # restore-production.sh clones bundles on the host; every other tool it needs is in the backup image
  mkdir -p /data && chmod 755 /data                       # bind mounts live here; `init` owns the subdirectories
  if ! swapon --show | grep -q '^/swapfile'; then          # RUNBOOK.md § Swap
    fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf && sysctl -p /etc/sysctl.d/99-swap.conf >/dev/null
    echo "swap: 4 GB file created"
  fi
  # The git-mirror deploy key (SECRETS.md, class repository): root-only on the host, mounted read-only
  # into the backup service; its private half is escrowed by the owner, not by this script.
  install -d -m 700 /data/backup/mirror-ssh
  [ -f /data/backup/mirror-ssh/id_ed25519 ] || ssh-keygen -q -t ed25519 -N '' -C better-answers-mirror -f /data/backup/mirror-ssh/id_ed25519
  ssh-keyscan -t ed25519 "${mirror_host}" 2>/dev/null > /data/backup/mirror-ssh/known_hosts
  chmod 600 /data/backup/mirror-ssh/*
  if [ -n "${drill_pubkey}" ]; then   # VPC 2's root key, so the drill can run psql here through docker exec
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
  # The client must match the DUMP's major, not Ubuntu's default: pg_restore 16 refuses a
  # pg18 custom-format archive (first drill prep, 04/09/2026). PGDG carries 18 on noble.
  YES=yes /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null
  apt-get install -y --no-install-recommends postgresql-client-18 >/dev/null
  # The mirror user: a home, /data/mirror, and one key that can run two commands.
  id mirror >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash mirror
  install -d -m 750 -o mirror -g mirror /data/mirror
  install -m 755 "$(dirname "$0")/mirror-shell.sh" /usr/local/bin/mirror-shell
  install -d -m 700 -o mirror -g mirror /home/mirror/.ssh
  printf 'command="/usr/local/bin/mirror-shell /data/mirror",restrict %s\n' "$(cat "${pubkey}")" > /home/mirror/.ssh/authorized_keys
  chown mirror:mirror /home/mirror/.ssh/authorized_keys && chmod 600 /home/mirror/.ssh/authorized_keys
  # The checkout the drill runs from (host cron, not a Coolify task: the drill wipes the stacks such a task would run inside).
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
# psql against PRODUCTION over the SSH connection this box already holds — no Postgres port is open (ticket 79 A12).
# The container is named by the Coolify DATABASE RESOURCE'S UUID, not the resource's display
# name (first deploy, 04/09/2026): read it with `docker ps` on VPC 1 and replace the placeholder.
PROD_PSQL="ssh -o BatchMode=yes root@${prod_host:-<VPC1 IP>} docker exec -i <pg-resource-uuid> psql -U postgres -d better_answers"
DRILL_WORKSPACE=
HEALTHCHECKS_PING_URL_DRILL=
HEALTHCHECKS_PING_URL_STAGING_WIPED=
# the `dumps:` remote, from the READ credential (SECRETS.md class object store)
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
  # root's own key, for the drill's SSH to VPC 1 (host-setup.sh vpc1 --drill-pubkey takes the public half)
  [ -f /root/.ssh/id_ed25519 ] || { install -d -m 700 /root/.ssh; ssh-keygen -q -t ed25519 -N '' -C better-answers-drill -f /root/.ssh/id_ed25519; }
  [ -z "${prod_host}" ] || { ssh-keyscan -t ed25519 "${prod_host}" 2>/dev/null >> /root/.ssh/known_hosts; sort -u -o /root/.ssh/known_hosts /root/.ssh/known_hosts; }
  cat > /etc/cron.d/better-answers-drill <<'CRON'
# the monthly restore drill (ADR 0022) — host cron, root, env from the root-only file
0 3 1 * * root set -a; . /etc/better-answers/drill.env; set +a; /opt/better-answers/deploy/restore-drill.sh >> /var/log/better-answers-drill.log 2>&1
CRON
  chmod 644 /etc/cron.d/better-answers-drill
  harden
  echo; echo "fill, as root, mode 0600: /etc/better-answers/drill.env · staging.env (every key the two compose files require, staging values) · backup-age.key (the identity, from escrow — resident here; SECRETS.md says what that means)"
  echo; echo "root's PUBLIC key for the drill — give it to: host-setup.sh vpc1 --mirror-host <this box> --drill-pubkey <file>"; cat /root/.ssh/id_ed25519.pub
  echo "still yours: Coolify itself (the wizard's stage 7), and the provider firewall (SSH from your IP and from VPC 1 only)"
}

case "${box}" in vpc1) vpc1 "$@" ;; vpc2) vpc2 "$@" ;; *) usage ;; esac
