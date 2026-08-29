# Coolify — the deployment shape

**This is the public half.** It states *what shape* the deployment has — which boxes, which resources, which ingress pattern and which probes are owed — without the estate's own values. Addresses, firewall rules, per-hostname edge policy, bucket and vault names, the orchestrator's URL and its recorded probe results are **not published**: they are `.planning/estate/coolify.md`, outside the repository (ADR 0027, ticket 79 Q10; ticket 77's acceptance line). Nothing a reader needs to stand up their own deployment is missing — the recipe is `deploy/wizard-41.sh`, which asks for every value and stores none.

Coolify is the orchestrator: a pinned version with auto-update off, so its own upgrade is a drill item rather than a surprise.

## Boxes

**Two boxes** (ADR 0024), sized 4 vCPU · 4 GB · 120 GB NVMe each, on contracts that cannot be resized — a bigger box is a third contract.

| Box | Role |
| --- | --- |
| **VPC 1** | production: the Postgres resource (`shared_buffers` 512 MB), the `stores` stack and the `platform` stack, the git store under `/data/git`, and a 4 GB swap file on the NVMe (`RUNBOOK.md` § Swap) |
| **VPC 2** | the orchestrator, the git mirror, and a restore target that exists only during a drill or rehearsal — staging is **on demand** and never stands |

No private network joins them: the orchestrator manages VPC 1 over SSH, the mirror is `git push` over SSH, and every client byte arrives through the tunnel. Growth steps, in order: **A** — split production over a WireGuard pair (object store, git store and backup to VPC 2) if the swap-in probe says so, at no cost; then **E** — a third contract. Neither needs a data-model change.

The estate's addresses, SSH users and key names, and its host firewall rules are in the private file. The rule they follow is public: **SSH from known sources only; 80 and 443 closed on both boxes** — every ingress arrives through the tunnel, so nothing listens on the public interface.

## Resources

| Resource | Type | Server | Notes |
| --- | --- | --- | --- |
| the Postgres resource | orchestrator database on our own `ghcr.io/betteranswers/postgres` image (Postgres 18 + Apache AGE + pgvector, by digest — ADR 0023) | VPC 1 | volume bind-mounted under `/data/postgres`; the orchestrator's own scheduled dump is the second backup writer (ADR 0022) |
| the `stores` stack | Docker Compose from `deploy/stores.compose.yaml` | VPC 1 | object store, `cloudflared`, `backup`; the embedding host is commented out until a workspace takes the local route (ADR 0024) |
| the `platform` stack | Docker Compose from `deploy/platform.compose.yaml` | VPC 1 | `migrate` → `app` → `worker`; digests patched and deployed by `build.yml` / `release.yml`; a private-registry pull credential on the server's Docker config |
| the staging Postgres resource | orchestrator database | VPC 2 | created once and kept empty; the drill refills it |
| the two staging stacks | the same two compose files, staging env | VPC 2 | **on demand** — brought up for a drill or rehearsal and wiped after (`RUNBOOK.md` § Bring staging up); synthetic fixture only; no machine hostname points at them |
| the orchestrator itself | pinned version, `AUTOUPDATE=false` | VPC 2 | its upgrade is a drill item; its own instance backup is in `BACKUPS.md` |
| host cron on VPC 2 | `restore-drill.sh` monthly, then `seed-synthetic.sh` | VPC 2 | deliberately **not** an orchestrator task — the drill wipes the stacks such a task would run inside |
| the backup S3 storage | orchestrator S3 storage | — | the write-and-list credential only (`SECRETS.md`) |
| notifications | email | — | failed deploy, unhealthy container, backup failed |

## Ingress (Cloudflare)

Every hostname resolves to the tunnel and the tunnel routes to `app:3000`; nothing else is exposed, and the tunnel's last ingress rule is a catch-all 404. Four kinds of hostname exist — the **web app**, the **MCP surface**, the **machine route** (`/agent/v1`, uploads), and the **apex**, which serves concept IRIs and nothing else (ADR 0002) — plus the docs site, built from `docs-site/` and served by its own static host.

Which hostname carries which edge policy, and where the edge rate-limit rule is placed, is **estate configuration and is not published**. The rules those choices follow are public and are in ADR 0022's edge paragraph and ADR 0008's amendment: a hostname that must serve an unauthenticated OAuth flow cannot sit behind an interactive access wall, and a machine hostname authenticates in the app before any body is read. The per-file cap on the machine route matches the edge's own body limit.

## Probes at the first deploy

Three questions the documents cannot answer without a box. Each is recorded in the private file with its date and result:

- **Two resources, one network** — does redeploying the platform stack leave the stores stack untouched?
- **The Postgres resource** — does it accept our own image by digest from a private registry, keep its scheduled backup writer on it, and take a bind-mounted data directory? If the image is refused, Postgres moves into `stores.compose.yaml` on the same Dockerfile (ADR 0023's named fallback).
- **Swap-in rate during the first index** (ticket 42) — this is what decides growth step A: steady swap-in means split now; a burst at the peak means the 1.5 GB worker cap holds.

Two more the reviews owe: whether AGE auto-creates a label table on first write, and whether the orchestrator's Postgres resource runs as the superuser (`\du` settles it, and it raises the graph's isolation stakes if so — ADR 0023).

## The `depends_on` probe

Run once at the first deploy and recorded privately: the compose command the orchestrator actually ran; whether `migrate` completed before `app` started; whether `worker` waited for `app` healthy. Research 68 answered it on paper — plain `docker compose up -d` honours the conditions — and the box is the confirmation.

## Stage 7 state

Where each secret goes, which notification channel carries which alert, how CI reaches the orchestrator through the edge, and which resource ids the workflows hold: all estate configuration, all in the private file. The rules are public and live in `SECRETS.md` — a secret appears in exactly one env per box, the pull credential is on the server's Docker config rather than in any env, and no shared team- or project-level variables exist because there is one stack per box and nothing to share.
