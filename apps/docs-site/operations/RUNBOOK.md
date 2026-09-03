# Runbook — nine pages and two procedures

Each entry: the check that fires, what to do, the rows to attach, who to escalate to, the drill that rehearses it.

**This is the public half.** The pages below state *what happens* and *in what order* — the shape one non-technical owner follows. The estate's own half — the provider console to open, the exact host paths, the named credential list to rotate, the addresses, the **names behind each escalation contact** and the recorded results — is **not published**: it is `.planning/estate/RUNBOOK.md`, outside the repository, beside `.planning/estate/SECRETS.md` and `.planning/estate/coolify.md` (ADR 0027, ticket 79 Q10; ticket 77's acceptance line). An operator runs from the private copy; a reader learns the design from this one. Detail on the classes and the rotation contract is in `SECRETS.md`; on the copies, in `BACKUPS.md`; on the shape of the deployment, in `coolify.md`.

**Escalation contacts.** Every page names a *role* — the technical contact, the second escrow holder, the client's named contact. The private file's § Contacts maps each role to a person and a number, and is re-read at every quarterly erasure rehearsal. A page that cannot reach its contact within its stated time escalates to the second escrow holder, who can open the vault and act.

The estate is two 4 GB boxes (ADR 0024): VPC 1 is production, VPC 2 is the orchestrator, the git mirror and a restore target — staging exists only while someone has brought it up.

## 1. A box is down

- **Fires:** the uptime check on the product's two paths (`coolify.md` § Ingress) goes red on the second channel; the scheduler's dead-man check misses (VPC 1). For VPC 2 nothing fires within the hour — the daily `coolify-backup` ping and the monthly `drill` ping are the only watchers, so a VPC 2 outage is noticed within a day, not a minute. That blind spot is written down here rather than left implicit.
- **Do:** open the provider's console and read the server's status. **VPC 1:** reboot — the stacks are `restart: unless-stopped`, `init` re-owns `/data`, and the orchestrator shows the stack healthy within minutes. If the disk is gone: a new box, `deploy/host-setup.sh vpc1` (it creates `/data`, the swap file and the mirror key), the server re-added in the orchestrator, the Postgres resource redeployed then both stacks, then **`deploy/restore-production.sh --objectstore --git`** with the backup identity fetched from escrow for the duration and deleted after. That script is the production restore: it wipes nothing, has no exit trap, needs no second database, and replays every erasure completed after the dump before `api` starts — it is **not** `restore-drill.sh`, which is the staging rehearsal and ends by wiping what it restored. **VPC 2:** reinstall the orchestrator at the pinned version and restore its instance backup (page 5).
- **Attach:** the provider's status page or ticket; the restore log the script writes under `/var/log/`; the dump name and its stamp (the RPO); the RTO the script prints.
- **Escalate:** the technical contact if the box is not back within one hour; the client's named contact once the RTO passes two hours.
- **Rehearsed by:** the monthly drill — VPC 1 rebuilt from nothing, on VPC 2.

## 2. Host compromise

