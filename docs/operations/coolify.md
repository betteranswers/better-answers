# The deployment on Coolify

This reference describes the production deployment. The docs site does not render it. Coolify is the orchestrator.

This file is the public half. The private file, `.planning/estate/coolify.md`, sits outside the repository. It holds the addresses, the firewall rules, each hostname's edge policy, the bucket and vault names, the orchestrator's URL, and the recorded probe results.

To stand up a deployment, run `deploy/wizard-41.sh`. It asks for every value a console needs and stores none. `deploy/host-setup.sh` does the shell work on each host, once per box.

## Boxes

There are two boxes. Each has 4 vCPU, 4 GB of memory, and 120 GB of NVMe. The contracts cannot be resized, so a bigger box is a third contract.

| Box | Role |
| --- | --- |
| **VPC 1** | Production. It runs the VPC 1 resources below, with `shared_buffers` at 512 MB on Postgres. It holds the git store under `/data/git`, a 4 GB swap file on the NVMe (`RUNBOOK.md` § Swap), and the checkout at `/opt/better-answers` that `restore-production.sh` runs from. `deploy/host-setup.sh vpc1` creates the swap file and the checkout. |
| **VPC 2** | The orchestrator and the git mirror. A restore target exists on it only during a drill or a rehearsal. Staging starts on demand and never stays up. |

No private network joins the boxes:

- The orchestrator manages VPC 1 over SSH.
- The mirror is a `git push` over SSH.
- Every customer byte arrives through the Cloudflare tunnel.

SSH is open from known sources only. Ports 80 and 443 are closed on both boxes. The private file holds the SSH users and the key names.

The deployment grows in two steps. Neither step changes the data model.

- **Step A** moves the object store, the git store, and `backup` to VPC 2 over a WireGuard pair. It costs nothing. The swap-in rate and the page-cache floor trigger it (§ Memory).
- **Step E** is a third contract.

## Resources

| Resource | Type | Box |
| --- | --- | --- |
| The Postgres resource | Orchestrator database | VPC 1 |
| The `stores` stack | Docker Compose, `deploy/stores.compose.yaml` | VPC 1 |
| The `platform` stack | Docker Compose, `deploy/platform.compose.yaml` | VPC 1 |
| The staging Postgres resource | Orchestrator database | VPC 2 |
| The two staging stacks | Docker Compose, outside the orchestrator | VPC 2 |
| The orchestrator | Coolify | VPC 2 |
| The restore drill | Host cron | VPC 2 |
| The image prune | Host cron | VPC 1 and VPC 2 |
| The backup S3 storage | Orchestrator S3 storage | None |
| Notifications | Email and the second channel | None |

### The Postgres resource

- The image is the official pgvector image, pinned by digest. The one reference to it is in `packages/schema/src/postgres-image.ts`. There is no custom image and no graph engine. The map is plain tables in this database.
- The volume is bind-mounted under `/data/postgres`.
- The orchestrator's scheduled dump is the second backup writer.

### The `stores` stack

- It runs the object store, `cloudflared`, and `backup`.
- `BACKUP_IMAGE_DIGEST` in the resource's env pins the backup image. Copy the digest from the run summary of `build.yml`. An operator moves it by hand. A release never moves it.

### The `platform` stack

- It runs `migrate`, then `api`, then `worker`.
- `release.yml` promotes the digests that `build.yml` pushed.
- The server's Docker config holds the pull credential for the private registry.

### Staging

- The staging Postgres resource is created once and kept empty. The drill refills it.
- The two staging stacks use the same two compose files plus `deploy/staging.override.yaml` and `deploy/staging.platform.override.yaml`. They read their env from a file that only root can read.
- The stacks come up for a drill or a rehearsal and are wiped after it (`RUNBOOK.md` § Bring staging up and tear it down).
- They hold only the synthetic fixture from `deploy/seed-synthetic.sh`. No hostname points at them.
- They run on plain `docker compose`. The overrides join them on the internal network `better-answers-staging-shared`. Production shares the orchestrator's network instead.

