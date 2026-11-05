# Image vulnerabilities with no fix

This page records each code scanning alert from `scan.yml` that has no fix we can take. For each package in each image, it gives the reason the alert is dismissed or held open. The triage method is in `CI.md`, under _Triage of a vulnerability_. A new alert on a package listed here starts from that package's assessment.

## Held open

The running service takes the flawed path of each alert below. Each alert stays open until the change under **Removal** ships.

### CVE-2026-60002 in `openssh-client`

Alert #446 in `image-backup`, critical.

`ssh` can use freed memory when the server changes its host key during a key re-exchange. The nightly `job_git_mirror` in `deploy/backup.sh` runs `ssh` and `git push --mirror` to the mirror, so the backup image takes this path.

- **Mitigation.** `ssh` connects only to the mirror. `deploy/host-setup.sh` pins the mirror's host key in the backup's `known_hosts`. Only the mirror's own `sshd` can start a re-exchange inside the session.
- **Removal.** BA-15 builds a Debian 13 `openssh-client` that fixes the flaw into the backup image and deploys it. No fixed trixie package is scheduled, so the removal has no date. Debian marks the flaw `<no-dsa>` (a minor issue) for trixie, so the Debian security team issues no update. Only a stable point release can carry a fix. OpenSSH 10.4 fixes the flaw, and only forky and sid carry 10.4. On 30/09/2026, `trixie-proposed-updates` had no fix and `trixie-backports` had 10.3p1.

### CVE-2026-95619 in `libstdc++6`

Alerts #1667 in `image-api` and #1671 in `image-worker`, medium.

The aligned `operator new` in libstdc++ rounds the requested size up to the alignment without an overflow check. A size within one alignment of 2^64 wraps to an allocation that is too small. The code is in `libstdc++.so`, and programs that take outside input import it:

- In `image-api`, `node` imports it.
- In `image-worker`, `libtorch_cpu.so`, `libtorch_python.so`, `libonnxruntime.so`, the onnxruntime pybind module, and `_sentencepiece` import it. A `readelf` read on 04/11/2026 shows this.

No real buffer length comes near 2^64, but an overflowed `new T[n]` count for an over-aligned `T` can. No read of these importers rules out an outside `n`.

- **Mitigation.** The alignment is at most 64 bytes, so the size must be within 64 bytes of 2^64. Node and V8 cap buffer and array lengths far below that. Torch allocates tensor storage through its own `posix_memalign` path, not `operator new`. That last point is inferred, not read in the binaries.
- **Removal.** BA-283 takes a trixie `libstdc++6` that fixes the flaw, in the api's apt layer and in the worker's `cc-debian13` digest. sid has the fix in `gcc-14 14.4.0-3`. Debian marks the flaw `<no-dsa>` for trixie, so only a stable point release can carry it. The removal has no date.

### CVE-2026-111943 in Go's standard library in `rclone`

Alert #1837 in `image-backup`, high.

Go 1.26.10 and 1.27.3 add a denylist to `crypto/x509`. The denylist refuses intermediate certificates that are no longer trusted, on systems whose trust store still holds them. `rclone` v1.75.2 is built with go1.26.9 and links `(*Certificate).Verify`. `go version -m` and the binary's function names showed this on 04/11/2026. Every hourly and nightly job uploads to the `dumps` remote, `BACKUP_S3_ENDPOINT`, over HTTPS, so the backup image takes this path.

- **Mitigation.** An attacker needs a certificate for the provider's host issued under a denied intermediate, and a network position between the host and the provider. The image's trust store is `ca-certificates 20250419+deb13u1`. `age` encrypts the database dumps and the git bundles before upload, so the attacker can read none of them. `job_mirror` copies the object store from `src:` to `dumps:` with `rclone sync` and does not encrypt the copy.
- **Removal.** Renovate opens a pull request for the first `rclone` release built with Go 1.26.10, 1.27.3, or later. Merging it and deploying the backup image removes the alert. BA-324 tracks it. On 04/11/2026, the latest `rclone` release was v1.75.2.

## What each image runs

Every assessment below checks the flawed path against these services. The services have not changed since 24/09/2026.

### `image-api`

- The service runs `node apps/api/src/main.ts` as uid 1000. `pnpm migrate` runs from the same image.
- The api spawns only `git`, through `execFile`, with no shell. `git` runs local plumbing on bare repositories and never contacts a remote (`packages/core/src/store/git/door.ts`).
- The erasure routine runs `git filter-repo`. It is the only Python the api runs, and it reads git's own fast-export stream.
- The image's `HEALTHCHECK` runs `wget -qO- http://127.0.0.1:3000/health` through `sh`. `deploy/platform.compose.yaml` replaces it with the exec form.
- The image installs no locale except C.UTF-8. It sets no `LANG`, `LC_*`, or `LANGUAGE`.

### `image-backup`