- **Fires:** anything unusual — a firewall rule you did not make, an unknown process, a provider notice; a spike in `401`s on the machine route (ticket 42).
- **Do:** **isolate** (deny all inbound at the provider's firewall; revoke the tunnel token so nothing reaches the app). **Rotate every host-side credential** — that is every row in the estate's secrets inventory whose *Lives in* column names a box, and no others: the bucket write-and-list pair, the registry pull token, the object store's root pair, the mirror deploy key, the auth secret and the mail credential. The **escrowed credentials were never on VPC 1**; do not rotate the envelope key unless the database itself is suspected, because rotating it re-wraps every workspace data key. Then rebuild VPC 1 from a fresh image and **restore from a copy older than the compromise** (`restore-production.sh --dump <the copy>`) — the dumps are under object-lock governance, so an attacker could not have altered them — and the script **replays erasures** after the dump, before the app turns healthy. Go to page 3 if personal data may have been read.
- **If the compromised box is VPC 2:** the backup `age` identity is **resident there in a root-only file** (`SECRETS.md` § The backup identity), so assume **every dump and bundle in the buckets was readable in plaintext** — that is every client's personal data — and page 3 applies without further evidence. Rotate the identity by that section's procedure, the bucket READ credential, the mirror key's accepted public half, and every orchestrator token; rebuild VPC 2 (page 5) before the drill runs again.
- **Attach:** the provider notice or the log line that fired; the rotation list with each row ticked and timed; the dump name restored from.
- **Escalate:** the technical contact immediately; the second escrow holder if a rotation needs the vault and the owner is unreachable.
- **Rehearsed by:** the drill's restore path; the rotation list is reviewed at the quarterly erasure rehearsal.

## 3. Personal-data breach

- **Fires:** page 2, a client's report, a subject's report, a provider notice.
- **Clock:** 72 hours to the ICO from *awareness*, if the breach is likely to risk people's rights; the client (controller) is told without undue delay — the platform is the processor.
- **Do:** contain (page 2); establish scope from `audit_event`, `answer_audit` and the `backup_run` rows — which copies exist and who could have read them (`SECRETS.md` § Who can read a backup bucket: a VPC 2 compromise means the copies' plaintext, because the identity is resident there); write the notification from those rows; tell the client's named contact; record the decision either way.
- **Attach:** the rows above; the containment times from page 2; the notification sent or the reasoned decision not to.
- **Escalate:** the client's named contact within 24 hours of awareness; the technical contact for scope; a solicitor if the ICO question is not clear-cut.
- **Rehearsed by:** the quarterly erasure rehearsal's report shape — the same rows answer both questions.

## 4. Erasure incident (a subject request that reaches git history)

- **Fires:** a `subject request` in Control Centre (ticket 24, ADR 0020).
- **Do:** ADR 0020's routine — the app holds `pg_advisory_lock(41)` so the hourly dump waits; history rewrite (`git filter-repo`) on the bare repository under its own lock, then `git reflog expire --expire=now --all` and `git gc --prune=now` there; `git push --mirror` to VPC 2 and the same expiry and `gc` on the mirror (there is no forge and no indexer — ADR 0024); the index, chunks, evidence and graph re-derived by a full rebuild (ADR 0032 — the graph is plain tables in the same Postgres, so the rebuild is a repair path, and an erasure's flip and sweep are one step); suppression + reprocess for source entities; the object-store deletion propagates to the mirror bucket that night; the report quotes the three dates from the last dump before the rewrite (`BACKUPS.md`).
- **What the routine does not do:** it rewrites what the platform wrote — actor ids across history — and **not** a person's name written inside a concept body, which the owner edits forward as a new commit. The report says so in those words (ADR 0020's 2026-08-30 amendment).
- **Attach:** the erasure report; the `erasure_request` row; the last dump's stamp.
- **Escalate:** the client's named contact with the report; the technical contact if the rewrite fails its verification.
- **Rehearsed by:** every third drill, on a synthetic subject.

## 5. The orchestrator is lost (VPC 2 rebuilt)

