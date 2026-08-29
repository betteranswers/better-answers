# Secrets — the classes, the rules and the rotation contract

**This is the public half.** It states *which classes of secret exist*, *what rule each obeys* and *how each rotates*. The estate's own inventory — which value lives on which box at which path, who holds the escrow, and the bus factor per row — is **not published**: it is `.planning/estate/SECRETS.md`, outside the repository, because a public operational map of a running estate helps only an attacker (ADR 0027, ticket 79 Q10; ticket 77's acceptance line). Everything a reader needs to *run their own* deployment is here and in the compose files, the Dockerfiles and `deploy/wizard-41.sh`.

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
| **object store** | the bucket credentials, in three grades: **write-and-list** on the host, **read** for the drill, **admin** (delete, lifecycle, governance bypass) never on any box | the write-and-list pair from env; the admin credential from escrow only |

**CI** carries two more that are not the platform's: a read-only registry pull token and the deploy token, both provider-issued and revocable, and both scoped to exactly one action.

## The rotation contract

Every class has a rotation path, and every path is written down before the credential is created:

- **A secret appears in exactly one env per box.** The config module's key list *is* the inventory's first column, and a missing key **fails the boot** — a secret that is quietly absent is worse than one that is loudly missing.
- **Nothing here is ever logged** — not by the logger, not by the exporter, not on an `llm_call` row (`[LOG1]`).
- **Every credential class has a documented rotation** — reissue at the provider, swap, redeploy, revoke the old — and a rotation that requires downtime says so.
- **Rotation on compromise is a runbook page, not a decision.** Host compromise rotates every host-side credential; a database compromise rotates the envelope key and re-wraps every workspace data key (ADR 0005).
- **Backups are encrypted client-side with `age`** and the private half is escrowed. Rotating that identity mints a new keypair and re-encrypts nothing: existing copies expire on their own lifecycle (`deploy/BACKUPS.md`).
- **Escrow has two holders before the first client goes live**, under a written instruction, and the recovery path is exercised in the first drill. Who they are is estate detail and is not published.
- **Access decisions are audit-logged** (`[SEC1]`), and tokens are stored hashed with a lookup prefix, expire, and are revocable.

## What the estate holds

The per-estate inventory — each secret, its class, the box and path it lives on, whether it is escrowed, its bus factor and its exact rotation command — is `.planning/estate/SECRETS.md`. Anyone standing up their own deployment builds the equivalent from the table above and `deploy/wizard-41.sh`, which asks for every value it needs and stores none.

## Who can read a backup bucket

The shape, without the estate's names. Four principals can reach a backup bucket: the **host's write-and-list key** (assume it can list and get back what it wrote), the **escrowed admin key**, the **drill's read key** on the restore host, and the **provider's staff** under the DPA. Because every object under `dumps/` is `age`-encrypted client-side, **nobody without the escrowed identity reads a dump or a bundle**. The object store's mirrored originals are held unencrypted at the client side — they are served back to the platform on restore — so provider-side encryption at rest and the DPA are what protect them; a client-side layer there is a named growth step, not a v0.1 control.
