# Better Answers

A living company knowledge map for UK SMBs on OKF v0.2 — every answer cited, permission-aware and explainable. The code is open under the [Apache License 2.0](LICENSE); the hosted service at `better-answers.com` is the product (ADR 0027).

Start with `AGENTS.md`, then `CONTEXT.md` (the glossary), `docs/okf-v02.md`, `CODING_RULES.md` and `docs/adr/`.

## Browsing the data

Two commands, one for each database a GUI points at, and one read-only login for both profiles. The local one needs Docker and an installed checkout (`pnpm install`), and nothing else.

| GUI profile | Command | Host and port | Database | User |
| --- | --- | --- | --- | --- |
| **local** | `deploy/local-database.sh up` | `127.0.0.1:55432`, or `LOCAL_DATABASE_PORT` | `better_answers` | `browse_ro`, password `browse_ro` |
| **production (read-only)** | `deploy/browse-production.sh` | `127.0.0.1:55433`, or `BROWSE_PORT` | `better_answers` | `browse_ro`, password from the password manager |

The local database is the one pinned Postgres image with the whole migration journal applied and the synthetic fixture seeded — a workspace, one uploaded markdown document, and the chunks it was cut into, its sort code already withheld. It keeps its data in a Docker volume across restarts: `deploy/local-database.sh down` stops it, `down --wipe` drops the data too, and `up` again migrates whatever the journal has gained. `psql` reaches it as the owner, `better_answers` with the same password, which is what `.env.example` names.

Production is reached only through the SSH forward, and only by an operator holding the private file's values; the forward stays open until Ctrl-C. Why it is shaped that way, and what the role can and cannot read, is `docs/operations/coolify.md` § Browsing the database; the operator's first-time act is `docs/operations/RUNBOOK.md` § Browse production.

**Contributions.** Issues are welcome. Outside pull requests are not accepted in v0.1 — open an issue instead; this will be revisited at v1.0. Vulnerabilities: see `SECURITY.md`.
