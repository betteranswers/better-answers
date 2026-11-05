# Runbook

This file has thirteen incident pages, then the procedures an operator runs by hand. The docs site does not render it.

**This file is the public half.** The private half is `.planning/estate/RUNBOOK.md`, outside the repository, beside `.planning/estate/SECRETS.md` and `.planning/estate/coolify.md`. It holds the provider console, the host paths, the named credentials to rotate, the addresses, the names behind each escalation contact, and the recorded results. Run an incident from the private copy. `SECRETS.md` covers secrets and rotation, `BACKUPS.md` covers the copies, and `coolify.md` covers the deployment.

**Escalation contacts.** Each page names a role: the technical contact, the second escrow holder, or the customer's named contact. The private file's § Contacts maps each role to a person and a number, and is reread at every quarterly erasure rehearsal. If a contact cannot be reached within the page's time, escalate to the second escrow holder, who can open the vault and step in.

The estate is two 4 GB boxes. VPC 1 is production. VPC 2 holds the orchestrator, the git mirror, and a restore target. Staging exists only while someone has brought it up.

## 1. A box is down

**Fires.**

- The uptime check on the product's two paths goes red (`coolify.md` § Ingress). During development it alerts by email (page 7).
- The scheduler's dead-man check misses, for VPC 1 (page 12).
- For VPC 2 on Pro, nothing fires within the hour. Only the daily `coolify-backup` ping and the monthly `drill` ping watch it, so an outage shows within a day. On Free, the uptime probe runs from VPC 2 (`deploy/uptime-probe.sh`), so its `uptime` check goes silent within ten minutes.

**Do.**

1. Read the server's status in the provider's console.
2. If VPC 2 is down, reinstall the orchestrator at the pinned version and restore its instance backup (page 5). Stop.
3. If VPC 1 is down and its disk is intact, reboot it. The stacks are `restart: unless-stopped`, and the orchestrator shows them healthy within minutes. Stop.
4. If VPC 1's disk is gone, make a new box and run `deploy/host-setup.sh vpc1` on it. It creates `/data`, the swap file, the checkout, and the mirror key.
5. Re-add the server in the orchestrator. Redeploy the Postgres resource, then both stacks.
6. Bring the checkout at `/opt/better-answers` to `main` (`pull --ff-only`).
7. Fetch the backup identity from escrow.
8. From the checkout, with `REPO_DIR` set to it, run **`deploy/restore-production.sh --objectstore --git`**.
9. Delete the backup identity.

**The restore.** `restore-production.sh` needs no second database. It replaces the database, wipes no other store, and replays every erasure completed after the dump before `api` starts. It is **not** `restore-drill.sh`, the staging rehearsal, which wipes what it restored. It follows `BACKUPS.md` § Recovery order: the database, the object store, the git store, the erasure replay (step 6, on the `api` service), then `api`.

The script stops the stores stack's `backup` service first. A dump's locks would hold up the database step's one transaction, and a nightly run would sync a half-restored object store over its mirror. It starts `backup` again last, once `api` answers. No dump is taken in between, so `pg-hourly` goes red if the run outlasts that check's grace, and `nightly` goes red if the run spans 02:00. Each turns green at its next run.

Over an existing database, the database step reads the whole dump first, and stops with the database unchanged if it cannot. It then applies the dump's roles. In one transaction it drops every schema, makes `public` again, and applies the dump. A failed statement rolls the whole transaction back.

**If the restore stops.**

1. If the log says *out of shared memory*, raise `max_locks_per_transaction` on the Postgres resource and restart the resource. The transaction takes about 45 locks per workspace. At PostgreSQL 18's defaults, 400 workspaces completed and 800 failed.
2. Run the script again, with an older dump if the dump is at fault.
3. If you abandon the restore, start the `backup` service with `docker compose … -p better-answers-stores start backup`, the invocation the script's `stores` helper makes.
4. Once a run completes, or you abandon the restore, remove both work directories with `rm -rf`. The log names them on its `work directories` line.

Until a run completes, `api` and `backup` stay stopped. The two work directories are `mktemp -d` directories under `/tmp` on VPC 1, mode 700. The first stays root's. The second is root's until the git step hands it, and each bundle moved into it, to the api's uid. A run stopped at the database step leaves `pg.dump` and `pg.sql` in the first. A run stopped at the git step leaves one decrypted `<workspace>.bundle`, in the first before the move and in the second after it, never in both. A run stopped anywhere else leaves no decrypted file. These files are personal data in plaintext. The script has no exit trap to remove them, and a new run makes directories of its own.

**Attach.** The provider's status page or ticket, the restore log under `/var/log/`, the dump name and stamp (the RPO), the RTO the script prints, and the `restore` rows of the `backup` table. If the log says `backup row not written`, run the statement it logged once the database answers (`BACKUPS.md` § The `backup` rows).

**Escalate.** If the box is not back within one hour, call the technical contact. Once the RTO passes two hours, tell the customer's named contact.

**Rehearsed by.** The monthly drill, which rebuilds VPC 1 from nothing on VPC 2.

## 2. Host compromise

**Fires.** Anything unusual: a firewall rule you did not make, an unknown process, a provider notice, or a spike in `401`s on the machine route.

**Do.**