### The orchestrator

- Its version is pinned, with `AUTOUPDATE=false`.
- Upgrading it is a drill item.
- `BACKUPS.md` covers its instance backup.

### The restore drill

- Host cron on VPC 2 runs `restore-drill.sh` at 03:00 UTC on the 1st of each month. The drill ends by running `seed-synthetic.sh`.
- It reads its env from a file that only root can read. `host-setup.sh vpc2` writes that file and the cron line.
- It is not an orchestrator task, because the drill wipes the stacks that such a task runs inside.
- It reads production's counts over SSH, not through an open Postgres port.

### The image prune

- Host cron on both boxes runs `prune-images.sh` nightly at 01:30 UTC.
- `host-setup.sh` installs the script as `/usr/local/bin/better-answers-prune-images`. It logs to `/var/log/better-answers-prune-images.log`.
- It removes each unused `ghcr.io/betteranswers/*` image beyond the newest two per repository. The two kept images allow a rollback. `--keep <n>` changes the count.
- It skips the night if a deployment is running.
- `--dry-run` prints the plan and removes nothing.
- The orchestrator's own cleanup skips these images. A release pins each image by digest, which leaves the images tagged `<none>`.

### The backup S3 storage

The orchestrator holds the write-and-list credential only (`SECRETS.md`).

### Notifications

- Email reports a failed deploy, an unhealthy container, and a failed backup.
- The dead-man checks `scheduler`, `pg-hourly`, `nightly`, and `drill`, and the uptime check, alert the second channel. The second channel is SMS or a chat app.
- A weekly all-green digest separates silence from health.

## Ingress (Cloudflare)

### Hostnames

Every hostname resolves to the tunnel. The tunnel routes to `http://api:3000` on the platform stack. Nothing else is exposed.

| Hostname | Serves |
| --- | --- |
| The app hostname, `app.<apex>` | The single-page app, sign-in, consent, OAuth, and `/mcp`, on one origin |
| The agent hostname, `agent.<apex>` | `/agent/v1/*` only, for the share agent |
| The apex, `<apex>` | Concept IRIs. It answers 404 to every request. |

There is no MCP hostname and no docs hostname.

The private file records the edge policy of each hostname. Two rules govern it:

- A hostname that serves an unauthenticated OAuth flow or a sign-in cannot sit behind an interactive access wall.
- A machine hostname authenticates in the api before the api reads any body.

### Two fences, checked against each other

The first fence is the tunnel's ingress rules. They end in a catch-all `http_status:404`. Their values, the apex included, are in the private file. The table below gives their shape.

The second fence is `apps/api/src/ingress/hostnames.ts`. It is an ordered list of paths. Each path has a hostname role and a reason. The api refuses a path outside its hostname's paths before it reads any body. Without this fence, Better Auth's handler would answer its wildcard on every hostname.

At the first deploy, and at every change to either fence, check both directions:

1. Every tunnel rule names a role in `hostnames.ts`.
2. Every role in `hostnames.ts` has a tunnel rule.

The api refuses to start unless these three values all differ: the host of `PUBLIC_URL` (the app hostname), `AGENT_HOSTNAME`, and `APEX_HOSTNAME`.

| Tunnel rule, in order | Role in `hostnames.ts` | Service | Paths the fence allows |
| --- | --- | --- | --- |
| `app.<apex>` | `app` | `http://api:3000` | All: the single-page app, sign-in, `/health`, `/mcp`, `/.well-known/*`, `/jwks`, `/oauth2/*`, consent, and the session endpoints |
| `agent.<apex>` | `agent` | `http://api:3000` | `/agent/v1/*` only |
| `<apex>` | `apex` | `http://api:3000` | None. The api answers 404. |
| catch-all | None | `http_status:404` | None |

