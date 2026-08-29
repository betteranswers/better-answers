# Runbook — five pages and two procedures

Each entry: the dead-man check that fires, what to do, the drill that rehearses it.

**This is the public half.** The pages below state *what happens* and *in what order* — the shape one non-technical owner follows. The estate's own half — the provider console to open, the exact host paths, the named credential list to rotate, the addresses and the recorded results — is **not published**: it is `.planning/estate/RUNBOOK.md`, outside the repository, beside `.planning/estate/SECRETS.md` and `.planning/estate/coolify.md` (ADR 0027, ticket 79 Q10; ticket 77's acceptance line). An operator runs from the private copy; a reader learns the design from this one. Detail on the classes and the rotation contract is in `deploy/SECRETS.md`; on the copies, in `deploy/BACKUPS.md`; on the shape of the deployment, in `deploy/coolify.md`.

The estate is two 4 GB boxes (ADR 0024): VPC 1 is production, VPC 2 is the orchestrator, the git mirror and a restore target — staging exists only while someone has brought it up.

## 1. A box is down

- **Fires:** the scheduler's check missed (VPC 1). Nothing fires for VPC 2 — you notice, or the drill does not run. *(That blind spot is real and is written down here rather than left implicit; an external check on the orchestrator is a named build task, `T-005`.)*
- **Do:** open the provider's console and read the server's status. **VPC 1:** reboot — the stacks are `restart: unless-stopped`, `init` re-owns `/data`, and the orchestrator shows the stack healthy within minutes. If the disk is gone: a new box, `/data` created, the swap file created (§ Swap), the server re-added, the Postgres resource redeployed then both stacks, then **restore** in page 5's order (`restore-drill.sh` is the script — run it against production values by hand). **VPC 2:** reinstall the orchestrator at the pinned version and restore its instance backup (page 5).
- **Rehearsed by:** the monthly drill — VPC 1 rebuilt from nothing, on VPC 2.

## 2. Host compromise

- **Fires:** anything unusual — a firewall rule you did not make, an unknown process, a provider notice; a spike in `401`s on the machine route (ticket 42).
- **Do:** **isolate** (deny all inbound at the provider's firewall; revoke the tunnel token so nothing reaches the app). **Rotate every host-side credential** — that is every row in the estate's secrets inventory whose *Lives in* column names a box, and no others: the bucket write-and-list pair, the registry pull token, the object store's root pair, the mirror deploy key, the auth secret and the mail credential. The **escrowed credentials were never on the box**; do not rotate the envelope key unless the database itself is suspected, because rotating it re-wraps every workspace data key. Then rebuild VPC 1 from a fresh image and **restore from a copy older than the compromise** — the dumps are under object-lock governance, so an attacker could not have altered them — and **replay erasures** after the dump, before the app turns healthy. Go to page 3 if personal data may have been read.
- **Rehearsed by:** the drill's restore path; the rotation list is reviewed at the quarterly erasure rehearsal.

## 3. Personal-data breach

- **Fires:** page 2, a client's report, a subject's report, a provider notice.
- **Clock:** 72 hours to the ICO from *awareness*, if the breach is likely to risk people's rights; the client (controller) is told without undue delay — the platform is the processor.
- **Do:** contain (page 2); establish scope from `audit_event`, `answer_audit` and the `backup_run` rows — which copies exist and who could have read them (`SECRETS.md` § Who can read a backup bucket); write the notification from those rows; tell the client's named contact; record the decision either way.
- **Rehearsed by:** the quarterly erasure rehearsal's report shape — the same rows answer both questions.

## 4. Erasure incident (a subject request that reaches git history)

- **Fires:** a `subject request` in Control Centre (ticket 24, ADR 0020).
- **Do:** ADR 0020's routine — the app holds `pg_advisory_lock(41)` so the hourly dump waits; history rewrite (`git filter-repo`) on the bare repository under its own lock, then `git reflog expire --expire=now --all` and `git gc --prune=now` there; `git push --mirror` to VPC 2 and the same expiry and `gc` on the mirror (there is no forge and no indexer — ADR 0024); the index, chunks, evidence and graph re-derived by a full rebuild (ADR 0023 — the graph is inside the same Postgres, so the rebuild is a repair path, and an erasure's flip and sweep are one step); suppression + reprocess for source entities; the object-store deletion propagates to the mirror bucket that night; the report quotes the three dates from the last dump before the rewrite (`BACKUPS.md`).
- **What the routine does not do:** it rewrites what the platform wrote — actor ids across history — and **not** a person's name written inside a concept body, which the owner edits forward as a new commit. The report says so in those words (ADR 0020's 2026-08-30 amendment).
- **Rehearsed by:** every third drill, on a synthetic subject.

## 5. The orchestrator is lost (VPC 2 rebuilt)

- **Fires:** nothing automatic — the drill fails to run, or a deploy fails.
- **Do:** install the pinned version; stop its containers; `pg_restore` its instance backup into its own database; **replace its SSH key directory from escrow** — it is not in the instance backup; set the previous-key variable if the app key changed; re-run the installer; re-add VPC 1; verify both stacks show healthy **without a redeploy**; then **re-escrow the app key**.
- **Rehearsed by:** once, before the first client goes live (the wizard's last stage); then yearly.

## Bring staging up / tear it down

Staging is on demand on VPC 2 (ADR 0024): nothing stands between drills. To bring it up, with the repository checked out on the box: `docker compose -f stores.compose.yaml -p <project>-stores-staging --env-file <staging env> up -d`, then the same for `platform.compose.yaml` — the staging Postgres resource is created in the orchestrator the first time and kept empty; pull the digests `build.yml` last pushed. `restore-drill.sh` does exactly this itself. To tear it down: `down --remove-orphans` on both, then wipe `/data/objectstore`, `/data/git`, `/data/worker/*`, the staging backup directory, and drop the staging schemas **including every per-workspace AGE graph schema** — the drill's `wipe_staging` is the reference and the `staging-wiped` ping is the proof. Staging holds client data only for the duration of a drill; a rehearsal that is not a drill uses the synthetic fixture.

## Swap

VPC 1 carries a 4 GB swap file on the NVMe so a first index that outgrows the worker's 1.5 GB cap slows down rather than fails (ADR 0024). Created once, on the box, as root: `fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`; then `/swapfile none swap sw 0 0` in `/etc/fstab` and `vm.swappiness=10` in `/etc/sysctl.d/99-swap.conf` (`sysctl -p` on that file). The swap-in rate during the first index is ticket 42's measurement — the worker heartbeat's `pswpin` figure, above 4 MB/s for five minutes (ADR 0025) — and a box that swaps steadily is the signal for the WireGuard split.