1. Deny all inbound traffic at the provider's firewall.
2. Revoke the tunnel token.
3. Rotate every row in the estate's secrets inventory whose *Lives in* column names a box, and no others: the bucket write-and-list pair, the registry pull token, the object store's root pair, the mirror deploy key, the auth secret, and the mail credential. The **escrowed credentials were never on VPC 1**.
4. Do not rotate the envelope key unless the database itself is suspected. A new key means every model key is reissued at its provider and set again (§ Set a workspace's model key). Once a workspace holds a model key, `KEK` sits in the `api` service's env on VPC 1 beside the rows it seals. A compromise that may have read either is then a compromise of `KEK`.
5. Rebuild VPC 1 from a fresh image.
6. **Restore from a copy older than the compromise**: `restore-production.sh --dump <the copy>`. Object-lock governance means an attacker could not have altered the dumps. The script **replays erasures** after the dump, before the api turns healthy.
7. If personal data may have been read, go to page 3.

**If the compromised box is VPC 2.** The backup `age` identity is **resident there in a root-only file** (`SECRETS.md` § The backup identity). Assume **every dump and bundle in the buckets was readable in plaintext**, and apply page 3 without further evidence.

1. Rotate the identity by the procedure in `SECRETS.md` § The backup identity.
2. Rotate the bucket READ credential, the mirror key's accepted public half, and every orchestrator token.
3. Rebuild VPC 2 (page 5) before the drill runs again.

**Attach.** The notice or log line that fired, the rotation list with each row ticked and timed, and the name of the dump restored from.

**Escalate.** Call the technical contact at once. If a rotation needs the vault and the owner is unreachable, call the second escrow holder.

**Rehearsed by.** The drill's restore path. The rotation list is reviewed at the quarterly erasure rehearsal.

## 3. Personal-data breach

**Fires.** Page 2, a customer's report, a subject's report, or a provider notice.

**Clock.** If the breach is likely to risk people's rights, the ICO must hear within 72 hours of *awareness*. Tell the customer, the controller, without undue delay. The platform is the processor.

**Do.**

1. Contain the breach (page 2).
2. Establish the scope from `audit_event`, `questions_asked`, and the `backup` rows: which copies exist, and who could have read them. After a VPC 2 compromise, the copies' plaintext is in scope (`SECRETS.md` § Who can read a backup bucket).
3. Write the notification from those rows.
4. Tell the customer's named contact.
5. Record the decision either way.

**Attach.** The rows above, the containment times from page 2, and the notification sent or the reasoned decision not to send one.

**Escalate.** Tell the customer's named contact within 24 hours of awareness. Ask the technical contact to establish the scope. If the ICO question is not clear-cut, ask a solicitor.

**Rehearsed by.** The quarterly erasure rehearsal's report shape. The same rows answer both questions.

## 4. Erasure incident (a subject request that reaches git history)

**Fires.** A `subject request` in Control Centre.

**Do.** Run the erasure routine (ADR 0020).

**What the routine does, in order.**

1. The api holds `pg_advisory_lock(41)`, so the hourly dump waits.
2. It rewrites history with `git filter-repo` on the bare repository, under the repository's own lock.
3. It runs `git reflog expire --expire=now --all` and `git gc --prune=now` there.
4. It runs `git push --mirror` to VPC 2, then the same expiry and `gc` on the mirror. The estate runs no forge and no indexer.
5. A full rebuild derives the index, the passages, the evidence, and the map again. The map is plain tables in the same Postgres, so an erasure's flip and sweep are one step.
6. It suppresses and reprocesses the source entities.
7. The object-store deletion reaches the mirror bucket that night.
8. The report quotes the three dates from the last dump before the rewrite (`BACKUPS.md`).

The routine rewrites what the platform wrote, the actor ids across history. It does **not** rewrite a person's name inside a concept body. The owner edits that forward as a new commit, and the report says so.

**Attach.** The erasure report, the `erasure_request` row, and the last dump's stamp.

**Escalate.** Send the report to the customer's named contact. If the rewrite fails its verification, call the technical contact.

**Rehearsed by.** Every third drill, on a synthetic subject.

## 5. The orchestrator is lost (VPC 2 rebuilt)

**Fires.** Nothing automatic. The `coolify-backup` ping misses, the drill fails to run, or a deploy fails.

**Do.**

1. On the new box, run `deploy/host-setup.sh vpc2`. It creates the mirror user, the checkout, the root-only env files, and the drill's cron.
2. Install the orchestrator at the pinned version, and stop its containers.
3. Restore its instance backup into its own database with `pg_restore`.
4. **Replace its SSH key directory from escrow.** The instance backup does not hold it.
5. If Coolify's `APP_KEY` changed, set the previous-key variable.
6. Run the installer again, and re-add VPC 1.
7. Check that both stacks show healthy **without a redeploy**.
8. **Escrow Coolify's `APP_KEY` again.**
9. Put the backup identity back into its root-only file from escrow. The drill needs it.

**Attach.** The name of the instance backup restored, and the time both stacks showed healthy.

**Escalate.** If VPC 1's stacks do not show healthy after the re-add, call the technical contact. For the vault, call the second escrow holder.

**Rehearsed by.** Once before the first customer goes live, at the wizard's last stage. Then yearly.

## 6. A release went wrong

**Fires.**

- `release.yml`'s post-deploy smoke is red. That shows as a red `build` run on `main`, whose last job is the release, or a red nightly `release` run.
- The step `set digests, redeploy production and wait for the deployment` is red.
- The uptime check goes red within minutes of a promotion.
- The orchestrator mails *failed deployment* or *unhealthy container*.

**Read a red smoke.** `deploy/await-release.sh` polls `/health` for six minutes until it answers healthy **and** names the promoted api digest. Its error names *expected*, the promoted digest, and *answering*, the digest of the last answer, with that answer's status in brackets.

- *answering* the replaced build, `healthy`. The promoted image never took over. The orchestrator's deploy log says why.
- *answering* the promoted digest, `unhealthy`. `/health`'s body names the store it cannot reach.
- *answering no image named*, `no health answer`. Production is down, with the old container gone and the new one not up. *the last image named* is the build that answered last.

**Read a red redeploy step.** The step waits up to 30 minutes for the orchestrator's deployment, and its error names that deployment. Read the deployment's log. None of these cases pushed a tag.

- If it failed before its log reached `Removing old containers.`, as a failed pull does, production still runs the previous release. Nothing needs rolling back.
- If it failed after that line, production is down. Follow **Do**.
- If it never finished, it may still swap production later. Read `/health` before you act.
- If the error names production's deployment as `queued` or `in_progress`, nothing changed. Let that deployment end, or cancel it, and run the release again.
- If the error says the orchestrator queued no deployment, both digests are already set, and a deployment that had not started ships them with no smoke and no tag. Read `/health` once it ends.

**Do.**

1. Read the deploy log in the orchestrator. If a stack never came up for a missing env key, set the key, deploy, and stop. The api refuses to start unless `PUBLIC_URL`, `AGENT_HOSTNAME` and `APEX_HOSTNAME` are set and differ. Compose refuses to start the platform stack without `S3_BUCKET`. Set it on the platform resource to the bucket that `wizard-41.sh`'s Garage stage created.
2. **List the release tags newest first**, and take the newest. Pass over `release/20260927T193912Z-4bc6a2e` and `release/20260927T200343Z-821c331`. If `release/*` holds no tag, read `deploy/RELEASES.md`'s last row the same way.

   ```sh
   git fetch --tags && git tag --list 'release/*' --sort=-creatordate | head -5
   git show --no-patch release/<stamp>   # when, who, both digests, what it rode on, its run
   ```

3. Log in to `ghcr.io` with a token that reads packages (`docker login ghcr.io`).
4. From the repository's root, list the migrations that production holds and the tag's api does not. An empty `built` answer is a missing login, not an empty diff.

   ```sh
   git fetch --tags origin main                           # the untagged commits too
   live=$(curl -sS <PUBLIC_URL>/health | jq -r .image)   # the api digest production runs
   target=<the digest on the tag's api: line>
   built() { docker buildx imagetools inspect "ghcr.io/betteranswers/api@$1" --format '{{ index .Image.Config.Labels "org.opencontainers.image.revision" }}'; }
   git diff --name-only --diff-filter=A "$(built "$target")" "$(built "$live")" -- 'packages/schema/migrations/*.sql'
   ```

5. If another release is running, cancel it first. Every release runs in the `release-production` concurrency group, which cancels no run, so a rollback otherwise waits behind it for up to about 70 minutes.
   1. Find its run, a `build` run on `main` or a `release` run, with `gh run list --status in_progress`.
   2. Cancel the run with `gh run cancel <run id>`. That does not stop its deployment.
   3. Read the deployment's name in the run's redeploy step log. Cancel the deployment on its page in the orchestrator, or let it end. While it is queued or running, the rollback's redeploy step stops before it sets anything and names it.
6. Run `release` with the tag's two digests as the inputs and `rehearsed_by: hotfix: rollback of <the failed tag>`. If the tag's api was built before `/health` named its digest, the smoke ends red with *answering no image named* and a `healthy` last answer. Read `/health` by hand. `healthy` with no `image` means the rollback is done, and it pushed no tag, so tag it by hand as `deploy/RELEASES.md` shows. `healthy` naming the failed digest means the failed build is still up.
7. If step 4 listed a `.sql` file, the rollback crosses a migration (§ Migrations that no digest rollback crosses). Once the release ends, run page 1's restore: `restore-production.sh --tier <tier> --dump <file>`. Use the last dump stamped before the first promotion after the tag, because a dump taken after that promotion already carries its migration. An untagged release's time is in its run.
8. Unless `RELEASE_MODE` is `drill`, merge nothing else until the fix, or the revert, has merged. Outside `drill`, a rollback holds only until the next automatic release: the next green build in `per-merge`, or the next night in `nightly`. That release still carries the broken change. To hold the rollback while the fix is made, set `RELEASE_MODE` to `drill`.

**Why these steps.** A release is tagged only after its smoke passes, so the newest tag is the last release that held. A run whose smoke failed says so in its summary. `deploy/RELEASES.md` is frozen and holds the promotions before 23/09/2026. A tag with no `Run:` line was dispatched by hand. The two tags of 27/09/2026 were pushed before smokes that failed, and neither release reached production. They are gone from origin, but a clone keeps them until `git fetch --prune --prune-tags`.

A release whose smoke failed pushed no tag, but its migrations still ran. Migrations are forward-only, so the digests alone are the rollback only when step 4 lists nothing. A migration that cannot run under the previous release says so in its release note. The restore comes after the release because its migrate step runs the deployed release. Hourly dumps are kept 48 hours, and the 02:00 UTC dump is filed under daily, weekly, or monthly. Every write since the dump is lost, and every erasure since it is replayed.

**Attach.** The message of the `release/*` tag rolled back to, as `git show --no-patch` prints it. The failed run, whose summary says no tag was pushed, with the smoke's error line naming both digests. The orchestrator's deploy log. The body `/health` answered, whose `image` is the digest actually running.

**Escalate.** If the rollback does not turn `/health` green within 30 minutes, call the technical contact. If the product was unreachable for more than an hour, tell the customer's named contact.

**Rehearsed by.** The first release after the first drill is rolled back on purpose, once, and both tags are kept.

### The `RELEASE_MODE` switch

`RELEASE_MODE` is a repository variable with three modes. Any other value fails closed: nothing is released, and the run says why.

- **`per-merge`**, the default while unset. Every green build on `main` releases its own commit, and skips one that `main` has moved past.
- **`nightly`**. At 02:35 UTC, `release` promotes the newest green commit on `main`, once the box's backup is fresh. Fresh means the dead-man service's `pg-hourly` check is up and pinged within 65 minutes, and its `nightly` check is up and pinged since the last 02:00 UTC. The run reads them with `HEALTHCHECKS_READ_KEY`, the service's read-only API key, kept as a `production` environment secret, and refuses without it. A night is skipped when that commit, or a newer one, already has a tag. A night refused for a stale backup deploys nothing (page 7), and the next night tries again.
- **`drill`**. Nothing releases itself. `release` refuses to run unless `rehearsed_by` names the drill report a restore was just proved on, or a hotfix reason. That makes one deploy train a month, on the drill day, plus hotfixes.

The phases are `per-merge` until the first customer's bundle lands, `nightly` until the platform goes live (no earlier than the end of v0.1), then `drill`. Add the read key before the first switch:

```sh
gh secret set HEALTHCHECKS_READ_KEY --env production   # the dead-man service's read-only key
gh variable set RELEASE_MODE --body nightly            # the day the bundle lands
gh variable set RELEASE_MODE --body drill              # the day the platform goes live
```

### Migrations that no digest rollback crosses

On a migrated database, the api of every release before each migration below fails. From 0066 on, that release's worker also claims nothing, because its deploy stamp no longer matches. To roll back from the first release that carries one to a tag below it, run `release` with the tag's digests, then `restore-production.sh --tier <tier> --dump <file>` with the last dump stamped before that release's promotion. Between two releases that both carry it, the digests alone are the rollback.

| Migration | Date | Change | An older api fails with |
| --- | --- | --- | --- |
| `0053_the-account-issuer-goes` | 24/09/2026 | Drops `account.issuer`, which Better Auth 1.7.2 reads on every email-code sign-in. | `column "issuer" does not exist` on every sign-in. |
| `0066_the-model-choice` | 05/10/2026 | Renames `llm_route` to `model_choice`, and queued `route-change` rebuilds to `model-choice-change`. | `relation "llm_route" does not exist` on every read of a workspace's model choices. |
| `0067_the-map` | 05/10/2026 | Renames the map tables to `map_generation`, `map_node` and `map_edge`. Moves map destinations to `map`, and queued `first-sync` rebuilds to `first-build`. | `relation "graph_node" does not exist` on every map read and write. |
| `0068_the-connected-source` | 07/10/2026 | Renames the connected sources' table to `connected_source`, and `source_document`'s column to `connected_source_id`. Moves *landed* sources to *received*, and syncs with the reason `bound` to `connected`. | `relation "source_binding" does not exist` on every Sources read and write. |
| `0069_the-passage` | 07/10/2026 | Renames the passage table to `index.passage`, its view to `index.readable_passage`, and its columns to `connected_source_id` and `embedding_model_choice_id`. Moves the destination `chunk-index` to `passage-index`. | `relation "index.chunk" does not exist` on every passage read. |
| `0070_the-verification` | 07/10/2026 | Renames `concept_verification`'s `checked_at` to `verified_at`. The MCP wire keys stay `checkedBy` and `checkedAt`. | `column "checked_at" does not exist` on every concept read and bundle import. |
| `0071_the-short-name` | 07/10/2026 | Renames the workspace's short-name column to `workspace.short_name`. | `column "slug" does not exist` on provisioning, renaming a workspace, asking to join, the console's Workspaces list, and every Better Auth read of a workspace. |
| `0072_the-knowledge-words` | 07/10/2026 | Renames tables to `write_up`, `write_up_include` and `concept_sensitivity_override`, a column to `unreadable_reason`, and a function to `narrower_sensitivity`. Moves stored values to `suggested-concept`, `citation-fix`, `unreadable` and `WriteUp`. | `relation … does not exist`, or a CHECK naming the old value, on the Sources list, sensitivities, overrides, narrowings, and suggestion sets. |
| `0073_the-action` | 07/10/2026 | Renames the `act` column of `audit_event` and `identity_audit_event` to `action`. | `column "act" does not exist` on nearly every write, signing in among them, and every read of the audit logs. |
| `0090_the-backoff` | 21/10/2026 | Narrows `job_queued_subject_key` to queued jobs not yet tried. | `there is no unique or exclusion constraint matching the ON CONFLICT specification` (42P10) on every job it enqueues. |

If 0069, 0072 or 0073 fails on `lock_timeout`, it rolls back whole and can run again. For 0069 and 0072, stop the old worker first.

**After 0069, wipe every connected source.** The worker's engine tracks its rows under the passage table's old name, so after the rename it silently deletes nothing that leaves a source.

1. For every workspace (`SELECT id FROM workspace`), run `pnpm ops reindex-connected-sources --workspace <id>`. Its `wiped` sync also removes the store under the old name, `binding/`.
2. Remove any `binding/` left under `LMDB_DIR` by a source that no longer stands: `find /data/worker/lmdb -mindepth 3 -maxdepth 3 -type d -name binding -prune -exec rm -rf {} +`.
3. Count rows as `postgres`. Row-level security makes the owner's unscoped count read 0.

**After 0072,** a browser tab opened before the release shows the error page on Sources until reloaded. Tell the Admins to reload. **After 0073,** the next release renamed the api's wire key `act` to `action`, so a tab opened before that release must be reloaded.

**The migration that adds `map_unresolved_reference`** (22/10/2026) starts the table empty, so a link written before the release has no row until its map is rebuilt. The migration queues one `full-rebuild` job with the reason `upgrade` for each workspace that has a map, unless a full rebuild already waits there. It runs once per database. Nothing is run by hand. Until a workspace's rebuild is done, a concept that lands at a path an older link names does not answer that link.

1. To watch, count `SELECT workspace_id, status FROM job WHERE kind = 'full-rebuild' AND reason = 'upgrade'` as `postgres`. Every row reaches `done` once the new worker is up.
2. If a row ends `failed` or `poisoned`, read the job's outcome and fix its cause.
3. Run `pnpm ops map-rebuild --workspace <id> --reason upgrade --wait` for that workspace.

The new worker runs each rebuild, and the daily sweep removes the old generation. A worker left running across the migration may take a rebuild and write no rows (`docs/operations/CI.md`, *The pull runs before the stop*). Rolling back across the migration is the migration case. An older api never reads the table, but an older worker's deploy stamp no longer matches, so it claims nothing. Rolling forward again queues the rebuilds anew.

### The tag ruleset

A tag ruleset (Settings, Rules, Rulesets) targets `release/*` and is Active, with **Restrict updates** and **Restrict deletions** on and **Restrict creations** off. Nothing can move or delete a release tag, and the record job can still push one. To delete a tag by hand, turn the ruleset off for the deletion and on again after. The `production` environment admits only `main` (Settings, Environments, `production`, Deployment branches and tags), so no workflow on another branch reads its secrets. Both were set on 03/10/2026.

## 7. A backup check is red

**Fires.** `pg-hourly`, `nightly`, `coolify-backup` or `drill` is late or failed at the dead-man service, by email. During development there is no second channel, by the owner's decision of 03/10/2026, so read the alert the day it arrives.

**Do.**

1. Read the stores stack's `backup` service log in the orchestrator. Every `pg-hourly` or `nightly` run ends with `backup.sh <hourly|nightly>: <ok|fail> bytes=<n> took=<seconds>`, the body of its ping. A run with no such line stopped before it pinged, unless it was an hourly run skipped for the erasure lock, which says so.
2. Match the line to `BACKUPS.md` § The backup service's own failure modes: a full `/staging`, a rotated bucket credential, a refused mirror push, or a dump skipped for the erasure lock, which clears itself. `BACKUPS.md` § How the jobs run, and how to read the last one has the rest.
3. If a run stops at `DATABASE_URL: parameter null or not set`, the container runs an image older than 24/09/2026, whose cron does not start jobs through `backup-env`. Follow `BACKUPS.md` § Putting a new backup image on production.
4. A `backup` service that `restore-production.sh` stopped takes no dump until the script's last step starts it again. If an abandoned restore left it stopped, start it by hand (page 1).
5. List the dumps bucket per tier: `rclone lsf dumps:<bucket>/pg/<tier>/`.
6. Read the last `backup` row per store.
7. If `pg-hourly` missed twice in a row, run no release (page 6) and no rehearsal until the check is green. **The recovery point is now the last good dump, and growing.**
8. If `coolify-backup` is red, check the orchestrator's own S3 storage and its credential. Page 5's restore depends on it.
9. If `drill` is red, read page 5, or the failed step in the drill's report under `drills/`.

**Attach.** The failing job's log lines, the last `backup` row per store, the bucket listing per tier, and the dead-man service's ping history for the check. The log lines hold no key or password, but they name paths, endpoints, buckets, objects, repositories, the mirror's address, and the database's host, port and role. rclone's `Config file … not found` notice names its config file on every call. Keep the lines with the private half's records, never anywhere public.

**Escalate.** If any check is still red after 24 hours, or after one attempt to fix it, call the technical contact. Tell the customer's named contact only if the recovery point passes the RPO their contract states.

**Rehearsed by.** The drill's step 9, which checks the bucket listing against the matrix. The `staging-wiped` check proves the drill's last step ran.

## 8. A customer reports wrong or lingering content

**Fires.** A customer says an answer is wrong, a concept says something false, a source they removed still answers, or a person's data is still visible.

**Do, for wrong content.**

1. Find the answer's `questions_asked` row on the System page, by the person and the time, and the concept it asserts.
2. Have the Admin edit the concept forward as a new commit, or file a *finding* on it. If only its body is wrong, use *Update a concept's body in place*, below.
3. Mark the answer's row *corrected*. Nothing is deleted.

**Do, for lingering content.**

1. If a person's data is still visible, go to page 4. Its report's dates say when the data is gone from every copy.
2. For a removed source, read the connected source's last sync row. If no sync has happened, start one.

The next sync stops the source answering and deletes its object-store originals. The deletion reaches the mirror bucket that night. Dumps holding it expire on the tiers (`BACKUPS.md` § The retention schedule), and are beyond use meanwhile.

**Attach.** The `questions_asked` or `audit_event` row, the concept's `bundle_commit`, the connected source's last sync row, the `backup` rows that bound the retention dates, and the customer's message.

**Escalate.** Answer the customer's named contact within one working day, with the row and the date. If the next sync does not remove the content, call the technical contact. If personal data was served to someone who should not have seen it, call page 3's contacts.

**Rehearsed by.** The quarterly erasure rehearsal, for lingering content. The first customer's onboarding, for wrong content, which corrects a deliberately wrong concept end to end.

## 9. Both boxes lost at once

**Fires.** Nothing beyond page 1's uptime check. You notice that the orchestrator is unreachable too. The cause is the provider, an account compromise, or a payment lapse.

**Do, in this order.** It takes half a day. `SECRETS.md`'s inventory is the checklist, and every value is in the repository, the private file, or the vault.

1. Make two new boxes at the provider.
2. On VPC 2, run **`host-setup.sh vpc2`**, install the orchestrator at the pinned version, and bring back its instance backup and SSH keys from the dumps bucket and escrow (page 5).
3. On VPC 1, run **`host-setup.sh vpc1`**, and re-add the server in the orchestrator.
4. Deploy the Postgres resource on the pinned image, by digest.
5. Deploy the two stacks from this repository, with every env value entered again from the private inventory and escrow.
6. Bring the checkout at `/opt/better-answers` to `main` (`pull --ff-only`), fetch the backup identity from escrow, and with `REPO_DIR` set to the checkout run **`restore-production.sh --objectstore --git`**.
7. If the old tunnel token was revoked, make a new one.
8. Check that the uptime check is green.

**Attach.** The restore log, the escrow access record (who opened the vault, and when), and the new addresses, in the private file.

**Escalate.** If the owner cannot act, the **second escrow holder** steps in. This page is why the two-holder rule exists. Within the first hour, give the customer's named contact an RTO.

**Rehearsed by.** Never in full, because it costs a day. Page 5 is rehearsed yearly, the drill monthly, and the second holder opens the vault once before the first customer goes live.

## 10. A workspace is stuck behind a commit

**Fires.** The api logs `reconciler tick` at warn with a `stopped` entry (`workspace_id`, `commit_sha`, `reason`) every thirty seconds, or `pnpm ops reconcile-watermark --workspace <id>` refuses. The replay of commits the rows missed stopped at a commit the index would not take. Until someone steps in, **every later write to that bundle fails**. Connected sources, write-ups, and members are untouched.

**Read the refusal first.** `reconcile-watermark` is the reconciler on demand, step 2 of `BACKUPS.md` § Recovery order. Its refusal reads `reconcile-watermark: REFUSED — stopped at <sha> (<reason>); head <sha>, watermark <sha>, replayed <n>, already landed <n>; …`. *head* is where the repository is. *watermark* is the last commit the rows knew when the run began. *stopped at* is the first commit between them that the index refused.

| Reason | Path |
| --- | --- |
| `merge-key-taken`: another concept holds the merge key the refused commit resolves by | Put it right. |
| `path-taken`: freeing the path means moving a concept's file, which the live write path refuses | Rewind. |
| `rename-refused`, `unreadable-commit`: a commit the governed write did not make | Rewind. |
| Anything else, such as `connection terminated unexpectedly`: a store's own failure | Run the command again, and escalate if it repeats. **Never rewind.** |

**Do, to put it right** (`merge-key-taken`). Prefer this whenever the reason allows. It keeps every commit made while the workspace was stuck.

1. Have an Editor or an Admin rewrite the concept that holds the key onto a free key. A free key is one that resolves to nothing. The rewrite may move its own concept onto such a key.
2. Run `reconcile-watermark` again and read the line.

**Do, to rewind the ref to the watermark.** A rewind **discards every edit attempted while the workspace was stuck**. **Record who is asked to redo which edit**, from the dropped commits' subjects and `Actor:` trailers.

1. Run `reconcile-watermark` once more, on its own, since its refusal exits non-zero. Use the line that says `replayed 0, already landed 0`. Its *watermark* is the commit to move to. A line that landed anything names a stale watermark.
2. Run every step below **inside the `api` container as the image's own user**: `docker compose … -p better-answers exec -T api …`. That is the invocation the `platform` helper in `deploy/restore-production.sh` makes, and the private file holds its env file. Never run `git` as root on the host over `/data/git`. One root-owned file under a bare repository blocks every later write the api makes.
3. Run `git --git-dir /data/git/<workspace>.git rev-parse refs/heads/main`. Write **the old head into the incident record before anything moves.** Nothing else on the box remembers it.
4. Run `git --git-dir … merge-base --is-ancestor <watermark> refs/heads/main`. Exit 0 with no output means the move only drops commits. If it exits non-zero, **stop** and escalate.
5. Run `git --git-dir … log --oneline <watermark>..refs/heads/main`, and write the commits it lists into the record.
6. Run `git --git-dir … update-ref refs/heads/main <watermark> <the old head>`, **with three arguments, always.** The third makes git refuse if a commit reached the ref since step 3. If it refuses, begin again at step 1.
7. Run `pnpm ops reconcile-watermark --workspace <id>` again. `done — head <sha>, watermark <sha>, replayed 0, already landed 0` with the two shas equal means the workspace is writable again.

**Attach.** The line that fired, with its stop reason, the old head, the dropped commits with their subjects and actors, who was told to redo which edit, and the `reconcile-watermark` line that ended it.

**Escalate.** Call the technical contact before any rewind. Once the list of edits to redo exists, send it to the customer's named contact, since their people redo them.

**Rehearsed by.** Once on staging, before the first customer's data is on the box, which is also the day page 6's switch turns to `nightly`. A commit written into a staging bundle by hand stops the replay as `unreadable-commit`. Rehearsed on 27/09/2026 at build `3557cba8`, where steps 1 to 7 put it right.

## 11. The sweeps' check is red

**Fires.** The `sweeps` check at the dead-man service, by email only. **Late** means no pass completed in 25 hours. **Failed** means a pass could not sweep a workspace, delete one kind of expired sign-in row, list the workspaces, or write its row.

**Do, when late.**

1. Read the api's start line.
2. If it reads `sweeps running`, the timer started. Check that the api is up (page 1). If it is, look for a skipped pass, which logs `a sweep pass was skipped: another holder has the sweeps' lock`. The usual holder is a sweep by hand that never finished.
3. If it reads `the sweeps are not running`, fix what it names, a wrong `UPLOAD_SWEEP` or no object store on the api service, and redeploy.

A ping that never arrived logs `check: sweeps`, as page 12 explains.

**Do, when failed.**

1. Read the last `sweep pass` line. Its `refusals` names each workspace passed over, the sweep (`uploads` or `map`), and the reason. The other workspaces were swept.
2. Run that sweep by hand for that workspace: `pnpm ops map-sweep --workspace <id>`, or `pnpm ops object-store-orphans --workspace <id> --list` while `UPLOAD_SWEEP` is `list`. By hand, the command removes unless given `--list`, whatever `UPLOAD_SWEEP` says.
3. Fix what the refusal names, and let the next pass go green.

A refusal whose sweep is `sessions`, `verifications` or `ingress` names no workspace. That kind's expired rows were kept, the other kinds were still deleted, and the next pass tries again. With no `sweep pass` line, `the sweep pass failed` carries the reason. The expired sign-in rows are deleted all the same, and the line still carries `sessions_deleted`, `verifications_deleted`, `ingress_windows_deleted` and `refusals`.

**Attach.** The line that fired, the last `sweep_pass` row, and the refusal line of the run by hand.

**Escalate.** If the check is still red after two passes, call the technical contact.

**Rehearsed by.** The drill's two sweeps on staging, which take the same lock.

## 12. The scheduler's check is red

**Fires.** The `scheduler` check at the dead-man service, by email during development (page 7). The api's head check pings once a minute. **Late** means four minutes without a ping. **Failed** means a tick could not run its pass because the database refused or did not answer, and one failed minute pages. A workspace the tick refused is not a failure here. Its `reconciler tick` line names the workspace, and a stuck one is page 10.

**Do, when late.**

1. Check page 1: VPC 1 is up and `api` is healthy in the orchestrator.
2. Read the api's start line.
3. If it reads `the scheduler check will not be pinged`, `HEALTHCHECKS_PING_URL_SCHEDULER` is wrong or missing. `head check running` then reads `check_configured: false`. Set the URL on the platform resource and redeploy. Staging takes a URL of its own, never production's.
4. If it reads `the head check is not running`, give the api service its `GIT_STORE_DIR`.
5. If `a reconciler tick was skipped: the previous one is still running` repeats every thirty seconds, attach those lines, escalate, then restart `api`.

**Do, when pinged and still late.** Find the lines logged with `check: scheduler`, which never carry the URL.

1. If `a dead-man ping was refused` carries `status` `404`, the check was deleted or re-created. Put its current URL on the platform resource and redeploy.
2. If `a dead-man ping could not be sent`, its `reason` is a timeout or no egress from VPC 1.

**Do, when failed.**

1. Read `the reconciler tick failed` in the api's log, which carries the database's `reason`.
2. If the check stays failed, read the Postgres resource's log and its disk in the orchestrator. `/health` answers `unhealthy` too. One failed minute and then green is a blip.

**Attach.** The start line, the lines that fired, and the check's ping history.

**Escalate.** If the check is not green fifteen minutes after `api` is healthy, call the technical contact.

**Rehearsed by.** Nothing on a schedule. The api's suite proves the pings and their log lines. Stopping `api` for five minutes fires this page for real.

## 13. The test workspace

The test workspace stands in production, marked, and no run signs in to it. Its three test people (the test Admin, Editor and Viewer) and its 51 invented members have addresses on its testing domain. The mark names that domain in a row the api cannot delete (migrations 0062 and 0063). While it stands, an invitation to an address off that domain is refused `off-testing-domain`, so an Admin of the workspace cannot invite a real person into it.

**The journeys and the test inbox are retired until go-live.** The owner retired them on 19/10/2026 (ADR 0022). The go-live rebuild starts from this page as `a3c19ec8` holds it, and from `docs/solutions/best-practices/a-cloudflare-email-worker-test-inbox-needs-its-own-zone-and-its-deploy-token-reaches-every-zone.md`.

**Fires.** Nothing. `off-testing-domain` is the mark doing its job.

**Do.**

- **Never erase a test person.** An erasure tombstones the address for good. Remove them on the workspace's Members page instead.
- **Keep the test Admin's authenticator key and recovery codes in the password manager.** An Admin must hold a second factor, so the test Admin holds one. If the key leaks, end its factors and sessions with `pnpm ops restore-sign-in`. A new authenticator waits for the go-live rebuild, since no inbox receives the test people's sign-in codes.
- **Keep the testing domain while the test people are members.** Its holder receives their sign-in codes. Remove the test people before the domain is released.

**Rehearsed by.** Nothing until go-live.

## Bring staging up and tear it down

Use this procedure to stand staging up on VPC 2 for a drill or a rehearsal, and to wipe it after. `restore-drill.sh` does the same, network first (`ensure_staging_network`), and its `wipe_staging` is the reference wipe.

**Bring staging up.**

1. The first time only, create the staging Postgres resource in the orchestrator, and keep it empty.
2. Take the digests `build.yml` last pushed, from its run summary.
3. Work from the checkout at `/opt/better-answers`, with the staging env in the root-only file that `host-setup.sh` creates.
4. If `docker network inspect better-answers-staging-shared` finds no network, run `docker network create --internal better-answers-staging-shared`.
5. Start the stores: `docker compose --project-directory deploy --env-file /etc/better-answers/staging.env -f deploy/stores.compose.yaml -f deploy/staging.override.yaml -p better-answers-stores-staging up -d`.
6. Start the platform with the same `docker compose` prefix and `-f deploy/platform.compose.yaml -f deploy/staging.platform.override.yaml -p better-answers-staging up -d --wait api worker`.

The `-f` paths resolve against the working directory, not the project directory. `staging.override.yaml` puts `objectstore` on the network, and `staging.platform.override.yaml` puts `migrate`, `api` and `worker` there, so the platform's `S3_ENDPOINT` resolves across projects as Coolify's `coolify` network makes it resolve in production. Neither compose file names the network, so production's deploy is untouched.

**Tear staging down.**

1. Run `down --remove-orphans` on both projects. The network can stay.
2. Wipe `/data/objectstore`, `/data/git`, `/data/worker/*`, and the staging backup directory.
3. Empty the staging database with `deploy/empty-database.sql`, the file `restore-production.sh` uses. It drops every schema but the system's and makes `public` again. The map is plain tables in `public`, so that is the whole wipe.

`seed-synthetic.sh` re-seeds the fixture, and the `staging-wiped` ping is the proof.

Staging holds customer data only during a drill. Any other rehearsal uses the synthetic fixture. The one exception, the owner's of 22/09/2026, is the first customer's reviewed bundle, which may stand on staging for its rehearsal under *Provision the first customer and land its bundle*, with its two people signed in for real. The drill's wipe removes it when the rehearsal ends.

## Browse production

Use this procedure to browse production's rows in a GUI, through an SSH forward, as the read-only role `browse_ro`. `coolify.md` § Browsing the database describes what the role reads. The values come from the private file's § Browsing production and are never written here. Run every command from the repository root of the main checkout.

1. **Check the public-port toggle, once, on the day.** In the orchestrator, the Postgres resource's public-port toggle must be on and publish one port, and the provider firewall must not let that port in. Record both in the private file, dated. Leave the toggle on, or the forward has nothing to reach.
2. **Write the private file's names, once.** § Browsing production in `.planning/estate/coolify.md` holds `VPC1_SSH_TARGET=<user>@<VPC 1's address>`, `VPC1_SSH_KEY=<the key's path>` (optional), `VPC1_DATABASE_PORT=<the port the toggle publishes>` and `VPC1_POSTGRES_CONTAINER=<the Postgres resource's UUID, which names its container>`. Before steps 3 and 4, read them into bash or zsh:

   ```sh
   estate=.planning/estate/coolify.md
   read_estate() { sed -n "s/^$1=//p" "$estate" | tr -d '\r'; }
   target=$(read_estate VPC1_SSH_TARGET); pg=$(read_estate VPC1_POSTGRES_CONTAINER); key=$(read_estate VPC1_SSH_KEY)
   identity=(); [ -n "$key" ] && identity=(-o IdentitiesOnly=yes -i "${key/#\~/$HOME}")
   ```

3. **Grant the role, once per estate and again after a release adds a table:** `ssh "${identity[@]}" "$target" docker exec -i "$pg" psql -U postgres -d better_answers -v ON_ERROR_STOP=1 < deploy/browse-role.sql`. The file is one transaction, and a rerun changes nothing that is already right.
4. **Set the role's password, once:** `ssh -t "${identity[@]}" "$target" docker exec -it "$pg" psql -U postgres -d better_answers -c '\password browse_ro'`. It prompts twice and sends only the hash. Put the password in the password manager, and record in the private inventory where it is held.
5. **Each time, run `deploy/browse-production.sh`.** Point the GUI's *production (read-only)* profile at host `127.0.0.1`, port `55433`, database `better_answers`, user `browse_ro`. Ctrl-C in that terminal closes the forward.

If `deploy/browse-production.sh` refuses, it names a local port already held, the private file absent, or one of its names missing, doubled, or malformed. It prints no value it read.

## A shell in the worker

Use this procedure to look inside the running worker. Its image has no shell, no package manager, and no `ls` (`apps/worker/Dockerfile` says why), so `exec worker sh` and the orchestrator's terminal both fail. The api's image keeps its shell. Run each way in on VPC 1 against `docker compose … -p better-answers`, the invocation `deploy/restore-production.sh`'s `platform` helper makes. The private file holds its env file.

1. **Use the worker's own Python.** `exec worker python` opens the interpreter as the worker's user, with its virtualenv, environment, and mounts. Ignore the `can't use pyrepl` warning. `os.listdir`, `pathlib.Path(…).read_text()` and `os.environ` replace `ls`, `cat` and `env`. `exec -T worker python -m better_answers_worker.health` runs the health check: exit 0 is healthy, and 1 is not.
2. **Copy a file out** with `docker cp <the worker's container>:<path> <here>`. Never copy anything in. A change reaches the worker through a release.
3. **Run a shell beside it** for `ps`, `top`, `nc` or `wget`. The base's debug variant carries busybox and joins the worker's process and network namespaces as the worker's uid:

   ```sh
   worker=$(docker compose … -p better-answers ps -q worker)
   docker run --rm -it --pid "container:$worker" --network "container:$worker" \
     --user 1000:1000 \
     gcr.io/distroless/cc-debian13:debug-nonroot@sha256:f525a9a37aed3e8a848f46cfe055999782d66ed797e9e2886928c8caaaa4fc52
   ```

   The worker is PID 1 there, so its filesystem is `/proc/1/root`: `ls /proc/1/root/app`, `cat /proc/1/root/data/worker/…`. `exit` removes the container. Run it as uid 1000, never as root or `--privileged`. Renovate does not read this file, so update the pinned digest by hand from the gcr.io registry.

### A worker that restarts by itself

Use these steps when the worker restarts on its own.

1. Find the log line `the job outlived its deadline`, which names the job. The thread stacks printed to stderr just before it show where the job hung.
2. Read the exit codes with `docker events --since 72h --filter event=die --filter container=<the worker's container>`. `exitCode=75` marks each such exit. `docker inspect` cannot show it, because it reads the running container.
3. Count the restarts with `docker inspect -f '{{.RestartCount}}' <the worker's container>`.

The worker ends a job that hangs past `JOB_DEADLINE_SECONDS`, 36 hours (`apps/worker/src/better_answers_worker/queue.py`), with exit code 75. It restarts and claims the job again. A job that outlives every attempt ends `poisoned`, so the restarts stop on their own.

## Swap

VPC 1 has a 4 GB swap file on the NVMe, so a first index that outgrows the worker's 1.5 GB cap slows down rather than fails. `deploy/host-setup.sh vpc1` creates it with `fallocate`, `mkswap`, `swapon`, the `fstab` line, and `vm.swappiness=10`. `memswap_limit` in `platform.compose.yaml` caps the worker's spill at 1.5 GB of swap.

During the first index, watch the worker heartbeat's `pswpin` figure. Above 4 MB/s for five minutes is the signal for the WireGuard split (ADR 0025). The page-cache floor in `BACKUPS.md` § Signals is the second trigger.

## The daily sweeps

Use this section to read the daily sweeps, and to switch the upload sweep from listing to removing.

**What a pass deletes.**

- **The upload sweep** removes an original that a failed connect or a lost race left in the object store, once it is past the 24-hour grace and no document row names it.
- **The map sweep** deletes every generation of a workspace's map but the live one.
- Every session past its expiry, and every session still pending an hour after it was first found pending.
- Every verification row more than a day past its expiry: sign-in codes and links, restore codes, parked authenticator setups, passkey challenges, and the library's other short-lived tokens.
- Every `ingress` rate-limit window more than a day old.

Better Auth's own deletion of expired codes is off, because it made a code that had just expired read as wrong rather than spent. The pass keeps each person's failed second-factor confirms, which hold their backoff.

**Schedule.** The sweeps run on a daily timer in the api process, beside the reconciler and never on its tick (`apps/api/src/timers/sweeps.ts`). The first pass runs ten minutes after the api starts, then every 24 hours. A refused workspace is named in the log and passed over. A pass tries a Postgres advisory lock and is skipped while another holder has it. `pnpm ops map-sweep`, `pnpm ops object-store-orphans`, and the restore drill's sweeps take the same lock and wait for it.

**Settings, on the platform resource.**

- `HEALTHCHECKS_PING_URL_SWEEPS` is required. It names the `sweeps` check at healthchecks.io (period 24 h, grace 1 h, email), which the operator creates (`deploy/wizard-41.sh`, the healthchecks.io stage). **Set it before the release that brings the sweeps reaches either box**, on the platform resource and in staging's env file, or compose refuses to start the stack, the drill's `platform up` included. Staging's URL is its own, never production's, and carries no alert.
- `UPLOAD_SWEEP` is `list` unless set, or `remove`. Any other value stops the sweeps with `the sweeps are not running`, and the check goes quiet.

**Reading the last pass.** Any one of these is enough:

- **The `sweeps` check.** A pass pings it with an outcome word and counts, such as `ok workspaces=3 refused=0 upload_sweep=list found=2 removed=0 generations=1`, or under `fail` when it passed over a workspace. The body names no workspace, key, or error.
- **The api's log.** One `sweep pass` line per pass, at warn when it passed over a workspace. It carries `upload_sweep`, `workspaces`, `refused`, `found`, `removed`, `generations`, `sessions_deleted`, `verifications_deleted`, `ingress_windows_deleted`, `reservations_settled` (§ Set a model's price and a workspace's spending limit) and `refusals`, which names each workspace passed over, the sweep, and why. It never names a key, a person, or an address.
- **The `sweep_pass` table.** One row per completed pass, never a skipped one: `SELECT * FROM sweep_pass ORDER BY at DESC LIMIT 1` through `browse_ro` (§ Browse production, step 3, rerun after the release that adds the table). It carries `at`, `upload_sweep`, `workspaces`, `refused`, `found`, `removed` and `generations`. The api cannot change or delete a row.

**The upload sweep only lists until an operator switches removal on.** On production it starts as `list`, so a pass reads `upload_sweep=list … removed=0`, and `found` counts the originals past the grace that no document row names. The map sweep deletes from its first pass. If the join were wrong, removal would delete live bytes for good, so read each rise in `found` against its cause first:

- `found` rises by one for each connect whose second transaction failed, and for each repeat of a connect that lost the race. A lost race's key, `uploads/<connected source>/<document>/original`, names a connected source whose document row names another key. `found` falls only when something removes originals, such as `object-store-orphans` run by hand without `--list`. By hand, that command removes unless given `--list`, whatever `UPLOAD_SWEEP` says.
- A rise with neither cause means the join is wrong. Leave the setting at `list` and escalate.
- `pnpm ops object-store-orphans --workspace <id> --list` gives one workspace's count. The counts add up to `found`.

**Switch the upload sweep to remove.** **The day to switch** is seven days after the first upload is bound in a customer's workspace on production. Before then, no row names an original, so every pass reads `found=0` and proves nothing. Importing a bundle (§ Import a company's bundle) writes no originals, so it does not start the week. Do not wait longer, because an orphan may hold personal data nobody can find.

