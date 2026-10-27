# Secrets — the classes, the rules and the rotation contract

**Operational reference, not a page of the docs site.** This file lives in `docs/operations/` because that is where the operational documents are kept; the docs site does not render it, and it is read from the repository.

**This is the public half.** It states *which classes of secret exist*, *what rule each obeys* and *how each rotates*. The estate's own inventory — which value lives on which box at which path, who holds the escrow, and the bus factor per row — is **not published**: it is `.planning/estate/SECRETS.md`, outside the repository, because a public operational map of a running estate helps only an attacker (ADR 0027, ticket 79 Q10; ticket 77's acceptance line). Everything a reader needs to *run their own* deployment is here and in the compose files, the Dockerfiles, `deploy/host-setup.sh` and `deploy/wizard-41.sh`.

No secret is ever in git. Bootstrap secrets live in the orchestrator's per-resource encrypted env and are read once by the typed config module. The orchestrator writes a resource's `.env` in plaintext to its workdir on the production host — accepted, and it is why a disk image or snapshot of that host is itself a secret.

## The classes

There are seven classes, and the secrets-seam rule keeps the rule that they are never mixed in one scope. What each is for and where it is read is written here today, which record should own that gloss being unsettled:

| Class | What it is for | Where it is read |
| --- | --- | --- |
| **bootstrap** | what the platform needs to start: the envelope key (`KEK`), the auth secret, the database DSNs, the tunnel token, transactional email, the object store's root pair, the dead-man ping URLs | read **once** by the typed config module at boot; never at a call site, never from `process.env` |
| **ingestion** | a connector's credential for one connected source | the credentials provider, decrypted per run and injected through the control plane (ADR 0005) |
| **acting** | writing back into a connected system as the user, approval-gated | not in v0.1; the class is reserved so its scope is a boundary, not a naming convention |
| **agent** | a share agent's connected-source-scoped token on `/agent/v1` | checked in the api before any body is read (ADR 0008) |
| **LLM provider** | a workspace's model key: its API key for one model provider, one per workspace and provider | the credentials provider, in the api tier at the moment of a model call; never logged, never in an `llm_call` row, never read from the environment (§ A workspace's model key) |
| **repository** | the git store's own keys — the mirror deploy key, the per-run read path | root-only on the host, mounted read-only into the service that needs it |
| **object store** | the bucket credentials, in three grades: **write-and-list** on the host, **read** for the drill, **admin** (delete, lifecycle, governance bypass) never on any box; and the backup **`age` identity** — public half in the stores resource's env, private half in escrow **and resident on VPC 2** (§ The backup identity) | the write-and-list pair from env; the admin credential from escrow only; the identity from a root-only file on VPC 2 |

**CI** carries five more that are not the platform's, each provider-issued, revocable and scoped to one action: a read-only registry pull token, the deploy token, the Access pair (`CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`), a Cloudflare Access service token that lets the deploy and the release reach the orchestrator through its tunnel, and the dead-man service's read-only API key (`HEALTHCHECKS_READ_KEY`), which the nightly release reads to see that the box's backup is fresh. The key reads check states and can ping nothing, so it cannot make a backup look fresh.

**The journeys' seven secrets and the test inbox's deploy token are retired until go-live** (BA-204). The signed-in production journeys and the test inbox they read left on 19/10/2026, and nothing in CI reads those secrets now. The go-live rebuild sets them up again; this file as `a3c19ec8` holds it gives each one's reach and rotation.

## The rotation contract

Every class has a rotation path, and every path is written down before the credential is created:

