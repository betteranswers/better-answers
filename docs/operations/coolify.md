# The deployment shape on Coolify

Operational reference, not rendered by the docs site. This is the public half. `.planning/estate/coolify.md`, outside the repository, holds the estate's values: addresses, firewall rules, each hostname's edge policy, bucket and vault names, the orchestrator's URL, and recorded probe results. To stand up your own deployment, run `deploy/wizard-41.sh`. It asks for every value a console needs and stores none. `deploy/host-setup.sh` does the host-side shell work, once per box. Coolify is the orchestrator.

## Boxes

Two boxes, each 4 vCPU, 4 GB, and 120 GB of NVMe, on contracts that cannot be resized. A bigger box is a third contract.

| Box | Role |
| --- | --- |
| **VPC 1** | Production: the VPC 1 resources below (`shared_buffers` 512 MB on Postgres), the git store under `/data/git`, a 4 GB swap file on the NVMe (`RUNBOOK.md` § Swap), and the checkout at `/opt/better-answers` that `restore-production.sh` runs from. `deploy/host-setup.sh vpc1` creates the swap file and the checkout. |
| **VPC 2** | The orchestrator, the git mirror, and a restore target that exists only during a drill or rehearsal. Staging is on demand and never stands. |

No private network joins them. The orchestrator manages VPC 1 over SSH, the mirror is a `git push` over SSH, and every customer byte arrives through the tunnel. SSH is open from known sources only, and 80 and 443 are closed on both boxes. The private file holds the SSH users and key names.

Growth has two steps, neither needing a data-model change. Step **A**, when the swap-in probe says so, moves the object store, git store, and backup to VPC 2 over a WireGuard pair, at no cost. Step **E** is a third contract.

## Resources

| Resource | Type | Server | Notes |
| --- | --- | --- | --- |
| the Postgres resource | Orchestrator database on the official pgvector image by digest, the one reference in `packages/schema/src/postgres-image.ts`. No custom image and no graph engine. The map is plain tables inside it. | VPC 1 | Volume bind-mounted under `/data/postgres`. The orchestrator's scheduled dump is the second backup writer. |
| the `stores` stack | Docker Compose, `deploy/stores.compose.yaml` | VPC 1 | Object store, `cloudflared`, and `backup`. `BACKUP_IMAGE_DIGEST` in this resource's env pins the backup image from `build.yml`'s run summary, moved by hand, never by a release. |
| the `platform` stack | Docker Compose, `deploy/platform.compose.yaml` | VPC 1 | `migrate`, then `api`, then `worker`. `release.yml` promotes the digests `build.yml` pushed. The server's Docker config holds a private-registry pull credential. |
| the staging Postgres resource | Orchestrator database | VPC 2 | Created once and kept empty. The drill refills it. |
| the two staging stacks | The same two compose files plus `deploy/staging.override.yaml` and `deploy/staging.platform.override.yaml`, env from a root-only file | VPC 2 | Up for a drill or rehearsal and wiped after (`RUNBOOK.md` § Bring staging up). Synthetic fixture only (`deploy/seed-synthetic.sh`). No hostname points at them. They run on plain `docker compose`, so the overrides join them on the internal `better-answers-staging-shared` network, where production shares the orchestrator's. |
| the orchestrator | Pinned version, `AUTOUPDATE=false` | VPC 2 | Its upgrade is a drill item. Its instance backup is in `BACKUPS.md`. |
| host cron on VPC 2 | `restore-drill.sh` monthly, ending in `seed-synthetic.sh`, env from a root-only file that `host-setup.sh vpc2` writes | VPC 2 | Not an orchestrator task, because the drill wipes the stacks such a task runs inside. Reads production's counts over SSH, not an open Postgres port. |
| host cron on both boxes | `prune-images.sh` nightly at 01:30 UTC, installed by `host-setup.sh` as `/usr/local/bin/better-answers-prune-images`, logging to `/var/log/better-answers-prune-images.log` | VPC 1, VPC 2 | Removes each unused `ghcr.io/betteranswers/*` image beyond the newest two per repository, kept for a rollback. Skips a night a deployment runs. The orchestrator's cleanup skips these images, because a release pins by digest and leaves them tagged `<none>`. `--dry-run` prints the plan. |
| the backup S3 storage | Orchestrator S3 storage | None | The write-and-list credential only (`SECRETS.md`). |
| notifications | Email and the second channel | None | Failed deploy, unhealthy container, failed backup. The dead-man checks `scheduler`, `pg-hourly`, `nightly`, and `drill` and the uptime check alert the second channel (SMS or a chat app). A weekly all-green digest tells silence apart from health. |

