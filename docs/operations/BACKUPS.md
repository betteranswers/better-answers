# Backups

This file lists each backup copy, its schedule and retention, and what restores it. The docs site does not render it. The private half, `.planning/estate/BACKUPS.md`, is outside the repository. It names the provider account, the buckets, the vault, the escrow holder, and the drill results. To back up your own deployment, use this file with `deploy/backup.sh`, `deploy/restore-drill.sh`, and `deploy/restore-production.sh`.

All times are UTC.

## The two buckets

Two buckets hold the copies. Both are off both IONOS boxes, in a UK or EU region, under a DPA with the UK addendum.

- **dumps** is versioned, with object lock in governance mode and the lifecycle tiers in the table below. The production host's credential can write and list, but cannot delete or bypass retention, so a compromised host cannot erase a copy. The escrowed admin credential can delete, to correct a mistake.
- **mirror** is versioned and has no lock. It expires non-current versions after 30 days, so that an erasure in the object store reaches the mirror.

`backup.sh` encrypts everything in `dumps/` with `age` before upload. The private half of the `age` identity is in escrow, and in a root-only file on VPC 2 for the unattended drill (`SECRETS.md` § The backup identity).

After each upload, the job checks the copy against the bucket. Then it writes a `backup` row (§ The `backup` rows) and pings its dead-man check. The ping body holds the outcome word and sizes, nothing else.

## Copied

| Store | What | How | Where | When | Retention | Personal data | Restored by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Postgres (Coolify resource) | `pg_dump --format=custom` of the database (`public`, `index`, Better Auth) and `pg_dumpall --globals-only` | `backup.sh hourly` in the `backup` service | `dumps/pg/<tier>/` | Hourly at `:05`. The 02:05 dump goes to the monthly tier on the 1st, the weekly tier on a Sunday, and the daily tier on other days. | Hourly 48 hours, daily 30 days, weekly 8 weeks, monthly **6 months** | Yes, including `suppression`, `erasure_request`, and findings | `pg_restore`. `restore-drill.sh` step 1. |
| Postgres (second writer) | Coolify's scheduled dump of the resource | Coolify, to its S3 storage | `dumps/coolify-pg/` | Daily | 30 days in Coolify. The bucket lifecycle governs. | Yes | Coolify's restore |
| The map (plain tables in Postgres) | `map_generation`, `map_node`, `map_edge` | Inside the Postgres dump | `dumps/pg/` | With every dump | Same as Postgres | Yes, source entities from redacted text | `pg_restore`. The map rebuild is a repair path, and the drill runs it monthly on one workspace. |
| Object store (uploads, normalised text) | Every bucket: the _mirror_ and _keep_ originals, and the redacted normalised text of _transient_ connected sources, for the map rebuild | `rclone sync` from the `backup` service, which also copies deletions | `mirror/objectstore/` | Nightly at 02:00 | Live, plus 30 days of non-current versions | Yes | `rclone sync` back. `restore-drill.sh` step 3. |
| Git store (`/data/git`, bare repositories) | One `git bundle --all` per workspace repository that holds a ref, verified, then encrypted | `backup.sh nightly`, with `/data/git` mounted read-only | `dumps/git/<workspace>/` | Nightly at 02:00 | 30 days of nightly bundles, plus the bundle from the 1st of each month for 6 months | Yes, including history from before a rewrite | `git clone --bare` from the bundle, run as the api's uid. A workspace that the restored database names but that has no bundle gets an empty repository. `restore-drill.sh` step 4. |
| Git store (second copy) | `git push --mirror` per repository that holds a ref | The `backup` service, over SSH to VPC 2's public IP with a deploy key (`GIT_MIRROR_SSH_TARGET`). The two VPCs have no private route. | VPC 2 `/data/mirror/<workspace>.git` | Nightly at 02:00, after the bundles | Live. After a push that replaced refs, the nightly job runs `reflog expire` and `git gc --prune=now` on the mirror. | Yes | `git clone` from VPC 2. Production never pulls from it. |
| Coolify itself | Its database and its env, encrypted with `APP_KEY`. Not `/data/coolify/ssh/keys/`, which is in escrow. | Coolify's instance backup | `dumps/coolify/` | Daily | 30 days | No customer data, only env | `RUNBOOK.md` § 5. The orchestrator is lost (VPC 2 rebuilt) |
| Drill reports | The log, staging's counts, the RTO and RPO, and the erasure rehearsal | `restore-drill.sh` | `dumps/drills/` | Monthly | 12 months | No, only a synthetic subject | Read them |