- **A secret appears in exactly one env per box.** The config module's key list *is* the inventory's first column, and a missing key **fails the boot** — a secret that is quietly absent is worse than one that is loudly missing.
- **Nothing here is ever logged** — not by the logger, not by the exporter, not on an `llm_call` row.
- **Every credential class has a documented rotation** — reissue at the provider, swap, redeploy, revoke the old — and a rotation that requires downtime says so.
- **Rotation on compromise is a runbook page, not a decision.** Host compromise rotates every host-side credential; a database compromise rotates the envelope key, after which every model key is set again (§ A workspace's model key). No data key per workspace stands between the two yet.
- **Backups are encrypted client-side with `age`**; the private half is escrowed and resident on VPC 2 (§ The backup identity). Rotating that identity mints a new keypair and re-encrypts nothing: existing copies expire on their own lifecycle (`BACKUPS.md`).
- **Escrow has two holders before the first customer goes live**, under a written instruction, and the recovery path is exercised in the first drill. Who they are is estate detail and is not published.
- **Access decisions are audit-logged**, and tokens are stored hashed with a lookup prefix, expire, and are revocable. A model key is sealed and never hashed, because it is sent.

## A workspace's model key

A model key is a workspace's API key for one model provider. It is a row sealed under the envelope key, one per workspace and provider, which the api tier opens at the moment of a model call (ADR 0050). The worker tier holds no grant on the table.

- **The envelope key is `KEK` on the api service:** 32 random bytes written as 64 hexadecimal characters, as `openssl rand -hex 32` prints them. It is a bootstrap secret, held in escrow. `pnpm ops set-model-key` reads it through the typed config module and refuses without it. The api's server reads it the same way when it starts, to open a workspace's model key at the moment of a call. Without it the server still starts, logs `no model will be called`, and `ask` calls no model.
- **Setting a key** is `pnpm ops set-model-key`, with the key on standard input (`RUNBOOK.md` § Set a workspace's model key). The key is never a command-line argument, so it reaches no shell history and no process list. Each run writes one audit event naming the model provider.
- **Rotation is replacement,** and needs no downtime: issue a new key at the model provider, set it with the command, then revoke the old key at the model provider. A call made between the two steps uses whichever key the row holds.
- **On a leak of a model key,** revoke it at the model provider first, since that is what stops its use, then set a new one.
- **On a new envelope key,** every row sealed under the old one stays in place and stops opening, and a model call refuses until its key is set again. Nothing reports such a row before a call does. List the workspace and provider pairs that hold a row first, through the browsing login, which reads `workspace_id` and `provider` and never the sealed key. Then set `KEK`, redeploy, and run the command once for each pair. No command re-seals a row.
- **On a compromise of the envelope key,** every model key sealed under it is treated as leaked, because whoever holds `KEK` and the database can open each one. Sealing the same key again under a new `KEK` protects nothing. Each is revoked and reissued at its model provider, then set under the new `KEK`.
- **After a restore,** a model key replaced since the dump was taken is back as it was, and it opens cleanly. Set each one again (`RUNBOOK.md` § Set a workspace's model key).

## The backup identity

The drill runs unattended, at 03:00 on the first of the month, and it decrypts a dump. So the private half of the backup `age` identity is **resident on VPC 2, in a root-only file** (`/etc/better-answers/backup-age.key`, mode `0600`, written by the owner by hand after `deploy/host-setup.sh vpc2`), as well as in escrow. Ticket 79 Q8 chose this over a semi-attended drill because a drill that needs a person present is a drill that stops happening; the price is stated here rather than hidden:

- **A VPC 2 compromise exposes the plaintext of every dump and every git bundle in the buckets** — which is every customer's personal data over the retention window — because that box holds the identity and the bucket READ credential together. `RUNBOOK.md` page 2 treats a VPC 2 compromise as page 3 (a personal-data breach) on that basis alone, without waiting for evidence that a copy was read.
- **The file is outside the orchestrator's instance backup by placement.** That backup takes the orchestrator's own database and its `.env` under its data directory and nothing under `/etc`, so the identity never rides into the dumps bucket in the orchestrator's own copy. VPC 1 never holds it: `restore-production.sh` takes it from escrow for the duration of a restore and the runbook says to delete it after.
- **Rotation**, on compromise or on schedule: mint a new pair on a laptop (`age-keygen`); set the new **public** half as `BACKUP_AGE_RECIPIENT` on the stores resource and redeploy that stack — every dump from the next hour on is encrypted to the new key; put the new private half in escrow and into the root-only file on a rebuilt VPC 2; **keep the old identity in escrow until the last copy encrypted to it has expired** (six months, the monthly tier) — a copy older than the rotation still needs it. The drill reads the newest dump in any tier and the newest nightly bundles, so a drill run after the first nightly copy that follows the redeploy reads only copies encrypted to the new key. On compromise, also rotate the bucket READ credential and consider an out-of-band dump so the window between the compromise and the first new-key copy is hours, not a day.

## What the estate holds

The per-estate inventory — each secret, its class, the box and path it lives on, whether it is escrowed, its bus factor and its exact rotation command — is `.planning/estate/SECRETS.md`. Anyone standing up their own deployment builds the equivalent from the table above and `deploy/wizard-41.sh`, which asks for every value it needs and stores none. The inventory's rows are the checklist `RUNBOOK.md` page 9 walks when both boxes are gone.

## Who can read a backup bucket

The shape, without the estate's names. Four principals can reach a backup bucket: the **host's write-and-list key** (assume it can list and get back what it wrote), the **escrowed admin key**, the **drill's read key** on the restore host, and the **provider's staff** under the DPA. Because every object under `dumps/` is `age`-encrypted client-side, **nobody without the identity reads a dump or a bundle** — and the identity is in two places: escrow, and the root-only file on VPC 2 beside the read key (§ The backup identity), which makes VPC 2 the one box where a dump is readable in plaintext. The object store's mirrored originals are held unencrypted at the client side — they are served back to the platform on restore — so provider-side encryption at rest and the DPA are what protect them; a client-side layer there is a named growth step, not a v0.1 control.