1. Through `browse_ro` (§ Browse production), read the first upload:

   ```sql
   SELECT workspace_id, first_seen FROM source_document
    WHERE original_key LIKE 'uploads/%' ORDER BY first_seen LIMIT 1;
   ```

2. If no row comes back, leave the setting at `list` and stop.
3. If the row's workspace is not a customer's, add `AND workspace_id <> '<its id>'` and read again.
4. On the row's `first_seen` plus seven days, read the week's passes:

   ```sql
   SELECT at, upload_sweep, found, removed FROM sweep_pass
    WHERE at >= '<first_seen>' ORDER BY at;
   ```

5. If every rise in `found` has a failed connect or a lost race behind it, set `UPLOAD_SWEEP=remove` on the platform resource and redeploy. Otherwise leave it at `list` and escalate.
6. Check that the next pass reads `upload_sweep=remove`, with `removed` equal to `found`. Setting `list` again stops removal from the next start.

## Import a company's bundle

Use this procedure to land a company's reviewed OKF bundle in its workspace. Run it on the `api` service, the only service that carries `GIT_STORE_DIR` and the database:

`pnpm ops import-bundle --workspace <id> --from <directory> --as <member email> [--sensitivity Restricted|Internal|Public] [--dry-run]`

1. Rehearse the real bundle on staging, against the synthetic seed, before production.
2. Copy the bundle's own tree to the box.
3. Run the command with `--dry-run`. It checks the whole tree, writes nothing, and says what a run would do.
4. Run the command without `--dry-run`.
5. If the run says `stopped at <file> (<reason>)`, it kept what landed. Put the reason right and run it again. For a taken merge key, apply page 10's `merge-key-taken` remedy and rewrite the holder onto a free key. `stopped at <file> (stale-precondition)` means another writer changed the file between the passes, and the rerun handles it.
6. Put the numbers from the closing line in the estate-size record.

