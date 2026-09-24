# Coolify — the deployment shape

**Operational reference, not a page of the docs site.** This file lives in `docs/operations/` because that is where the operational documents are kept; the docs site does not render it, and it is read from the repository.

**This is the public half.** It states *what shape* the deployment has — which boxes, which resources, which ingress pattern and which probes are owed — without the estate's own values. Addresses, firewall rules, per-hostname edge policy, bucket and vault names, the orchestrator's URL and its recorded probe results are **not published**: they are `.planning/estate/coolify.md`, outside the repository (ADR 0027, ticket 79 Q10; ticket 77's acceptance line). Nothing a reader needs to stand up their own deployment is missing — the recipe is `deploy/wizard-41.sh`, which asks for every value and stores none.

Coolify is the orchestrator: a pinned version with auto-update off, so its own upgrade is a drill item rather than a surprise. The host-side shell work on both boxes is `deploy/host-setup.sh`, run once per box; `deploy/wizard-41.sh` walks the owner through everything a console asks for.

## Boxes

**Two boxes** (ADR 0024), sized 4 vCPU · 4 GB · 120 GB NVMe each, on contracts that cannot be resized — a bigger box is a third contract.

| Box | Role |
| --- | --- |
| **VPC 1** | production: the Postgres resource (`shared_buffers` 512 MB, a 1 GB memory limit set in the orchestrator), the `stores` stack and the `platform` stack, the git store under `/data/git`, and a 4 GB swap file on the NVMe (`RUNBOOK.md` § Swap; created by `deploy/host-setup.sh vpc1`) |
| **VPC 2** | the orchestrator, the git mirror, and a restore target that exists only during a drill or rehearsal — staging is **on demand** and never stands |

No private network joins them: the orchestrator manages VPC 1 over SSH, the mirror is `git push` over SSH, and every client byte arrives through the tunnel. Growth steps, in order: **A** — split production over a WireGuard pair (object store, git store and backup to VPC 2) if the swap-in probe says so, at no cost; then **E** — a third contract. Neither needs a data-model change.

The estate's addresses, SSH users and key names, and its host firewall rules are in the private file. The rule they follow is public: **SSH from known sources only; 80 and 443 closed on both boxes** — every ingress arrives through the tunnel, so nothing listens on the public interface.

## Resources

| Resource | Type | Server | Notes |
| --- | --- | --- | --- |
| the Postgres resource | orchestrator database on the **official pgvector image, by digest** — the one reference in `packages/schema/src/postgres-image.ts` (ADR 0032; no custom image, no graph engine: the graph is plain tables inside it) | VPC 1 | volume bind-mounted under `/data/postgres`; the orchestrator's own scheduled dump is the second backup writer (ADR 0022); `\du` at the first deploy records whether its owner is the superuser (§ Probes); its public-port toggle stays on with the port firewalled, for the browsing forward alone, and its state is read on the day (§ Browsing the database) |
| the `stores` stack | Docker Compose from `deploy/stores.compose.yaml` | VPC 1 | object store, `cloudflared`, `backup` — the backup image by digest (`BACKUP_IMAGE_DIGEST` in this resource's env, from `build.yml`'s run summary; moved by hand, never by a release); no embedding host runs until a workspace takes the local route (ADR 0024), and § The local embedding route below is how one is added |
| the `platform` stack | Docker Compose from `deploy/platform.compose.yaml` | VPC 1 | `migrate` → `api` (`worker` is declared behind the `pipeline` profile until `T-006`); digests promoted by `release.yml` from what `build.yml` pushed; a private-registry pull credential on the server's Docker config; every service carries a memory limit (§ Memory) |
| the staging Postgres resource | orchestrator database | VPC 2 | created once and kept empty; the drill refills it |
| the two staging stacks | the same two compose files plus `deploy/staging.override.yaml`, staging env from a root-only file | VPC 2 | **on demand** — brought up for a drill or rehearsal and wiped after (`RUNBOOK.md` § Bring staging up); synthetic fixture only (`deploy/seed-synthetic.sh`); no hostname points at them |
| the orchestrator itself | pinned version, `AUTOUPDATE=false` | VPC 2 | its upgrade is a drill item; its own instance backup is in `BACKUPS.md` |
| host cron on VPC 2 | `restore-drill.sh` monthly, ending in `seed-synthetic.sh`; env from a root-only file written by `host-setup.sh vpc2` | VPC 2 | deliberately **not** an orchestrator task — the drill wipes the stacks such a task would run inside; it reads production's counts **over SSH**, not over an open Postgres port |
| the backup S3 storage | orchestrator S3 storage | — | the write-and-list credential only (`SECRETS.md`) |
| notifications | email, and the second channel | — | failed deploy, unhealthy container, backup failed; the dead-man checks `scheduler`, `pg-hourly`, `nightly`, `drill` and the uptime check all alert the **second channel** (SMS or a chat app), and a **weekly all-green digest** is sent so silence is distinguishable from health |

## Ingress (Cloudflare)

Every hostname resolves to the tunnel and the tunnel routes to `http://api:3000` on the platform stack; nothing else is exposed, and the tunnel's last ingress rule is a catch-all `http_status:404`. **Three hostnames** (ADR 0022 as amended by ADR 0034) — the **app** hostname `app.<apex>`, which carries the single-page app, sign-in, consent, `/oauth2/*`, `/.well-known/*`, `/jwks` and the MCP surface at `/mcp` on one origin; the **agent** hostname, routed only to `/agent/v1/*` for the share agent; and the **apex**, which serves concept IRIs and answers 404 on everything (ADR 0002). There is no `mcp.` hostname and no `docs.` hostname. Which edge policy each hostname carries is estate configuration, in the private file; the rule it follows is public and is ADR 0022's edge paragraph as amended: a hostname that serves an unauthenticated OAuth flow or a sign-in cannot sit behind an interactive access wall, and a machine hostname authenticates in the api before any body is read.

**Two fences, checked against each other on the day.** The tunnel's three ingress rules are the first fence: they are estate configuration — the apex is in the private file — but their *shape* is public and is this table. The api's own hostname list is the second: `apps/api/src/ingress/hostnames.ts` holds one ordered list of surface → hostname role → reason and refuses, before any body is read, a path outside its hostname's surface; Better Auth's handler would otherwise answer the wildcard on every hostname the process is given. At the first deploy, and at every change to either, the operator reads the two side by side: every rule in the tunnel names a role in the file, every role in the file has a rule in the tunnel, and the api was started with `PUBLIC_URL` (whose host *is* the app hostname), `AGENT_HOSTNAME` and `APEX_HOSTNAME` all differing — it refuses to start otherwise.

| Tunnel rule (order matters) | Role in `hostnames.ts` | Service | What the fence allows there |
| --- | --- | --- | --- |
| `app.<apex>` | `app` | `http://api:3000` | everything: the SPA, `/health`, `/mcp`, `/.well-known/*`, `/jwks`, `/oauth2/*`, consent, the session endpoints |
| `agent.<apex>` | `agent` | `http://api:3000` | `/agent/v1/*` alone |
| `<apex>` | `apex` | `http://api:3000` | nothing — 404, as the edge answers it |
| catch-all | — | `http_status:404` | — |

**Rate limiting, by path on the app hostname.** Cloudflare's rules are the first line ahead of the api's own Postgres counters (ADR 0018, T-022), which stay as the second. Matched by path rather than hostname, because everything credential-shaped is now a path on one origin (ADR 0034): the authorization server (`/oauth2/*`), discovery (`/.well-known/*`), the MCP surface reached without a bearer (`/mcp` with no `Authorization` header), and the sign-in endpoints (`/email-otp/send-verification-otp`, `/sign-in/email-otp`). Each counts per client IP. **Plans meter rules, not paths**: Cloudflare Free allows one rate-limiting rule, Pro two, Business five ($250/month — not this estate's) — developers.cloudflare.com/waf/rate-limiting-rules, read 2026-09-04. The path groups are combined with OR expressions to fit the plan's allowance — on Free, one rule with one shared threshold over **three** groups, because a Free rate-limiting expression may match URI paths only (found in the builder, 2026-09-04): the `/mcp`-without-a-bearer group needs a header clause, so on Free it is covered by the api's counters alone; on Pro, two rules, the credential writes (`/oauth2/*`, the sign-in endpoints, `/mcp` without a bearer) apart from discovery (`/.well-known/*`). **Where each rule sits and its threshold is estate configuration**: the private file's § Ingress records the rules beside the tunnel rules, with the date each was last tightened (ADR 0027; ticket 77's acceptance line). **The Pro trigger (Q9) is a condition, not a stage: before the first client credential exists, the zone is on Pro.** Until that day, Free's one combined rule ahead of the api's counters is the accepted posture (Q9 b) — the wizard's Cloudflare stage passes on Free only against the operator's confirmation that no client credential exists or is imminent, refuses otherwise, and records the upgrade as still owed; this line is the second place the trigger is written.

A rule's effect on the real flow is rehearsed before it is written into the estate: `pnpm --filter @better-answers/api run serve:local https://<name>.trycloudflare.com` behind a quick tunnel is the connector flow with no box, and a rule that breaks claude.ai's pre-flight shows there first (T-045).

**The uptime check — one, external, on the hostname clients use.** **Two paths on the app hostname**, each expecting `200`: `/health` — the api is up and its database answers — and `/.well-known/oauth-protected-resource/mcp` — the authorization server's discovery is served, which is what a connector needs before anything else. On Pro, Cloudflare's own Health Checks (Traffic → Health Checks; a Pro feature) run them from outside both boxes every minute, three failures to go red, alerting the **second channel** through Cloudflare Notifications, and bypass the rate-limit rules above. Until the zone is on Pro, `deploy/uptime-probe.sh` runs them from VPC 2 by host cron every five minutes — through the public edge, so DNS, the tunnel and the origin are all on the probed path — and pings the healthchecks.io check `uptime` (5 min period · 5 min grace) with the outcome. The probe cannot be replaced by healthchecks.io alone: that service only listens for pings and never probes a URL. Its two requests per five minutes sit far under any threshold above. Either way the check is the one signal that covers VPC 1 from the outside. On Pro, VPC 2 is covered only by its daily and monthly pings; on Free, the probe's own silence — VPC 2 down included — trips the dead-man alarm within ten minutes, narrowing that blind spot (`RUNBOOK.md` page 1 records both postures).

**The share agent's per-file cap** matches the edge's own body limit, 100 MB on Free and Pro.

## Browsing the database

A GUI browses two databases, both under one login. Day to day it is the **local database**: the pinned image on a developer's own machine, the journal applied and the synthetic fixture seeded, brought up by `deploy/local-database.sh up` (`README.md` § Browsing the data). Production is browsed occasionally, and only this way.

**The mechanism.** `deploy/browse-production.sh` opens an SSH forward from a loopback port on the operator's machine (`127.0.0.1:55433`, or `BROWSE_PORT`) to the Postgres resource's host-published port on VPC 1, where the orchestrator's TCP proxy stands in front of the database. The forward carries keepalives, binds the loopback alone, refuses a local port something already holds, and stays in the foreground until Ctrl-C closes it. It reads three names from the private file's § Browsing production — `VPC1_SSH_TARGET`, `VPC1_SSH_KEY` (optional; ssh's own configuration otherwise) and `VPC1_DATABASE_PORT` — and prints none of their values. A GUI's own SSH support is not used: on 06/09/2026 it timed out where the same parameters worked from a terminal.

**The posture.** The provider firewall keeps the database's port closed to the internet: SSH from known sources is all it lets in (§ Boxes). The orchestrator's public-port toggle on the Postgres resource stays **on**, because the forward's far end is the host-published port and with the toggle off there is nothing on the host to forward to. A GUI profile signs in as `browse_ro`, never as the owner. Whether the toggle is on and which port it publishes are read on the day and recorded in the private file.

**The read-only role.** `deploy/browse-role.sql` makes `browse_ro` in one transaction, so a run that fails partway grants nothing, and can be run again to the same end. It is a login with no superuser, role-making, database-making or replication right. It bypasses row-level security, because every tenant table forces it and a role without the bypass reads no tenant row. It holds SELECT on every table and view in `public` and `index`, and EXECUTE on the one pure function the chunk view classes its rows through. It reads none of the identity set's credential columns — the session token, the verification value, the signing key's private half, an account's tokens and password, an OAuth client's secret, the OAuth token values and the refresh token's replay response — because a login that reads a live credential can act as its holder. Its sessions are read-only by default, so a slip in a GUI is refused before a grant is consulted. Inside its own session it can still make a temporary table or change its own password, as any login can; neither reaches a platform row. A table a later migration adds is readable once the file is run again; a credential column a later migration adds is withheld only once the file names it, so the pull request that adds the column adds the name. `apps/api/tests/browse-role.test.ts` runs the file over the whole journal on a cluster of its own and proves each of those lines, the refusals first: a write to any platform table, partitions reached directly among them, and DDL in either schema, in a read-write transaction the role asks for; every definer function; each credential column; and a run that fails partway, statement by statement as psql runs it. The operator's act is `RUNBOOK.md` § Browse production.

**Why the role is an operator act and not a migration.** Either was open, and the act was chosen:

- **The credential is an operator act whichever way.** A migration can make a role but cannot give it a password, so a hand-run `ALTER ROLE … PASSWORD` on the box would follow it, as it follows `app_rt` and `worker_rt` (§ Probes). The migration route removes no act from the operator's list.
- **The journal's roles are the runtime's.** ADR 0032's role seam is `app_rt` and `worker_rt`. The roles' surface is generated from a database holding those two and the migrator, reads any other role as the migrator and refuses a fourth, and its roles block holds that neither runtime role bypasses row-level security — the bypass this role exists to have. A browsing convenience in the journal would stand in every database the journal builds, test clusters included, and every later migration would have to decide what it may read.
- **The refusal proofs do not need the journal.** A grant a migration installs ships with the test of what it refuses; the suite above holds this file to the same bar, applying it after the whole journal.
- **The local database runs the same file on every `up`**, so the act the operator runs once against production has run many times before it does.

## The local embedding route

The CPU embedding host (bge-m3, 1024 dims) runs only for a workspace on the **local** embedding route, and the first estate has none: client one embeds on the hosted route, and a 4 GB box has no room for an idle model server (ADR 0024). A workspace choosing the local route is growth step E — a third contract, sized for a model host — and the route is immutable per workspace, so the choice is made once.

The day a workspace takes it, the service below joins a stores stack **on the model-host box**, not VPC 1 — growth step E buys that box precisely because a 3–5 GB model server does not fit beside the Postgres resource, `api`, `worker`, Garage, the tunnel and `backup`. Add `embeddings:1000` to that stack's `init` directory list: nothing under `/data/embeddings` existed before, so `init` is what creates and owns it. The image is chosen and pinned by digest on that day, as every other image in the file is, and the service carries an explicit memory limit like every other (§ Memory) — sized against the model chosen, and written into this section and the compose file together.

```yaml
  embeddings:
    image: # the OpenAI-shaped embedding server, pinned by digest on the day
    <<: [*restart, *logging]
    deploy: { resources: { limits: { memory: # sized against the model chosen } } }
    environment:
      MODEL_ID: BAAI/bge-m3
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/health"]
      interval: 15s
      timeout: 3s
      retries: 20
      start_period: 120s
    volumes: ["/data/embeddings:/data"]
    depends_on:
      init: { condition: service_completed_successfully }
```

`EMBEDDINGS_URL` is already declared in `deploy/platform.compose.yaml`'s bootstrap block and is unset while no host runs; it is set to the model host's address in the platform resource's env when the service is added.

## Probes at the first deploy

Questions the documents cannot answer without a box. Each is recorded in the private file with its date and result:

- **Two resources, one network** — does redeploying the platform stack leave the stores stack untouched?
- **The Postgres resource** — does the orchestrator accept the official pgvector image **by digest** (the reference in `packages/schema/src/postgres-image.ts`), keep its scheduled backup writer on it, and take a bind-mounted data directory? And **`\du`**: is the resource's owner the superuser? It raises the value of `app_rt`'s non-owner seam if so (ADR 0032); it does not change the decision.
- **The estate step for the runtime roles** — `T-003`'s migration creates `app_rt` and `worker_rt` `NOLOGIN` (ADR 0032), so a freshly migrated box is not reachable by the api until the operator grants `LOGIN` and sets each password (`ALTER ROLE app_rt LOGIN PASSWORD '…'`, the same for `worker_rt`, as the resource's owner), writes the two DSNs into the platform resource's env as `DATABASE_URL` and `WORKER_DATABASE_URL`, and records in the private inventory how the two passwords are held. The owner DSN reaches `migrate` alone.
- **`depends_on` on the day** — the compose command the orchestrator actually ran; whether `migrate` completed before `api` started; whether `worker`, once its profile is enabled, waited for `api` healthy. Research 68 answered it on paper — plain `docker compose up -d` honours the conditions — and the box is the confirmation.
- **The first push to ghcr.io** may need the organisation's package-creation setting (Packages → allow members to create) before `build.yml`'s three images can be pushed; the run summary's three digests are what the deploy unit and the stores resource take.
- **Swap-in rate during the first index** (ticket 42) — this is what decides growth step A: steady swap-in means split now; a burst at the peak means the 1.5 GB worker cap holds.

## Memory

Every service on VPC 1 carries an explicit limit (ticket 79 scale F2), so the sum is a number and not a hope: the Postgres resource 1 GB (set in the orchestrator); `api` 512 MB; `migrate` 512 MB while it runs; `worker` 1.5 GB plus 1.5 GB of swap (`memswap_limit`), declared but not started until `T-006`; the object store 384 MB; `backup` 384 MB; `cloudflared` 128 MB; `init` 128 MB while it runs. Running services today sum to about 2.4 GB of 4 GB; with the worker, 3.9 GB. **The page-cache floor is 512 MB**: `MemAvailable` on VPC 1 below that for five minutes is the second trigger for growth step A, beside the swap-in rate (`BACKUPS.md` § Signals). A limit is moved here and in the compose file together, never in one.

## Stage 7 state

Where each secret goes, which notification channel carries which alert, how CI reaches the orchestrator through the edge, and which resource ids the workflows hold: all estate configuration, all in the private file. The workflows read three repository variables and one secret — `COOLIFY_URL`, `COOLIFY_PROD_APP_UUID`, `PUBLIC_URL` and `COOLIFY_DEPLOY_TOKEN` — plus `CLIENT_DATA_ON_BOX`, set the day the first client's data lands, which flips `release.yml` to drill-day releases (`RUNBOOK.md` page 6). The rules are public and live in `SECRETS.md` — a secret appears in exactly one env per box, the pull credential is on the server's Docker config rather than in any env, and no shared team- or project-level variables exist because there is one stack per box and nothing to share.
