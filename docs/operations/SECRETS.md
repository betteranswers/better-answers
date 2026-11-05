# Where each secret lives and how it rotates

The docs site does not render this file. It holds names and procedures, and no values. The estate's own inventory is `.planning/estate/SECRETS.md`, outside the repository (§ What the estate holds). To run your own deployment, use this file with the compose files under `deploy/`, the Dockerfiles, `deploy/host-setup.sh`, and `deploy/wizard-41.sh`.

No secret is ever in git. A deployment secret lives in the orchestrator's encrypted environment for its resource, and the tier's typed config module reads it once. The orchestrator also writes each resource's `.env` in plaintext to that resource's workdir on the production host. That risk is accepted, so treat a disk image or a snapshot of that host as a secret.

## Where a secret lives

Two facts decide where a secret lives. The first is who owns it: the deployment, a workspace, or a person. The second is what the platform does with it: sends it onward, checks it when someone presents it, or uses it at boot. Read ADR 0052 (`docs/solutions/architecture-patterns/adr-0052.md`) before you add a secret to a tier's config module or to a compose file.

### Deployment secrets

The deployment owns every secret in this table.

| Secret | What uses it | Where it lives |
| --- | --- | --- |
| `KEK` (the envelope key), `AUTH_SECRET`, the database DSNs (`DATABASE_URL`, `WORKER_DATABASE_URL`, `MIGRATE_DATABASE_URL`), `SMTP_URL`, the object store's root pair (`OBJECTSTORE_ROOT_KEY`, `OBJECTSTORE_ROOT_SECRET`), `HEALTHCHECKS_PING_URL_SCHEDULER`, and `HEALTHCHECKS_PING_URL_SWEEPS` | The api and worker tiers, at boot. The backup job also reads the object store's root pair. | The platform resource's environment (`deploy/platform.compose.yaml`). The tier's typed config module reads each one once, never at a call site and never from `process.env`. `KEK` is also in escrow. |
| `TUNNEL_TOKEN`, `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`, and the backup job's `DATABASE_URL`, `HEALTHCHECKS_PING_URL_PG_HOURLY`, and `HEALTHCHECKS_PING_URL_NIGHTLY` | The tunnel, Garage, and the backup job, which run outside the two tiers. | That container's environment in the stores resource (`deploy/stores.compose.yaml`). |
| The backup bucket's write-and-list pair (`BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`) | The backup job | The stores resource's environment. |
| The mirror deploy key | The backup job's git mirror | A root-only directory on VPC 1, `/data/backup/mirror-ssh`, mounted read-only into the `backup` service. |
| The drill's credentials: the backup bucket's read pair (`RCLONE_CONFIG_DUMPS_*`), a write-and-list pair for its report (`RCLONE_CONFIG_DRILLSINK_*`), `STAGING_DATABASE_URL`, the staging object store pair, `HEALTHCHECKS_PING_URL_DRILL`, `HEALTHCHECKS_PING_URL_STAGING_WIPED`, its SSH key into VPC 1, and the backup `age` identity | The monthly restore drill | Root-only files on VPC 2: `/etc/better-answers/drill.env`, `/etc/better-answers/staging.env`, `/etc/better-answers/backup-age.key`, and `/root/.ssh/id_ed25519`. The identity's private half is also in escrow. Its public half is `BACKUP_AGE_RECIPIENT` in the stores resource's environment (§ The backup identity). |
| The backup bucket's admin credential, which can delete, change the lifecycle, and bypass governance | Recovery only | Escrow only. It is on no box. |

### Workspace and person secrets

