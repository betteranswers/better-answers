---
title: "Production is a Postgres resource and two Compose stacks, deployed by digest and backed up off-host"
date: 2026-09-27
module: deploy
problem_type: architecture_pattern
component: deploy
severity: high
applies_when:
  - "Adding a service, a volume or an image to either compose stack"
  - "Changing how a release is promoted, tagged or rolled back"
  - "Changing what a release must pass before it is tagged"
  - "Rebuilding a signed-in run against production at go-live"
  - "Changing a backup job, a restore script or the restore drill"
  - "Adding a hostname or a path at the edge"
tags:
  - adr-0022
  - deploy-unit
  - release-mode
  - digest
  - backup
  - restore-drill
  - staging
---

# Production is a Postgres resource and two Compose stacks, deployed by digest and backed up off-host

## The decision

Production runs on VPC 1 as a Coolify Postgres resource and two Compose stacks:

- `stores` (`deploy/stores.compose.yaml`), redeployed only for a store's upgrade.
- `platform` (`deploy/platform.compose.yaml`: `migrate` → `api` → `worker`), redeployed on every release.

Every stateful service is a bind mount under `/data/<service>`. Garage is the object store, provisioned by `deploy/wizard-41.sh`. Every image deploys by digest, and the backup image is the third. Every release that held is an annotated `release/*` tag, never a commit to `main`. A release holds once its smoke has passed. Every call to the orchestrator must answer 2xx. Migrations are forward-only, and a rollback is the previous digest. That decision lives here alone.

One variable, `RELEASE_MODE`, phases the releases:

- `per-merge`: every green build on `main` releases its own commit, unless `main` has moved past it. It runs until the first customer's bundle lands.
- `nightly`: `main`'s newest green commit is released at 02:35 UTC, once the box's own verified backup is fresh. It runs until go-live.
- `drill`: a dispatched release names the drill report it rides on, or a hotfix reason. It runs from go-live.
- Any other value releases nothing.

Until go-live, no run signs in to production. The browser suite proves each page before it merges, and the smoke and the uptime probe watch production. The signed-in production journeys, and the `JOURNEYS_MODE` variable that staged them, are retired until go-live.

Until the first customer uses the platform, a failed release never rolls production back. The owner decides, by the runbook's rollback. From that day, a failure re-promotes the last tagged release. If the failed release added a migration, the failure alerts the owner instead. That rollback is BA-48, still to be built.

Every irreplaceable byte is encrypted and copied off-host:

- Postgres is dumped hourly, daily, weekly and monthly under a governance-mode lock.
- The object store is mirrored to an unlocked bucket.
- Each workspace's git store is bundled and mirrored to VPC 2.
- Every job pings a hosted dead-man's switch only once its upload is verified.
- The backup identity is resident on VPC 2 as well as escrowed with two holders.

Every restore replays the erasures completed after its dump, once all three stores are back and before `api` starts. The replay runs on `api`, the one service carrying both stores' settings. `deploy/restore-production.sh` has no exit trap. It empties and refills the database in one transaction once the dump has been read whole, and wipes no other store. The monthly drill on VPC 2 (`deploy/restore-drill.sh`) reads production over SSH and ends by wiping staging.

The edge is one tunnel and three hostnames. `app.` is open, and Better Auth is its sign-in. The tunnel's ingress rules are the first fence, and the api's own hostname list (`apps/api/src/ingress/hostnames.ts`) is the second. The `pnpm ops` commands answer done · refused · not built. The ops documents live in `docs/operations/`.

## Why

- A Coolify redeploy stops and restarts the whole resource, so one stack would restart the tunnel and every store on every release.
- Every dump is a personal-data copy. Replaying the erasures completed after it is what makes "beyond use" honest.
- The replay runs after the stores are back because the routine it re-runs rewrites each repository and reads its replay copy from the object store.
- The backup identity sits on VPC 2 because the drill runs unattended, and a drill that needs a person present stops happening. The cost: a VPC 2 compromise exposes every dump's plaintext.
- At about sixty merges a day, a release by hand is sixty dispatches nobody makes. A drill report on every release of a platform nobody relies on yet buys nothing.
- Nothing reaches the stores stack from GitHub but the orchestrator's API, so the nightly release rides the box's own backup rather than a backup CI takes.
- The first automatic release tagged a deploy that never happened: the edge answered empty credentials with a redirect that `curl -f` counted as success. Hence every call must answer 2xx, and only a release that held gets a tag. So the newest tag is always the last release that held, and the rollback target. A release whose smoke failed may still run, untagged, with its migrations applied all the same. So a rollback first lists the migrations it would cross.
- The smoke reads `/health` and one unauthenticated document, so a release can pass it and refuse every sign-in. Only a run signed in as each role sees that in production. Until go-live the browser suite sees it before merge, signed in as each role against the served build.
- An automatic rollback across a migration would run an api older than its schema: a rollback below migration 0053 fails every sign-in.
- Forward-only and the digest rollback are a decision, not a rule, because neither half is legible in a diff.
- The api's list is the second fence because Better Auth's handler answers the wildcard on every hostname the process is given.

## Rejected

- One compose stack for everything: an outage per release.
- Every store its own Coolify resource: more resources to keep in step.
- A compliance-mode lock for twelve months: "we cannot" reads as failure to design for erasure, and a scripting mistake is unfixable.
- WAL archiving from day one: a second process with its own failure modes, until the database passes 5 GB or a contract asks for an RPO under an hour.
- SeaweedFS as the object store: several daemons even in one process.
- Access service tokens at the edge: a second credential class, kept as the day-two kill switch.
- A self-hosted dead-man's switch on VPC 2: it cannot report its own outage.
- SOPS in the repository: one more tool, and Coolify still needs the values pasted.
- A switch per release phase: the phases never overlap, and one name read in one place cannot contradict another.
- Signed-in production journeys before go-live: 37 of the last 40 releases ran them and every run held, while 69 of the 1,894 commits since 25/09/2026 went to keeping them up. They return at go-live.