- The service is `cron -f`, as PID 1. cron runs `backup.sh` hourly and nightly through `backup-env`, from two fixed job lines that it runs through `sh`.
- `backup.sh` and `backup-env` are bash. The image's copies match `deploy/backup.sh` and `deploy/backup-env.sh`.
- The jobs run `psql`, `pg_dump`, `pg_dumpall`, `age`, `rclone` against S3, `git` and `ssh` to the mirror, `curl` for the ping, `jq`, `find`, `grep`, `stat`, `rm`, `basename`, and `date`.
- `backup-env` passes the jobs a fixed list of variables. The list has no `LANG`, `LC_*`, `LANGUAGE`, or proxy variable.
- The healthcheck runs `pgrep` and `find` through `sh`.
- Both `rclone` remotes are of type `s3`. `src` is the object store over plain HTTP. `dumps` is the provider over HTTPS.
- `/root/.ssh` is the read-only mount of `/data/backup/mirror-ssh` (`deploy/stores.compose.yaml`). `deploy/host-setup.sh` fills it with the mirror's key and `known_hosts`, and with no ssh config.
- The image has no locale except C.UTF-8, and every job runs in the C locale.

### `image-worker`

- The service is `better-answers-worker` on Distroless.
- The image has no shell, no binary in `/bin` or `/usr/bin`, no setuid file, no `mount`, no `nsenter`, and no `nscd`.
- The image has no locale directory, and its Python imports no gettext.

## Assessed 04/11/2026

This assessment covers every critical, high, medium, and unrated alert open on 04/11/2026, except alerts that a fix closes. Low alerts have not been assessed.

The nightly scan of 04/11/2026 (run 41821287427) read these images, all built for `08b9b21`. The installed versions match what the alerts report.

| Image | Digest |
| --- | --- |
| api | `sha256:15f5d84d…` |
| backup | `sha256:12d4ac22…` |
| worker | `sha256:bff3d8fb…` |

Each image was exported with `docker export`. The read covered dpkg's status file, the file list, and a `readelf` sweep of every ELF file for its `DT_NEEDED` entries and its undefined and defined dynamic symbols. For Go binaries, it also covered `go version -m` and the function names. Two checks ran the images themselves:

- In the api image, importing `git_filter_repo` loads 82 modules. None of them is `ssl`, `socket`, `tarfile`, `zipfile`, `pyexpat`, or `sqlite3`.
- In the backup image, `perl` with `POSIX` and `PgCommon` loaded, as `pg_wrapper` loads them, holds 16 modules and no `Pod::` module.

178 alerts are dismissed: 64 in `image-api`, 85 in `image-backup`, and 29 in `image-worker`.

- 89 alerts were assessed under BA-279 on 28/10/2026, on the images of `sha-e905815`. Every reason still holds on these digests, and each alert is dismissed with BA-279's text. CVE-2026-113351 in `libexpat1` (#1843 and #1851) has since risen from medium to high. Its reason does not depend on the rating.
- 5 alerts are glibc's CVE-2026-84243, under BA-310. BA-310 read only the repository, and the images confirm its reasons. The `image-api` reason names `initRepository`, which runs `git init` without `LC_ALL=C`. That call still runs in the C locale, because nothing sets `LANG`.
- 84 alerts are new, under BA-323.

Held open: #446, #1667 and #1671 (BA-283), and #1837.

Left to a fix, and not assessed:

- undici in pnpm under `/opt/corepack`: #1849, #1850, #1860, #1861, and #1862 (BA-311).
- `libbrotli1` in `image-backup`: #1841.
- `ca-certificates` in `image-worker`: #1839.
- `liblzma5` in `image-worker`: #1733 and #1365.

### `image-api`

