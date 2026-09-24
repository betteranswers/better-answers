# Image vulnerabilities with no fix

Each package's assessment behind the code-scanning alerts `scan.yml` raises with no fix we can take, and the alerts held open. The method is `CI.md`, `scan.yml`, *Triage of a vulnerability*.

## Held open

**CVE-2026-60002 in `openssh-client`, `image-backup`, alert #446, critical.** `ssh` can use freed memory when the server changes its host key during a key re-exchange. The path is run: the nightly `job_git_mirror` runs `ssh` and `git push` over SSH to the mirror.

- **What holds it today.** The client speaks to that one host, whose host key `deploy/host-setup.sh` pins in the backup's `known_hosts`, so a re-exchange inside the session can come only from the mirror's own `sshd`.
- **What removes it.** T-365: Debian 13's fixed `openssh-client` built into the image and deployed, once Debian ships it.

## Assessed 24/09/2026

Every critical and high alert; the medium and low ones have not been through the method. The images read are the ones `build.yml` pushed for `c8ed108`: `api` `sha256:0a9b161a…`, `backup` `sha256:8dd3c0f6…`, `worker` `sha256:0c138f7e…`. The scan read `85c40ae`'s, and no image's source changed between the two. 142 alerts were dismissed (69 in `image-api`, 69 in `image-backup`, 4 in `image-worker`) and one is held open, above.

### `image-api`

The service is `node apps/api/src/main.ts` as uid 1000, and `pnpm migrate` from the same image. It spawns `git`, which runs local plumbing on bare repositories and never a remote (`packages/core/src/store/git/index.ts`), and `git filter-repo` in the erasure routine. The healthcheck runs `wget`.

- **util-linux**: `util-linux`, `mount`, `login`, `bsdutils`, `libmount1`, `libblkid1`, `libsmartcols1`, `liblastlog2-2`, `libuuid1`. CVE-2026-76642, CVE-2026-78408, CVE-2026-78409 and CVE-2026-78410, 36 alerts. Debian's base system, and `libuuid1` for `wget` and Python's `_uuid` as well. Each flaw needs a user mount that `/etc/fstab` authorises, through the setuid `mount` and its `X-mount.*` options, or a privileged operator running `nsenter --join-cgroup`. The fstab is Debian's unconfigured stub, nothing calls `mount` or `nsenter`, and no compose file adds a capability, so the container has no `CAP_SYS_ADMIN` to mount with.
- **`libacl1`**: CVE-2026-54369, 1 alert. For coreutils, `sed`, `tar` and `passwd`. The symlink flaw needs a privileged caller on a path an attacker controls. Only `cp`, `mv`, `install`, `sed`, `tar`, `useradd` and `usermod` link it, and the api runs none of them.
- **`libcurl3t64-gnutls`**: CVE-2026-8927, CVE-2026-8458, CVE-2026-8286 and CVE-2026-12064, 4 alerts. For `git`. Only git's HTTP transports link it: `git-remote-http`, `git-http-fetch`, `git-http-push` and `git-imap-send`. The api's git never talks to a remote.
- **`libexpat1`**: CVE-2026-66046, CVE-2026-76956, CVE-2026-76957 and CVE-2026-93990, 4 alerts. For `git` and Python. Linked by `python3.13`, as `pyexpat`, and by `git-http-push`. `git filter-repo` imports no XML module, and no push goes over HTTP.
- **ncurses**: `ncurses-base`, `ncurses-bin`, `libtinfo6`, `libncursesw6`. CVE-2025-69720, 4 alerts. Debian's base system and Python's `_curses`. The overflow is in the `infocmp` tool, which nothing runs.
- **Perl**: `perl`, `perl-base`, `perl-modules-5.40`, `libperl5.40`. CVE-2026-9538, 4 alerts. For `git`. The flaw is in `Archive::Tar`. No Perl program runs: the git commands the api runs are C builtins.
- **Python**: `python3.13`, `python3.13-minimal`, `libpython3.13-stdlib`, `libpython3.13-minimal`. CVE-2026-82049, CVE-2026-15308 and CVE-2026-7210, 12 alerts. For `git filter-repo`. The flaws need `tarfile`, `html.parser` or `xml.parsers.expat` over crafted input. `git filter-repo` imports none of them and reads git's own fast-export stream.
- **systemd**: `libsystemd0`, `libudev1`. CVE-2026-16742, 2 alerts. For `apt`, coreutils, util-linux and PAM. The flaw is in `systemd-homed`, a Debian package of its own that the image does not install. PID 1 is node.
- **`wget`**: CVE-2026-58472 and CVE-2026-58471, 2 alerts. For the healthcheck. The flaws are in `--convert-links` and in naming a local file from the URL. The healthcheck writes the api's own `/health`, fetched over the loopback, to stdout and converts nothing.

