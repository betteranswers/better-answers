# Image vulnerabilities with no fix

Each package's assessment behind the code-scanning alerts `scan.yml` raises with no fix we can take, and the alerts held open. The method is `CI.md`, `scan.yml`, *Triage of a vulnerability*.

## Held open

**CVE-2026-60002 in `openssh-client`, `image-backup`, alert #446, critical.** `ssh` can use freed memory when the server changes its host key during a key re-exchange. The path is run: the nightly `job_git_mirror` runs `ssh` and `git push` over SSH to the mirror.

- **What holds it today.** The client speaks to that one host, whose host key `deploy/host-setup.sh` pins in the backup's `known_hosts`, so a re-exchange inside the session can come only from the mirror's own `sshd`.
- **What removes it.** BA-15: a Debian 13 `openssh-client` that fixes the flaw, built into the image and deployed. No such package is due. Debian marks trixie `<no-dsa>` (a minor issue), so its security team will issue no update, and only a stable point release could carry one. On 30/09/2026 `trixie-proposed-updates` held no fix, and `trixie-backports` carried 10.3p1, while the flaw is fixed from OpenSSH 10.4, in forky and sid only. The removal has no date.

## Assessed 30/09/2026

Every medium alert. The low and unrated ones have not been through the method. The images read are the ones `build.yml` pushed for `1279f9c`: `api` `sha256:0613fe1d…`, `backup` `sha256:23f1bd1d…`, `worker` `sha256:eb8e4ca0…`. The alerts come from the nightly scan on `83c2f68`, and the versions installed in these images match what the alerts report. Each image was exported with `docker export` and read there: dpkg's status file, and a `readelf` sweep of every ELF file for what imports each flawed entry point and what links each library.

Of the 285 critical, high and medium alerts open that day:

- 240 medium alerts are dismissed on the assessments below: 112 in `image-api`, 109 in `image-backup` and 19 in `image-worker`.
- 33 in `image-backup` are OpenSSL's, and have a fix: `3.5.7-1~deb13u3`, from DSA-6531-1. `deploy/backup.Dockerfile` takes it.
- 11 in `image-worker` are OpenSSL's too. The worker's `libssl3t64` is Distroless's, so they close when the `cc-debian13` digest moves to a build that carries the fix.
- 5 of the 240 are glibc's CVE-2026-8674: `image-api` #707 and #729, `image-backup` #112 and #134, `image-worker` #1327. The flaw aborts a process whose resolver reads a `search` domain of about 200 characters, and a container copies its host's `search` line. Read on both hosts on 30/09/2026: `/etc/resolv.conf` is systemd-resolved's stub with `search .`, no domain at all, and every running container carries the same line. Netplan's DHCP leaves `UseDomains` at its default, off, so the provider's DHCP cannot add a domain either.
- 1 critical alert is held open, above.

### `image-api`

The service is as on 24/09, below. It spawns only `git`, through `execFile`, with no shell. The image's `HEALTHCHECK` runs `wget` through `sh`, and `deploy/platform.compose.yaml` replaces it with the exec form.