| Secret | Owner and use | Where it lives |
| --- | --- | --- |
| A workspace's model key | The workspace's. The api sends it to the workspace's model provider. | A sealed row in `model_key`. The api tier opens it at the moment of a model call. It is never logged and never in an `llm_call` row (§ A workspace's model key). |
| A connected source's credential | The workspace's. The platform sends it to the source. | A sealed row, opened at the moment of a sync. `docs/specs/route/s4.md` builds it and decides which tier opens it. |
| An acting credential | A person's. The platform sends it to a connected source to write back as that person, after approval. | A sealed row keyed by person and workspace, opened only after approval. Not in v0.1. |
| `CUBIC_API_KEY` | A person's. The `cubic` CLI sends it to Cubic when `pnpm run cubic-review` runs the author's pre-push review on Cubic's included model. | The environment of the machine or cloud session that runs the review. It is never in git and never in CI, and no tier reads it. The `cubic` CLI reads it from the environment, and the script never puts it in an argument (§ The Cubic API key). |
| A share agent's token on `/agent/v1`, scoped to connected sources | The workspace's. The api checks it when the agent presents it. | A hashed row behind a lookup prefix. It expires and can be revoked. The api checks it before it reads any body. Not built yet. |
| Sign-in links and recovery codes | A person's. The api checks each one when it is presented. | Rows the platform writes. A recovery code is hashed in `recovery_code`. A sign-in link is keyed by a hash in `verification`, holds its email code sealed under the auth secret, and expires. |
| OAuth tokens and client secrets, session tokens, the authenticator secret and its backup codes, and the JWT signing keys | A person's, an OAuth client's, or the deployment's | Better Auth's tables, under the library's own conventions. OAuth tokens and client secrets are hashed. The authenticator secret, its backup codes, and the signing keys are encrypted under the auth secret. |

### Secrets CI holds

CI holds five secrets that are not the platform's. A provider issues each one, each one can be revoked, and each one is scoped to one action. `DOCKERHUB_USERNAME` is stored as a secret beside `DOCKERHUB_TOKEN`, but it is an account name.

| Secret | Scope |
| --- | --- |
| `DOCKERHUB_TOKEN` | A read-only Docker Hub token. CI uses it to pull an image that `mirror.gcr.io` lacks. |
| `COOLIFY_DEPLOY_TOKEN` | The deploy token. |
| `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` | A Cloudflare Access service token. It lets the deploy and the release reach the orchestrator through its tunnel. |
| `HEALTHCHECKS_READ_KEY` | The dead-man service's read-only API key. The nightly release uses it to check that the box's backup is fresh. The key reads check states and can ping nothing, so it cannot make a backup look fresh. |

### The Cubic API key

A Cubic API key starts with `cbk_`. A person issues it in Cubic's settings and can revoke it there. It is for a session that cannot sign in with a browser, such as a cloud session. It works only while the organisation's Cubic subscription is active.

A session without a key connects a model provider instead, with `cubic auth connect claude-code` or `cubic auth connect codex`. The CLI keeps that provider token in its own auth file on that machine only, and `cubic auth list` shows the path. The repository never holds the token. For a session with neither, follow `.agents/playbooks/review.md`.

To rotate the key with no downtime:

1. Issue a new key in Cubic's settings.
2. Set the new key where the old one was.
3. Revoke the old key.

Revoking a key stops every job that uses it at once.

### Retired secrets

The journeys' seven secrets and the test inbox's deploy token are retired until go-live. Nothing in CI reads them. The go-live rebuild sets them up again from this file as commit `a3c19ec8` holds it, which gives each one's reach and rotation. Read that version with `git show a3c19ec8:docs/operations/SECRETS.md`.

## Rules every secret follows

Write down each secret's rotation before you create the credential. A rotation reissues the secret at the provider, swaps it in, redeploys, and revokes the old one. If a rotation needs downtime, say so.

