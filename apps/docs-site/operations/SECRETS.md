# Secrets — the classes, the rules and the rotation contract

**This is the public half.** It states *which classes of secret exist*, *what rule each obeys* and *how each rotates*. The estate's own inventory — which value lives on which box at which path, who holds the escrow, and the bus factor per row — is **not published**: it is `.planning/estate/SECRETS.md`, outside the repository, because a public operational map of a running estate helps only an attacker (ADR 0027, ticket 79 Q10; ticket 77's acceptance line). Everything a reader needs to *run their own* deployment is here and in the compose files, the Dockerfiles, `deploy/host-setup.sh` and `deploy/wizard-41.sh`.

No secret is ever in git. Bootstrap secrets (`[SEC1]`) live in the orchestrator's per-resource encrypted env and are read once by the typed config module. The orchestrator writes a resource's `.env` in plaintext to its workdir on the production host — accepted, and it is why a disk image or snapshot of that host is itself a secret.

## The classes

`[SEC1]` fixes seven credential classes, never mixed in one scope:

| Class | What it is for | Where it is read |
| --- | --- | --- |
| **bootstrap** | what the platform needs to start: the envelope key (`KEK`), the auth secret, the database DSNs, the tunnel token, transactional email, the object store's root pair, the dead-man ping URLs | read **once** by the typed config module at boot; never at a call site, never from `process.env` |
| **ingestion** | a connector's credential for one source binding | the credentials provider, decrypted per run and injected through the control plane (ADR 0005) |
| **acting** | writing back into a connected system as the user, approval-gated | not in v0.1; the class is reserved so its scope is a boundary, not a naming convention |
| **agent** | a share agent's binding-scoped token on `/agent/v1` | checked in the app before any body is read (ADR 0008) |
| **LLM provider** | a model route's API key, per workspace and purpose | the credentials provider; never logged, never in an `llm_call` row (`[LOG1]`) |
| **repository** | the git store's own keys — the mirror deploy key, the per-run read path | root-only on the host, mounted read-only into the service that needs it |
| **object store** | the bucket credentials, in three grades: **write-and-list** on the host, **read** for the drill, **admin** (delete, lifecycle, governance bypass) never on any box; and the backup **`age` identity** — public half in the stores resource's env, private half in escrow **and resident on VPC 2** (§ The backup identity) | the write-and-list pair from env; the admin credential from escrow only; the identity from a root-only file on VPC 2 |

**CI** carries two more that are not the platform's: a read-only registry pull token and the deploy token, both provider-issued and revocable, and both scoped to exactly one action.

## The rotation contract

Every class has a rotation path, and every path is written down before the credential is created:

- **A secret appears in exactly one env per box.** The config module's key list *is* the inventory's first column, and a missing key **fails the boot** — a secret that is quietly absent is worse than one that is loudly missing.
- **Nothing here is ever logged** — not by the logger, not by the exporter, not on an `llm_call` row (`[LOG1]`).
- **Every credential class has a documented rotation** — reissue at the provider, swap, redeploy, revoke the old — and a rotation that requires downtime says so.
- **Rotation on compromise is a runbook page, not a decision.** Host compromise rotates every host-side credential; a database compromise rotates the envelope key and re-wraps every workspace data key (ADR 0005).
- **Backups are encrypted client-side with `age`**; the private half is escrowed and resident on VPC 2 (§ The backup identity). Rotating that identity mints a new keypair and re-encrypts nothing: existing copies expire on their own lifecycle (`BACKUPS.md`).
- **Escrow has two holders before the first client goes live**, under a written instruction, and the recovery path is exercised in the first drill. Who they are is estate detail and is not published.
- **Access decisions are audit-logged** (`[SEC1]`), and tokens are stored hashed with a lookup prefix, expire, and are revocable.

## The backup identity

The drill runs unattended, at 03:00 on the first of the month, and it decrypts a dump. So the private half of the backup `age` identity is **resident on VPC 2, in a root-only file** (`/etc/better-answers/backup-age.key`, mode `0600`, written by the owner by hand after `deploy/host-setup.sh vpc2`), as well as in escrow. Ticket 79 Q8 chose this over a semi-attended drill because a drill that needs a person present is a drill that stops happening; the price is stated here rather than hidden:

- **A VPC 2 compromise exposes the plaintext of every dump and every git bundle in the buckets** — which is every client's personal data over the retention window — because that box holds the identity and the bucket READ credential together. `RUNBOOK.md` page 2 treats a VPC 2 compromise as page 3 (a personal-data breach) on that basis alone, without waiting for evidence that a copy was read.
- **The file is outside the orchestrator's instance backup by placement.** That backup takes the orchestrator's own database and its `.env` under its data directory and nothing under `/etc`, so the identity never rides into the dumps bucket in the orchestrator's own copy. VPC 1 never holds it: `restore-production.sh` takes it from escrow for the duration of a restore and the runbook says to delete it after.
- **Rotation**, on compromise or on schedule: mint a new pair on a laptop (`age-keygen`); set the new **public** half as `BACKUP_AGE_RECIPIENT` on the stores resource and redeploy that stack — every dump from the next hour on is encrypted to the new key; put the new private half in escrow and into the root-only file on a rebuilt VPC 2; **keep the old identity in escrow until the last copy encrypted to it has expired** (six months, the monthly tier) — a copy older than the rotation still needs it, and the drill's step 1 reads the newest daily dump, so within a day the drill runs on the new key. On compromise, also rotate the bucket READ credential and consider an out-of-band dump so the window between the compromise and the first new-key copy is hours, not a day.

## What the estate holds

The per-estate inventory — each secret, its class, the box and path it lives on, whether it is escrowed, its bus factor and its exact rotation command — is `.planning/estate/SECRETS.md`. Anyone standing up their own deployment builds the equivalent from the table above and `deploy/wizard-41.sh`, which asks for every value it needs and stores none. The inventory's rows are the checklist `RUNBOOK.md` page 9 walks when both boxes are gone.

## Who can read a backup bucket

The shape, without the estate's names. Four principals can reach a backup bucket: the **host's write-and-list key** (assume it can list and get back what it wrote), the **escrowed admin key**, the **drill's read key** on the restore host, and the **provider's staff** under the DPA. Because every object under `dumps/` is `age`-encrypted client-side, **nobody without the identity reads a dump or a bundle** — and the identity is in two places: escrow, and the root-only file on VPC 2 beside the read key (§ The backup identity), which makes VPC 2 the one box where a dump is readable in plaintext. The object store's mirrored originals are held unencrypted at the client side — they are served back to the platform on restore — so provider-side encryption at rest and the DPA are what protect them; a client-side layer there is a named growth step, not a v0.1 control.