- **dash**: CVE-2026-102473 and CVE-2026-102474, 2 alerts. Debian's `/bin/sh`. The flaws are in dash's own glob matching, which this build uses because it imports no libc `fnmatch`, and in its `printf`. dash runs only the `HEALTHCHECK`'s fixed line, which compose replaces. Nothing globs a directory an attacker can write, and no outside data reaches dash's `printf`.
- **glibc**: `libc6`, `libc-bin`. CVE-2026-18374, CVE-2026-19499, CVE-2026-19542, CVE-2026-5435, CVE-2026-6238, CVE-2026-6368, CVE-2026-6791, CVE-2026-77117, CVE-2026-80489, CVE-2026-86805, CVE-2026-89092 and CVE-2026-95818, 24 alerts. Debian's base system. No ELF file imports `ns_printrr`, `ns_printrrf`, `fp_nquery`, `wordexp` or `strfmon`. Only `libtinfo` and `libncursesw` import `tdelete`, whose flaw needs a tree of a million nodes. `git`, `wget`, `tar` and `bash` import `iconv`, and the api's git re-encodes nothing: it writes blobs by `hash-object --stdin` with no `--path`, and its commits are its own UTF-8. There is no `nscd`, and none of the 11 setuid or setgid files has an RPATH or RUNPATH. The `fopen` flaw needs a caller that passes an outside `ccs=` mode, and the advisory knows of none in a distribution.
- **`libacl1`**: CVE-2026-54370, 1 alert, beside CVE-2026-54369 below. For coreutils, `sed`, `tar` and `passwd`. The new flaw is in `getfacl` and `setfacl`, from the `acl` package, which the image does not install. Only `cp`, `install`, `mv`, `sed`, `tar`, `useradd` and `usermod` link the library, and the api runs none of them. The earlier flaw also needs a privileged caller on a path an attacker controls.
- **`libattr1`**: CVE-2026-54371, 1 alert. For coreutils and `passwd`. The flaw is in `getfattr` and `setfattr`, from the `attr` package, which the image does not install. Only `cp`, `install`, `mv`, `useradd` and `usermod` link the library, and the api runs none of them.
- **`libbz2-1.0`**: CVE-2026-42250, 1 alert. The flaw is in the `bzip2recover` tool, which the image does not carry. The library holds none of that code.
- **`libcurl3t64-gnutls`**: CVE-2026-10536, CVE-2026-11856, CVE-2026-19931, CVE-2026-80229, CVE-2026-8924, CVE-2026-8926, CVE-2026-8932, CVE-2026-9079, CVE-2026-9080 and CVE-2026-9545, 10 alerts, beside the four below. For `git`. Only git's HTTP transports link it: `git-remote-http`, `git-http-fetch`, `git-http-push` and `git-imap-send`. The api's git runs local plumbing on bare repositories and never contacts a remote.
- **`libexpat1`**: CVE-2025-66382 and CVE-2026-102633, 2 alerts, beside the four below. Linked by `python3.13`, as `pyexpat`, and by `git-http-push`. `git filter-repo`, the only Python the api runs, loads neither `pyexpat` nor any `xml` module (checked in the image), and no push goes over HTTP.
- **`libnghttp2-14`**: CVE-2026-58055, 1 alert. For libcurl. The flaw is in the `nghttpx` proxy, which the image does not carry. Only `libcurl3t64-gnutls` links the library, as an HTTP/2 client for git's HTTP transports, which never run.
- **`libp11-kit0`**: CVE-2026-13757 and CVE-2026-18938, 2 alerts. For GnuTLS. Both flaws are in p11-kit's RPC protocol, which is used only with remote modules, and the image has no `/etc/pkcs11` and configures no module. Only `libgnutls` links it, for git's HTTP transports, which never run. CVE-2026-18938 affects 32-bit builds only.
- **`libsqlite3-0`**: CVE-2026-50812 and CVE-2026-50813, 2 alerts. Both flaws are in the Session extension's changesets. Python's `_sqlite3` links it, and `git filter-repo` never loads that module, which exposes no session API anyway. `liblastlog2` links it for `login`, which nothing runs.
- **PAM**: `libpam-modules`, `libpam-modules-bin`, `libpam-runtime`, `libpam0g`. CVE-2026-54411, 4 alerts. Debian's base system. The flaw is in `pam_userdb`, which the image carries and no `/etc/pam.d` file references. The api authenticates nobody through PAM.
- **Perl**: the four packages below. CVE-2026-15534 and CVE-2026-19487, 8 alerts. For `git`. Both flaws need an outside subject to reach a Perl regex, and one needs a subject of 286 MB. No Perl program runs: the git commands the api runs are C builtins.
- **Python**: the four packages below. CVE-2025-12781, CVE-2025-15366, CVE-2025-15367, CVE-2026-12345, CVE-2026-15806, CVE-2026-17084, CVE-2026-19672 and CVE-2026-87910, 32 alerts. For `git filter-repo`. The flaws need `tempfile`, `tarfile`, `base64` or `binascii`, `urllib`, `imaplib`, `poplib`, `stringprep` or `pyexpat`. Importing `git_filter_repo` in the image loads 81 modules and none of these (checked in the image). The tool reads git's own fast-export stream.
- **systemd**: `libsystemd0`, `libudev1`. CVE-2026-15059, 2 alerts, beside the one below. The flaw is in `systemd-oomd`'s IPC API. `systemd-oomd` is not installed, and PID 1 is node.
- **`tar`**: CVE-2026-18477, CVE-2026-18508 and CVE-2026-5704, 3 alerts. Debian's base system. All three flaws need `tar` to extract a crafted archive. The api never runs `tar`.
- **util-linux**: the nine packages below. CVE-2026-3184, 9 alerts. The flaw is in `login -h`, which a remote-login daemon calls. The image has no such daemon, and nothing runs `login`. The other eight packages hold none of that code.
- **`wget`**: CVE-2021-31879, CVE-2026-15146, CVE-2026-58469 and CVE-2026-58470, 4 alerts, beside the two below. For the healthcheck. `wget` runs only as the healthcheck, fetching `http://127.0.0.1:3000/health` to stdout. It follows no redirect that carries credentials, and uses no FTP, no Metalink, no `-c` and no `Content-Range`.
- **`zlib1g`**: CVE-2026-27171 and CVE-2026-85091, 2 alerts. Debian's base system. Only Perl's `Compress::Raw::Zlib` imports `crc32_combine64`, and nothing loads it. Nothing imports `gzprintf` or `gzvprintf`. Node bundles its own zlib.