**The tree.** `manifest.yaml` sits at its root, with the five keys ADR 0002 names: `id` (a ULID minted once for the bundle), `origin`, `ref`, `owner`, and `content_version`. Concept files sit beneath it in any folders. `index.md` and `log.md` are skipped at any level.

**The flags.** `--as` names the Admin the run acts as. Every commit carries their name and email, and every audit event their person id, so the run is never a platform principal. An Editor or a Viewer is refused, because an import writes across every collection. `--sensitivity` is where every landed concept starts, `Internal` by default.

**The checks.** One unsound file refuses the run, naming the file and the reason. A file is unsound if it does not parse, has no `type` or `title`, links (relative `.md`) to a file that is not a concept in the tree, has a `verified` event whose `human:<email>` is not a member (invite them first), sits at a path the platform keeps or cannot hold, or derives another file's merge key. A missing or malformed manifest refuses the run, as does a manifest standing in the workspace under another id.

**What a run writes.** The manifest is the bundle's first commit. Each concept follows in path order through the governed write, as its own commit, with `verified[].by` rewritten from email to person id, `sources[]` kept as the file's projection, no evidence, and status `stable`. Each `verified` event becomes an imported verification with its audit event, read as *Verified by … · imported*. A second pass rewrites every relative `.md` link in a body to the IRI minted for that path, keeping the link text, with one governed write per file and a base precondition on the hash the first pass landed. A file with no relative link left is skipped, so the second pass is idempotent. After a full run, no concept file under `knowledge/` carries a relative link or an email.