## Ingress (Cloudflare)

Every hostname resolves to the tunnel, which routes to `http://api:3000` on the platform stack. Nothing else is exposed. There are three hostnames. The **app** hostname `app.<apex>` carries the single-page app, sign-in, consent, OAuth, and `/mcp` on one origin. The **agent** hostname serves only `/agent/v1/*`, for the share agent. The **apex** is for concept IRIs, and answers 404 to everything. There is no `mcp.` and no `docs.` hostname.

The private file records which edge policy each hostname carries. A hostname that serves an unauthenticated OAuth flow or a sign-in cannot sit behind an interactive access wall. A machine hostname authenticates in the api before any body is read.

**Two fences, checked against each other.** The first is the tunnel's ingress rules, ending in a catch-all `http_status:404`. Their values, the apex included, are private, and their shape is the table below. The second is `apps/api/src/ingress/hostnames.ts`, an ordered list of paths, each with a hostname role and a reason. The api refuses a path outside its hostname's paths before reading any body, so Better Auth's handler cannot answer its wildcard on every hostname.

At the first deploy and at every change to either fence, check that every tunnel rule names a role in the file and every role has a tunnel rule. The api refuses to start unless `PUBLIC_URL` (whose host is the app hostname), `AGENT_HOSTNAME`, and `APEX_HOSTNAME` all differ.

| Tunnel rule (order matters) | Role in `hostnames.ts` | Service | What the fence allows |
| --- | --- | --- | --- |
| `app.<apex>` | `app` | `http://api:3000` | Everything: the single-page app, sign-in, `/health`, `/mcp`, `/.well-known/*`, `/jwks`, `/oauth2/*`, consent, the session endpoints |
| `agent.<apex>` | `agent` | `http://api:3000` | `/agent/v1/*` alone |
| `<apex>` | `apex` | `http://api:3000` | Nothing. 404, as the edge answers it. |
| catch-all | None | `http_status:404` | Nothing |

**Rate limiting, by path on the app hostname.** Cloudflare's rules are the first line. The api's Postgres counters are the second, for every route group but discovery. The api counts each route group separately, and counts neither page loads nor discovery reads, which it serves with `Cache-Control: public, max-age=300`. A count's first refusal of an address in a window logs `ingress.address_ceiling_met` once, with the route group as `group`, and `anthropicRange` true for Anthropic's published range `160.79.104.0/21`, never the address. A line with `group` `oauth` and `anthropicRange` true is the trigger to revisit the token endpoint's ceiling. A request Cloudflare refuses logs nothing.

The rules match by path, not by hostname, because every credential-shaped path is on the app hostname. Each path group counts per client IP: the authorization server (`/oauth2/*`), discovery (`/.well-known/*`), MCP without a bearer (`/mcp` with no `Authorization` header), and the sign-in endpoints (`/email-otp/send-verification-otp`, `/sign-in/email-otp`).

**Plans meter rules, not paths.** Cloudflare Free allows one rate-limiting rule, Pro two, and Business five at $250/month, which this estate does not use (developers.cloudflare.com/waf/rate-limiting-rules). On Free, one OR expression with one shared threshold covers three groups. A Free expression may match URI paths only, so only the api's counters cover the `/mcp`-without-a-bearer group. On Pro, one rule covers the credential writes (`/oauth2/*`, the sign-in endpoints, `/mcp` without a bearer) and another covers discovery. The private file's § Ingress records each rule's place and threshold, with the date each was last tightened.

**The Pro trigger (Q9) is a condition, not a stage.** The zone moves to Pro before the first assistant credential exists. Until then, Free's one rule ahead of the api's counters is accepted. On Free, the wizard's Cloudflare stage refuses unless the operator confirms that no assistant credential exists or is imminent, and records the upgrade as owed. The wizard and this paragraph both state the trigger.

