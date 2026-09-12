# Backups — one line per store

**Operational reference, not a page of the docs site.** This file lives in `docs/operations/` because that is where the operational documents are kept; the docs site does not render it, and it is read from the repository.

**This is the public half.** It states *which copies exist*, *on what schedule*, *how long each is kept* and *what restores each one*. The estate's own half — the provider account, the buckets and the vault as they are actually named, who holds the escrowed identity, and the recorded drill results — is **not published**: it is `.planning/estate/BACKUPS.md`, outside the repository, because a public operational map of a running estate helps only an attacker (ADR 0027, ticket 79 Q10; ticket 77's acceptance line). Everything a reader needs to back up *their own* deployment is here and in `deploy/backup.sh`, `deploy/restore-drill.sh` and `deploy/restore-production.sh`.

The matrix ADR 0007 asked for, decided by ticket 41 (ADR 0022) and resized by ticket 74 (ADR 0024). Two off-host buckets outside both IONOS boxes, UK or EU region under a UK-addendum DPA (ticket 41 Q5; provider: `research/41-object-store-and-bucket.md`):

- **dumps** — versioned, **object lock in governance mode**, lifecycle tiers below. The production host's credential can write and list, never delete, never bypass retention; the escrowed admin credential can. A compromised host cannot erase its history; a human can correct a mistake.
- **mirror** — versioned, **no lock**, 30-day expiry of non-current versions: deletions must propagate, because the object store holds personal data that erasure removes (ADR 0020).

Everything in `dumps/` is **client-side encrypted with `age`** before upload; the private half lives in escrow and, for the unattended drill, in a root-only file on VPC 2 — with the consequence `SECRETS.md` § The backup identity states. Every job: verify the upload against the bucket, write a `backup_run` row (the System screen reads it — ticket 42), then ping the dead-man check with the outcome word and sizes only.

## Copied