- **Fires:** nothing automatic — the `coolify-backup` ping misses, the drill fails to run, or a deploy fails.
- **Do:** `deploy/host-setup.sh vpc2` on the new box (the mirror user, the checkout, the root-only env files, the drill's cron); install the pinned version; stop its containers; `pg_restore` its instance backup into its own database; **replace its SSH key directory from escrow** — it is not in the instance backup; set the previous-key variable if the app key changed; re-run the installer; re-add VPC 1; verify both stacks show healthy **without a redeploy**; then **re-escrow the app key**. Put the backup identity back into its root-only file from escrow; the drill needs it.
- **Attach:** the instance-backup name restored; the time both stacks showed healthy.
- **Escalate:** the technical contact if VPC 1's stacks do not show healthy after the re-add; the second escrow holder for the vault.
- **Rehearsed by:** once, before the first client goes live (the wizard's last stage); then yearly.

## 6. A release went wrong

- **Fires:** `release.yml`'s post-deploy smoke is red; the uptime check goes red within minutes of a promotion; the orchestrator's *failed deployment* or *unhealthy container* mail.
- **Do:** open **`deploy/RELEASES.md`**. The row above the one just written is the release that worked: run `release` again with that row's two digests as the inputs and `rehearsed_by: hotfix: rollback of <the failed row>`. Migrations are forward-only (`[OPS1]`): a migration that cannot run under the previous release says so in its release note, and then the rollback is page 1's restore from the last hourly dump instead of the previous digest. Read the deploy log in the orchestrator before either — a stack that never came up (a missing env key: the app refuses to start unless `PUBLIC_URL`, `AGENT_HOSTNAME` and `APEX_HOSTNAME` are set and differ, ADR 0034) is fixed by the key, not by a rollback.
- **The switch (ticket 79 Q7):** the day the first client's data is on the box, set the repository variable `CLIENT_DATA_ON_BOX` to that date. From then on `release` refuses to run unless `rehearsed_by` names the drill report a restore was just proved on, or a hotfix reason — one deploy train a month, on the drill day, plus hotfixes. Before that day any green build may be promoted, and the smoke is the last step.
- **Attach:** the two `RELEASES.md` rows (failed, rolled back to); the workflow run; the orchestrator's deploy log; the body `/health` answered.
- **Escalate:** the technical contact if the rollback does not turn `/health` green within 30 minutes; the client's named contact if the product was unreachable for more than an hour.
- **Rehearsed by:** the first release after the first drill is rolled back on purpose, once, and the row is kept.

## 7. A backup check is red

- **Fires:** `pg-hourly`, `nightly`, `coolify-backup` or `drill` late or failed at the dead-man service, on the **second channel** (all four alert there — a missed backup is not an email to read on Monday).
- **Do:** read the stores stack's `backup` service log in the orchestrator and match the line to `BACKUPS.md` § The backup service's own failure modes — a full `/staging`, a rotated bucket credential, a mirror push refused, a dump skipped while the erasure lock is held (that one clears itself). List the dumps bucket per tier (`rclone lsf dumps:<bucket>/pg/<tier>/`) and read the last `backup_run` row per store. **Two consecutive `pg-hourly` misses mean the recovery point is now the last good dump and growing**: no release (page 6) and no rehearsal until green. `coolify-backup` red is the orchestrator's own S3 storage or credential — page 5's restore depends on it. `drill` red is page 5 or a failed step in the drill's report under `drills/`.
- **Attach:** the failing job's log lines (never a path or key — the log holds none); the last `backup_run` row per store; the bucket listing per tier; the dead-man service's ping history for the check.
- **Escalate:** the technical contact if any check is still red after 24 hours or after one attempt to fix; the client's named contact only if the recovery point passes the RPO their contract states.
- **Rehearsed by:** the drill's step 8 (the bucket listing against the matrix); the `staging-wiped` check proves the drill's last step ran.

## 8. A client reports wrong or lingering content

- **Fires:** a client's message: an answer is wrong, a concept says something false, a source they removed still answers, or a person's data is still visible.
- **Do — wrong content:** find the answer's `answer_audit` row (the System screen; by the person and the time) and the concept it asserts. The correction is a governed write: the Admin edits the concept forward as a new commit, or files a *finding* on it (ADR 0014, 0017); the answer's row is marked *corrected* so the record shows what was said and when it changed. Nothing is deleted.
- **Do — lingering content:** a removed *source* stops answering at the binding's next run — read the binding's last run row; if no run has happened, start one. Its object-store originals are deleted on that run and the deletion reaches the mirror bucket that night; dumps holding it expire on the tiers (`BACKUPS.md` § The retention schedule) and are beyond use meanwhile. A *person's* data is page 4, and the report's dates are the answer to "when is it gone from every copy".
- **Attach:** the `answer_audit` or `audit_event` row; the concept's `bundle_commit`; the binding's last run row; the `backup_run` rows that bound the retention dates; the client's message.
- **Escalate:** the client's named contact is answered within one working day with the row and the date; the technical contact if the next run does not remove the content; page 3's contacts if personal data was served to someone who should not have seen it.
- **Rehearsed by:** the quarterly erasure rehearsal (lingering); the first client's onboarding, where a deliberately wrong concept is corrected end to end (wrong).

## 9. Both boxes lost at once

- **Fires:** nothing automatic beyond page 1's uptime check — you notice that the orchestrator is unreachable too. Cause: the provider, an account compromise, or a payment lapse.
- **Do, in this order (half a day):** two new boxes at the provider; **`host-setup.sh vpc2`**, the orchestrator at the pinned version, its instance backup and SSH keys back from the dumps bucket and escrow (page 5); **`host-setup.sh vpc1`**, the server re-added, the Postgres resource on the pinned image by digest, the two stacks from this repository with every env value re-entered from the private inventory and escrow; then **`restore-production.sh --objectstore --git`** on VPC 1 with the identity from escrow; a new tunnel token if the old one was revoked; the uptime check green. Every value needed exists in exactly one of three places — the repository, the private file, the vault — and `SECRETS.md`'s inventory is the checklist.
- **Attach:** the restore log; the escrow access record (who opened the vault, when); the new addresses in the private file.
- **Escalate:** the **second escrow holder** is who acts if the owner cannot — this is the page the two-holder rule exists for; the client's named contact within the first hour with an RTO.
- **Rehearsed by:** never in full — the cost is a day. Its parts are: page 5 yearly, the drill monthly, and the second holder opening the vault once before the first client goes live.

## Bring staging up / tear it down

Staging is on demand on VPC 2 (ADR 0024): nothing stands between drills. To bring it up, with the repository checked out at `/opt/better-answers` and the staging env in the root-only file `host-setup.sh` creates: `docker compose --project-directory deploy --env-file /etc/better-answers/staging.env -f stores.compose.yaml -f staging.override.yaml -p better-answers-stores-staging up -d`, then the same for `platform.compose.yaml` (`up -d api` — the worker is behind the `pipeline` profile until `T-006`). The staging Postgres resource is created in the orchestrator the first time and kept empty; the digests are the ones `build.yml` last pushed, read from its run summary. `restore-drill.sh` does exactly this itself. To tear it down: `down --remove-orphans` on both, then wipe `/data/objectstore`, `/data/git`, `/data/worker/*`, the staging backup directory, and drop the three schemas the journal writes — `public`, `index` and `drizzle` — which is the whole wipe, because the graph is plain tables in `public` (ADR 0032). The drill's `wipe_staging` is the reference, `seed-synthetic.sh` re-seeds the fixture, and the `staging-wiped` ping is the proof. Staging holds client data only for the duration of a drill; a rehearsal that is not a drill uses the synthetic fixture.

## Swap

VPC 1 carries a 4 GB swap file on the NVMe so a first index that outgrows the worker's 1.5 GB cap slows down rather than fails (ADR 0024); `deploy/host-setup.sh vpc1` creates it once (`fallocate`, `mkswap`, `swapon`, the `fstab` line, `vm.swappiness=10`). The worker's own spill is bounded at 1.5 GB of swap by `memswap_limit` in `platform.compose.yaml`. The swap-in rate during the first index is ticket 42's measurement — the worker heartbeat's `pswpin` figure, above 4 MB/s for five minutes (ADR 0025) — and a box that swaps steadily is the signal for the WireGuard split; the page-cache floor in `BACKUPS.md` § Signals is the second trigger.