Rehearse a rule before writing it into the estate by running `pnpm --filter @better-answers/api run serve:local https://<name>.trycloudflare.com` behind a quick tunnel, where a rule that breaks claude.ai's pre-flight shows first.

**The uptime check is one external check on the app hostname.** It expects `200` from `/health` (the api is up and its database answers) and from `/.well-known/oauth-protected-resource/mcp` (discovery, which a connector needs first, is served).

On Pro, Cloudflare Health Checks (under Traffic) request both paths from outside the boxes every minute, go red after three failures, alert the second channel through Cloudflare Notifications, and bypass rate limiting.

On Free, `deploy/uptime-probe.sh` requests them through the public edge from VPC 2, by host cron every five minutes, so DNS, the tunnel, and the origin are all on the probed path. It pings the healthchecks.io check `uptime` (5 min period, 5 min grace) with the outcome. Its two requests per five minutes stay far under every rate-limiting threshold. healthchecks.io cannot replace the probe, because it only listens for pings.

The uptime check is the one outside signal for VPC 1. On Pro, only its daily and monthly pings cover VPC 2. On Free, the probe's silence, VPC 2 down included, trips the dead-man alarm within ten minutes. `RUNBOOK.md` page 1 records both postures.

**`/health` names the image that answers.** Its body's `image` is the api digest the container started from, handed in by `deploy/platform.compose.yaml` from `API_IMAGE_DIGEST`, which its `image:` pins. It is `null` in the dev loop and the suites. The release's smoke test waits on it (`CI.md` § `release.yml`). The uptime check and the container healthcheck read only the status code. Publishing the digest is safe, because every `release/*` tag in this public repository carries it, and the ghcr.io packages are private.

The share agent's per-file cap matches the edge's body limit, 100 MB on Free and Pro.

## Browsing the database

A GUI browses two databases under one login. Day to day it is the local database, which `deploy/local-database.sh up` starts on a developer's own machine from the pinned image, with the journal applied and the synthetic fixture seeded (`README.md` § Browsing the data). Production is browsed occasionally, and only as below.

**The mechanism.** `deploy/browse-production.sh` forwards a loopback port on the operator's machine (`127.0.0.1:55433`, or `BROWSE_PORT`) over SSH to the Postgres resource's host-published port on VPC 1, where the orchestrator's TCP proxy fronts the database. The forward uses keepalives, binds only the loopback, refuses a port already in use, and holds the foreground until Ctrl-C. It reads `VPC1_SSH_TARGET`, `VPC1_SSH_KEY` (optional), and `VPC1_DATABASE_PORT` from the private file's § Browsing production, and prints none of them. Do not use a GUI's own SSH support, which times out where a terminal works.

**The posture.** The provider firewall closes the database port to the internet (§ Boxes). The public-port toggle on the Postgres resource stays on, because without it there is no host-published port to forward to. A GUI profile signs in as `browse_ro`, never as the owner. The toggle's state and port are read on the day and recorded in the private file.

**The read-only role.** `deploy/browse-role.sql` creates `browse_ro` in one transaction, so a failed run grants nothing and a rerun is safe. `browse_ro` has:

- a login with no superuser, role-making, database-making, or replication right
- the row-level security bypass, since every tenant table forces it
- SELECT on every table and view in `public` and `index`, and EXECUTE on the one pure function the passage view classes its rows through
- no read of the identity set's credential columns, because a login that reads a live credential can act as its holder: the session token, the verification value, the signing key's private half, an account's tokens and password, an OAuth client's secret, the OAuth token values, and the refresh token's replay response
- no read of `sealed` in `model_key`, which opens only under the envelope key this login never holds. `workspace_id` and `provider` stay readable, to show which workspace holds a key for which provider.
- read-only sessions by default, so Postgres refuses a slip before consulting a grant
- the right any login has to make a temporary table or change its own password, neither of which reaches a platform row

Rerun the file to make tables that later migrations add readable. A new credential column is withheld only once the file names it, so the pull request adding the column adds its name.

`apps/api/tests/deploy/browse-role.test.ts` runs the file over the whole journal and proves each line.

The operator's action is `RUNBOOK.md` § Browse production.