| Store | What | How | Where | When | Retention | Personal data | Restored by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Postgres (Coolify resource) | `pg_dump -Fc` + `pg_dumpall -g`: `public`, `index`, Better Auth | the `backup` service (`backup.sh hourly`), age-encrypted | `dumps/pg/<tier>/` | every hour; 02:05 files as daily / weekly (Sun) / monthly (1st) | hourly 48 h · daily 30 d · weekly 8 w · monthly **6 m** | yes — incl. `suppression`, `erasure_request`, findings | `pg_restore` — `restore-drill.sh` step 1 |
| Postgres (second writer) | Coolify's own scheduled dump of the resource | Coolify → its S3 storage | `dumps/coolify-pg/` | daily | 30 d (Coolify's one number; the bucket lifecycle is the truth) | yes | Coolify's restore |
| Object store (uploads, normalised text) | every bucket — originals under *mirror*/*keep*, and the *transient* bindings' redacted normalised text the graph rebuild needs (53 Q8) | `rclone sync` from the `backup` service — deletions propagate | `mirror/objectstore/` | nightly 02:00 | live + 30 d of non-current versions | yes | `rclone sync` back — step 3 |
| Git store (`/data/git`, bare repositories) | one verified `git bundle --all` per workspace repository, age-encrypted | `backup.sh nightly` reading `/data/git` read-only | `dumps/git/<workspace>/` | nightly 02:00 | 30 d of nightlies + first-of-month for 6 m | yes (history before a rewrite) | `git clone <bundle>` — step 4 |
| Git store (second copy) | `git push --mirror` per repository | the `backup` service over SSH to VPC 2's public IP under a deploy key (`GIT_MIRROR_SSH_TARGET`; the two VPCs do not route privately) | VPC 2 `/data/mirror/<workspace>.git` | nightly 02:00, after the bundles | live; `reflog expire` and `git gc --prune=now` on the mirror by the nightly job, after any push that replaced refs | yes | `git clone` from VPC 2 — never pulled *from* by production |
| Coolify itself | its database and the `APP_KEY`-encrypted env — **not** `/data/coolify/ssh/keys/` (escrowed) | Coolify's instance backup | `dumps/coolify/` | daily | 30 d | no client data (env only) | `RUNBOOK.md` page 5 |
| Drill reports | log, counts diff, RTO/RPO, erasure rehearsal | `restore-drill.sh` | `dumps/drills/` | monthly | 12 m | no (synthetic subject only) | read |

## Never backed up

| Store | Kind | Why not | Rebuilt by | Budget |
| --- | --- | --- | --- | --- |
| The graph (plain tables inside Postgres, ADR 0032) | copied | rides the Postgres dump above — no separate job | `dumps/pg/` | with every dump | as Postgres | yes — source entities from redacted text | `pg_restore`; the rebuild is a repair path, drilled monthly on one workspace |
| Worker LMDBs (`/data/worker/lmdb/<binding>`) | **personal data on disk** | memoised extraction output; disposable by design (`[PIPE1]`, ADR 0005); capped at 4 GB per binding, wiped and reprocessed over it | reprocessing the binding | priced by the extraction plan |
| Worker trees (`/data/worker/trees`) | personal data on disk | checkouts of the bare repositories at a commit | `git clone` from `/data/git` (mounted read-only) | minutes |
| `/data/backup/staging` | personal data on disk | the local copy before upload — deleted on verified upload; anything older than 24 h is deleted by the next job | — | — |
| HF cache, embedding models | rebuildable | public model weights | re-download on first warm | minutes |
| Container logs | rebuildable | stdout, rotated at 10 × 20 MB per service — the DPIA states 30 days | — | — |

## The retention schedule the erasure report quotes (ADR 0020)

The three dates are computed **from the timestamp of the last dump before the rewrite**, not from the request: that copy is the last that holds the subject. It leaves the hourly tier within 48 hours, the daily within 30 days, the weekly within 8 weeks and every copy within **six months**. The nightly bundles and the VPC 2 mirror follow the same dates; after a rewrite the routine runs `git gc --prune=now` on the bare repository, and the next nightly `git push --mirror` replaces the mirror's refs and then prunes the mirror through the deploy key's `prune-repo` verb (ADR 0024, amended 11/09/2026), so neither copy keeps the old objects and both are clear within the first of the four dates. Object lock (governance) makes the dates certain: nothing is deleted earlier by the host, and the lifecycle deletes on the day. The report's wording: *"Backup copies taken before <last-dump-at> are beyond use: restored only in a disaster, encrypted at rest, deletable only by the escrowed credential, expiring on <hourly> · <daily> · <weekly> · <monthly>. Should a restore from such a copy occur, this request is re-applied before the platform serves reads."* The last clause is `pnpm ops replay-erasures --since <dump-at>`, run by the restore before `api` turns healthy.

## Recovery order (ADR 0007)

0. The stores, in this order and all of them before the app is started: Postgres from the latest dump (or the one the incident names), then the object store from the mirror bucket, then the git store from the nightly bundles.
1. **Replay every erasure completed after the dump** — after the three stores are back and before `api` is up.
2. Reconcile the bundle commit watermark against the git store's heads — the head-check reconciler.
3. Resync the graph from git and records (the estate rebuild).
4. Reconcile pipeline state: every LMDB is wiped; bindings reprocess from the object store.
5. Object-store orphans: blobs with no catalogue row are listed, then swept after the grace.

**Why the replay waits for the stores** (11/09/2026, ADR 0022 amended): the routine it re-runs rewrites each workspace's bare repository and reads the replay copy every erasure left in the object store, so a replay that ran beside `migrate` — where both scripts ran it until this date — either found no copy to read or rewrote a repository the git step was about to overwrite from a bundle that still named the subject. It runs on the `api` service rather than `migrate`, because that is the one service in `deploy/platform.compose.yaml` carrying `GIT_STORE_DIR` with `/data/git` mounted and the object store's endpoint, bucket, region and credentials.

`restore-drill.sh` replays exactly this into staging on VPC 2 on the first of every month, records RTO and RPO, and ends by wiping staging. **`restore-production.sh` replays it into production** (`RUNBOOK.md` page 1): the same order, step 1's replay mandatory, no wipe and no trap. Every step that needs a slice not yet built says so through its `pnpm ops` command's exit code (`apps/api/src/ops.ts`), so a drill before the graph exists records "not built" and never a false green. A restore anywhere is an `audit_event` (*restore*: by whom, from which copy) on the System screen.

## The drill's erasure rehearsal — step 10, every third month (ADR 0020, 0022)

A backup that restores proves the platform comes back. It does not prove that an erasure erased, which is the one claim a restore path cannot make for itself, so every third month the drill makes it on a synthetic subject, in **seven steps that each rest on the one before**:

1. **Seed** the synthetic subject — a person, an Admin membership and one concept file naming them, in one commit. The command prints the subject's tokens (email, address, display name) on its last line.
2. **`pg_dump`** the whole staging database to plain SQL, on the host.
3. **`dump-grep`** that dump for the tokens and **find them**. If they are not there the seed did not do what it says, and every step below would prove nothing.
4. **Run the routine**, under the platform principal, writing the report the drill keeps.
5. **`pg_dump` again**, the same database, whole.
6. **`dump-grep` again** and find them gone — **from every table but two**.
7. **`git cat-file -e`** on each commit the seed made, which must now **fail**: after `git filter-repo` and the prune the old objects are not merely unreferenced, they are not there to read.

**Both dumps are taken whole, and the grep reports per table.** A dump with tables excluded is not the copy a restore would use, and an exclusion would hide the very rows step 6 is about. After the routine the honest reading is not *absent everywhere*: **`subject_request` and `suppression` keep the subject's identifier set by design** — a restore from a dump older than the request has to re-create the suppressions from that set (the routine's steps 6 and 10), so a post-erasure dump that did not hold it would make the erasure unrepeatable. Present in those two is expected and recorded; present in any other table, or outside every `COPY` section, is the erasure having missed a store and stops the drill. Both tables are restricted personal data of the same class as the rest, in the erasure map and covered by the retention dates above.

## Boxes (ADR 0024)

Two boxes of 4 vCPU · 4 GB · 120 GB NVMe. VPC 1 runs all of production — the worker capped at 1.5 GB, one index at a time, `shared_buffers` 512 MB, a 4 GB swap file as the safety net. VPC 2 runs Coolify, the git mirror and the restore target; **staging is on demand** — brought up from the same two compose files for a drill or a rehearsal and wiped after, never standing. The drill restores onto VPC 2 with the same caps as production, so its RTO is the number production would see.

## The `backup` service's own failure modes

| Failure | Caught by |
| --- | --- |
| `/data/backup/staging` full | the job fails before upload → missed ping; the 42 disk signal at 80 % |
| `pg_dump` / server version skew | the backup image is built FROM the database image — same major, always |
| bucket credential expired or rotated | `rclone` fails → missed ping |
| partial upload | `verify` compares sizes against the bucket before the row and the ping |
| lifecycle misconfigured | the drill's step 9 lists copies per tier against this matrix |
| the service itself down | its healthcheck (cron alive, nothing stale in `/staging`); every check's missed ping |
| a dump during the erasure routine | the routine holds `pg_advisory_lock(41)`; the hourly job skips while it is held |
| a dump restored that predates an erasure | `replay-erasures --since` in every restore path |
| the mirror push fails (VPC 2 down, key rotated) | `git push --mirror` fails → the nightly job fails → missed ping; the bundles in `dumps/git/` are the copy that does not depend on VPC 2 |

## Signals (for ticket 42)

`backup_run(id, kind ∈ backup · drill, store, started_at, finished_at, outcome, bytes, location, report_url, contains_personal_data, expires_at, rto_minutes)` — the table lands with ticket 42's signals task; until then `backup.sh` and the drill say "row not written" and carry on, and the pings are the record. Alerts: a missed or failed ping per job (scheduler, pg-hourly, nightly, drill, Coolify instance backup, staging-wiped) — `pg-hourly`, `nightly` and `drill` on the **second channel**, with a weekly all-green digest so silence is distinguishable from health; the uptime check's two paths (`coolify.md` § Ingress); disk under `/data` above 80 %; last backup per store older than its period; last drill older than 35 days; worker `image_digest` ≠ the released one. **Growth step A has two triggers** (ADR 0024): the swap-in rate (`pswpin` above 4 MB/s for five minutes) and the **page-cache floor** — `MemAvailable` on VPC 1 below 512 MB for five minutes, with every service's limit summed in `coolify.md` § Memory.
