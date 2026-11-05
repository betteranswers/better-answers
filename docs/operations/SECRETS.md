# Secrets, where each lives and how it rotates

Operational reference, not rendered by the docs site. This public half says where each kind of secret lives, the rule it obeys, and how it rotates. The estate's inventory is `.planning/estate/SECRETS.md`, outside the repository, because a public map of a running estate helps only an attacker (§ What the estate holds). To run your own deployment, use this file with the compose files, the Dockerfiles, `deploy/host-setup.sh`, and `deploy/wizard-41.sh`.

No secret is ever in git. The deployment's own secrets live in the orchestrator's encrypted env for each resource, and the tier's typed config module reads them once. The orchestrator writes a resource's `.env` in plaintext to its workdir on the production host. That is an accepted risk, and it makes a disk image or snapshot of that host a secret in itself.

## Where a secret lives

Two facts decide where a secret lives: who owns it (the deployment, a workspace, or a person), and what the platform does with it (sends it onward, checks it when it is presented, or uses it at boot). There are no named classes. Read ADR 0052 before you add a secret to a tier's config module or a compose file.

| Secret | Owner and use | Where it lives |
| --- | --- | --- |
| The envelope key (`KEK`), the auth secret, the database DSNs, transactional email, the object store's root pair, the scheduler's and the sweeps' dead-man ping URLs | the deployment's, used at boot | the environment, read **once** by the tier's typed config module, never at a call site and never from `process.env`. The backup job also reads the object store's root pair. `KEK` is also in escrow |
| The tunnel token, Garage's RPC secret and admin token, the backup job's database DSN and dead-man ping URLs | the deployment's, used by a container outside the two tiers: the tunnel, Garage or the backup job | that container's compose environment in the stores resource |
| The backup bucket's **write-and-list** pair | the deployment's, used by the backup job | the stores resource's environment |
| The mirror deploy key | the deployment's, used by the mirror | a root-only file on the host, mounted read-only into the service that needs it |
| The drill's credentials: the backup bucket's **read** pair, a **write-and-list** pair for its report, the staging stack's database URL and object store pair, its dead-man ping URLs, its SSH key into VPC 1, and the backup **`age` identity** | the deployment's, used by the drill | root-only files on VPC 2. The identity's private half is also in escrow, and its public half is in the stores resource's environment (§ The backup identity) |
| The backup bucket's **admin** credential (delete, lifecycle, governance bypass) | the deployment's, held for recovery | escrow only, never on any box |
| A workspace's model key | the workspace's, sent to its model provider | a sealed row, opened by the api tier at the moment of a model call. Never logged, and never in an `llm_call` row (§ A workspace's model key) |
| A connected source's credential | the workspace's, sent to the source | a sealed row, opened at the moment of a sync. S4 builds it and decides which tier opens it |
| An acting credential | a person's, sent to a connected source to write back as that person, approval-gated | a sealed row read by person and workspace, opened only after approval. Not in v0.1 |
| A Cubic API key (`CUBIC_API_KEY`) | a person's, sent to Cubic when `pnpm run cubic-review` runs the author's pre-push review on Cubic's included model | the environment of the machine or cloud session that runs the review; never in git and never in CI, and read by no tier. The `cubic` CLI reads it from the environment, and the script never puts it in an argument |
| A share agent's token on `/agent/v1`, scoped to connected sources | the workspace's, checked when the agent presents it | a hashed row behind a lookup prefix, expiring and revocable, checked in the api before any body is read. Not built yet |
| Sign-in links and recovery codes | a person's, checked when presented | rows the platform writes. A recovery code is hashed in `recovery_code`. A sign-in link is keyed by a hash in `verification`, holds its email code sealed under the auth secret, and expires |
| OAuth tokens and client secrets, session tokens, the authenticator secret and its backup codes, the JWT signing keys | a person's, an OAuth client's or the deployment's | Better Auth's tables, under the library's own conventions. OAuth tokens and client secrets are hashed. The authenticator secret, its backup codes and the signing keys are encrypted under the auth secret |

CI holds five more secrets that are not the platform's. A provider issues each one, each is revocable, and each is scoped to one action:

- a read-only registry pull token
- the deploy token
- the Access pair, `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`, a Cloudflare Access service token that lets the deploy and the release reach the orchestrator through its tunnel
- the dead-man service's read-only API key, `HEALTHCHECKS_READ_KEY`, which the nightly release reads to see that the box's backup is fresh. The key reads check states and can ping nothing, so it cannot make a backup look fresh.

**A Cubic API key** has the prefix `cbk_`. A person issues it in Cubic's settings and can revoke it there. It is for a session that cannot sign in with a browser, such as a cloud session, and works only while the organisation's Cubic subscription is active. A session without one connects a model provider instead, with `cubic auth connect claude-code` or `codex`. The CLI keeps that provider token in its own auth file on that machine only, and `cubic auth list` shows the path. The repository never holds it. `.agents/playbooks/review.md` says what a session with neither does. To rotate the key with no downtime, issue a new key, set it where the old one was, then revoke the old one. Revoking a key stops every job that uses it at once.

**The journeys' seven secrets and the test inbox's deploy token are retired until go-live** (BA-204). Nothing in CI reads them. The go-live rebuild sets them up again from this file as `a3c19ec8` holds it, which gives each one's reach and rotation.

## The rotation contract

Every secret has a rotation, written down before the credential is created: reissue at the provider, swap, redeploy, and revoke the old one. A rotation that needs downtime says so.

- **A missing required key fails the boot.** The worker's config module and the api's required readers stop the process when a key they need is absent, and the compose files refuse a deploy without one. An optional key, such as `KEK` when the api runs outside the compose files, is reported as absent at boot or at its first use.
- **Nothing here is ever logged,** by the logger, by the exporter, or on an `llm_call` row.
- **Rotation on compromise is a runbook page, not a decision.** A host compromise rotates every host-side credential. A database compromise rotates the envelope key, and then every model key is set again (§ A workspace's model key). No data key per workspace stands between the two.
- **Backups are encrypted client-side with `age`.** Rotating the identity re-encrypts nothing, and existing copies expire on their own lifecycle (§ The backup identity, `BACKUPS.md`).
- **Escrow has two holders before the first customer goes live,** under a written instruction, and the first drill exercises the recovery path. Who they are is estate detail and is not published.
- **Access decisions are audit-logged.** The platform stores a secret it checks as a hash, except in Better Auth's tables, which keep the library's conventions (§ Where a secret lives). A model key is sealed and never hashed, because the platform sends it.

## A workspace's model key

A model key is a workspace's API key for one model provider. It is a row sealed under the envelope key, one per workspace and provider. The api tier opens it at the moment of a model call, and the worker tier holds no grant on the table. `RUNBOOK.md` § Set a workspace's model key has the steps to set, rotate, and list the keys.

- **The envelope key is `KEK` on the api service.** It is 32 random bytes written as 64 hexadecimal characters, as `openssl rand -hex 32` prints them. It is a deployment secret, held in escrow. `pnpm ops set-model-key` and the api's server read it through the typed config module. Without it the command refuses, and the server still starts, logs `no model will be called`, and `ask` calls no model.
- **The key goes on standard input,** never in a command-line argument, so it reaches no shell history and no process list. Each run writes one audit event naming the model provider.
- **Rotation is replacement and needs no downtime.** A call made between setting the new key and revoking the old one uses whichever key the row holds. On a leak, revoke the key at the model provider first, because that stops its use.
- **No command re-seals a row under a new envelope key.** A row sealed under the old one stays and stops opening, and nothing reports it before a model call refuses. List the workspace and provider pairs before you change `KEK`, then set each key again.
- **A compromised envelope key leaks every model key sealed under it,** because whoever holds `KEK` and the database can open each one. Sealing the same keys again under a new `KEK` protects nothing. Revoke and reissue each one at its model provider, then set it under the new `KEK`.
- **After a restore,** a model key replaced since the dump is back at its old value, and it still opens. Set each such key again.

## The backup identity

The drill runs unattended at 03:00 on the first of the month and decrypts a dump. So the private half of the backup `age` identity is in escrow and also **resident on VPC 2, in a root-only file**, `/etc/better-answers/backup-age.key` with mode `0600`. The owner writes it by hand after `deploy/host-setup.sh vpc2`. A drill that needs a person present stops happening, so the identity stays resident, at this cost:

- **A VPC 2 compromise exposes the plaintext of every dump and every git bundle in the buckets.** That is every customer's personal data over the retention window, because that box holds both the identity and the bucket's read credential. `RUNBOOK.md` page 2 therefore treats a VPC 2 compromise as page 3, a personal-data breach, without waiting for evidence that a copy was read.
- **The file is outside the orchestrator's instance backup.** That backup takes the orchestrator's own database and the `.env` under its data directory, and nothing under `/etc`. So the identity never reaches the dumps bucket in the orchestrator's copy.
- **VPC 1 never holds the identity.** `restore-production.sh` takes it from escrow for the duration of a restore, and the runbook says to delete it after.

To rotate the identity, on compromise or on schedule:

1. Mint a new key pair on a laptop with `age-keygen`.
2. Set the new public half as `BACKUP_AGE_RECIPIENT` on the stores resource, and redeploy that stack. Every dump from the next hour on is encrypted to the new key.
3. Put the new private half in escrow, and in the root-only file on a rebuilt VPC 2.
4. Keep the old identity in escrow until the last copy encrypted to it has expired, six months later with the monthly tier. A copy older than the rotation still needs it.
5. On compromise, also rotate the bucket's read credential. Consider an out-of-band dump, so the window between the compromise and the first copy under the new key is hours, not a day.

The drill reads the newest dump in any tier and the newest nightly bundles. So a drill that runs after the first nightly copy that follows the redeploy reads only copies encrypted to the new key.

## What the estate holds

`.planning/estate/SECRETS.md` is the estate's inventory. For each secret it gives the owner and use, the box and path it lives on, whether it is escrowed and who holds the escrow, its bus factor, and its exact rotation command. Its rows are the checklist that `RUNBOOK.md` page 9 walks when both boxes are gone. To stand up your own deployment, build the equivalent from the table above and `deploy/wizard-41.sh`, which asks for every value it needs and stores none.

## Who can read a backup bucket

Four principals can reach a backup bucket:

- the **host's write-and-list key**, which you should assume can list and get back what it wrote
- the **escrowed admin key**
- the **drill's read key** on the restore host
- the **provider's staff**, under the DPA

Every object under `dumps/` is `age`-encrypted client-side, so nobody without the identity reads a dump or a bundle. The identity is in escrow and in the root-only file on VPC 2 beside the read key (§ The backup identity). That makes VPC 2 the one box where a dump is readable in plaintext.

The object store's mirrored originals have no client-side encryption, because they are served back to the platform on restore. Provider-side encryption at rest and the DPA protect them. A client-side layer there is a named growth step, not a v0.1 control.