The role is not a migration, because a migration cannot set its password (a hand-run `ALTER ROLE … PASSWORD` would follow anyway, as for `app_rt` and `worker_rt`), and the journal would put its row-level security bypass into every database it builds, test clusters included. The generated roles surface also refuses a fourth role. The local database runs the file on every `up`, so the operator's one production run follows many local ones.

## The local embedding model choice

The CPU embedding host (bge-m3, 1024 dims) runs only for a workspace on the local embedding model choice. The first estate has none, because customer one embeds on a hosted model choice and a 4 GB box has no room for an idle model server. The choice is immutable per workspace. A workspace taking the local choice is growth step E, a third contract sized for a model host.

On that day, the service below joins a stores stack on the model-host box, not VPC 1, because a model server of 3 to 5 GB does not fit beside the Postgres resource, `api`, `worker`, Garage, the tunnel, and `backup`. Add `embeddings:1000` to that stack's `init` directory list, so `init` creates and owns `/data/embeddings`. Pin the image by digest on the day. Size its memory limit against the model (§ Memory).

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

`EMBEDDINGS_URL` is declared, unset, in the bootstrap block of `deploy/platform.compose.yaml`. Set it to the model host's address in the platform resource's env when you add the service.

## Probes at the first deploy

The private file records each answer with its date.

- **Two resources, one network.** Does redeploying the platform stack leave the stores stack untouched?
- **The Postgres resource.** Does the orchestrator accept the official pgvector image by digest (`packages/schema/src/postgres-image.ts`), keep its scheduled backup writer on it, and take a bind-mounted data directory? Does `\du` show the owner as the superuser? If so, running the api as `app_rt`, not the owner, is worth more, and ADR 0032's decision stands.
- **The runtime roles.** The migration creates `app_rt` and `worker_rt` `NOLOGIN`. Before the api can reach a freshly migrated box, the operator, as the resource's owner, grants `LOGIN` and sets each password (`ALTER ROLE app_rt LOGIN PASSWORD '…'`, the same for `worker_rt`). The operator then writes the DSNs into the platform resource's env as `DATABASE_URL` and `WORKER_DATABASE_URL`, and records in the private inventory how the passwords are held. On the platform resource only `migrate` gets the owner DSN. The stores resource's `DATABASE_URL` is the owner DSN too, because the `backup` service's dump reads every table.
- **`depends_on` on the day.** Which compose command did the orchestrator run? Did `migrate` complete before `api` started, and `worker` wait for `api` healthy? Plain `docker compose up -d` honours both on paper.
- **The first push to ghcr.io** may need the organisation's package-creation setting (Packages, allow members to create) before `build.yml` pushes its three images. The deploy unit and the stores resource take the three digests from the run summary.
- **The swap-in rate during the first index** decides growth step A. Steady swap-in means split now. A burst at the peak means the 1.5 GB worker cap holds.

## Memory

Every service on VPC 1 has a limit. Change one here and in the compose file together.

| Service | Limit |
| --- | --- |
| the Postgres resource | 1 GB, set in the orchestrator |
| `api` | 512 MB |
| `migrate` | 512 MB while it runs |
| `worker` | 1.5 GB, plus 1.5 GB of swap (`memswap_limit`). It runs one index at a time. |
| the object store | 384 MB |
| `backup` | 384 MB |
| `cloudflared` | 128 MB |
| `init` | 128 MB while it runs |

The running services sum to about 3.9 GB of 4 GB. The page-cache floor is 512 MB. `MemAvailable` on VPC 1 below it for five minutes is the second trigger for growth step A, beside the swap-in rate (`BACKUPS.md` § Signals).

## Stage 7 state

The private file holds where each secret goes, which channel carries which alert, how CI reaches the orchestrator through the edge, and the workflows' resource ids.

The workflows read these names:

- `COOLIFY_URL`, `COOLIFY_PROD_APP_UUID`, and `PUBLIC_URL`, as repository variables
- `COOLIFY_DEPLOY_TOKEN`, as a secret
- `RELEASE_MODE`, which sets whether `release.yml` releases per merge, nightly, or only on a drill (`CI.md`, *The rhythm*)

`SECRETS.md` holds the rules. A secret appears in exactly one env per box. The private-registry pull credential is in the server's Docker config and in no env. There are no shared team-level or project-level variables, because one stack per box leaves nothing to share.