### `image-backup`

The service is `cron -f`, running `backup.sh` hourly and nightly through `backup-env`. The jobs run `psql`, `pg_dump` and `pg_dumpall`, `age`, `rclone` against S3, `git` and `ssh` to the mirror, `curl` for the ping, `jq`, and `find`, `grep`, `stat`, `rm`, `basename` and `date`. The healthcheck runs `pgrep` and `find`.

- **util-linux**: the nine packages and four CVEs above, 36 alerts. Debian's base system. The same conditions go unmet: the fstab is the stub, nothing calls `mount` or `nsenter`, and there is no `CAP_SYS_ADMIN`.
- **`libacl1`**: CVE-2026-54369, 1 alert. For coreutils, `sed`, `tar`, `passwd` and systemd. Linked by `cp`, `mv`, `install`, `sed`, `tar`, `useradd`, `usermod` and systemd's tools, and the jobs run none of them.
- **`curl`, `libcurl4t64`**: CVE-2026-8927, CVE-2026-8458, CVE-2026-8286 and CVE-2026-12064, 8 alerts. For the ping. The job's one `curl` call is an HTTPS POST to the ping URL. The four flaws need a proxy from the environment with Digest auth, Negotiate auth, a STARTTLS protocol, and a schemeless URL with `--proto-default sftp` or `scp`. The call uses none of them, and `backup-env` passes the job no proxy variable.
- **`libcurl3t64-gnutls`**: the same four CVEs, 4 alerts. For `git`, whose HTTP transports alone link it. The job's git pushes over SSH.
- **`libexpat1`**: the four CVEs above, 4 alerts. For `git`. Only `git-http-push` links it. `rclone` parses S3's XML in Go, without it.
- **ncurses**: the four packages above, CVE-2025-69720, 4 alerts. Debian's base system and `procps`. The overflow is in `infocmp`, which nothing runs.
- **Perl**: the four packages above, CVE-2026-9538, 4 alerts. For `git` and `postgresql-common`. Perl runs here as `pg_wrapper`, behind `psql`, `pg_dump` and `pg_dumpall`. It loads `POSIX`, `Socket` and `IPC::Open3`, and never `Archive::Tar`.
- **systemd**: `systemd`, `libsystemd-shared`, `libsystemd0`, `libudev1`. CVE-2026-16742, 4 alerts. `systemd` comes in with `cron-daemon-common`. `systemd-homed` is not installed, and PID 1 is cron.
- **`openssh-client`**: CVE-2026-59999 and CVE-2026-60000, 2 of its 3 alerts. For the mirror push. Both flaws are in `sshd`, which the image does not carry. CVE-2026-60002 is held open, above.
- **`google.golang.org/grpc` in `rclone`**: CVE-2026-84445, 1 alert. The module has a fixed version, and no `rclone` release carries it yet, so it is assessed as a vulnerability with no fix. The panic is in gRPC's xDS server, `xds.NewGRPCServer`. The binary links 60 grpc packages and no xds one, and `rclone` runs as a client with no listener.
- **`/etc/ssl/private/ssl-cert-snakeoil.key`**: a private key the secret scan flags, 1 alert. `ssl-cert`, a dependency of `postgresql-common`, generates it when the image is built. Nothing in the image serves TLS, and `psql` and `pg_dump` never read it, so it authenticates nothing.

### `image-worker`

The service is `better-answers-worker` on Distroless: no shell, no setuid binary, no `mount` and no `nsenter`.

- **`libuuid1`**: the four util-linux CVEs above, 4 alerts. For Python's `_uuid`. The flaws are in `mount`, `libmount` and `nsenter`, and `libuuid1` holds none of that code.
