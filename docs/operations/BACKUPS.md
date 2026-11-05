# Backups, one line per store

Operational reference, not rendered by the docs site. This public half lists each copy, its schedule and retention, and what restores it. `.planning/estate/BACKUPS.md`, outside the repository because a public estate map helps only an attacker, names the provider account, buckets, vault, escrow holder, and drill results. To back up your own deployment, use this file with `deploy/backup.sh`, `deploy/restore-drill.sh`, and `deploy/restore-production.sh`.

Two off-host buckets outside both IONOS boxes, in a UK or EU region under a UK-addendum DPA, hold the copies:

- **dumps** is versioned, with governance-mode object lock and the lifecycle tiers below. The production host's credential can write and list but never delete or bypass retention, so a compromised host cannot erase history. The escrowed admin credential can, so a human can correct a mistake.
- **mirror** is versioned and unlocked, and expires non-current versions after 30 days, because erasure removes personal data from the object store and deletions must propagate.

Everything in `dumps/` is `age`-encrypted client-side before upload. The identity's private half is in escrow and, for the unattended drill, in a root-only file on VPC 2 (`SECRETS.md` § The backup identity). Every job verifies the upload against the bucket, writes a `backup` row (§ The `backup` rows), then pings the dead-man check with the outcome word and sizes only.

## Copied

| Store | What | How | Where | When | Retention | Personal data | Restored by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Postgres (Coolify resource) | `pg_dump -Fc` and `pg_dumpall -g`: `public`, `index`, Better Auth | `backup.sh hourly` in the `backup` service, age-encrypted | `dumps/pg/<tier>/` | Hourly. The 02:05 dump files as daily, weekly (Sunday), and monthly (1st). | hourly 48 h, daily 30 d, weekly 8 w, monthly **6 m** | Yes, with `suppression`, `erasure_request`, findings | `pg_restore`, `restore-drill.sh` step 1 |
| Postgres (second writer) | Coolify's scheduled dump of the resource | Coolify, to its S3 storage | `dumps/coolify-pg/` | Daily | 30 d in Coolify, but the bucket lifecycle governs | Yes | Coolify's restore |
| The map (plain tables inside Postgres) | `map_generation`, `map_node`, `map_edge` | In the Postgres dump | `dumps/pg/` | With every dump | As Postgres | Yes, source entities from redacted text | `pg_restore`. The rebuild is a repair path, drilled monthly on one workspace. |
| Object store (uploads, normalised text) | Every bucket: *mirror* and *keep* originals, and *transient* connected sources' redacted normalised text for the map rebuild | `rclone sync` from the `backup` service, propagating deletions | `mirror/objectstore/` | Nightly 02:00 | Live, plus 30 d of non-current versions | Yes | `rclone sync` back, step 3 |
| Git store (`/data/git`, bare repositories) | One verified `git bundle --all` per workspace repository holding a ref, age-encrypted | `backup.sh nightly`, reading `/data/git` read-only | `dumps/git/<workspace>/` | Nightly 02:00 | 30 d of nightlies, plus each first of the month for 6 m | Yes (history before a rewrite) | `git clone <bundle>` as the api's uid from its own directory, plus an empty repository per bundle-less workspace the restored database names. Step 4. |
| Git store (second copy) | `git push --mirror` per repository holding a ref | The `backup` service, over SSH to VPC 2's public IP with a deploy key (`GIT_MIRROR_SSH_TARGET`), as the VPCs have no private route | VPC 2 `/data/mirror/<workspace>.git` | Nightly 02:00, after the bundles | Live, with `reflog expire` and `git gc --prune=now` run by the nightly job after a push that replaced refs | Yes | `git clone` from VPC 2. Production never pulls from it. |
| Coolify itself | Its database and `APP_KEY`-encrypted env, not `/data/coolify/ssh/keys/` (escrowed) | Coolify's instance backup | `dumps/coolify/` | Daily | 30 d | No customer data (env only) | `RUNBOOK.md` page 5 |
| Drill reports | Log, staging's counts, RTO and RPO, erasure rehearsal | `restore-drill.sh` | `dumps/drills/` | Monthly | 12 m | No (synthetic subject only) | Read |

