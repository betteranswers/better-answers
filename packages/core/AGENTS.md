# packages/core

## Principal

Every function that reads or writes tenant data takes a `Principal` (workspace, user, role) first, and a transport builds it. Check the role, the action's threshold and the read predicate beside the data access. Test the predicate against columns on the readable unit, never against a connected source's fields. Work that outlives a session runs under a deferred or platform principal, never a live user session.

## Audit

- Every Admin action, governed write and platform action writes its event through the audit slice, in the same transaction as the rows the event describes. An action whose event cannot be written does not happen.
- Write one row per action and target. A bulk action is N rows sharing a batch id.
- Call the audit doors bare. A wrapper that catches the abort hands it back as a value the action might not read.
- Name an action `family.subject.verb`. The families are people, knowledge, sources and platform: `people.member.role_changed`, `sources.binding.published`.
- The actor is the kernel's `ActorId`, derived from the principal, never an email, display name or session. Work outside a session audits under its own actor through the door that takes an explicit actor. Concept files keep `human:<email>` in `generated.by` and `verified[].by`, which is why erasure rewrites files and never the audit log.
- The detail carries ids, role words (Admin, Editor, Viewer) and typed confirmations. It never carries an email, display name, prompt or completion, because the audit log is never rewritten.
- Mint the row's ULID through the kernel minter before the write, so an audit event and its git commit join on one id.
- A read, a run and a health check write no audit row, unless a decision names the view an action. An event with no workspace is a log line, unless it is declared for the identity-set audit log, as sign-in and passkey or authenticator setup are. These land after the library's commit, so a failed row is a log line, never a refusal. Runs, *Questions asked*, signals, alerts, spend, backups and health checks keep their own records.
