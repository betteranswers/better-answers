# Deployment — two boxes, two stacks, one tunnel

The estate ADRs 0022 and 0024 fix: two IONOS boxes of 4 vCPU · 4 GB · 120 GB NVMe, production on one, Coolify and the mirror on the other, every image deployed by digest, every irreplaceable byte encrypted off-host. The files are `deploy/stores.compose.yaml` and `deploy/platform.compose.yaml`; the operations documents are under `apps/docs-site/operations/`.

```mermaid
C4Deployment
  title Deployment diagram — the v0.1 estate

  Deployment_Node(cloudflare, "Cloudflare", "edge, Free plan", "Three ingress rules on the tunnel: app., agent., the apex; catch-all 404; rate-limit rules on app. paths") {
    Container_Ext(edge, "Tunnel ingress", "Cloudflare Tunnel", "Every hostname to api:3000 over the tunnel; the first fence")
  }

  Deployment_Node(vpc1, "VPC 1 — production", "IONOS VPS, 4 GB, 4 GB swap file, Coolify-managed over SSH", "Everything production, every service with a memory limit") {
    Deployment_Node(pgnode, "Postgres resource", "Coolify database resource, 1 GB, shared_buffers 512 MB", "Its own lifecycle and a second backup writer") {
      ContainerDb(postgres, "Postgres", "pgvector on Postgres 18, pinned by digest", "The identity set, the tenant tables, the graph, the queue, the ledger")
    }
    Deployment_Node(stores, "stores stack", "docker compose, redeployed for a store's upgrade only", "init, objectstore, cloudflared, backup; the embedding host commented out") {
      Container(init, "init", "alpine, one-shot", "Owns every /data directory by uid; never root")
      ContainerDb(garage, "objectstore", "Garage, single node, 384 MB", "S3 on :3900, internal only; /data/objectstore")
      Container(cloudflared, "cloudflared", "128 MB", "The only way in; lives here so a release never drops the tunnel")
      Container(backup, "backup", "cron, pg_dump, age, rclone, git, 384 MB", "Hourly to monthly dumps, the nightly mirror, git bundles and the push mirror; pings only after a verified upload")
    }
    Deployment_Node(platform, "platform stack", "docker compose, redeployed on every release, migrate then api then worker", "Both images by digest, or the stack refuses to start") {
      Container(migrate, "migrate", "api image, 512 MB, one-shot", "Runs the journal as the owner role; exit 0 releases api")
      Container(api, "api", "Node 24, 512 MB, :3000", "Serves app. and agent.; mounts /data/git read-write as GIT_STORE_DIR")
      Container(worker, "worker", "Python 3.13, 1.5 GB plus 1.5 GB swap", "One index at a time; mounts /data/git read-only, /data/worker/lmdb and /data/worker/trees; refuses to claim on a schema mismatch")
    }
  }

  Deployment_Node(vpc2, "VPC 2", "IONOS VPS, 4 GB", "Coolify, the mirror, a restore target that exists only during a drill") {
    Container(coolify, "Coolify", "pinned, auto-update off", "Deploys VPC 1 over SSH; PATCHed digests then a deploy call per release")
    ContainerDb(mirror, "Git mirror", "/data/mirror, SSH", "The push mirror of every bare repository, nightly")
    Container(staging, "Restore target", "the same two compose files, on demand", "Wiped, restored from the buckets with erasures replayed, smoke-tested, wiped and re-seeded; every third drill rehearses the erasure routine")
  }

  Deployment_Node(offhost, "Off-host", "Backblaze B2, EU; healthchecks.io; ghcr.io", "Nothing here holds a plaintext client byte") {
    ContainerDb(dumps, "Dumps bucket", "S3, versioned, object lock in governance mode", "Encrypted Postgres dumps 48 h · 30 d · 8 w · 6 m; the host credential can write and list, never delete")
    ContainerDb(mirrorbucket, "Mirror bucket", "S3, versioned, unlocked, 30-day non-current expiry", "The object-store mirror, so erasure deletions propagate")
    Container_Ext(healthchecks, "Dead-man switch", "healthchecks.io", "The scheduler's minute ping, every backup job's outcome word, the drill and staging-wiped checks")
    Container_Ext(registry, "Image registry", "ghcr.io, private", "api, worker and backup images pushed by build.yml on main, pulled by digest")
  }

  Rel(edge, cloudflared, "Reaches over the tunnel", "outbound from cloudflared")
  Rel(cloudflared, api, "Forwards every hostname to", "HTTP :3000 on the shared network")
  Rel(migrate, postgres, "Migrates", "owner DSN")
  Rel(api, postgres, "Reads and writes", "app_rt DSN")
  Rel(worker, postgres, "Claims and writes", "worker DSN")
  Rel(api, garage, "Streams objects", "S3")
  Rel(worker, garage, "Reads objects", "S3")
  Rel(backup, postgres, "Dumps hourly", "pg_dump, age")
  Rel(backup, garage, "Mirrors nightly", "rclone")
  Rel(backup, dumps, "Uploads and verifies", "rclone, S3")
  Rel(backup, mirrorbucket, "Syncs", "rclone, S3")
  Rel(backup, mirror, "Push-mirrors every repository to", "git over SSH")
  Rel(backup, healthchecks, "Pings after a verified upload", "HTTPS")
  Rel(api, healthchecks, "Pings every minute", "HTTPS")
  Rel(coolify, migrate, "Starts a release: migrate, then api, then worker", "SSH, docker compose")
  Rel(coolify, registry, "Pulls by digest from", "read-only token")
  Rel(staging, dumps, "Restores from, in a drill", "rclone")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="2")
```

## What the diagram claims

- **Two stacks because a Coolify redeploy restarts the whole resource.** The stores stack holds the tunnel and the stores and is redeployed a few times a year; the platform stack is redeployed on every release. `depends_on` is a convenience; the safety is in the process — `migrate` waits for the DSN, the worker compares its committed schema view to the migrator's stamp and claims nothing until they agree (ADR 0007).
- **Three hostnames, not four, and none behind Access.** `app.` carries the SPA, sign-in, consent, `/oauth2/*`, discovery, `/jwks` and `/mcp`; `agent.` is routed only to `/agent/v1/*`, unbuilt; the apex answers 404. `mcp.` is gone and `docs.` struck (ADR 0034; ADR 0022, amended 2026-09-03). The app derives `app.` from `PUBLIC_URL` and refuses to start unless all three differ.
- **What is never backed up**: every per-binding LMDB (personal data, disposable), the worker's working trees and caches. The graph rides every dump and every restore as ordinary tables (ADR 0032).
- **Every dump is a personal-data copy**, so every restore replays the erasures completed after the dump before `api` turns healthy — `pnpm ops replay-erasures`, which S0 fills in — and the erasure report's dates are computed from the last dump before the rewrite (ADRs 0020, 0022).
- **The growth steps are named**: A — split the stores to VPC 2 over WireGuard if the swap-in rate during the first index says so; E — a third contract, brought forward to the day a workspace asks for local embedding (ADR 0024).

## Memory on VPC 1

| Service | Limit |
| --- | --- |
| Postgres resource | 1 GB |
| worker | 1.5 GB, plus 1.5 GB of the swap file |
| api | 512 MB |
| migrate | 512 MB, one-shot |
| objectstore | 384 MB |
| backup | 384 MB |
| cloudflared | 128 MB |
| init | 128 MB, one-shot |

The sum is what `BACKUPS.md` § Signals measures the page-cache floor against; a box under that floor for five minutes is growth step A.