The run prints `rewrote <path> — <n> links` per file, and closes with `import-bundle: done — landed <n>, skipped <n>, <n> verifications recorded (<n> already present), <n> links rewritten, <s> seconds`. A rerun is safe. It skips concepts already at their path, verifications already held, and links already IRIs, and says so.

**Exit codes.** `pnpm ops` with no command prints the same table.

| Exit | Meaning |
| --- | --- |
| 0 | Done. |
| 1 | The run stopped at a named file or commit, the tree is unsound, the manifest commit was refused as malformed, or a refusal has no word, such as a bundle store that cannot be opened or a directory that cannot be read. |
| 2 | A usage error (a missing `--workspace`, `--from` or `--as`, an unknown `--sensitivity`, or a value given to `--dry-run`), or a refusal of the class `malformed`. |
| 3 | A database the migration has not reached. |
| 4 to 9 | A refusal, by its word's class: 4 `unauthenticated`, 5 `forbidden`, 6 `absent`, 7 `inapplicable`, 8 `conflict`, 9 `precondition`. |

## Update a concept's body in place

Use this procedure to fix a standing concept's content without editing it, such as to remove a bid writer's note from an imported `Answer`. Run it on the `api` service, with the new body on standard input:

`pnpm ops update-concept-body --workspace <id> --iri <iri> --as <member email> [--expect <content hash>] [--dry-run]`