### Rate limiting

Rate limiting has two layers. Cloudflare's rules come first. The api's Postgres counters come second, for every route group except discovery.

Cloudflare's rules match by path on the app hostname. They do not match by hostname, because every path that takes a credential is on the app hostname. Each rule counts per client IP. The path groups are:

- The authorization server, `/oauth2/*`.
- Discovery, `/.well-known/*`.
- MCP without a bearer: `/mcp` with no `Authorization` header.
- The sign-in endpoints, `/email-otp/send-verification-otp` and `/sign-in/email-otp`.

The api counts each route group separately. It does not count page loads or discovery reads. It serves discovery with `Cache-Control: public, max-age=300`.

The first time a counter refuses an address in a window, the api logs `ingress.address_ceiling_met` once. The line carries the route group as `group`. It carries `anthropicRange` as true when the address is in Anthropic's published range `160.79.104.0/21`. The line never carries the address. A line with `group` set to `oauth` and `anthropicRange` true is the signal to revisit the token endpoint's ceiling. A request that Cloudflare refuses logs nothing.

### Rules per Cloudflare plan

Cloudflare limits the number of rate-limiting rules per plan, not the number of paths. Free allows one rule, Pro allows two, and Business allows five. This estate does not use Business. See [Cloudflare rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/).

- **On Free,** one rule covers three path groups with one OR expression and one shared threshold. A Free expression can match only URI paths, so only the api's counters cover MCP without a bearer.
- **On Pro,** one rule covers the credential writes: `/oauth2/*`, the sign-in endpoints, and `/mcp` without a bearer. A second rule covers discovery.

The private file's § Ingress records the order and threshold of each rule, and the date each was last tightened.

### The Pro trigger (Q9)

Move the zone to Pro before the first assistant credential exists. Until then, Free's one rule in front of the api's counters is accepted. On Free, the Cloudflare stage of `wizard-41.sh` stops unless the operator confirms that no assistant credential exists or is about to. The wizard then records the upgrade as owed.

### Rehearse a rule

Before you add a rule to the estate, test it against the real flow. Serve the api behind a Cloudflare quick tunnel:

```sh
pnpm --filter @better-answers/api run serve:local https://<name>.trycloudflare.com
```

A rule that breaks claude.ai's pre-flight request fails here first.

### The uptime check

The uptime check is one external check on the app hostname. It expects `200` from two paths:

- `/health`: the api is up and its database answers.
- `/.well-known/oauth-protected-resource/mcp`: discovery is served. A connector needs discovery first.

On Pro, Cloudflare Health Checks (under **Traffic**) request both paths from outside the boxes every minute. A check goes red after three failures. It alerts the second channel through Cloudflare Notifications. Health checks bypass rate limiting.

On Free, `deploy/uptime-probe.sh` requests both paths through the public edge from VPC 2. Host cron runs it every five minutes, so DNS, the tunnel, and the origin are all on the probed path. The probe pings the healthchecks.io check `uptime` (period 5 minutes, grace 5 minutes) with the outcome. Two requests every five minutes stay far below every rate-limiting threshold. healthchecks.io cannot replace the probe, because healthchecks.io only listens for pings.

The uptime check is the only outside signal for VPC 1. On Pro, only the daily and monthly pings cover VPC 2. On Free, a silent probe trips the dead-man alarm within ten minutes, and that includes VPC 2 being down. `RUNBOOK.md` page 1 records both cases.

### What `/health` reports

The `image` field in the `/health` body is the api digest that the container started from. `deploy/platform.compose.yaml` passes it in from `API_IMAGE_DIGEST`, the same variable that pins the service's `image:`. The field is `null` in the dev loop and in the test suites.

The release's smoke test waits on this field (`CI.md` § `release.yml`). The uptime check and the container healthcheck read only the status code.

Publishing the digest is safe. Every `release/*` tag in this public repository carries it, and the ghcr.io packages are private.

