# Better Answers

A living company knowledge map for UK SMBs on OKF v0.2 — every answer cited, permission-aware and explainable.

## Browsing the data

Two commands, one for each database a GUI points at, and one read-only login for both profiles. The local one needs Docker and an installed checkout (`pnpm install`), and nothing else.

| GUI profile | Command | Host and port | Database | User |
| --- | --- | --- | --- | --- |
| **local** | `deploy/local-database.sh up` | `127.0.0.1:55432`, or `LOCAL_DATABASE_PORT` | `better_answers` | `browse_ro`, password `browse_ro` |
| **production (read-only)** | `deploy/browse-production.sh` | `127.0.0.1:55433`, or `BROWSE_PORT` | `better_answers` | `browse_ro`, password from the password manager |

Production is reached through the SSH forward. See `docs/operations/coolify.md` § Browsing the database; the operator's first-time action is `docs/operations/RUNBOOK.md` § Browse production.

**Contributions.** Vulnerabilities: see `SECURITY.md`.