1. Read the concept's file. `git --git-dir "$GIT_STORE_DIR/<workspace id>.git" ls-tree -r --name-only main` lists the paths, and `git --git-dir "$GIT_STORE_DIR/<workspace id>.git" show main:<path>` prints the file. Its frontmatter carries the `iri`. The body is everything after the frontmatter's closing `---` and the blank line below it.
2. Save the whole new body to a file on the box, and pipe it into a dry run with no `--expect`: `docker exec -i "$api" pnpm ops update-concept-body … < new-body.md`, with `$api` the `api` service's container. The first line is `update-concept-body: <path> stands at <hash>; pass it as --expect`. The diff follows, marking lines with two spaces (both), `- ` (held only), or `+ ` (new only).
3. If the diff removes only what you meant to remove, run again without `--dry-run` and with `--expect <the hash from step 2>`. The done line is `update-concept-body: done — <path> moved from <old hash> to <new hash>, commit <short sha>; frontmatter, status, verification and citations kept`.

The command replaces the body and nothing else. The frontmatter's bytes, the status, the verification rows, and the citations stay. It is one governed commit through the concept page's save route, with reuse taken as confirmed, and one `knowledge.concept.committed` audit event naming both hashes. An imported verification keeps reading *Verified by … · imported*. A hashed verification reads *Changed since verified* until someone verifies again.

`--as` must be the concept's owner or an Admin, for the dry run too. A Restricted concept needs an Admin, because to an Editor it is absent.

**Refusals** write nothing.

| Refusal | Exit | Meaning and what to do |
| --- | --- | --- |
| `stale-precondition` | 8 | The concept moved off the `--expect` hash, or its file is ahead of its row while another write lands. Run the dry run again. If it repeats a minute later, the rows are behind the bundle, so go to page 10. |
| `no-such-concept` | 6 | The IRI names no concept the `--as` member can read. |
| `unchanged` | 7 | The body renders as the one held, as after a done line. |
| `widening-refused` | 7 | The concept is held narrower than its sources' documents, and the update would widen it. Escalate to the technical contact. |
| `no-such-document` | 7 | A source cites a document the catalogue no longer holds. Escalate to the technical contact. |
| `body-locator-refused` | 7 | The body names a passage locator no source cites. Cite it in the sources first, or leave it out. |
| `not-a-member` | 4 | The `--as` person is not a member. |
| `role-forbids` | 5 | The `--as` person is a Viewer. |
| none | 2 | A usage error: a missing `--workspace`, `--iri` or `--as`, a write with no `--expect`, a value given to `--dry-run`, an empty standard input, or a malformed IRI. |
| none | 1 | No word, such as a bundle store that cannot be opened, or a concept file missing or unparseable at the head. Stop and escalate, because page 10 comes before any update. |
| none | 3 | A database the migration has not reached. |