### `image-backup`

The service is as on 24/09, below. cron runs its two fixed job lines through `sh`, and so does the healthcheck's `pgrep` and `find` line. `backup.sh` and `backup-env` are bash.

- **`curl`, `libcurl4t64`**: CVE-2026-10536, CVE-2026-11856, CVE-2026-19931, CVE-2026-80229, CVE-2026-8924, CVE-2026-8926, CVE-2026-8932, CVE-2026-9079, CVE-2026-9080 and CVE-2026-9545, 20 alerts, beside the four below. For the ping. Only `/usr/bin/curl` links `libcurl4t64`. The job's one call is an HTTPS POST to the ping URL, `curl -fsS -m 10 --retry 3`, with one handle per run. The flaws need, in turn: HTTP/2 stream dependencies, Digest auth, Negotiate auth, TLS reuse across a multi handle with an OpenSSL provider config, the cookie engine, `--netrc`, a client certificate, a proxy, an application's `SOCKETFUNCTION` callback, and HTTP/3 with early data. The call uses none of them, and `backup-env` passes the job no proxy variable.
- **dash**: CVE-2026-102473 and CVE-2026-102474, 2 alerts. Debian's `/bin/sh`. The flaws are as in `image-api`, above. dash runs only cron's two fixed job lines and the healthcheck's fixed line. Nothing globs a directory an attacker can write, and no outside data reaches dash's `printf`.
- **glibc**: `libc6`, `libc-bin`. The twelve CVEs in `image-api`, above, 24 alerts. Debian's base system. The same sweep: no ELF file imports `ns_printrr`, `fp_nquery`, `wordexp` or `strfmon`, and only ncurses imports `tdelete`. The jobs re-encode nothing: `git bundle` and `git push` pass bytes as they are. There is no `nscd`, and none of the 14 setuid or setgid files, `ssh-keysign`, `ssh-agent` and `crontab` among them, has an RPATH or RUNPATH. No caller passes an outside `fopen` mode.
- **`golang.org/x/crypto` in `age` and `age-keygen`**: CVE-2026-56855 and CVE-2026-78662, 4 alerts. The module has a fixed version, 0.56.0, and no `age` release carries it yet: `age` v1.3.2 builds with 0.55.0. So it is assessed as a vulnerability with no fix. Both flaws are denial-of-service bugs in the SSH connection code. `age` links `x/crypto/ssh` only to parse keys, through `ParsePublicKey`, `ParseAuthorizedKey` and `ParseRawPrivateKey`, and `age-keygen` links none of it.
- **`libacl1`**: CVE-2026-54370, 1 alert, beside CVE-2026-54369 below. The new flaw is in `getfacl` and `setfacl`, which the image does not carry. Only `cp`, `install`, `mv`, `sed`, `tar`, `useradd`, `usermod` and systemd's tools link the library, and the jobs run none of them.
- **`libattr1`**: CVE-2026-54371, 1 alert. The flaw is in `getfattr` and `setfattr`, which the image does not carry. Only `cp`, `install`, `mv`, `useradd` and `usermod` link the library, and the jobs run none of them.
- **`libbz2-1.0`**: CVE-2026-42250, 1 alert. The flaw is in the `bzip2recover` tool, which the image does not carry. The library holds none of that code.
- **`libcurl3t64-gnutls`**: the ten CVEs above, 10 alerts, beside the four below. For `git`, whose HTTP transports alone link it. The job's git pushes to the mirror over SSH, never HTTP.
- **`libexpat1`**: CVE-2025-66382 and CVE-2026-102633, 2 alerts, beside the four below. Only `git-http-push` links it, and the job's git pushes over SSH. `rclone` parses S3's XML in Go, without it.
- **`libnghttp2-14`**: CVE-2026-58055, 1 alert. The flaw is in the `nghttpx` proxy, which the image does not carry. `libcurl4t64` and `libcurl3t64-gnutls` link the library, only as an HTTP/2 client.
- **`libp11-kit0`**: CVE-2026-13757 and CVE-2026-18938, 2 alerts. As in `image-api`: an RPC protocol for remote modules, none configured, linked only by `libgnutls` for git's HTTP transports, which never run. CVE-2026-18938 affects 32-bit builds only.
- **`libsqlite3-0`**: CVE-2026-50812 and CVE-2026-50813, 2 alerts. Both flaws are in the Session extension's changesets. Only `liblastlog2` links it, for `login` and `lastlog2`, which nothing runs.
- **`openssh-client`**: CVE-2026-59995, CVE-2026-59996, CVE-2026-59997, CVE-2026-59998, CVE-2026-60001, CVE-2026-73282 and CVE-2026-73283, 7 alerts, beside the two below and the one held open, above. For the mirror push. CVE-2026-59997, CVE-2026-59998, CVE-2026-60001 and CVE-2026-73283 are in `sshd`, which the image does not carry. CVE-2026-59995 and CVE-2026-59996 are in `sftp` and `scp`: the package ships both, and `backup.sh` never runs them. CVE-2026-73282 needs remote forwarding. The push runs `ssh -o BatchMode=yes` and `git push --mirror`, with no `-R`, and the image holds no ssh config beyond Debian's. `/root/.ssh` is the read-only mount of the mirror's key and `known_hosts`.
- **PAM**: the four packages in `image-api`, above. CVE-2026-54411, 4 alerts. Debian's base system. No `/etc/pam.d` file references `pam_userdb`. cron's PAM stack is `common-*`, `pam_env`, `pam_limits` and `pam_loginuid`, and nothing authenticates a password.
- **Perl**: the four packages below. CVE-2026-15534 and CVE-2026-19487, 8 alerts. For `git` and `postgresql-common`. Perl runs only as `pg_wrapper`, behind `psql` and `pg_dump`, which matches its own fixed patterns against the job's arguments and config. No outside subject reaches a regex, let alone one of 286 MB.
- **systemd**: `systemd`, `libsystemd-shared`, `libsystemd0`, `libudev1`. CVE-2026-15059, 4 alerts, beside the one below. The flaw is in `systemd-oomd`'s IPC API. Neither `systemd-oomd` nor `oomctl` is installed, and PID 1 is cron.
- **`tar`**: CVE-2026-18477, CVE-2026-18508 and CVE-2026-5704, 3 alerts. Debian's base system. All three flaws need `tar` to extract a crafted archive. `tar` runs only at build, on `age`'s pinned release, and the jobs never run it.
- **util-linux**: the nine packages below. CVE-2026-3184, 9 alerts. As in `image-api`: the flaw is in `login -h`, there is no remote-login daemon, and nothing runs `login`.
- **`zlib1g`**: CVE-2026-27171 and CVE-2026-85091, 2 alerts. Debian's base system. Only Perl's `Compress::Raw::Zlib` imports `crc32_combine64`, and `pg_wrapper` never loads it. Nothing imports `gzprintf` or `gzvprintf`.