## Never backed up

| Store | Kind | Why not | Rebuilt by | Budget |
| --- | --- | --- | --- | --- |
| Worker LMDBs (`/data/worker/lmdb/<workspace>/<connected source id>`) | Personal data on disk | Memoised extraction output that can be thrown away, capped at 4 GB per connected source. Past the cap, the worker wipes it and reprocesses. | Reprocessing the connected source | The cost estimate prices it |
| Worker trees (`/data/worker/trees`) | Personal data on disk | Checkouts of the bare repositories at a commit | `git clone` from `/data/git`, mounted read-only | Minutes |
| `/data/backup/staging` | Personal data on disk | The local copy before upload. The job deletes it once the upload is verified, and each run deletes any file there older than 24 hours. | None | None |
| HF cache, embedding models | Rebuildable | Public model weights | Download again on the first warm-up | Minutes |
| Container logs | Rebuildable | stdout, rotated at 10 files of 20 MB per service. The DPIA states 30 days. | None | None |

## The retention schedule the erasure report quotes

The erasure routine writes four dates into its report, one per tier: hourly, daily, weekly, and monthly. Each date counts from the instant the routine took the erasure lock. The last dump that holds the subject is earlier than that instant, so each date is the latest that a copy can expire. A copy leaves the hourly tier within 48 hours, the daily tier within 30 days, the weekly tier within 8 weeks, and every tier within 6 months. The dates are certain because the host can delete nothing early and the lifecycle deletes on the day.

The bundles in `dumps/git/` follow the same dates. The bare repository and the VPC 2 mirror are clear by the first date. After a rewrite, the routine runs `git gc --prune=now` on the bare repository. The next nightly `git push --mirror` replaces the mirror's refs, and the deploy key's `prune-repo` command prunes the mirror.

The report says:

> "Backup copies taken before `<anchor>` are beyond use: restored only in a disaster, encrypted at rest, deletable only by the escrowed credential, expiring on `<hourly>` · `<daily>` · `<weekly>` · `<monthly>`. Should a restore from such a copy occur, this request is re-applied before the platform serves reads."

The last sentence is `pnpm ops replay-erasures --since <dump-at>`. Every restore runs it before `api` starts.

## Recovery order

Restore in this order. Do not start `api` before step 1 completes.