## Provision the first customer and land its bundle

Use this procedure to land the first customer on staging, then on production. First check three gates:

- T-209 is merged, so a concept path another writer holds refuses before the commit.
- Page 10's rewind stands.
- The bundle's checker is green, with `manifest.yaml` at its root: `id` a ULID that never changes between staging and production, `origin: company`, `ref` the libraries' titles and versions as the bundle's report names them, `owner` as ADR 0002 defines it, and `content_version` the first.

1. **Bring staging up** (the procedure above) at the digests `build.yml` last pushed.
2. **Have two people sign in with an email code and give a display name.** The page after the code asks each for the display name. Both finish before step 3, because a workspace is never provisioned around a person the identity set does not hold or who has given no display name. One is the running Admin, the owner, who reads only what they already hold as the platform's developer. The other is the verifier every `verified` event names. If one cannot sign in, add them with `add-person` (below).
3. **Run `pnpm ops provision-workspace --name <name> --short-name <short name> --admin <the Admin's email>`** on the `api` service. Copy the workspace id the done line begins with.
4. **Run `pnpm ops add-member --workspace <id> --email <the verifier's email> --role Admin`.** The verifier owns the content and will administer the workspace.
5. **Copy the tree to the box**, `manifest.yaml` with it.
6. **Run `pnpm ops import-bundle --workspace <id> --from <directory> --as <the Admin's email> --dry-run`**, then the same without `--dry-run` (the procedure above).
7. **Smoke and open.** Run `pnpm ops smoke --url <origin> --workspace <id> --find`. Through the MCP surface as a member, `find` a question the bundle answers and `open` the concept it names. Check for *Verified by <the verifier's name> · imported* under the answer.
8. **Record the numbers** from the closing line (landed, skipped, checks, links, seconds) in the estate-size record, staging's beside production's.
9. **Wipe staging** by the drill's own wipe (the procedure above). The `staging-wiped` ping is the proof.
10. **Run steps 2 to 8 on production**, on VPC 1, with the same two people, the same short name, and the manifest's id unchanged. C1's brief records these numbers as the first measurement of a real customer.

**Add a person who cannot sign in.** **`pnpm ops add-person --email <address> --name <display name>`** on the `api` service writes a person whose mail the operator cannot read, with the address unverified. It records `people.person.added` in the identity-set audit log under the platform's actor id, and its done line begins with the person's id. Their first email-code sign-in marks the address verified and asks no display name. It refuses `malformed` (not an address), a `display-name-…` word, or `person-exists`, an address held under any case, whose person is taken as they stand.

**Refusals.** `provision-workspace` creates the workspace, its partition, the Admin's member row, its configuration row, its audit event, and its bare bundle repository under `GIT_STORE_DIR`. It writes nothing when it refuses. `REFUSED — no-such-user` means step 2 is not done for that person. `no-display-name` means they must sign in again and give one. `slug-taken` means another workspace holds the short name. `add-member` refuses `no-display-name` the same way, and `already-a-member` on a repeat, because changing a role is the Admin's action on the People page. Any role satisfies the loader. Add further people the same way, or by invitation once P1 lands.

**On staging.** Staging has no mail and no public hostname. Run steps 2 and 7 inside the staging `api` container against its loopback. The codes go to a mail catcher on the platform network. Set the display name by hand in staging's database. The MCP read runs the claude.ai assistant's OAuth flow to a bearer, then calls `/mcp`. Start only `objectstore` of the stores stack, since `backup` would ship staging's rows off-host.

**On production,** the steps run as written. The running Admin may be the operator's own address, and the verifier may be added by `add-person`, as the first customer was.

## Make or unmake the operator

Use this procedure to make a person the operator, whom the console serves, or to clear the mark. No page can.

1. Check that the person has signed in with an email code, or was added by `add-person` (the procedure above). An unknown address refuses `REFUSED — no-such-user`.
2. Run `pnpm ops operator --email <address> --grant` on the `api` service, or `--revoke` to clear the mark. No other command sets or clears it.

Each change writes `people.operator.granted` or `people.operator.revoked` to the identity-set audit log under the platform's own actor id. A person already as asked is left alone. The console answers the operator from their ordinary session, never an OAuth token, and clearing the mark refuses their next request. Inside a workspace the operator holds only their role there. An erasure that pseudonymises the person clears the mark.

## Restore a person's sign-in

Use this procedure when an Admin who has lost every second factor and every recovery code asks the operator to restore them. No page can.

1. Check who they are by a channel other than their email: a call to a number already on file, or in person.
2. Run `pnpm ops restore-sign-in --email <address>` on the `api` service.
3. Read them the restore code it prints, by the channel you checked them on, and never by email.

In one transaction the command ends their passkeys, authenticator, recovery codes, and sessions, and records `people.person.sign_in_restored` in the identity-set audit log under the platform's own actor id. It emails a notice that never carries the code. The code works once, for 24 hours, and a second restore voids it. Their next email sign-in asks for it before any factor can be added. The command changes nothing for an unknown address (`REFUSED — no-such-user`), or when the `api` service has no `SMTP_URL`. If the notice does not go, the restore stands, and the output says to tell them yourself.

## Set a workspace's model key

Use this procedure to set or replace a workspace's model key, its own key for a model provider. No page can, and nothing reads a provider's key from the environment (`SECRETS.md` § A workspace's model key).

1. **Once per estate, set the envelope key.** Make it with `openssl rand -hex 32` (64 hexadecimal characters). Put it into the escrow vault first, because a row sealed under a lost key is lost with it. Then set it as the `api` service's `KEK`. If `KEK` already holds a value of another shape, replace it and redeploy. That loses nothing while no model key is set.
2. **Run `pnpm ops set-model-key --workspace <id> --provider <anthropic|mistral|cloudflare>` on the `api` service, with the key on standard input,** never as an argument:

   ```sh
   read -rs MODEL_KEY && printf '%s' "$MODEL_KEY" | docker exec -i "$api" pnpm ops set-model-key --workspace <id> --provider anthropic; unset MODEL_KEY
   ```

3. **To rotate,** issue a new key at the provider, run the command again, then revoke the old key. On a leak, revoke first.
4. **After this release, run the browsing role's file again** (§ Browse production, step 3), not before. Before the migration it finds no `model_key` and grants nothing. It withholds the sealed key from `browse_ro`, and leaves each row's `workspace_id` and `provider` readable, which the query below relies on.

Without a valid `KEK`, the command refuses `KEK must be set to the envelope key`, and the `api` service logs `no model will be called`. The done line names the workspace and the provider, never the key. Each run records `platform.workspace.model_key_set` in the workspace's audit log, under the platform's own actor id. A workspace holds one key per provider, and has no model from a provider it holds no key for.

**A Cloudflare key** is for Workers AI, which runs the decision models. It is `<account id>:<API token>`, as in `0123456789abcdef0123456789abcdef:<token>`, where the account id is the 32 lower-case hexadecimal characters on the dashboard's account page and the token may run Workers AI.

**Refusals** write nothing. `malformed` is a bad workspace id, a provider outside the three, an empty standard input or one holding a space or line break, or a Cloudflare key in another form. `no-such-workspace` is an id no workspace holds. `not built`, exit 3, is a database the migration has not reached.

**Which workspaces hold a key.** Through the browsing login, `SELECT workspace_id, provider FROM model_key ORDER BY 1, 2`.

**After `KEK` changes,** rows sealed under the old key no longer open, and nothing reports it until a model call refuses. List the pairs before the change, and set each key again after.

**After a compromise of `KEK`,** every key sealed under it is leaked. Sealing the same keys again under a new `KEK` protects nothing. Revoke each at its provider, issue a new one there, set a new `KEK`, redeploy, and set each new key.

**After a restore,** a key replaced since the dump is back and still opens, so nothing refuses until the model provider does. Set each such key again (`BACKUPS.md` § Recovery order).

## Set a model's price and a workspace's spending limit

Use this procedure to let a workspace's questions call a model. A question calls one only with a model choice for the purpose, a price for the model on the day, and a workspace spending limit. Otherwise `ask` answers with its evidence alone. No page can set these. Prices, `cost_gbp`, and the limit are in pounds sterling, and no exchange rate is read at call time. The model choice turns the judge on, so set it last. The next question with an `Answer` among what bears on it then calls the model.

1. **Price the model, once per estate and whenever the provider's price or the exchange rate moves.** Convert the provider's list price in US dollars, from its price page, to pounds at that day's rate, and set it from that day. For a decision model on Workers AI, which charges for input alone, pass `--provider cloudflare --model clef-flash --gbp-per-million-out 0`.

   ```sh
   docker exec "$api" pnpm ops set-model-price --provider anthropic --model claude-sonnet-5-5 \
     --from <yyyy-mm-dd> --gbp-per-million-in <the input price in pounds> --gbp-per-million-out <the output price in pounds>
   ```

2. **Set the workspace's monthly limit.** The limit applies to each calendar month, by UTC, until a second run replaces it:

   ```sh
   docker exec "$api" pnpm ops set-spending-limit --workspace <id> --gbp <pounds>
   ```

3. **Set a decision model's threshold** once the owner's decision reading has chosen one, before any workspace chooses the model (§ Read the decision models). The threshold is the probability at or above which the model's yes is taken. It is a decimal strictly between 0 and 1, such as `0.7`:

   ```sh
   docker exec "$api" pnpm ops set-decision-threshold --provider cloudflare --model clef-flash --threshold <probability>
   ```

4. **Choose the workspace's model for a purpose** once the model has a price in effect today:

   ```sh
   docker exec "$api" pnpm ops set-model-choice --workspace <id> --purpose judging --provider anthropic --model claude-sonnet-5-5
   ```

**Prices and thresholds** belong to the model and hold for every workspace. A call takes the latest price on or before its UTC day. Set a new price from the day it moves rather than editing an old one. A second run for the same day replaces it. `platform.model.priced` and `platform.model.threshold_set` go to the identity-set audit log, under the platform's own actor id. A model on the Messages API takes no threshold.

**The limit.** The amount is the setting itself, read as in *Reading the spend* below. Spend counts from the first of each month. At the limit `ask` refuses `spending-limit-met`, a precondition, and tells the person their Admin can ask better-answers to raise it. `find` and `open` keep working. Each run records `platform.workspace.spending_limit_set` in the workspace's audit log.

**The model choice.** A second run for a purpose replaces it. The provider must be a sub-processor the DPIA names, and a call also needs the workspace's model key (§ Set a workspace's model key). Each run records `platform.workspace.model_choice_set`. The embedding model is fixed.