- **gcc-14**: `gcc-14-base`, `libgcc-s1`, and `libstdc++6`. CVE-2026-95619 in `gcc-14-base` and `libgcc-s1` (#1665 and #1666), CVE-2026-102010 (#1647, #1648, and #1653), and CVE-2026-114690, CVE-2026-114691, and CVE-2026-115455 (#1891 to #1896 and #1909 to #1911), 14 alerts.
  - `gcc-14-base` holds only documentation, and `libgcc_s` exports no C++ symbol.
  - CVE-2026-102010 and the three later CVEs are in header-only templates: parallel-mode `std::search`, the `vector<bool>` constructor, extracting a `bitset` from a wide stream, and `__gnu_pbds`. `libstdc++.so` exports none of them, and the image has no C++ headers.
  - No ELF file imports `__gnu_parallel` or the sentry of `basic_istream<wchar_t>`, and no file contains `__gnu_pbds`.
  - CVE-2026-95619 in `libstdc++6` is held open.
- **glibc**: `libc6` and `libc-bin`. CVE-2026-84243, 2 alerts. gettext reads `LANGUAGE` only outside the C locale, and the image has no other locale. `node` imports no gettext. The environment comes from the operator's compose file.
- **krb5**: `libgssapi-krb5-2`, `libk5crypto3`, `libkrb5-3`, and `libkrb5support0`. CVE-2026-107778 and CVE-2026-107708, 8 alerts. CVE-2026-107778 needs a GSS-API acceptor, and no ELF file imports `gss_accept_sec_context`. CVE-2026-107708 needs the KDC, and the image has no `krb5kdc`.
- **`libcurl3t64-gnutls`**: CVE-2026-92388, 1 alert. The flaw needs a failed FTP wildcard `LIST`. Only git's HTTP transports link the library, and the api's git never contacts a remote.
- **`libexpat1`**: CVE-2026-113351, CVE-2026-115506, CVE-2026-117610, and CVE-2026-118370, 4 alerts. Each flaw needs a parser over an outside document. CVE-2026-113351 also needs `XML_ParserReset`, which no ELF file imports. Only `python3.13` and `git-http-push` link the library. `git filter-repo` never loads `pyexpat`, and no push goes over HTTP.
- **`libsasl2-2` and `libsasl2-modules-db`**: CVE-2026-107161, 2 alerts. The overflow is in the DIGEST-MD5 plugin, which is not installed. `sasl2/` holds only `libsasldb`. Only `libldap` links `libsasl2`.
- **`libsqlite3-0`**: CVE-2026-119371 to CVE-2026-119376, CVE-2026-119378, CVE-2026-119379, and CVE-2026-119591, 9 alerts. Each flaw needs SQLite to run outside SQL or to open an outside database. Only Python's `_sqlite3` and `liblastlog2`, which `lslogins` uses, link the library. `git filter-repo` never loads `sqlite3`, and nothing runs `lslogins`.
- **Perl**: `perl`, `perl-base`, `perl-modules-5.40`, and `libperl5.40`. CVE-2026-82560, 4 alerts. The flaw needs `Pod::Text` to format an outside POD document. No Perl program runs. The git commands the api runs are C builtins, and nothing runs `perldoc` or `pod2text`.
- **Python**: `python3.13`, `python3.13-minimal`, `libpython3.13-stdlib`, and `libpython3.13-minimal`. CVE-2026-19553, CVE-2026-19445, CVE-2026-15310, CVE-2026-114583, and CVE-2026-116566, 20 alerts. The flaws need `ssl`, `zipfile`, `tarfile`, or `socket.getaddrinfo`. `git filter-repo` loads none of them, and its one lazy import is `unicodedata`.

### `image-backup`

- **`curl`, `libcurl4t64`, and `libcurl3t64-gnutls`**: CVE-2026-92388, 3 alerts. The flaw needs a failed FTP wildcard `LIST` and a reused handle. The jobs make one `curl` call, an HTTPS POST to the ping URL, with one handle per run. git's HTTP transports never run.
- **gcc-14**: `gcc-14-base`, `libgcc-s1`, and `libstdc++6`. CVE-2026-95619 (#1662 to #1664), CVE-2026-102010 (#1644 to #1646), and CVE-2026-114690, CVE-2026-114691, and CVE-2026-115455 (#1872 to #1877 and #1888 to #1890), 15 alerts. `gcc-14-base` holds only documentation, and `libgcc_s` exports no C++ symbol. Only apt's binaries link `libstdc++`, and the jobs never run apt. cron, the jobs' tools, `rclone`, and `age` are written in C or Go.
- **glibc**: `libc6` and `libc-bin`. CVE-2026-84243, 2 alerts. The image has no locale except C.UTF-8, and every job runs in the C locale.
- **Go's standard library in `age` and `age-keygen`**: CVE-2026-56866, CVE-2026-78659, CVE-2026-78660, CVE-2026-78663, CVE-2026-78667, CVE-2026-78669, CVE-2026-94439, CVE-2026-94440, CVE-2026-94448, CVE-2026-97030, CVE-2026-97031, CVE-2026-97032, and CVE-2026-111943, 26 alerts. `age` v1.3.2 is built with go1.27.0. It links no `net/http`, `html/template`, `mime/multipart`, `crypto/tls`, or `(*Certificate).Verify`, and it encrypts only local files. The low CVE-2026-56857 stays open with the other low alerts.
- **`github.com/go-chi/chi/v5` in `rclone`**: CVE-2026-114437, 1 alert. The flaw is in the `ClientIPFromXFF` middleware. `rclone` links chi's `middleware` package but not that function. Here `rclone` runs as an S3 client with no listener.
- **`golang.org/x/crypto` in `age`, `age-keygen`, and `rclone`**: GO-2026-5932, 3 alerts. The advisory covers the unmaintained `openpgp` package. None of the three binaries links any of its functions.
- **`golang.org/x/net` in `rclone`**: CVE-2026-78661 and CVE-2026-97045, 2 alerts. Both flaws are in the HTML parser, `x/net/html`. An `s3` remote returns XML, which `rclone` parses with `encoding/xml`. The `rclone` code that calls the HTML parser is inferred from its source, not read in the binary.
- **krb5**: the four packages listed for `image-api`. CVE-2026-107778 and CVE-2026-107708, 8 alerts. As in `image-api`, no ELF file imports `gss_accept_sec_context`, and the image has no `krb5kdc`.
- **`libexpat1`**: the four CVEs listed for `image-api`, 4 alerts. No ELF file imports `XML_ParserReset`. Only `git-http-push` links the library, and the mirror push goes over SSH.
- **`libsasl2-2` and `libsasl2-modules-db`**: CVE-2026-107161, 2 alerts. As in `image-api`, the DIGEST-MD5 plugin is not installed, and only `libldap` links `libsasl2`.
- **`libsqlite3-0`**: the nine CVEs listed for `image-api`, 9 alerts. Only `liblastlog2` links the library, for `lslogins`, which the jobs never run.
- **`openssh-client`**: CVE-2026-106553, CVE-2026-106555, CVE-2026-106586, CVE-2026-106552, CVE-2026-106585, and CVE-2026-106583, 6 alerts.
  - CVE-2026-106553, CVE-2026-106555, and CVE-2026-106586 are in `sshd`, which the image does not carry.
  - CVE-2026-106552 is in `sftp`, which `backup.sh` never runs.
  - CVE-2026-106585 needs compression. `backup.sh` passes no `-C`, no file in `/etc/ssh` sets `Compression`, and `/root/.ssh` holds no ssh config.
  - CVE-2026-106583 needs a `$` or `\` in a username on the command line. The only username is `mirror`, which `deploy/wizard-41.sh` tells the operator to set in `GIT_MIRROR_SSH_TARGET`. It contains neither character.
- **Perl**: the four packages listed for `image-api`. CVE-2026-82560, 4 alerts. Perl runs only as `pg_wrapper`, which loads no `Pod::` module.

### `image-worker`

- **gcc-14**: `gcc-14-base`, `libgcc-s1`, `libgomp1`, and `libstdc++6`. CVE-2026-95619 in the first three packages (#1668 to #1670), CVE-2026-102010 (#1658 to #1661), and CVE-2026-114690, CVE-2026-114691, and CVE-2026-115455 (#1914 to #1922 and #1933 to #1935), 19 alerts.
  - `libgcc_s` and `libgomp` export no C++ symbol.
  - As in `image-api`, the flaws are in header-only templates that `libstdc++.so` does not export. No ELF file imports `__gnu_parallel` or the sentry of `basic_istream<wchar_t>`, and no file contains `__gnu_pbds`.
  - `libtorch_cpu.so` imports OpenMP, but not `__gnu_parallel`.
  - CVE-2026-95619 in `libstdc++6` is held open.
- **glibc**: `libc6`. CVE-2026-84243, 1 alert. Distroless has no locale, and Python's `gettext` module is pure Python.
- **`libsqlite3-0`**: the nine CVEs listed for `image-api`, 9 alerts. Only Python's `_sqlite3` links the library. No module of the worker or its venv imports `sqlite3`, `dbm`, or `shelve`.

## Assessed 30/09/2026

This assessment covers every medium alert open on 30/09/2026. Low and unrated alerts were not assessed.

The images read are the ones `build.yml` pushed for `1279f9c`. The alerts come from the nightly scan on `83c2f68`, and the installed versions match what the alerts report.

| Image | Digest |
| --- | --- |
| api | `sha256:0613fe1d…` |
| backup | `sha256:23f1bd1d…` |
| worker | `sha256:eb8e4ca0…` |

Each image was exported with `docker export`. The read covered dpkg's status file and a `readelf` sweep of every ELF file for what imports each flawed entry point and what links each library.

On 30/09/2026, 285 critical, high, and medium alerts were open:

- 240 medium alerts are dismissed: 112 in `image-api`, 109 in `image-backup`, and 19 in `image-worker`.
- 33 alerts in `image-backup` are OpenSSL's and have a fix, `3.5.7-1~deb13u3` from DSA-6531-1. The `apt-get upgrade` in `deploy/backup.Dockerfile` installs it.
- 11 alerts in `image-worker` are OpenSSL's. The worker's `libssl3t64` comes from Distroless, so these alerts close when the `cc-debian13` digest moves to a build that carries the fix.
- 1 critical alert, CVE-2026-60002, is held open.

### CVE-2026-8674 in glibc, all three images

5 of the 240 dismissed alerts: #707 and #729 in `image-api`, #112 and #134 in `image-backup`, and #1327 in `image-worker`.

The flaw aborts a process whose resolver reads a `search` domain of about 200 characters. A container copies its host's `search` line. On 30/09/2026, `/etc/resolv.conf` on both hosts was the systemd-resolved stub with `search .`, which sets no search domain. Every running container had the same line. Netplan's DHCP leaves `UseDomains` at its default, off, so the provider's DHCP cannot add a search domain.

### `image-api`

- **dash**: CVE-2026-102473 and CVE-2026-102474, 2 alerts. dash is Debian's `/bin/sh`. The flaws are in dash's own glob matching and in its `printf`. This build uses its own glob matching because it imports no libc `fnmatch`. dash runs only the fixed line of the image's `HEALTHCHECK`, which compose replaces. Nothing globs a directory an attacker can write, and no outside data reaches dash's `printf`.
- **glibc**: `libc6` and `libc-bin`. CVE-2026-18374, CVE-2026-19499, CVE-2026-19542, CVE-2026-5435, CVE-2026-6238, CVE-2026-6368, CVE-2026-6791, CVE-2026-77117, CVE-2026-80489, CVE-2026-86805, CVE-2026-89092, and CVE-2026-95818, 24 alerts. Installed as part of Debian's base system.
  - No ELF file imports `ns_printrr`, `ns_printrrf`, `fp_nquery`, `wordexp`, or `strfmon`.
  - Only `libtinfo` and `libncursesw` import `tdelete`, whose flaw needs a tree of a million nodes.
  - `git`, `wget`, `tar`, and `bash` import `iconv`. The api's git re-encodes nothing. It writes blobs with `hash-object --stdin` and no `--path`, and it writes its own commits in UTF-8.
  - The image has no `nscd`. None of the 11 setuid or setgid files has an RPATH or RUNPATH.
  - The `fopen` flaw needs a caller that passes an outside `ccs=` mode. The advisory knows of no such caller in any distribution.
- **`libacl1`**: CVE-2026-54370, 1 alert. Installed for coreutils, `sed`, `tar`, and `passwd`. The flaw is in `getfacl` and `setfacl`, from the `acl` package, which the image does not install. Only `cp`, `install`, `mv`, `sed`, `tar`, `useradd`, and `usermod` link the library, and the api runs none of them.
- **`libattr1`**: CVE-2026-54371, 1 alert. Installed for coreutils and `passwd`. The flaw is in `getfattr` and `setfattr`, from the `attr` package, which the image does not install. Only `cp`, `install`, `mv`, `useradd`, and `usermod` link the library, and the api runs none of them.
- **`libbz2-1.0`**: CVE-2026-42250, 1 alert. The flaw is in the `bzip2recover` tool, which the image does not carry. The library holds none of that code.
- **`libcurl3t64-gnutls`**: CVE-2026-10536, CVE-2026-11856, CVE-2026-19931, CVE-2026-80229, CVE-2026-8924, CVE-2026-8926, CVE-2026-8932, CVE-2026-9079, CVE-2026-9080, and CVE-2026-9545, 10 alerts. Installed for `git`. Only git's HTTP transports link the library: `git-remote-http`, `git-http-fetch`, `git-http-push`, and `git-imap-send`. The api's git never contacts a remote.
- **`libexpat1`**: CVE-2025-66382 and CVE-2026-102633, 2 alerts. `python3.13` links the library as `pyexpat`, and `git-http-push` links it. A check in the image shows that `git filter-repo` loads neither `pyexpat` nor any `xml` module. No push goes over HTTP.
- **`libnghttp2-14`**: CVE-2026-58055, 1 alert. Installed for libcurl. The flaw is in the `nghttpx` proxy, which the image does not carry. Only `libcurl3t64-gnutls` links the library, as an HTTP/2 client for git's HTTP transports, which never run.
- **`libp11-kit0`**: CVE-2026-13757 and CVE-2026-18938, 2 alerts. Installed for GnuTLS. Both flaws are in p11-kit's RPC protocol, which only remote modules use. The image has no `/etc/pkcs11` and configures no module. Only `libgnutls` links the library, for git's HTTP transports, which never run. CVE-2026-18938 affects only 32-bit builds.
- **`libsqlite3-0`**: CVE-2026-50812 and CVE-2026-50813, 2 alerts. Both flaws are in the changesets of the Session extension. Python's `_sqlite3` links the library. `git filter-repo` never loads that module, and the module exposes no session API. `liblastlog2` links the library for `login`, which nothing runs.
- **PAM**: `libpam-modules`, `libpam-modules-bin`, `libpam-runtime`, and `libpam0g`. CVE-2026-54411, 4 alerts. Installed as part of Debian's base system. The flaw is in `pam_userdb`. The image carries it, but no `/etc/pam.d` file references it. The api authenticates nobody through PAM.
- **Perl**: `perl`, `perl-base`, `perl-modules-5.40`, and `libperl5.40`. CVE-2026-15534 and CVE-2026-19487, 8 alerts. Installed for `git`. Both flaws need an outside subject to reach a Perl regex, and one flaw needs a subject of 286 MB. No Perl program runs, because the git commands the api runs are C builtins.
- **Python**: `python3.13`, `python3.13-minimal`, `libpython3.13-stdlib`, and `libpython3.13-minimal`. CVE-2025-12781, CVE-2025-15366, CVE-2025-15367, CVE-2026-12345, CVE-2026-15806, CVE-2026-17084, CVE-2026-19672, and CVE-2026-87910, 32 alerts. Installed for `git filter-repo`. The flaws need `tempfile`, `tarfile`, `base64` or `binascii`, `urllib`, `imaplib`, `poplib`, `stringprep`, or `pyexpat`. A check in the image shows that importing `git_filter_repo` loads 81 modules and none of these.
- **systemd**: `libsystemd0` and `libudev1`. CVE-2026-15059, 2 alerts. The flaw is in the IPC API of `systemd-oomd`. `systemd-oomd` is not installed, and PID 1 is node.
- **`tar`**: CVE-2026-18477, CVE-2026-18508, and CVE-2026-5704, 3 alerts. Installed as part of Debian's base system. All three flaws need `tar` to extract a crafted archive. The api never runs `tar`.
- **util-linux**: the nine packages listed under _Assessed 24/09/2026_. CVE-2026-3184, 9 alerts. The flaw is in `login -h`, which a remote-login daemon calls. The image has no such daemon, and nothing runs `login`. The other eight packages hold none of that code.
- **`wget`**: CVE-2021-31879, CVE-2026-15146, CVE-2026-58469, and CVE-2026-58470, 4 alerts. Installed for the healthcheck. `wget` runs only as the healthcheck, which fetches `http://127.0.0.1:3000/health` to stdout. It follows no redirect that carries credentials. It uses no FTP, no Metalink, no `-c`, and no `Content-Range`.
- **`zlib1g`**: CVE-2026-27171 and CVE-2026-85091, 2 alerts. Installed as part of Debian's base system. Only Perl's `Compress::Raw::Zlib` imports `crc32_combine64`, and nothing loads it. Nothing imports `gzprintf` or `gzvprintf`. Node bundles its own zlib.

### `image-backup`

- **`curl` and `libcurl4t64`**: the ten CVEs listed for `libcurl3t64-gnutls` in `image-api`, 20 alerts. Installed for the ping. Only `/usr/bin/curl` links `libcurl4t64`. The jobs make one call, an HTTPS POST to the ping URL with `curl -fsS -m 10 --retry 3`, with one handle per run. The flaws need, in turn, HTTP/2 stream dependencies, Digest auth, Negotiate auth, TLS reuse across a multi handle with an OpenSSL provider config, the cookie engine, `--netrc`, a client certificate, a proxy, an application's `SOCKETFUNCTION` callback, and HTTP/3 with early data. The call uses none of them, and `backup-env` passes the jobs no proxy variable.
- **dash**: CVE-2026-102473 and CVE-2026-102474, 2 alerts. dash is Debian's `/bin/sh`, and the flaws are the ones described for `image-api`. dash runs only cron's two fixed job lines and the healthcheck's fixed line. Nothing globs a directory an attacker can write, and no outside data reaches dash's `printf`.
- **glibc**: `libc6` and `libc-bin`. The twelve CVEs listed for `image-api`, 24 alerts. Installed as part of Debian's base system.
  - No ELF file imports `ns_printrr`, `fp_nquery`, `wordexp`, or `strfmon`.
  - Only ncurses imports `tdelete`.
  - The jobs re-encode nothing. `git bundle` and `git push` pass bytes unchanged.
  - The image has no `nscd`. None of the 14 setuid or setgid files has an RPATH or RUNPATH. `ssh-keysign`, `ssh-agent`, and `crontab` are among those files.
  - No caller passes an outside `fopen` mode.
- **`golang.org/x/crypto` in `age` and `age-keygen`**: CVE-2026-56855 and CVE-2026-78662, 4 alerts. The module's fixed version is 0.56.0. `age` v1.3.2 builds with 0.55.0, and no `age` release carries the fix, so the alerts count as having no fix. Both flaws are denial-of-service bugs in the SSH connection code. `age` links `x/crypto/ssh` only to parse keys, through `ParsePublicKey`, `ParseAuthorizedKey`, and `ParseRawPrivateKey`. `age-keygen` links none of `x/crypto/ssh`.
- **`libacl1`**: CVE-2026-54370, 1 alert. The flaw is in `getfacl` and `setfacl`, which the image does not carry. Only `cp`, `install`, `mv`, `sed`, `tar`, `useradd`, `usermod`, and systemd's tools link the library, and the jobs run none of them.
- **`libattr1`**: CVE-2026-54371, 1 alert. The flaw is in `getfattr` and `setfattr`, which the image does not carry. Only `cp`, `install`, `mv`, `useradd`, and `usermod` link the library, and the jobs run none of them.
- **`libbz2-1.0`**: CVE-2026-42250, 1 alert. The flaw is in the `bzip2recover` tool, which the image does not carry. The library holds none of that code.
- **`libcurl3t64-gnutls`**: the ten CVEs listed for `image-api`, 10 alerts. Installed for `git`, and only git's HTTP transports link it. The jobs' git pushes to the mirror over SSH, never HTTP.
- **`libexpat1`**: CVE-2025-66382 and CVE-2026-102633, 2 alerts. Only `git-http-push` links the library, and the jobs' git pushes over SSH. `rclone` parses S3's XML in Go, without the library.
- **`libnghttp2-14`**: CVE-2026-58055, 1 alert. The flaw is in the `nghttpx` proxy, which the image does not carry. `libcurl4t64` and `libcurl3t64-gnutls` link the library only as an HTTP/2 client.
- **`libp11-kit0`**: CVE-2026-13757 and CVE-2026-18938, 2 alerts. As in `image-api`, the flaws are in the RPC protocol for remote modules, and the image configures no module. Only `libgnutls` links the library, for git's HTTP transports, which never run. CVE-2026-18938 affects only 32-bit builds.
- **`libsqlite3-0`**: CVE-2026-50812 and CVE-2026-50813, 2 alerts. Both flaws are in the changesets of the Session extension. Only `liblastlog2` links the library, for `login` and `lastlog2`, which nothing runs.
- **`openssh-client`**: CVE-2026-59995, CVE-2026-59996, CVE-2026-59997, CVE-2026-59998, CVE-2026-60001, CVE-2026-73282, and CVE-2026-73283, 7 alerts. Installed for the mirror push.
  - CVE-2026-59997, CVE-2026-59998, CVE-2026-60001, and CVE-2026-73283 are in `sshd`, which the image does not carry.
  - CVE-2026-59995 and CVE-2026-59996 are in `sftp` and `scp`. The package ships both, and `backup.sh` never runs them.
  - CVE-2026-73282 needs remote forwarding. The push runs `ssh -o BatchMode=yes` and `git push --mirror` with no `-R`. The image holds no ssh config beyond Debian's, and `/root/.ssh` holds only the mirror's key and `known_hosts`.
- **PAM**: the four packages listed for `image-api`. CVE-2026-54411, 4 alerts. Installed as part of Debian's base system. No `/etc/pam.d` file references `pam_userdb`. cron's PAM stack is `common-*`, `pam_env`, `pam_limits`, and `pam_loginuid`, and nothing authenticates a password.
- **Perl**: the four packages listed for `image-api`. CVE-2026-15534 and CVE-2026-19487, 8 alerts. Installed for `git` and `postgresql-common`. Perl runs only as `pg_wrapper`, behind `psql` and `pg_dump`. `pg_wrapper` matches its own fixed patterns against the job's arguments and config. No outside subject reaches a regex, and none comes near 286 MB.
- **systemd**: `systemd`, `libsystemd-shared`, `libsystemd0`, and `libudev1`. CVE-2026-15059, 4 alerts. The flaw is in the IPC API of `systemd-oomd`. Neither `systemd-oomd` nor `oomctl` is installed, and PID 1 is cron.
- **`tar`**: CVE-2026-18477, CVE-2026-18508, and CVE-2026-5704, 3 alerts. Installed as part of Debian's base system. All three flaws need `tar` to extract a crafted archive. `tar` runs only during the image build, on `age`'s pinned release. The jobs never run it.
- **util-linux**: the nine packages listed under _Assessed 24/09/2026_. CVE-2026-3184, 9 alerts. As in `image-api`, the flaw is in `login -h`, the image has no remote-login daemon, and nothing runs `login`.
- **`zlib1g`**: CVE-2026-27171 and CVE-2026-85091, 2 alerts. Installed as part of Debian's base system. Only Perl's `Compress::Raw::Zlib` imports `crc32_combine64`, and `pg_wrapper` never loads it. Nothing imports `gzprintf` or `gzvprintf`.

### `image-worker`

The venv holds 142 ELF files, and the `readelf` sweep read them too.

- **glibc**: `libc6`. The twelve CVEs listed for `image-api`, 12 alerts. No ELF file imports `ns_printrr`, `fp_nquery`, `wordexp`, `strfmon`, or `tdelete`. Only `libstdc++` imports `iconv_open`, and Python's codecs do not use it. No caller passes an outside `fopen` mode.
- **`libbz2-1.0`**: CVE-2026-42250, 1 alert. Installed for Python's `bz2`. The flaw is in the `bzip2recover` tool, and the image carries no binary except Python. The library holds none of that code.
- **`libsqlite3-0`**: CVE-2026-50812 and CVE-2026-50813, 2 alerts. Installed for Python's `sqlite3`. Both flaws are in the changesets of the Session extension. Only `_sqlite3` links the library, and Python's `sqlite3` module exposes no session or changeset API.
- **`libuuid1`**: CVE-2026-3184, 1 alert. The flaw is in `login -h`. The image has no `login`, and `libuuid1` holds none of that code.
- **`zlib1g`**: CVE-2026-27171 and CVE-2026-85091, 2 alerts. No ELF file in the image or the venv imports `crc32_combine64`, `crc32_combine_gen64`, `gzprintf`, or `gzvprintf`.

## Assessed 24/09/2026

This assessment covers every critical and high alert open on 24/09/2026. The medium alerts are under _Assessed 30/09/2026_.

The images read are the ones `build.yml` pushed for `c8ed108`. The scan read the images built for `85c40ae`, and no image's source changed between the two commits.

| Image | Digest |
| --- | --- |
| api | `sha256:0a9b161a…` |
| backup | `sha256:8dd3c0f6…` |
| worker | `sha256:0c138f7e…` |

142 alerts are dismissed: 69 in `image-api`, 69 in `image-backup`, and 4 in `image-worker`. One alert, CVE-2026-60002, is held open.

### `image-api`

- **util-linux**: `util-linux`, `mount`, `login`, `bsdutils`, `libmount1`, `libblkid1`, `libsmartcols1`, `liblastlog2-2`, and `libuuid1`. CVE-2026-76642, CVE-2026-78408, CVE-2026-78409, and CVE-2026-78410, 36 alerts. Installed as part of Debian's base system, and `libuuid1` also for `wget` and Python's `_uuid`.
  - Each flaw needs either a user mount that `/etc/fstab` authorises, through the setuid `mount` and its `X-mount.*` options, or a privileged operator who runs `nsenter --join-cgroup`.
  - The fstab is Debian's unconfigured stub, and nothing calls `mount` or `nsenter`.
  - No compose file adds a capability, so the container has no `CAP_SYS_ADMIN` to mount with.
- **`libacl1`**: CVE-2026-54369, 1 alert. Installed for coreutils, `sed`, `tar`, and `passwd`. The symlink flaw needs a privileged caller on a path an attacker controls. Only `cp`, `mv`, `install`, `sed`, `tar`, `useradd`, and `usermod` link the library, and the api runs none of them.
- **`libcurl3t64-gnutls`**: CVE-2026-8927, CVE-2026-8458, CVE-2026-8286, and CVE-2026-12064, 4 alerts. Installed for `git`. Only git's HTTP transports link the library: `git-remote-http`, `git-http-fetch`, `git-http-push`, and `git-imap-send`. The api's git never contacts a remote.
- **`libexpat1`**: CVE-2026-66046, CVE-2026-76956, CVE-2026-76957, and CVE-2026-93990, 4 alerts. Installed for `git` and Python. `python3.13` links the library as `pyexpat`, and `git-http-push` links it. `git filter-repo` imports no XML module, and no push goes over HTTP.
- **ncurses**: `ncurses-base`, `ncurses-bin`, `libtinfo6`, and `libncursesw6`. CVE-2025-69720, 4 alerts. Installed as part of Debian's base system and for Python's `_curses`. The overflow is in the `infocmp` tool, which nothing runs.
- **Perl**: `perl`, `perl-base`, `perl-modules-5.40`, and `libperl5.40`. CVE-2026-9538, 4 alerts. Installed for `git`. The flaw is in `Archive::Tar`. No Perl program runs, because the git commands the api runs are C builtins.
- **Python**: `python3.13`, `python3.13-minimal`, `libpython3.13-stdlib`, and `libpython3.13-minimal`. CVE-2026-82049, CVE-2026-15308, and CVE-2026-7210, 12 alerts. Installed for `git filter-repo`. The flaws need `tarfile`, `html.parser`, or `xml.parsers.expat` over crafted input. `git filter-repo` imports none of them.
- **systemd**: `libsystemd0` and `libudev1`. CVE-2026-16742, 2 alerts. Installed for `apt`, coreutils, util-linux, and PAM. The flaw is in `systemd-homed`, a separate Debian package that the image does not install. PID 1 is node.
- **`wget`**: CVE-2026-58472 and CVE-2026-58471, 2 alerts. Installed for the healthcheck. The flaws are in `--convert-links` and in naming a local file from the URL. The healthcheck fetches the api's own `/health` over the loopback, writes it to stdout, and converts nothing.

### `image-backup`

- **util-linux**: the nine packages and four CVEs listed for `image-api`, 36 alerts. Installed as part of Debian's base system. The same conditions are unmet. The fstab is the stub, nothing calls `mount` or `nsenter`, and the container has no `CAP_SYS_ADMIN`.
- **`libacl1`**: CVE-2026-54369, 1 alert. Installed for coreutils, `sed`, `tar`, `passwd`, and systemd. Only `cp`, `mv`, `install`, `sed`, `tar`, `useradd`, `usermod`, and systemd's tools link the library, and the jobs run none of them.
- **`curl` and `libcurl4t64`**: CVE-2026-8927, CVE-2026-8458, CVE-2026-8286, and CVE-2026-12064, 8 alerts. Installed for the ping. The jobs' one `curl` call is an HTTPS POST to the ping URL. Each flaw needs one of these: a proxy from the environment with Digest auth, Negotiate auth, a STARTTLS protocol, or a schemeless URL with `--proto-default sftp` or `scp`. The call uses none of them, and `backup-env` passes the jobs no proxy variable.
- **`libcurl3t64-gnutls`**: the same four CVEs, 4 alerts. Installed for `git`, and only git's HTTP transports link it. The jobs' git pushes over SSH.
- **`libexpat1`**: the four CVEs listed for `image-api`, 4 alerts. Installed for `git`. Only `git-http-push` links the library. `rclone` parses S3's XML in Go, without the library.
- **ncurses**: the four packages listed for `image-api`. CVE-2025-69720, 4 alerts. Installed as part of Debian's base system and for `procps`. The overflow is in `infocmp`, which nothing runs.
- **Perl**: the four packages listed for `image-api`. CVE-2026-9538, 4 alerts. Installed for `git` and `postgresql-common`. Perl runs only as `pg_wrapper`, behind `psql`, `pg_dump`, and `pg_dumpall`. `pg_wrapper` loads `POSIX`, `Socket`, and `IPC::Open3`, and never `Archive::Tar`.
- **systemd**: `systemd`, `libsystemd-shared`, `libsystemd0`, and `libudev1`. CVE-2026-16742, 4 alerts. `systemd` is installed as a dependency of `cron-daemon-common`. `systemd-homed` is not installed, and PID 1 is cron.
- **`openssh-client`**: CVE-2026-59999 and CVE-2026-60000, 2 of the package's 3 alerts. Installed for the mirror push. Both flaws are in `sshd`, which the image does not carry. The third alert, CVE-2026-60002, is held open.
- **`google.golang.org/grpc` in `rclone`**: CVE-2026-84445, 1 alert. The module has a fixed version, but no `rclone` release carries it, so the alert counts as having no fix. The panic is in the gRPC xDS server, `xds.NewGRPCServer`. The binary links 60 grpc packages and no xds package. `rclone` runs as an HTTP client with no listener.
- **`/etc/ssl/private/ssl-cert-snakeoil.key`**: a private key that the secret scan flags, 1 alert. `ssl-cert`, a dependency of `postgresql-common`, generates the key when the image is built. Nothing in the image serves TLS, and `psql` and `pg_dump` never read the key, so it authenticates nothing.

### `image-worker`

- **`libuuid1`**: the four util-linux CVEs listed for `image-api`, 4 alerts. Installed for Python's `_uuid`. The flaws are in `mount`, `libmount`, and `nsenter`, and `libuuid1` holds none of that code.