0. Restore every store. First restore Postgres from the latest dump, or from the dump the incident names. Then restore the object store from the mirror bucket. Then restore the git store from the nightly bundles.
1. **Replay every erasure completed after the dump.** All three stores must be back, and `api` must not be up.
2. Reconcile the bundle commit watermark against the heads in the git store, with the head-check reconciler.
3. Resync the map from git and records, with the estate rebuild.
4. Reconcile pipeline state. Every LMDB is empty, so connected sources reprocess from the object store.
5. List the object-store orphans, which are blobs with no catalogue row. Sweep them after the grace period.
6. Set again, by hand, every model key replaced since the dump (`RUNBOOK.md` § Set a workspace's model key). No script holds a model key, and the key in the dump still opens.

The replay in step 1 needs the restored stores, because the erasure routine rewrites bare repositories and reads replay copies in the object store. It runs on `api`. In `deploy/platform.compose.yaml`, `api` is the only service with the object store's settings and with `/data/git` mounted read-write (`GIT_STORE_DIR`). The worker mounts `/data/git` read-only.

## The restore scripts

`restore-drill.sh` follows the recovery order into staging on VPC 2 on the 1st of each month. Staging runs with production's memory caps (`coolify.md` § Boxes), so the drill's RTO is production's. The drill records the RTO and RPO, then wipes staging when it exits. In the drill, the erasure replay is step 5.

`restore-production.sh` follows the recovery order into production (`RUNBOOK.md` § 1. A box is down). In this script, the erasure replay is step 6 and is mandatory. The script sets no exit trap. It wipes no store except the database, which it replaces in one transaction.

`pnpm ops` reads table names from the schema. If a command answers "not built" after `migrate`, the restored copy lost a table, and the drill fails.

Production records no map counts. The drill's step 7 records staging's counts and compares them with nothing.

`restore-production.sh` writes no `audit_event` for a restore. Until the signals task adds one, the restore log is the record.

### The drill workspace

Steps 6 to 10 of the drill (rebuild, count, smoke test, rehearse) run on one workspace: `DRILL_WORKSPACE` in `/etc/better-answers/drill.env`. Every `pnpm ops` command refuses a workspace id that is not a ULID, so the drill checks the id and refuses it before step 0.

Until production holds a workspace worth rebuilding, `drill.env` names the synthetic fixture, `01M2SYNTHET1CAAAAAAAAAAAAA`. `deploy/seed-synthetic.sh --workspace-id` prints that id. No production dump holds the fixture, so drill step 5b seeds it into every restored copy, with its passage partition and an empty repository.

## The drill's erasure rehearsal at step 10, every third month

In March, June, September, and December, the drill proves on a synthetic subject that an erasure removes the subject. A restore cannot prove this. Each step depends on the step before it.

1. **Seed** the subject: an Admin member, one concept file that names them in one commit, and one bound document that names them by work address and name. The command refuses unless the document's index job is done within the drill's wait. Then it prints the tokens: email, address, and display name.
2. **`pg_dump`** the whole staging database to plain SQL, on the host.
3. **`dump-grep`** the dump and **find the tokens**. The index's passage table must be among the tables that hold them. If it is not, the later steps prove nothing about the index.
4. **Run the erasure routine** as the platform principal. The drill keeps the report the routine writes.
5. **`pg_dump` again**, whole.
6. **`dump-grep` again**, and confirm that the tokens are gone **from every table except two**.
7. **`git cat-file -e`** each commit the seed made. Each check must **fail**, because after `git filter-repo` and the prune those objects no longer exist.

Both dumps are whole, and `dump-grep` reports per table, so no excluded table can hide a token from step 6.

`subject_request` and `suppression` keep the subject's identifier set on purpose. A restore from an older dump uses them to create the suppressions again. The drill expects tokens in those two tables and records them. A token in any other table, or outside every `COPY` section, means a store was missed, and the drill stops. Both tables are restricted personal data, listed in the erasure map and covered by the retention dates above.

## The `backup` service's own failure modes

| Failure | Caught by |
| --- | --- |
| `/data/backup/staging` full | The job fails before upload and misses its ping. The disk signal fires at 80 %. |
| `pg_dump` and server version skew | The image installs PGDG's client for the database image's major version. A Dockerfile test holds the two equal, and the image probe runs `pg_dump --version`. |
| Bucket credential expired or rotated | `rclone` fails, so the job misses its ping. |
| Partial upload | `verify` compares sizes with the bucket before the job writes the row and pings. |
| Lifecycle misconfigured | The drill's step 9 lists the copies per tier, to compare with the table in § Copied. |
| The service itself down | Its healthcheck (cron running, no file older than 24 hours in `/staging`), and every missed ping. |
| A dump during the erasure routine | The routine holds `pg_advisory_lock(41)`. The hourly job skips while the lock is held. |
| A restored dump that predates an erasure | `replay-erasures --since` in every restore path. |
| A dump or mirror sync during a production restore | `restore-production.sh` stops the service before its first change. It restarts the service once `api` answers. If the run stops, the service stays stopped (`RUNBOOK.md` § 1. A box is down). |
| The mirror push fails (VPC 2 down, key rotated) | The nightly job fails, so it misses its ping. The bundles in `dumps/git/` do not depend on VPC 2. |
| A workspace repository refused as another user's | The image trusts `/data/git/*`. The image probe's nightly run bundles a repository that the api's uid owns. |
| A job started without its variables | The image probe. At run time, the job stops at its variable check, with no closing line and no ping. |
| A workspace not yet written to | `git bundle` and `git push --mirror` refuse a repository with no ref, so the nightly job skips it. A repository it cannot read still fails the job. A restore creates an empty repository from the workspace's row, because the api refuses a workspace without a repository as an unrestored store. The image probe's nightly runs include a repository with no ref and one with no HEAD. Its restore steps include a workspace with no bundle and a bucket with no bundles. |

## How the jobs run, and how to read the last one

cron gives a job `PATH=/usr/bin:/bin` and none of the container's variables. So `/etc/cron.d/backup` runs `backup.sh` through `backup-env` (`deploy/backup-env.sh`).

`backup-env` clears the environment it starts with. Then it reads the environment of PID 1, which only root can read. It passes on only `PATH`, `HOME`, and the names in the `backup` service's `environment:` block, and it writes no copy to disk. `TUNNEL_TOKEN`, `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`, and the other variables of the stores resource never reach a job. A test holds the list in `backup-env` equal to the compose block, so add a new variable to both.

To run a job the way cron does, run:

```sh
docker exec <backup container> /usr/local/bin/backup-env /usr/local/bin/backup.sh hourly
```

The nightly job verifies each bundle inside its own repository, because `git bundle verify` runs only inside a repository. The api's uid owns the repositories and the job runs as root, so the image's git config trusts `/data/git/*`. The mount is read-only.

Every run ends with one log line, which is also its ping body: `backup.sh hourly: ok bytes=<n> took=<seconds>`. A failed run writes `fail` in place of `ok`. If a run has no such line, it stopped before the ping, and the lines above it show where.

Other lines you can see:

- `erasure routine running — hourly dump skipped`. The hourly run skipped under the erasure lock and pinged nothing.
- rclone's `Config file … not found`, once per call. This is expected, because the remotes come from the environment.
- `backup row not written`, after an error from psql. The copy and the ping went ahead without their row (§ The `backup` rows).

A file left in `/staging` clears itself. Each run first deletes any file there older than 24 hours, such as a leftover `globals-…sql.age`. The healthcheck turns healthy at its next interval.

A red `pg-hourly` or `nightly` check also stops the nightly release at 02:35 (`CI.md` § `release.yml`, _The nightly backup_).

## The `backup` rows

Each script writes its `backup` row as the owner of the database resource, the role it already connects as. The stores stack's `DATABASE_URL` is the owner DSN, because a dump reads every table. The drill reaches production as `postgres`. `restore-production.sh` takes the owner DSN. No other role, including the api and the worker, has any privilege on the table.

A row is one run of one kind on one store. Its key is kind, store, and start instant.

| Kind | Written by | Store | When |
| --- | --- | --- | --- |
| `backup` | `backup.sh` | `postgres` hourly. `objectstore`, `git`, and `git-mirror` nightly. | After the job verifies the copy against the bucket, before the ping. `ok` with the copy's location and expiry, or `failed` with neither. |
| `drill` | `restore-drill.sh` | `all` | At the end of a drill that passed. Written to production, never staging, with the report and the RTO. |
| `restore` | `restore-production.sh` | `postgres`, plus `objectstore` and `git` when the run restored them | After the `backup` service restarts at the end. Written into the restored and migrated database, with the dump and the RTO. |

If a script cannot write its row, the run goes on. The ping and the exit status do not change, and the script logs `backup row not written`.

A failed drill writes no row. Its failed ping is the record. A restore that stops early writes no row, because the database may not be restored yet.

If `restore-production.sh` cannot write its row, it logs the statement it tried. Run that statement by hand once the database answers. It inserts nothing if the row already exists.

## Putting a new backup image on production

`release.yml` promotes the api and worker digests, but never the backup image. After `build.yml` pushes a new backup image:

1. Copy the backup digest from the run summary of `build.yml` (`ghcr.io/betteranswers/backup@sha256:…`).
2. In the orchestrator, set `BACKUP_IMAGE_DIGEST` to that digest in the environment of the stores resource.
3. Redeploy the stores stack.

To confirm the change:

1. Confirm that the `backup` container runs the new digest.
2. Confirm that its first run at `:05` logs `backup.sh hourly: ok …` and turns `pg-hourly` green.
3. Confirm that its first run at 02:00 does the same for `nightly`.

## Signals

The signals task (ticket 42) adds the signal lines. They read the `backup` rows:

`backup(kind ∈ backup · drill · restore, store, started_at, finished_at, outcome, bytes, location, report_url, contains_personal_data, expires_at, rto_minutes)`

The alerts are:

- A missed or failed ping for each job: scheduler, `pg-hourly`, `nightly`, drill, Coolify instance backup, and staging-wiped. `pg-hourly`, `nightly`, and drill also alert the second channel. A weekly all-green digest tells silence apart from health.
- The two paths of the uptime check (`coolify.md` § Ingress).
- Disk use under `/data` above 80 %.
- A store whose last backup is older than its period.
- A last drill older than 35 days.
- A worker `image_digest` that differs from the released one.

**Growth step A** triggers when either signal holds for five minutes:

- The swap-in rate `pswpin` is above 4 MB/s.
- `MemAvailable` on VPC 1 is below the page-cache floor of 512 MB.

`coolify.md` § Memory sums the memory limit of every service.
