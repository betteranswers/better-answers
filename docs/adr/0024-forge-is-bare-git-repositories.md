---
status: accepted
date: 2026-08-28
amends: 0005, 0007, 0012, 0020, 0022
---

# The forge is bare git repositories the app writes; v0.1 runs on two 4 GB boxes with staging on demand

**The constraint.** The two IONOS contracts cannot be resized — a bigger box is a third contract — and cash is tight before the first client pays (Liam, ticket 74, 28/08/2026). So the estate is **two boxes of 4 vCPU · 4 GB · 120 GB NVMe**, not the 16 GB + 8 GB ticket 41 sized. Client one embeds on the hosted route (ADR 0020 amended), so no embedding server runs in the first estate; with that, production is an estimated 3.5–4.5 GB — it fits one box if it is trimmed, and Coolify (whose documented minimum is 2 GB) takes the other.

**The shape (B — lean single box).** **VPC 1** runs everything production: the Postgres resource (`shared_buffers` 512 MB), `app`, `worker` **capped at 1.5 GB and one index run at a time** (`MAX_CONCURRENT_RUNS=1`), Garage, the git store, `cloudflared`, `backup`. A **4 GB swap file on the NVMe** is the safety net: a first index that outgrows the cap runs slower rather than failing, and how much the box swaps during it is a ticket-42 measurement. **VPC 2** runs Coolify, the git mirror, and a **restore target that exists only during a drill or a rehearsal** — staging is **on demand**, brought up from the same two compose files and wiped after, never standing. `build.yml` still builds and pushes every image on `main`; "staging redeploys on every build" becomes "staging deploys when someone brings it up". The first drill still precedes the first client's data (ADR 0022). The named growth steps, in order: **A** — split production across the two boxes over a WireGuard pair (Garage, git and backup to VPC 2; ~0.5 GB back; one client's data on two boxes) if 42's swap measurement says so, at £0; then **E** — a third IONOS contract when client one pays. Neither needs a data-model change. No IONOS private network joins the two existing servers (Liam, 28/08); nothing in shape B needs one — Coolify manages VPC 1 over SSH on its public IP, the mirror is `git push` over SSH, every client byte arrives through the tunnel.

