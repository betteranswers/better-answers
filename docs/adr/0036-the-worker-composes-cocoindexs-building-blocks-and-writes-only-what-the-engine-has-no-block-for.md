---
status: accepted
date: 2026-09-05
amends: 0005, 0007
---

# The worker composes cocoindex's building blocks and writes only what the engine has no block for; the exit stays cheap

**Where this came from.** Ticket 53 (27 August 2026) drew the line between what the knowledge worker builds and what it takes from cocoindex — research 54's *ours / shared / theirs* table — and recorded it in the constitution as `[PIPE1]`. Nothing the table names exists yet: cocoindex is in no manifest and no source file, and the one live clause is the DDL invariant. A specification with no code to check it against is not a coding rule (the coding-rules audit of 5 September 2026, T-078), so the decision is recorded here in the rule's own words, and `[PIPE1]` keeps the two sentences a reviewer can check.

**Theirs — the blocks the worker composes and never rebuilds.** Per-component commit; memoisation with keys and states; stable ids; target sync with deletes; `mount_each` isolation; cooperative timeouts; exception handlers; `stats_group` and `watch()`; one `Environment` per binding — one LMDB per binding (ADR 0005, 2026-08-27 amendment). Rebuilding any of these is the failure this record exists to stop.

**Ours — what the engine has no block for.** The run key (cocoindex's *stable id* is a different word for a different thing); claim, lease, heartbeat and reaper; attempt count and poison threshold; the source-document catalogue with its source id and `gone_at`; retention membership; priced-versus-actual; outcome rows, for changes only; the object-store landing; one run per binding; supervision. These are rows the app's schema owns and the control plane reads (ADR 0005).

**Shared.** The landing checkpoint, grace and run signals: cocoindex reports them, the worker records them.

**What is never relied on.** Undocumented API — `use_state` — is never called. `use_mount` never fans documents onto the critical path; `mount_each` does the isolating.

**The exit stays cheap.** cocoindex types never cross a module seam; the catalogue and the run rows are the durable truth; every LMDB is disposable — never backed up, wiped and reprocessed on erasure (ADR 0005). Every cocoindex target is `managed_by="user"` and the app owns all DDL (ADR 0007, 2026-08-27 amendment): the engine's default `managed_by="system"` would let one binding's deletion drop the shared `index.chunk` and its index under every other binding.

## Considered options

- **Keep the whole table as a rule.** Rejected: a rule is checked against code, and there is no code; the block list drifts from the library's API the day the first pipeline is written, with nothing to flag the drift. `[PIPE1]` keeps the two clauses that are checkable now — the seam and the DDL invariant.
- **A thinner *ours* — infer outcomes from `inspect` diffs.** Rejected in ticket 53: cocoindex has no per-item success hook, so outcome rows the worker writes are the only record of what changed.
- **The checkpoint inside cocoindex's work.** Rejected in ticket 53: it collapses into the option above and ties the durable truth to a disposable store.

## Consequences

- `[PIPE1]` is two sentences — cocoindex types never cross a module seam; every target is `managed_by="user"` and the app owns all DDL — with this ADR as the pointer for the line itself.
- The first task that adds cocoindex to `apps/worker` reads this record before its first `Environment`, and the table above is what its review checks against.
- Reopening condition: cocoindex documenting a block for anything under *ours*, or removing one under *theirs* — then the line moves, here.