### `image-worker`

The service is as on 24/09, below. The image carries no binary in `/bin` or `/usr/bin`, no setuid file and no `nscd`. The venv holds 142 ELF files, and the sweep read them too.

- **glibc**: `libc6`. The twelve CVEs in `image-api`, above, 12 alerts. No ELF file imports `ns_printrr`, `fp_nquery`, `wordexp`, `strfmon` or `tdelete`. Only `libstdc++` imports `iconv_open`, and Python's codecs do not use it. No caller passes an outside `fopen` mode.
- **`libbz2-1.0`**: CVE-2026-42250, 1 alert. For Python's `bz2`. The flaw is in the `bzip2recover` tool, and the image carries no binary beyond Python. The library holds none of that code.
- **`libsqlite3-0`**: CVE-2026-50812 and CVE-2026-50813, 2 alerts. For Python's `sqlite3`. Both flaws are in the Session extension's changesets. Only `_sqlite3` links the library, and Python's `sqlite3` module exposes no session or changeset API.
- **`libuuid1`**: CVE-2026-3184, 1 alert, beside the four below. The flaw is in `login -h`. The image has no `login`, and `libuuid1` holds none of that code.
- **`zlib1g`**: CVE-2026-27171 and CVE-2026-85091, 2 alerts. No ELF file in the image, the venv included, imports `crc32_combine64`, `crc32_combine_gen64`, `gzprintf` or `gzvprintf`.

## Assessed 24/09/2026

Every critical and high alert open that day. The medium ones were assessed on 30/09, above. The images read are the ones `build.yml` pushed for `c8ed108`: `api` `sha256:0a9b161a…`, `backup` `sha256:8dd3c0f6…`, `worker` `sha256:0c138f7e…`. The scan read `85c40ae`'s, and no image's source changed between the two. 142 alerts were dismissed (69 in `image-api`, 69 in `image-backup`, 4 in `image-worker`) and one is held open, above.

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