## Never backed up

| Store | Kind | Why not | Rebuilt by | Budget |
| --- | --- | --- | --- | --- |
| Worker LMDBs (`/data/worker/lmdb/<workspace>/<connected source id>`) | Personal data on disk | Disposable memoised extraction output, capped at 4 GB per connected source, wiped and reprocessed over it | Reprocessing the connected source | Priced by the cost estimate |
| Worker trees (`/data/worker/trees`) | Personal data on disk | Checkouts of the bare repositories at a commit | `git clone` from `/data/git` (mounted read-only) | Minutes |
| `/data/backup/staging` | Personal data on disk | The local copy before upload, deleted on verified upload. The next job deletes anything older than 24 h. | None | None |
| HF cache, embedding models | Rebuildable | Public model weights | Re-download on first warm | Minutes |
| Container logs | Rebuildable | stdout, rotated at 10 × 20 MB per service. The DPIA states 30 days. | None | None |

## The retention schedule the erasure report quotes

ADR 0020 defines the erasure routine and its report. The three dates run from the last dump before the rewrite, the last copy to hold the subject, not from the request. It leaves the hourly tier within 48 hours, the daily within 30 days, the weekly within 8 weeks, and every copy within six months.

The bundles and the VPC 2 mirror follow the same dates. After a rewrite the routine runs `git gc --prune=now` on the bare repository, and the next nightly `git push --mirror` replaces the mirror's refs and prunes it through the deploy key's `prune-repo` verb, so both are clear within the first of the four dates. Object lock makes the dates certain, since the host deletes nothing earlier and the lifecycle deletes on the day.

The report's wording:

> *"Backup copies taken before <last-dump-at> are beyond use: restored only in a disaster, encrypted at rest, deletable only by the escrowed credential, expiring on <hourly> · <daily> · <weekly> · <monthly>. Should a restore from such a copy occur, this request is re-applied before the platform serves reads."*

The last clause is `pnpm ops replay-erasures --since <dump-at>`, which the restore runs before `api` turns healthy.

## Recovery order