### Body size

The share agent's per-file cap equals the edge's body limit: 100 MB on Free and on Pro.

## Browsing the database

One GUI login browses two databases.

- **The local database** is the daily case. `deploy/local-database.sh up` starts it on a developer's machine from the pinned image. The script applies the journal and seeds the synthetic fixture (`README.md` § Browsing the data).
- **Production** is browsed occasionally, and only through the forward below.

### The forward

`deploy/browse-production.sh` forwards a loopback port on the operator's machine over SSH to the Postgres resource's host-published port on VPC 1. On VPC 1, the orchestrator's TCP proxy fronts the database.

- The local end is `127.0.0.1:55433`. Set `BROWSE_PORT` to use another port.
- The forward uses keepalives and binds only the loopback.
- It refuses a local port that is already in use.
- It holds the foreground until Ctrl-C.
- It reads `VPC1_SSH_TARGET`, `VPC1_SSH_KEY` (optional), and `VPC1_DATABASE_PORT` from the private file's § Browsing production. It prints none of them.

Do not use a GUI's built-in SSH support. It times out where a terminal forward works.

The operator's procedure is `RUNBOOK.md` § Browse production.

### Exposure

- The provider firewall closes the database port to the internet (§ Boxes).
- The public-port toggle on the Postgres resource stays on. Without it, there is no host-published port to forward to.
- A GUI profile signs in as `browse_ro`, never as the owner.
- The operator reads the toggle's state and port on the day and records them in the private file.

### The read-only role

`deploy/browse-role.sql` creates `browse_ro` in one transaction. A failed run grants nothing, and a rerun is safe. `browse_ro` has:

- a login with no superuser, role-creation, database-creation, or replication right
- the row-level security bypass, because every tenant table forces row-level security
- SELECT on every table and view in `public` and `index`
- EXECUTE on the one pure function that the passage view uses to class its rows
- read-only sessions by default, so Postgres refuses a write before it checks any grant
- the rights every login has: to create a temporary table and to change its own password. Neither right reaches a platform row.

`browse_ro` cannot read the credential columns of the identity tables, because a login that reads a live credential can act as its holder. The withheld columns are:

- the session token
- the verification value
- the private half of the signing key
- an account's tokens and password
- an OAuth client's secret
- the OAuth token values
- the refresh token's replay response

`browse_ro` also cannot read `sealed` in `model_key`. Only the envelope key opens it, and this login never holds that key. `workspace_id` and `provider` stay readable, so a reader can see which workspace holds a key for which provider.

Rerun the file after a migration adds tables, so that `browse_ro` can read them. The file withholds a new credential column only once it names the column. The pull request that adds a credential column must add its name to the file.

`apps/api/tests/deploy/browse-role.test.ts` runs the file over the whole journal and tests each line.

The role is not a migration, for two reasons. A migration cannot set the role's password, so a hand-run `ALTER ROLE … PASSWORD` would follow anyway, as it does for `app_rt` and `worker_rt`. Also, the journal would put the role's row-level security bypass into every database it builds, test clusters included. The generated roles surface (`packages/schema/scripts/roles-surface.ts`) also refuses a fourth role. `deploy/local-database.sh` runs the file on every `up`, so the one production run follows many local runs.

## The local embedding model

The CPU embedding host runs bge-m3 at 1024 dimensions. It runs only when a workspace uses the local embedding model choice. The current estate has no such workspace. Customer one embeds on a hosted model choice, and a 4 GB box has no room for an idle model server.

A workspace's model choice cannot change after it is set. A workspace that takes the local choice triggers growth step E: a third contract, sized for a model host.

### Add the embedding service

The model server needs 3 to 5 GB. It does not fit on VPC 1 beside the Postgres resource, `api`, `worker`, Garage, the tunnel, and `backup`. Add it to a stores stack on the model-host box instead.