- A missing required key fails the boot. The worker's config module and the api's required readers stop the process when a key they need is absent. The compose files refuse a deploy without one. An optional key, such as `KEK` when the api runs outside the compose files, is reported as absent at boot or at its first use.
- No secret is ever logged, whether by the logger, by the exporter, or on an `llm_call` row.
- Rotation on compromise follows a runbook page and needs no decision. A host compromise rotates every host-side credential. A database compromise rotates the envelope key, and then every model key is set again (§ A workspace's model key). No per-workspace data key sits between the two.
- Backups are encrypted client-side with `age`. Rotating the identity re-encrypts nothing, and existing copies expire on their own lifecycle (§ The backup identity, and `BACKUPS.md`).
- Escrow has two holders before the first customer goes live, under a written instruction. The first drill tests the recovery path. The holders' names are estate detail and are not published.
- Access decisions are audit-logged.
- The platform stores a secret that it checks as a hash, except in Better Auth's tables, which keep the library's conventions. The platform seals a model key and never hashes it, because it sends the key onward.

## A workspace's model key

A model key is a workspace's API key for one model provider. It is a row in `model_key`, sealed under the envelope key, with one row per workspace and provider. The api tier opens the row at the moment of a model call, and the worker tier holds no grant on the table. For the steps to set, rotate, and list the keys, see `RUNBOOK.md` § Set a workspace's model key.

- The envelope key is `KEK` on the api service. It is 32 random bytes written as 64 hexadecimal characters, as `openssl rand -hex 32` prints them. It is also in escrow.
- `pnpm ops set-model-key` and the api server read `KEK` through the typed config module. Without `KEK`, the command refuses. The server still starts, logs `no model will be called`, and `ask` calls no model.
- The command takes the key on standard input, never as a command-line argument, so the key reaches no shell history and no process list.
- Each run of `set-model-key` writes one audit event that names the model provider.
- Replacing a key rotates it and needs no downtime. A call made between setting the new key and revoking the old one uses whichever key the row holds.
- If a key leaks, revoke it at the model provider first. Revoking it there stops its use.
- After a restore, a model key replaced since the dump is back at its old value, and it still opens. Set each such key again.

### Before you change `KEK`

No command re-seals a row under a new envelope key. A row sealed under the old key stays in the table and no longer opens. Nothing reports the row until a model call refuses.

1. List the workspace and provider pairs.
2. Change `KEK`.
3. Set each key again.

If `KEK` is compromised, every model key sealed under it has leaked, because anyone with `KEK` and the database can open each row. Sealing the same keys again under a new `KEK` protects nothing. Revoke and reissue each key at its model provider, then set it under the new `KEK`.

## The backup identity

The private half of the backup `age` identity is in escrow. It is also resident on VPC 2, in a root-only file: `/etc/better-answers/backup-age.key`, mode `0600`. The owner writes the file by hand after running `deploy/host-setup.sh vpc2`.

VPC 1 never holds the identity. `deploy/restore-production.sh` takes it from escrow for the length of a restore, and the runbook says to delete it afterwards.

The identity stays on VPC 2 because the drill runs unattended at 03:00 on the first of each month and decrypts a dump. A drill that needs a person present stops happening. The resident copy has two consequences:

- A VPC 2 compromise exposes the plaintext of every dump and every git bundle in the buckets. That is every customer's personal data over the retention window, because VPC 2 holds both the identity and the bucket's read credential. `RUNBOOK.md` page 2 therefore treats a VPC 2 compromise as page 3, a personal-data breach, without waiting for evidence that anyone read a copy.
- The file is outside the orchestrator's instance backup. That backup takes the orchestrator's own database and the `.env` under its data directory, and nothing under `/etc`. The identity therefore never reaches the dumps bucket through the orchestrator's copy.

### Rotate the backup identity

Rotate the identity after a compromise or on a schedule.

1. On a laptop, mint a new key pair with `age-keygen`.
2. Set the new public half as `BACKUP_AGE_RECIPIENT` on the stores resource, and redeploy that stack. Every dump from the next hour on is encrypted to the new key.
3. Put the new private half in escrow, and in the root-only file on a rebuilt VPC 2.
4. Keep the old identity in escrow until the last copy encrypted to it has expired. With the monthly tier, that is six months later. A copy older than the rotation still needs the old identity.
5. After a compromise, also rotate the bucket's read credential. Consider an out-of-band dump, so that the window between the compromise and the first copy under the new key is hours, not a day.

The drill reads the newest dump in any tier and the newest nightly bundles. A drill that runs after the first nightly copy since the redeploy reads only copies encrypted to the new key.

## What the estate holds

`.planning/estate/SECRETS.md` is the estate's inventory. It is outside the repository because a public map of a running estate helps only an attacker. For each secret, it gives the following:

- the owner and use
- the box and path it lives on
- whether it is escrowed, and who holds the escrow
- its bus factor
- its exact rotation command

When both boxes are gone, `RUNBOOK.md` page 9 uses its rows as the checklist. To stand up your own deployment, build the equivalent from the tables in § Where a secret lives and from `deploy/wizard-41.sh`, which asks for every value it needs and stores none.

## Who can read a backup bucket

Four principals can reach a backup bucket:

- the host's write-and-list key, which you should assume can list and read back what it wrote
- the escrowed admin key
- the drill's read key on the restore host
- the provider's staff, under the DPA

Every object under `dumps/` is encrypted client-side with `age`, so nobody without the identity can read a dump or a bundle. The identity is in escrow and in the root-only file on VPC 2, beside the read key (§ The backup identity). VPC 2 is therefore the one box where a dump can be read in plaintext.

The object store's mirrored originals have no client-side encryption, because a restore serves them back to the platform. Provider-side encryption at rest and the DPA protect them. A client-side layer for them is a later growth step, not a v0.1 control.
