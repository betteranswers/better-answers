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
  - "Changing what a release must pass before it is tagged, or when the journeys run"
  - "Changing a backup job, a restore script or the restore drill"
  - "Adding a hostname or a path at the edge"
tags:
  - adr-0022
  - deploy-unit
  - release-mode
  - journeys
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

Every stateful service is a bind mount under `/data/<service>`. Garage is the object store, provisioned by `deploy/wizard-41.sh`. Every image deploys by digest, and the backup image is the third. Every release that held is an annotated `release/*` tag, never a commit to `main`. A release holds once its smoke has passed, and, under `JOURNEYS_MODE=gate`, once its journeys have ended `held` too. Every call to the orchestrator must answer 2xx. Migrations are forward-only and a rollback is the previous digest; that decision lives here alone.

One variable, `RELEASE_MODE`, phases the releases:

- `per-merge`: every green build on `main` releases its own commit, unless `main` has moved past it. It runs until the first customer's bundle lands.
- `nightly`: `main`'s newest green commit is released at 02:35 UTC, once the box's own verified backup is fresh. It runs until go-live.
- `drill`: a dispatched release names the drill report it rides on, or a hotfix reason. It runs from go-live.
- Any other value releases nothing.

The journeys sign in to production as the test people and walk the pages each role reaches. A second variable, `JOURNEYS_MODE`, stages them:

- `off`, or unset: they never run, and a release is tagged on its smoke.
- `report`: they run and report, and the tag still follows the smoke.
- `gate`: a journeyed release is tagged only when its journeys end `held`. One that ends `fail` stays live and is tagged `rejected/`, which the nightly gate treats as the edge of its walk, so it never promotes that commit again or moves production back past it. One that cannot run stays live, untagged, and is promoted again the next night.
- Any other value releases nothing.

Under `report` and `gate` the journeys run after every nightly or dispatched promotion whose smoke passes, before its tag. A release `build.yml` calls after a merge runs none, and keeps its smoke-only tag under every value. A scheduled night with nothing newer to promote runs them alone against the live release, in every release mode, and so does a journeys-only dispatch. They check out the commit the live api image was built from, read from the image's revision label.

Until the first customer uses the platform, a failed release never rolls production back: the owner decides, by the runbook's rollback. From that day, a failure re-promotes the last tagged release, unless the failed release added a migration, which alerts the owner instead. That rollback is BA-48, still to be built; its rejected marker landed first, with the gate.

Every irreplaceable byte is encrypted and copied off-host:

- Postgres is dumped hourly, daily, weekly and monthly under a governance-mode lock.
- The object store is mirrored to an unlocked bucket.
- Each workspace's git store is bundled and mirrored to VPC 2.
- Every job pings a hosted dead-man's switch only once its upload is verified.
- The backup identity is resident on VPC 2 as well as escrowed with two holders.

Every restore replays the erasures completed after its dump, once all three stores are back and before `api` starts. The replay runs on `api`, the one service carrying both stores' settings. `deploy/restore-production.sh` has no exit trap. It empties and refills the database in one transaction once the dump has been read whole, and wipes no other store. The monthly drill on VPC 2 (`deploy/restore-drill.sh`) reads production over SSH and ends by wiping staging.

The edge is one tunnel and three hostnames. `app.` is open, with Better Auth its sign-in. The tunnel's ingress rules are the first fence, and the api's own hostname list (`apps/api/src/ingress/hostnames.ts`) is the second. The `pnpm ops` commands answer done · refused · not built. The ops documents live in `docs/operations/`.

## Why

- A Coolify redeploy stops and restarts the whole resource, so one stack would restart the tunnel and every store on every release.
- Every dump is a personal-data copy. Replaying the erasures completed after it is what makes "beyond use" honest.
- The replay runs after the stores are back because the routine it re-runs rewrites each repository and reads its replay copy from the object store.
- The backup identity sits on VPC 2 because the drill runs unattended, and a drill that needs a person present stops happening. The cost: a VPC 2 compromise exposes every dump's plaintext.
- At about sixty merges a day, a release by hand is sixty dispatches nobody makes. A drill report on every release of a platform nobody relies on yet buys nothing.
- Nothing reaches the stores stack from GitHub but the orchestrator's API, so the nightly release rides the box's own backup rather than one CI takes.
- The first automatic release tagged a deploy that never happened: the edge answered empty credentials with a redirect that `curl -f` counted as success. Hence 2xx only, and a tag only for a release that held, so the newest tag is always the last release that held, and the rollback target. Under `gate` the release production runs may be newer than that tag and untagged, with its migrations applied all the same, so a rollback first lists the migrations it would cross.
- The smoke reads `/health` and one unauthenticated document, so a release can pass it and refuse every sign-in. Only a run signed in as each role sees that.
- The journeys skip a release `build.yml` calls because `per-merge` lasts only until the first customer's bundle lands, and journeys on every release of a platform nobody relies on yet buy nothing.
- Every night runs them, with or without a promotion, so the alert hears from each night and a night with no run reads as a late check. They sit in the release's concurrency group, so they never overlap a release.
- A refused night pings `could-not-run`, so an unknown mode or an unreadable history reaches the alert that night, not a day and a half later.
- A failed release is rejected rather than promoted again: without the marker, `gate` would redeploy the same broken commit every night, restarting the api, until someone acted. Only `fail` rejects, since `could-not-run` says nothing about the release.
- They check out the image's own commit, not `main`'s head, so a rollback night runs the old commit's journeys against the old images.
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
- A daily schedule of the journeys' own: a second place they run, which could overlap a release.

## History

The full record, with its thirteen amendments (among them T-005, T-022, T-030, T-039, T-045, T-119, T-125, T-184 and T-358): `docs/archive/adr/0022-two-stacks-deployed-by-digest.md`.