**No decision model can be chosen yet.** No threshold is set, because the owner's decision reading of 21/10/2026 found none that makes Clef or Clef-flash a judge on the reuse set, and the DPIA does not name Cloudflare. A decision model with no threshold is never called. Its judging fails, and the `api` logs `llm: a model call never sent` with `read` `no-threshold`.

**Refusals** write nothing.

- `set-model-choice` checks, in order: `malformed`, `fixed-model-choice` (the embedding purpose), `no-decision-threshold`, `no-sub-processor` (`local` and `cloudflare` included), `no-such-workspace`, then `no-model-price`.
- `set-decision-threshold` refuses `malformed` for `0`, `1`, `1.0`, `.5` or any value not strictly between 0 and 1, and `not-a-decision-model` for `anthropic` and `mistral`.
- `malformed` is also a sum that is not pounds, a model name that is not lower case letters, digits, dots, and hyphens, a day not on the calendar, a provider outside the three, or a bad workspace id. `no-such-workspace` is an unknown id. `not built`, exit 3, is a database the migration has not reached.

**How a call is counted.** Before a call, `ask` reserves the most the call may cost at the day's price, in the transaction that would refuse it, so two questions cannot both pass the last of the limit. When the call ends, it becomes one `llm_call` row per attempt and the rest is released. A reservation lives ten minutes, and counts against the limit until settled. If the `api` stops mid-call, the daily sweep settles it as one failed `llm_call` row at the whole reserved cost, counted as `reservations_settled`. A refused settling is named under `refusals` with the sweep `spend`.

**Reading the spend** through the browsing login. This month's spend is `SELECT sum(cost_gbp) FROM llm_call WHERE workspace_id = '<id>' AND called_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`. The limit is `SELECT value FROM workspace_config WHERE workspace_id = '<id>' AND key = 'llm.spending_limit_gbp'`. A row names its question by `answer_id`, and never holds the prompt or the completion. After the release that adds these tables, rerun the browsing role's file (§ Browse production, step 3).

## Read the judge on the reuse set

Use this procedure to measure how well the judge tells an `Answer` that fits a question from one that differs in one qualifier, such as the plan, the module, the app, or the audience. Run it on the owner's machine with the owner's own model key, never in `check`.

1. **Have Docker running** and the checkout installed (`pnpm install`).
2. **Read the day's exchange rate**, in pounds per US dollar. Check the list prices in `packages/core/test/readings/reuse.reading.ts` against the provider's price page.
3. **Run it from `packages/core`.** `read -rs` keeps the key out of the command line and history:

   ```sh
   cd packages/core
   read -rs READING_ANTHROPIC_KEY && export READING_ANTHROPIC_KEY
   READING_GBP_PER_USD=<pounds per dollar> pnpm reading:reuse
   unset READING_ANTHROPIC_KEY
   ```

   To run one model or one effort, filter on the run's name, such as `pnpm reading:reuse -t "Haiku"` or `-t "effort low"`.

4. **Record the figures** as a row per run under *The reuse reading* in `docs/operations/readings.md`, with the day, the rate, and the commit.

The reading asks the 34 questions of the synthetic reuse set (`packages/core/test/fixtures/reuse-set.json`) through the product's own `ask`, entry step, and judge, in a throwaway Postgres container. It holds no customer content. It makes four runs: Claude Sonnet 5.5 and Claude Haiku 5.5, each at its default effort and at effort low. The default is high for Sonnet 5.5 and medium for Haiku 5.5. The product's judge sends no effort, so production runs the default. The key is sealed into the container's database, is never printed or logged, and is gone when the run ends and the container is removed.

Each run prints, under *Reuse reading*, then one line per miss:

- **fits found**, of 32, and how many never reached the judge.
- **hard negatives wrongly taken**, of 36, and how many never reached the judge.
- **other Answers taken**, `Answer`s judged to fit that the question names neither way.
- **questions the judge answered**. A failed call is left out of the counts and named on its own line.
- **spend** in pounds, from the run's `llm_call` rows.
- **judge latency**, the median and the worst, retries included.

A run whose judge answered nothing fails. Report any *never sent* figure above zero. A run makes 34 calls of about 2,000 tokens in. All four runs cost about £1 at a rate near 0.75, and at most about £9 with every call spending 16,000 tokens out. Each run's workspace has a £20 spending limit.

## Read the decision models

Use this procedure to measure Clef-flash and Clef, the decision models on Cloudflare's Workers AI. It runs like the reuse reading, over synthetic content only, never in `check`.

1. **Have Docker running** and the checkout installed (`pnpm install`).
2. **Make a Workers AI key**, written as `<account id>:<API token>` (§ Set a workspace's model key).
3. **Read the day's exchange rate**, in pounds per US dollar. Check the list prices in `packages/core/test/readings/decision.reading.ts` against each model's page on Cloudflare's site.
4. **Run it from `packages/core`:**

   ```sh
   cd packages/core
   read -rs READING_WORKERS_AI_KEY && export READING_WORKERS_AI_KEY
   READING_GBP_PER_USD=<pounds per dollar> pnpm reading:decision
   unset READING_WORKERS_AI_KEY
   ```

   To run one model, threshold, or way, filter on the run's name, such as `pnpm reading:decision -t "Clef-flash"`, `-t "threshold 0.7"` or `-t "entry step"`.

5. **Record the figures** as a row per run under *The decision reading* in `docs/operations/readings.md`, with the day, the rate, and the commit.

The owner then chooses a threshold, if any, and sets it with `set-decision-threshold`. S2b's brief records which backend the first customer's workspace runs, and why.

The reading measures two ways:

- **On reuse,** as the judge's decision backend, at thresholds 0.3, 0.5, 0.7 and 0.9, under *Reuse reading, Clef-flash at threshold 0.7* and the like. No threshold is calibrated yet.
- **At the entry step,** against S2a's recall baseline. For each question of the 340 paraphrases and the 154 buyer-worded questions, the model scores the entry step's first 20 points, and the reading reports recall in the first ten beside `find`'s and the entry step's own, under *Entry step reading*. The product's entry step calls no model.

The container seeds the model choice, because `set-model-choice` refuses Cloudflare until the DPIA names it, and stores each threshold in its `decision_threshold` table. A run that judged or scored nothing fails. An unscored point keeps the entry step's order. Clef-flash costs $0.038 and Clef $0.24 per million tokens in, with no output charge. All runs together cost well under £1. The reuse runs' workspaces have a £20 limit, and the entry step's calls are bounded to about £3 in all.

## Read a workspace's unmapped-passage rate

Use this procedure to read a workspace's unmapped-passage rate, the second reading that can bring vectors in, beside recall at ten on the customer's answer tests:

```sh
docker exec "$api" pnpm ops unmapped-passage-rate --workspace <id>
```

It prints one JSON line, such as `{"with_the_map":{"flagged_incomplete":3,"showed_unmapped_passages":2},"map_unavailable":{"flagged_incomplete":1,"showed_unmapped_passages":1},"map_unknown":{"flagged_incomplete":0,"showed_unmapped_passages":0}}`. In each pair, the first count is the *Questions asked* records with an *incomplete* flag, open or closed, each record counted once. The second is how many of them showed an unmapped passage. Read the two together, never as one percentage.

- `with_the_map` is the reading: answers the map answered.
- `map_unavailable` is answers from search alone, while the map was unavailable.
- `map_unknown` is records kept before records kept the map's state.

The command runs read-only, scoped to the workspace, and prints no question, note, or passage. The console cannot read a workspace's records. `malformed`, exit 2, is a bad workspace id. An unknown id reads as zeros. `not built`, exit 3, is a database the migration has not reached.
