---
title: "The clock is a kernel value the api hands to every act that reads time"
date: 2026-09-26
module: packages/core
problem_type: architecture_pattern
component: kernel
severity: medium
applies_when:
  - "Code in packages/core, packages/schema or apps/api needs the current time"
  - "A test has to hold an instant still on either side of a comparison"
  - "Adding a timestamp column or a write that stamps a row"
tags:
  - adr-0040
  - clock
  - kernel
  - time
  - testing
  - timestamps
---

# The clock is a kernel value the api hands to every act that reads time

## The decision

A `Clock`, `{ now(): Date }`, lives in the kernel (`packages/core/src/kernel/clock.ts`). It is a value, not a fifth door. The api builds one `systemClock()` per process, in `apps/api/src/main.ts` and again in `apps/api/src/ops.ts`, and hands it down explicitly.

- An act that reads one instant and spends it once takes a plain `now: Date` from its caller (`open`, `find`, `approveRequest`, the git door's `CommitRequest.at`).
- An act that hands the reading on to more than one call takes the `Clock` and reads it itself (`writeConcept`, the reconciler).
- No parameter defaults to `new Date()`.
- A row's own timestamp stays the database's `now()`: the audit log, `bundle_commit` and the worker's job queue.
- The worker is handed no Clock. Its one clock-shaped read is the ULID minter's, which orders an id and decides nothing.
- The identity set's `updated_at` columns are stamped by Better Auth inside the library (ADR 0009). The platform's two raw-SQL writes to those tables set `updated_at = now()`.

The gate is a tree scan, `apps/api/tests/no-ambient-clock.test.ts`, over `packages/core/src`, `apps/api/src` and `packages/schema/src`. It has two exemptions: `kernel/clock.ts` and the ULID minter. The lint can now express the same selectors, but the scan stays: in the lint, each exemption would be an override restating every other selector.

## Why

- Two of `open`'s shelf-life mutants survived because the comparison read `new Date()` inside the function under test, so no test could hold the instant still on either side of it. Six more ambient reads had the same shape.
- A clock is vocabulary every slice needs, like `Result` and the branded ids, so it goes in the kernel (ADR 0029). It holds no workspace data, so it is not a door.
- A defaulted `now: Date = new Date()` is still an ambient read, the moment a caller leaves the argument out.
- The smallest interface differs by site. Forcing a `Clock` on sites that read one instant once makes their interface bigger for nothing.
- A row's timestamp is a fact about when the store committed it. Moving it onto the api's clock would let the transaction time and the process's wall clock disagree about the same row.

A test pins a `now: Date` site with a literal `Date`, and a `clock: Clock` site with an inline `{ now: () => new Date("...") }`. A fixed clock is a fixture, not a kernel export.

## Rejected

- A defaulted `now` parameter everywhere: still an ambient read.
- A fifth door, `store/clock/`: a door is a store a workspace's data lives in.
- One mutable process-wide clock patched in tests: the constitution bans mocking our own code, and it is the same ambient state moved.
- A `Clock` at every site: a bigger interface than the sites that read once need.
- A Clock for the worker, for symmetry: it would invite a time-based decision in the tier with no harness to pin one.

## History

The full record, with its three amendments (T-109, T-138, T-429): `docs/archive/adr/0040-clock-is-a-kernel-value.md`.