0. Restore every store before the api starts: Postgres from the latest dump (or the one the incident names), then the object store from the mirror bucket, then the git store from the nightly bundles.
1. **Replay every erasure completed after the dump**, with the three stores back and `api` not yet up.
2. Reconcile the bundle commit watermark against the git store's heads (the head-check reconciler).
3. Resync the map from git and records (the estate rebuild).
4. Reconcile pipeline state. Every LMDB is wiped, and connected sources reprocess from the object store.
5. List the object-store orphans, blobs with no catalogue row, and sweep them after the grace period.
6. Set again, by hand, every model key replaced since the dump (`RUNBOOK.md` § Set a workspace's model key). No script holds one, and the dump's earlier key opens cleanly.

**The replay waits for the stores**, because its routine rewrites bare repositories and reads replay copies in the object store. It runs on `api`, the only service in `deploy/platform.compose.yaml` with both stores' settings: `GIT_STORE_DIR`, `/data/git` mounted, and the object store's endpoint, bucket, region, and credentials.

`restore-drill.sh` replays this order into staging on VPC 2 on the 1st of each month, with production's caps (`coolify.md` § Boxes) so its RTO is production's, records RTO and RPO, and wipes staging. `restore-production.sh` replays it into production (`RUNBOOK.md` page 1), with step 1 mandatory, no trap, and no wipe beyond the database it replaces in one transaction. `pnpm ops` reads table names from the schema, so a "not built" answer after `migrate` means the restored copy lost a table and fails the drill. Production records no map counts, so the drill's step 7 records staging's without comparing. A restore anywhere is an `audit_event` (*restore*, by whom, from which copy) on the System page.

**The workspace the drill works on** in steps 6 to 10 (rebuild, count, smoke test, rehearse) is `DRILL_WORKSPACE` in `/etc/better-answers/drill.env`. Every `pnpm ops` command refuses a non-ULID id, so the drill refuses one before step 0. Until production holds a workspace worth rebuilding, `drill.env` names the synthetic fixture's `01M2SYNTHET1CAAAAAAAAAAAAA` (`deploy/seed-synthetic.sh --workspace-id`), which step 5b seeds into every restored copy with its passage partition and an empty repository, since no production dump holds it.

## The drill's erasure rehearsal at step 10, every third month

Every third month the drill proves on a synthetic subject that an erasure erased, which a restore cannot. Each step rests on the one before:

1. **Seed** the subject (an Admin member, one concept file naming them in one commit, one bound document naming them by work address and name). The command refuses unless the document's index job ends done within the drill's wait, then prints the tokens (email, address, display name).
2. **`pg_dump`** the whole staging database to plain SQL, on the host.
3. **`dump-grep`** the dump and **find the tokens, the index's passage table among the tables holding them**. Otherwise the later steps, and step 6 for the index, prove nothing.
4. **Run the routine** under the platform principal, writing the report the drill keeps.
5. **`pg_dump` again**, whole.
6. **`dump-grep` again**, and find the tokens gone **from every table but two**.
7. **`git cat-file -e`** each commit the seed made, which must **fail**. After `git filter-repo` and the prune, the objects no longer exist.

**Both dumps are whole, and the grep reports per table**, so no excluded table hides what step 6 checks. **`subject_request` and `suppression` keep the subject's identifier set by design**, for a restore from an older dump to re-create the suppressions (the routine's steps 6 and 10). Tokens there are expected and recorded. Tokens anywhere else, or outside every `COPY` section, mean a missed store and stop the drill. Both tables are restricted personal data, in the erasure map and under the retention dates above.

## The `backup` service's own failure modes

| Failure | Caught by |
| --- | --- |
| `/data/backup/staging` full | The job fails before upload and misses its ping. The disk signal fires at 80 %. |
| `pg_dump` and server version skew | The image installs PGDG's client for the database image's major, held by a Dockerfile test and the image probe's `pg_dump --version`. |
| Bucket credential expired or rotated | `rclone` fails, so the ping is missed. |
| Partial upload | `verify` compares sizes against the bucket before the row and the ping. |
| Lifecycle misconfigured | The drill's step 9 lists copies per tier against this matrix. |
| The service itself down | Its healthcheck (cron alive, nothing stale in `/staging`), and every missed ping. |
| A dump during the erasure routine | The routine holds `pg_advisory_lock(41)`, and the hourly job skips while it is held. |
| A dump or mirror sync during a production restore | `restore-production.sh` stops the service before its first change and restarts it once `api` answers, unless the run stops (`RUNBOOK.md` page 1). |
| The mirror push fails (VPC 2 down, key rotated) | The nightly job fails, so the ping is missed. The bundles in `dumps/git/` do not depend on VPC 2. |
| A job started without its variables | The image probe. At run time the job stops at its variable check, without a closing line or ping. |
| A workspace not yet written to | `git bundle` and `git push --mirror` refuse its ref-less repository, so the nightly job skips it, though an unreadable repository still fails the job. A restore recreates it empty from the workspace's row, since the api refuses a workspace without one as an unrestored store. |

## How the jobs run, and how to read the last one

**cron hands a job `PATH=/usr/bin:/bin` and none of the container's variables**, so `/etc/cron.d/backup` runs `backup.sh` through `backup-env` (`deploy/backup-env.sh`). It reads PID 1's environment as root and passes on only the `backup` service's `environment:` names, `PATH`, and `HOME`, writing no copy. `TUNNEL_TOKEN`, `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`, and the stores resource's other variables never reach a job. A test holds `backup-env`'s list equal to the compose block, so add a new variable to both. To run a job as cron does, run `docker exec <backup container> /usr/local/bin/backup-env /usr/local/bin/backup.sh hourly`.