1. Add `embeddings:1000` to the directory list of that stack's `init` service. `init` then creates `/data/embeddings` and owns it.
2. Add the service below. Pin the image by digest on the day.
3. Set the memory limit to fit the model (§ Memory).
4. In the platform resource's env, set `EMBEDDINGS_URL` to the model host's address. `deploy/platform.compose.yaml` declares `EMBEDDINGS_URL`, unset, in its bootstrap block.

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

## Probes at the first deploy

Answer each question at the first deploy. Record each answer, with its date, in the private file.

- **Two resources, one network.** Does a redeploy of the platform stack leave the stores stack untouched?
- **The Postgres resource.** Does the orchestrator accept the official pgvector image by digest (`packages/schema/src/postgres-image.ts`)? Does it keep its scheduled backup writer on that image? Does it take a bind-mounted data directory? Does `\du` show the owner as a superuser? If it does, running the api as `app_rt` instead of the owner matters even more.
- **`depends_on`.** Which compose command did the orchestrator run? Did `migrate` complete before `api` started? Did `worker` wait for `api` to be healthy? Plain `docker compose up -d` honours both conditions, but the orchestrator may run a different command.
- **The first push to ghcr.io.** The push may need the organisation's package-creation setting (**Packages**, allow members to create packages) before `build.yml` pushes its three images. The deploy unit and the stores resource take the three digests from the run summary.
- **The swap-in rate during the first index.** The rate decides growth step A. A steady swap-in means split now. A burst at the peak means the 1.5 GB cap on `worker` holds.

### Enable the runtime logins

The migration creates `app_rt` and `worker_rt` as `NOLOGIN`. The api cannot reach a freshly migrated box until the operator enables both.

1. As the resource's owner, grant `LOGIN` and set a password for each role:

   ```sql
   ALTER ROLE app_rt LOGIN PASSWORD '…';
   ALTER ROLE worker_rt LOGIN PASSWORD '…';
   ```

2. In the platform resource's env, write the `app_rt` DSN as `DATABASE_URL` and the `worker_rt` DSN as `WORKER_DATABASE_URL`.
3. Record in the private file how the passwords are held.

On the platform resource, only `migrate` gets the owner DSN, as `MIGRATE_DATABASE_URL`. The stores resource's `DATABASE_URL` is also the owner DSN, because the dump in the `backup` service reads every table.

## Memory

Every service on VPC 1 has a memory limit. To change a limit, change it here and in the compose file together.

| Service | Limit |
| --- | --- |
| The Postgres resource | 1 GB, set in the orchestrator |
| `api` | 512 MB |
| `migrate` | 512 MB, while it runs |
| `worker` | 1.5 GB, plus 1.5 GB of swap (`memswap_limit`). It runs one index at a time. |
| The object store | 384 MB |
| `backup` | 384 MB |
| `cloudflared` | 128 MB |
| `init` | 128 MB, while it runs |

The running services sum to about 3.9 GB of the box's 4 GB. The page-cache floor is 512 MB. Growth step A has two triggers (`BACKUPS.md` § Signals):

- the swap-in rate
- `MemAvailable` on VPC 1 below the 512 MB floor for five minutes

## CI names and secret placement

The private file holds where each secret goes, which channel carries which alert, how CI reaches the orchestrator through the edge, and the resource ids that the workflows use.

The workflows read these names:

- `COOLIFY_URL`, `COOLIFY_PROD_APP_UUID`, and `PUBLIC_URL`, as repository variables
- `COOLIFY_DEPLOY_TOKEN`, as a secret
- `RELEASE_MODE`, which sets whether `release.yml` releases per merge, nightly, or only on a drill (`CI.md`, _The rhythm_)

`SECRETS.md` holds the rules for secrets. Three rules apply to this deployment:

- A secret appears in exactly one env per box.
- The pull credential for the private registry is in the server's Docker config and in no env.
- There are no shared team-level or project-level variables. One stack per box leaves nothing to share.