**The forge.** ADR 0012 made the app the only committer and ADR 0022 gave Forgejo no human accounts and no public hostname, so Forgejo's UI, SSH server, user model and Postgres schema ran for nobody. They are removed. Each workspace's repository is a **bare git repository under `/data/git/<workspace>.git`** that the **app writes through the git binary in its own image** (`git` is a binary we consume, never code we write — ADR 0005) — the governed write is unchanged: one commit per act, the person as author, the platform bot as committer, the hash precondition checked against the ref before the commit, the ref updated under a per-repository lock the app holds. The **worker reads the repository at a commit over a read-only bind mount of `/data/git`** (same box in shape B and A); the per-run read-only token ADR 0012 named becomes the commit hash on the run row. For the **customer-hosted worker (v1.0)** the app serves the repository over git smart HTTP (`git http-backend` behind the app's principal check, read-only, under the run's token) — designed here, built when that worker is. Portability is what it was: the bundle snapshot and the repository export (a `git bundle`) through the app. The nightly bundles, the push mirror to VPC 2 (`git push --mirror` over SSH from the `backup` service, which already mounts the git store read-only) and the erasure routine's history rewrite (`git filter-repo` then `git gc --prune=now` on the bare repository — no indexer to rebuild) carry over one for one. Two fewer things in every dump (Forgejo's schema and role), one fewer service, one fewer upgrade-drill line, one fewer cause on the reconciler (*Forgejo unreachable* becomes a filesystem error on the app's own volume).

## Alternatives considered

- **A. Split production over WireGuard now** — ~0.5 GB more headroom for a permanent cross-box dependency on the box the drill wipes and rebuilds, and one tenant's data on two boxes. Kept as the first growth step, not the start.
- **C. Coolify off the estate** (plain compose + Actions over SSH) — frees room on VPC 2, whose RAM was never the problem; rewrites ADR 0022's resource, UI and second-backup-writer story. No.
- **D. Supabase for Postgres** (the old project's account exists) — Supabase does not ship Apache AGE (a C extension; not a trusted-language extension), so it would reverse ADR 0023 the day after it was accepted; ADR 0007 rejected it on idle services and vendor helpers; the Pro plan's included compute is a 1 GB Micro — no more RAM than the box — and every table would move to a new sub-processor. No. The old organisation is on a paid plan: it is exported and cancelled, the money earmarked for E.
- **E. A third contract before go-live** — ~£18/month the effort does not have yet. The fallback, named.
- **Keep Forgejo** — it fits (~0.3 GB); it was removed for simplicity, not RAM: a forge with no users is a service to patch, drill, back up and mirror for no one.
- **No swap; hard caps only** — an index that does not fit fails visibly and is retried smaller. Rejected: the first client's index is the one load test that must not fail; the swap-in rate is measured instead.
- **An in-app git library** (ADR 0012's "Home D") was rejected because a customer-hosted worker cannot mount a shared volume; the smart-HTTP read path above is the answer to that objection, kept for v1.0.

## Consequences

- `deploy/stores.compose.yaml`: `forgejo` and `embeddings` gone (~~the embedding service stays in the file commented out~~, for the workspace that chooses the local route — the compose file carries no commented-out service since T-321's strip, and `docs/operations/coolify.md` § The local embedding route is where it is written out); `init` owns `/data/git`; `backup` mounts `/data/git` read-only and pushes the mirror. `deploy/platform.compose.yaml`: `app` mounts `/data/git`; `worker` mounts it read-only, `MAX_CONCURRENT_RUNS=1`, memory limit 1.5 GB. `apps/docs-site/operations/coolify.md` § Boxes: the two boxes and the swap file. `apps/docs-site/operations/BACKUPS.md`, `RUNBOOK.md` and `SECRETS.md`, and `deploy/restore-drill.sh` and `deploy/backup.sh`: Forgejo rows and steps become the git store's; the Forgejo database credential and bot token leave `SECRETS.md`.
- Records: `backup_run` unchanged; the run row carries `bundle_commit` (the hash the worker checked out).
- Signals to ticket 42: **swap-in rate during a first index** (decides A), free memory on VPC 1 at 85 %, the git store's size per workspace.
- `CONTEXT.md`: *forge* — the bare repositories under `/data/git` the app writes; *staging* — on demand.
- Amends ADR 0005 (the git host is a bare repository the app writes and the worker mounts), 0007 (Forgejo's schema leaves the dump), 0012 (the Forgejo consequence), 0020 (the erasure routine's git step; Mistral EU as a sub-processor on the hosted embedding route), 0022 (box sizes, staging on demand, swap and caps, the forge).
- Owed: ticket 42 measures the estimates; the first build task owns the app's git module and its functional tests on a real bare repository (`[TEST]`).

**Amended by ADR 0025 (28/08/2026):** the swap measurement that decides step A is the worker heartbeat's `pswpin` figure — swap-in above 4 MB/s for five minutes during a first index.

## Amendment — 2026-08-30, the model-host box is a precondition, not a date (ticket 79, the pre-build gate; applied by T-001)

The constraint paragraph above says client one embeds on the hosted route "so no embedding server runs in the first estate", while `docs/vision.md` states local models as a principle. Both stand; the sentence that connects them was missing.

**A model-host box is a named precondition of local *embedding*, triggered by the first workspace that asks for it — never by a date.** The requirement `docs/vision.md` states is what ticket 38 settled: a local model must be usable in **any** purpose, per workspace, which the per-workspace route record keyed by purpose already delivers. Local embedding is the one purpose the first estate cannot host — a 3–5 GB CPU embedding server does not fit on a 4 GB box beside the Postgres resource, `app`, `worker`, Garage, the git store, `cloudflared` and `backup`.

So the trigger is a workspace choosing the local embedding route, and the step is **growth step E** — a third IONOS contract, sized for a model host, at roughly £20–40/month — brought forward from "when client one pays" to "when a workspace asks", whichever comes first. Until then the hosted route is the default and its processor is named in that workspace's DPIA entry and in the platform's sub-processor list (ADR 0020's Mistral EU amendment). ~~`stores.compose.yaml` already carries the embedding service commented out for exactly this.~~ Since T-321's strip that text lives in `docs/operations/coolify.md` § The local embedding route, which carries the service and what turns it on. Neither branch needs a data-model change.

## Amendment — 2026-09-08 (T-105), `GIT_STORE_DIR` names the forge's root, one repository per workspace under it

The forge paragraph above names the path literally (`/data/git/<workspace>.git`) without saying where `/data/git` comes from. It is **`GIT_STORE_DIR`**, an environment variable the api reads once at boot (`apps/api/src/config.ts`) and the estate sets to `/data/git` (`deploy/platform.compose.yaml`): where a workspace's bare repository lives, **one repository per workspace directly under it**.

Nothing before this amendment checked what the key actually named — an empty or relative value was joined against a workspace id and written wherever the process's own working directory happened to be, which is how a mutation run once left a bare repository at `packages/core/undefined/`. The git door (`openGit`, `packages/core/src/store/git/index.ts`) is now the one place that checks: the root must be an absolute path that exists as a directory, or the door refuses before a `GitDoor` can be built from it, and every entry that writes into a workspace's repository — `initRepository` included — trusts the root the door already checked rather than checking it again.

## Amendment — 2026-09-11 (T-125), the mirror key's grammar is three verbs: `prune-repo` joins `init-repo` and `git-receive-pack`

The forge paragraph above gives the mirror on VPC 2 its whole surface — `git push --mirror` over SSH from the `backup` service, under a deploy key that can neither open a shell nor forward a port — and `deploy/mirror-shell.sh`'s forced command has accepted exactly two verbs since the day it was written: `init-repo <ws>`, because `git-shell` alone would refuse the first push to a workspace that has no mirror yet, and `git-receive-pack`. That grammar was one verb short of what ADR 0020 promises.

**What changed.** ADR 0020 requires `git reflog expire` and `git gc --prune=now` on **both** copies of a history the erasure routine rewrote, and the mirror is the second copy. A `git push --mirror` that replaces refs leaves the objects it replaced on VPC 2, reachable through the reflog `git-receive-pack` writes; nothing on that box then removed them, so the mirror went on holding what production had erased, and the disagreement was silent — the push reported success and the erasure report quoted dates the mirror was not keeping.

**So the key gains a third verb, `prune-repo <ws>`**: argument-checked exactly as `init-repo` is (one path segment of DNS-safe characters, refused otherwise), taking a workspace id and no options, refusing a mirror that does not exist, and running `git reflog expire --expire=now --all` and `git gc --prune=now` on that one repository. `deploy/backup.sh`'s `job_git_mirror` calls it only after a push whose `--porcelain` report carries a forced update (`+`) or a deletion (`-`), which is precisely *refs were replaced*; an ordinary fast-forward night prints neither and prunes nothing. It is a verb on this key rather than a cron on VPC 2 because the push is the only thing that knows a rewrite happened, and ADR 0020's amendment of the same date already records that this prune is the backup service acting for the routine.

**What still stands.** The surface is a closed list and everything outside it is refused and logged; `command="/usr/local/bin/mirror-shell /data/mirror",restrict` in the mirror user's `authorized_keys` is unchanged, so the key still has no shell and no forwarding; `git-shell` is still not the answer, for the reason the file gives. Three verbs, not a shell — and the mirror is still never pulled *from* by production.

## Amendment — 2026-09-23 (T-222), the worker's memory read at the cgroup, under the cap and its swap

The shape above caps `worker` at 1.5 GB and gives it a swap file so that "a first index that outgrows the cap runs slower rather than failing", and says ticket 42 measures the estimates. T-130 recorded the worker at **2,967–2,975 MB of peak RSS** with the seam and both converters in one process: nearly twice the cap. But that was the process's peak RSS, on `linux/arm64`, with no limit, and the deployed image is `linux/amd64`. This amendment records the same work read where the box reads it: the container's cgroup, the deployed architecture, and the deploy unit's own limits.

**How it was read, 23/09/2026.** The worker image was built for `linux/amd64` from the tree. It ran the seam over the fixture page (3,107 bytes) and both converters over their fixtures in one process, with the network refused, under `--memory=1536m --memory-swap=3072m`. Those are `platform.compose.yaml`'s `limits.memory` and `memswap_limit`, so the container may spill 1.5 GB. Three containers ran, minutes apart. **The machine is not the box.** It was an Apple M4 Pro (14 cores, 24 GB) under Docker Desktop 29.8, and the amd64 image ran **emulated by Rosetta 2**. Time and probably memory therefore err long. The VM's own swap is 1 GB, and under it the capped run was OOM-killed twice, about 16 s into the model load, with all 1,024 MB of swap in use. So a temporary 2 GB swap file was added to the VM for the readings and removed after. The VM's `vm.swappiness` was 60, where `deploy/host-setup.sh` sets the box to 10.

**What it read:**

- **The run finished** in all three containers, with no OOM kill.
- **`memory.peak` was 1,536 MB in all three**, at the cap. **`memory.swap.peak` was 1,474, 1,456 and 1,473 MB**, which is 95–96 % of the 1,536 MB the deploy unit lets it spill.
- **Steady state**, read 30 s after the last page: **994–1,051 MB resident plus 1,053–1,088 MB in swap, 2.08–2.10 GB in all.**
- **With no limit**, the same image read `memory.peak` 2,889 MB and a process peak RSS of 2,992 MB, beside T-130's 2,967–2,975 MB on arm64. Its steady state was 2,115 MB.
- **The peak is the load.** ~~Torch reads the pinned model's 1.16 GB `pytorch_model.bin` whole and builds the model beside it.~~ Since the amendment of 23/09/2026 below (T-347), torch maps the file and gliner assigns its tensors in place, so nothing is built beside it. The process drops to its steady figure once the load is done.
- **`pswpin`**, read from the cgroup's `memory.stat`, which here matched `/proc/vmstat`:
  - During the model load: **2.1–2.2 GB swapped in at 98–113 MB/s for 19.8–23.1 s**, and 3.3–3.5 GB swapped out.
  - During detection, three pages: **3.8–4.6 MB/s**, 75–77 MB in all.
  - Idle: none.
- **The seam's milliseconds per page under the limit** were 5,579, 6,453 and 5,273, over loads of 19.8–23.1 s. With no limit the same image read 4,554. S1's per-document timeout is re-cut from these readings.

**Only the pinned model loads.** An audit hook caught every `open` under `HF_HOME`. The only weights the process opened were `urchade/gliner_multi_pii-v1`'s `pytorch_model.bin`. Of `microsoft/mdeberta-v3-base` it opened the tokenizer and the config alone, and the image carries no weights for it. ~~`/proc/self/maps` held no file from the cache, because torch reads the weights rather than mapping them.~~ Since the amendment of 23/09/2026 below (T-347), `/proc/self/maps` lists the weights file. The measured-only `knowledgator/gliner-pii-base-v1.0` has not been in the image since T-148. No model is loaded for nothing, so there is no free 1.8 GB to take.

**What this settles.** ~~The cap works as this ADR designed it, but only because of its swap. Without swap the worker cannot hold the detector under 1.5 GB at all: its steady state alone is 2.1 GB, and with 1 GB of swap the load was killed. With the unit's 1.5 GB of spill the worker runs, and it uses 95 % of that allowance at every process start. A heavier load beside the model could exhaust that allowance, and so could a box whose swap file is smaller than the spill the unit allows. The kernel would then kill the worker mid-load, with a claimed job under a live lease.~~ Superseded on 23/09/2026 by the amendment below (T-347): the load that holds the weights once swaps nothing.

**The question it leaves open.** Is the always-on detector affordable on the two 4 GB boxes? ~~Four answers are named, and none is chosen here:~~ Four answers are named, and the amendment of 23/09/2026 below (T-347) chooses the second:

- swap as designed, which this reading says works, slower;
- ~~a load that does not hold the weights twice, unmeasured;~~ a load that does not hold the weights twice, read on VPC 1 on 23/09/2026;
- a smaller detector;
- growth step E.

The deciding readings are the box's own, at S4's first index. ~~The first is `memory.peak` and `memory.swap.peak` at native `linux/amd64`, which this laptop cannot give.~~ The first was read on VPC 1 on 23/09/2026 (the amendment below). The second is step A's signal. ~~Every process that loads the detector swaps in about 2.2 GB within 20–23 s, a burst the five-minute window has to absorb.~~ The load that holds the weights once swaps in 5–7 pages (the amendment below). Detection itself runs either side of the 4 MB/s threshold, and whether it stays above it for five minutes over a real index is the reading that decides step A.

## Amendment — 2026-09-23 (T-347), the detector's weights held once and mapped from the file

The amendment above named four answers to the worker's memory and left the choice to the box's own readings. VPC 1 read the load both ways the same day, and the second answer is chosen: **the worker holds the detector's weights once, mapped from the file.**

**What the load was.** By default gliner 0.2.29 builds a randomly initialised model, resizes its embedding, then reads the whole 1.16 GB `pytorch_model.bin` beside that model and copies it in. For the length of the load the weights are held twice. What stays afterwards is anonymous memory, and only swap can take that off the cgroup.

**What it is now.** `ModelRecogniser` builds `GLiNERRecognizer` with `low_cpu_mem_usage=True`, which Presidio forwards to `GLiNER.from_pretrained`. gliner then builds the model on the meta device and assigns the loaded tensors in place, so no second copy exists. The build runs inside torch's `load.mmap` setting, patched for the build alone, so torch maps the file rather than reading it. The assigned tensors are views of that mapping, which the cgroup charges as `file`, not `anon`. The kernel reclaims those pages by dropping them and reads them back from the image on the next fault, so they never go to swap. The weights are bit-identical and the predictions unchanged. gliner and Presidio are neither forked nor patched, and the image gains no file. When gliner cannot build on the meta device, it warns and falls back to the double load. The worker's suite turns that warning into an error, so a pin that brings the fallback back fails there and not on the box.

**How it was read, 23/09/2026.** VPC 1 is an AMD EPYC-Milan with 4 vCPU and 3.8 GB, running native `linux/amd64` with the real 4 GB swap file at `vm.swappiness` 10. T-222's probe ran unchanged over the fixture page (3,107 bytes) and both converters' fixtures, with the network refused, under the deploy unit's `--memory=1536m --memory-swap=3072m`. The production worker and its neighbours were running beside it. The double load ran on image `e95f0c16`, three capped runs. The load that holds the weights once ran on image `1587e0c1` with the patched `detector.py` mounted over it, three capped runs and one uncapped.

| | The double load (3 capped runs) | The weights held once (3 capped, 1 uncapped) |
| --- | --- | --- |
| `memory.peak` | 1,536 MB (the cap), all three | 1,032, 712 and 758 MB; uncapped 718 MB |
| `memory.swap.peak` | 1,401, 1,509 and 1,302 MB (85–98 % of the spill) | 0 in all four |
| Settled, 30 s after the last page | 1,175–1,293 MB resident plus 714–767 MB swap | 650–656 MB anonymous plus 4–324 MB of file-backed weights |
| Model load (`load_ms`) | 17,671, 18,257 and 18,581 ms, after 4.2–4.9 s of imports | 4,451, 4,232 and 4,509 ms, the stack's imports included |
| Seam, median of three, ms per page | 3,206, 3,100 and 2,946 | 3,209, 3,016 and 3,254; uncapped 3,119 |
| Swap-in | about 150–170 MB/s box-wide through each load; about zero through detection | 5–7 pages per run |
| Box `MemAvailable`, lowest | 719 MB | 1,565 MB |
| Neighbours pushed to swap | Postgres 34 MB, api 17 MB, worker 9 MB | none |

The second image defers the detector's imports into the load, so its `load_ms` includes them; the settled and swap figures compare directly. A file-backed page is charged to the cgroup that first faults it, which is why the second and third capped runs read less `file` than the first. The double load's worst run spilled 1,509 of its 1,536 MB, 27 MB short of the kill the amendment above names.

**What this settles.** The worker swaps nothing at start and settles near 650 MB of anonymous memory, where the double load used 85–98 % of its spill at every start and settled at about 2 GB. At the probe's scale the always-on detector fits the box without a smaller detector or growth step E. Swap goes back to being the safety net this ADR designed it as, rather than something every process start leans on. The seam and load figures above are readings. S1's per-document ceiling stays as the amendment above cut it.

**What stays, and why.** The worker keeps its 1.5 GB cap and its 1.5 GB of spill. The probe read three pages, not an index. A real index adds LMDB, cocoindex and larger documents to the 650 MB, and mapped LMDB pages count as `file` too. `memory.peak` can therefore still reach the cap from page cache, and that alone is not a failure: the signals are `anon`, `memory.swap.peak` and `pswpin`. This reading does not settle whether mapped weight pages are evicted and re-faulted once LMDB, cocoindex and the converters share the cgroup. S4's first index reads that, beside step A's swap-in signal.
