# packages/core

## Principal

Every function that reads or writes tenant data takes a `Principal` (workspace, user, role) first, and a transport builds it. Check the role, the action's threshold and the read predicate beside the data access. Test the predicate against columns on the readable unit, never against a connected source's fields. Work that outlives a session runs under a deferred or platform principal, never a live user session.

## Audit

- Every Admin action, governed write and platform action writes its event through the audit slice, in the same transaction as the rows the event describes.
- Write one row per action and target. A bulk action is N rows sharing a batch id.
- Call the audit doors bare. A wrapper that catches the abort hands it back as a value the action might not read.
- Mint the row's ULID through the kernel minter before the write, so an audit event and its git commit join on one id.