**The nightly bundle is verified inside its own repository**, the only place `git bundle verify` runs. The image's git config trusts `/data/git/*`, which the api's uid owns while the job runs as root. The mount is read-only.

**Every run ends with one log line**, its ping's body: `backup.sh hourly: ok bytes=<n> took=<seconds>`, or `fail` for `ok`. A run without it stopped before pinging, and the lines above say where. An hourly run skipped under the erasure lock logs the skip and pings nothing. rclone's `Config file … not found`, once per call, is expected, because the remotes come from the environment. A `backup row not written` line after psql's error means the copy and ping went ahead without their record (§ The `backup` rows).

**A file left in `/staging` clears itself**, because each run first deletes anything there older than 24 hours, such as a leftover `globals-…sql.age`. The health check then turns healthy at its next interval.

A red `pg-hourly` or `nightly` check also stops the 02:35 UTC nightly release (`CI.md` § `release.yml`, *The nightly backup*).

## The `backup` rows

Every script writes its `backup` row as the database resource's owner, its existing role (`postgres` for the drill). So the stores stack's `DATABASE_URL` is the owner DSN, and `restore-production.sh` takes the owner DSN. No other role, the api and worker included, has any privilege on the table. A row is one run of one kind on one store, keyed by kind, store, and start instant.

| Kind | Written by | Store | When |
| --- | --- | --- | --- |
| `backup` | `backup.sh` | `postgres` hourly, and `objectstore`, `git`, and `git-mirror` nightly | After the copy is verified against the bucket, before the ping. `ok` with where the copy went and when it expires, or `failed` with neither. |
| `drill` | `restore-drill.sh` | `all` | At the end of a drill that passed, to production, never staging, with the report and the RTO |
| `restore` | `restore-production.sh` | `postgres`, plus `objectstore` and `git` when restored | Once the `backup` service restarts at the end, into the restored and migrated database, with the dump and the RTO |

A row that cannot be written never stops its run or changes its ping or exit status. The script logs `backup row not written` and goes on. A failed drill writes no row, and its failed ping is the record. A restore that stops early writes none, since the database may not be restored yet. `restore-production.sh` logs the statement it tried. Run it by hand once the database answers. It inserts nothing if the row exists.

## Putting a new backup image on production

`release.yml` promotes the api and worker digests, never the backup image. After `build.yml` pushes a new one:

1. Copy the backup digest from `build.yml`'s run summary (`ghcr.io/betteranswers/backup@sha256:…`).
2. In the orchestrator, set `BACKUP_IMAGE_DIGEST` to it in the stores resource's environment.
3. Redeploy the stores stack.

To check, confirm the `backup` container runs the new digest, its first `:05` run logs `backup.sh hourly: ok …` and pings `pg-hourly` green, and the first 02:00 run does the same for `nightly`.

## Signals

The signal lines, landing with ticket 42's signals task, read the `backup` rows:

`backup(kind ∈ backup · drill · restore, store, started_at, finished_at, outcome, bytes, location, report_url, contains_personal_data, expires_at, rto_minutes)`

The alerts:

- A missed or failed ping per job: scheduler, pg-hourly, nightly, drill, Coolify instance backup, staging-wiped. `pg-hourly`, `nightly`, and `drill` alert the second channel, and a weekly all-green digest tells silence from health.
- The uptime check's two paths (`coolify.md` § Ingress).
- Disk under `/data` above 80 %.
- A store's last backup older than its period.
- The last drill older than 35 days.
- The worker's `image_digest` differing from the released one.

**Growth step A** triggers when, for five minutes, the swap-in rate `pswpin` is above 4 MB/s, or `MemAvailable` on VPC 1 is below the 512 MB page-cache floor. `coolify.md` § Memory sums every service's limit.
