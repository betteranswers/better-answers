# Containers — the two tiers over four stores

Level 2. What runs, what it runs on, and what it may reach. The rule the diagram enforces is ADR 0005's: the TypeScript tier and the Python tier **share four stores and never code, and there is no HTTP between them** — the control plane is rows in the queue. The one seam between the tiers is checkable: `contracts/`, eight agreements both suites read (ADR 0031).

```mermaid
C4Container
  title Container diagram — Better Answers

  Person(person, "Admin, Editor or Viewer", "Signed in on app., a session cookie host-only")
  Person(operator, "Operator", "Runs pnpm ops inside the api container; releases through Coolify")
  System_Ext(claude, "Claude and Claude Code", "MCP client with a bearer token from consent or the Account page")
  System_Ext(models, "Model providers", "Answering, judging, extraction routes; embedding in reserve")
  System_Ext(external, "Microsoft 365, the client's website, SMTP", "Sign-in and SharePoint from P1 and S4; email today")

  System_Boundary(platform, "Better Answers") {
    Container(web, "Single-page app", "Vite, React, TanStack Query", "Control Centre's six screens, sign-in, the workspace picker; talks tRPC only, plus the Better Auth client for sign-in")
    Container(api, "api", "Hono on Node 24", "The one TypeScript deployable: tRPC, the MCP surface, the authorization server, the SPA's static build, pnpm ops, the reconciler tick; logic from packages/core")
    Container(worker, "worker", "Python 3.13, uv, psycopg, dulwich", "The work loop claiming jobs by kind, the nightly parser audit, the full graph rebuild; S1 makes it a cocoindex host")
    Container(migrate, "migrate", "Drizzle over one journal", "One-shot on every release, ahead of api: every migration the app owns, in index and the graph too")
    Container(backup, "backup", "cron, pg_dump, age, rclone, git", "Hourly to monthly encrypted dumps, the nightly object-store mirror, one git bundle per repository and the push mirror")

    ContainerDb(postgres, "Postgres", "Postgres 18 with pgvector, RLS default-deny", "The identity set, every tenant table, the concept index, index.chunk, the graph tables, the queue, the ledger")
    ContainerDb(objects, "Object store", "Garage, S3 API, path-style", "Source documents as landed, under a per-workspace prefix")
    ContainerDb(git, "Git store", "Bare repositories under GIT_STORE_DIR", "One repository per workspace holding the bundle; the app the only committer, one commit per act")
    ContainerDb(lmdb, "Per-binding LMDB", "cocoindex Environment", "The worker's memo and target state; personal data on disk; never backed up, wiped and reprocessed; planned S1")
  }

  Rel(person, web, "Uses", "HTTPS on app.")
  Rel(web, api, "Calls procedures and subscribes to streams on", "tRPC over HTTPS")
  Rel(claude, api, "Calls find, ask, open, give_feedback on", "MCP Streamable HTTP at /mcp; OAuth at /oauth2/*")
  Rel(operator, api, "Runs pnpm ops in", "exec")

  Rel(api, postgres, "Reads and writes under SET LOCAL app.workspace_id as", "app_rt, pg")
  Rel(api, git, "Commits the governed write to, under a per-repository lock", "git binary")
  Rel(api, objects, "Streams uploads to and passages from; planned S1", "S3")
  Rel(api, models, "Calls answering and judging routes of; planned S2", "fetch-shaped seam")
  Rel(api, external, "Sends sign-in codes and alerts; signs in with Microsoft from P1", "SMTP, OIDC")
  Rel(api, web, "Serves the static build of", "HTTP on app.")

  Rel(migrate, postgres, "Runs the journal against, as the owner role", "Drizzle")
  Rel(worker, postgres, "Claims jobs, heartbeats, writes index.chunk and the graph in, as a workspace-scoped role", "claim_job, psycopg")
  Rel(worker, git, "Reads the bundle at a commit from", "dulwich, read-only mount")
  Rel(worker, objects, "Reads landed documents from; planned S1", "S3")
  Rel(worker, lmdb, "Memoises and tracks targets in; planned S1", "cocoindex")
  Rel(worker, models, "Calls the extraction route of; planned S7", "fetch-shaped seam")
  Rel(worker, external, "Fetches the website and SharePoint libraries; planned S4", "HTTPS, Graph")

  Rel(backup, postgres, "Dumps", "pg_dump, age")
  Rel(backup, objects, "Mirrors nightly", "rclone")
  Rel(backup, git, "Bundles and push-mirrors", "git, SSH")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## What the diagram claims

- **No arrow between api and worker.** A job is a row the api's act inserts in its own transaction and the worker claims with `claim_job` under `SKIP LOCKED`, keeping a lease alive by heartbeat; the reaper and poison come with the row (ADR 0005; the `queue` agreement). S1 adds the kinds a tier may claim — `claim_job(p_worker_id, p_lease, p_kinds text[])` — so S6's question-set job is claimed by the api and never by the worker (T-113).
- **Postgres is four things in one resource.** The identity set Better Auth owns, isolated by key not scope; the tenant tables under `FORCE ROW LEVEL SECURITY` with `current_workspace_id()` as the one policy seam; the graph as plain tables under the same policy (ADR 0032, no AGE, no per-workspace role); and `index.chunk`, list-partitioned per workspace, the one table both tiers write into — the worker its rows, the app its DDL (ADR 0007).
- **The git store is written by one process.** The api commits through the git binary under a per-repository lock held from the precondition through the Postgres COMMIT, so `bundle_commit` is a prefix of git history (ADR 0012). The worker mounts the same directory read-only and reads at the commit on the run row (ADR 0024).
- **The per-binding LMDB is a store the contract names** (ADR 0005, 2026-08-27). It holds memoised output, which is personal data; it is disposable — a wipe is paired with deleting the binding's chunk rows in the app's transaction, because the LMDB is the engine's record of what to delete (ADR 0036, amended 2026-09-10; probe 4).
- **The web talks tRPC only.** The one exception, invitation-accept on the Better Auth client, arrives with P1. Uploads are a tRPC mutation over `splitLink`, never a second HTTP route (S1; `[APP5]`).

## The tier contract

| Agreement | Form | What it pins |
| --- | --- | --- |
| queue | SQL function | claim, lease, heartbeat, finish, fail; a lapsed lease revokes its claimant |
| concept-inbox | SQL function | the `concept_write_request` handshake |
| llm-routing | SQL function | the route per workspace and purpose |
| credential-envelope | fixtured | the encryption envelope both tiers decrypt |
| visibility-columns | fixtured | the three columns the worker writes and the app's predicate reads |
| id-shape | fixtured | the one ULID shape either tier mints |
| concept-file | fixtured | the canonical text and content hash of a concept file |
| cost-ledger | generated | the `llm_call` row's meaning |

S1 adds the first document-shaped agreement and moves `contract_version` past 5.
