---
title: "A signal is a query over rows the platform already keeps"
date: 2026-09-05
module: repository
problem_type: architecture_pattern
component: observability
severity: medium
applies_when:
  - "Adding a signal, a threshold or an alert"
  - "Adding code that calls a model"
  - "Reaching for a metrics store, a scrape or a dashboard product"
  - "Adding a host figure the operator needs to see"
tags:
  - adr-0025
  - signal
  - alert
  - llm-call
  - platform-event
  - heartbeat
  - system
---

# A signal is a query over rows the platform already keeps

## The decision

A **signal** is a named query over rows the platform already keeps, with a threshold that makes it worth a line on System. There is no metrics store, no scrape and no dashboard product.

- Thresholds are config rows an Admin changes on System, never code.
- An **alert** is recorded once as a `platform_event(kind=alert)` and closed by a *cleared* event, so no condition fires twice.
- Every model call writes one `llm_call` row: `workspace_id`, purpose, model choice, model, tokens in and out, seconds, priced cost, outcome, and the run or answer it served. Never the prompt or the completion.
- The answer audit is its own table, with a workspace id and a retention period (ADR 0017).
- The worker's heartbeat row carries the box's figures once a minute: memory, `pswpin`, disk under `/data`, the git store's size per workspace and each LMDB volume's. That row is the whole host-metrics agent. Swap-in above 4 MB/s for five minutes during a first index is ADR 0024's step-A signal.
- Three channels, each for the case only it can see: healthchecks.io for silence, Coolify through Resend for deploy and container failures, and the api's own email through `SMTP_URL` for the thresholds, immediately for a short list and in a daily digest for the rest.
- Retention: `platform_event` 90 days; heartbeats one a minute for seven days, then one an hour for ninety; `llm_call` six months, then a monthly per-workspace aggregate.

These shapes live here, not in the rules. The rule *Log through the tier's one structured logger*, in `CODING_STANDARDS.md`, keeps the checkable sentence that no prompt or completion reaches a logger, an exporter or a row. The rule *Keep a signal and an alert as rows*, in `deploy/CODING_STANDARDS.md`, keeps "no metrics store and no scrape", and the alert-once rule moved here from the deploy rule.

`llm_call`, `platform_event`, the threshold rows and the heartbeat's host figures have no table yet. `contracts/cost-ledger/rows.json` holds the `llm_call` row's golden rows and the purposes both tiers already speak.

## Why

- Two 4 GB boxes (ADR 0024) have nothing to spare for a metrics store.
- Every signal a run emits is already a row or a count over rows, with no instrumentation added.
- The first client's first index is expected to tune most thresholds, and a threshold in code makes every tune a release.
- Silence is watched from outside because the api may be what is down.
- Without the api's own alerts, the statutory case (erasure) and the spend case (the ceiling) go unseen unless someone looks.
- `llm_call` feeds the ceiling, price drift, replay spend, per-client spend and the onboarding estimate, and ADR 0017's replay reads it.
- A column list in a rule was a specification dressed as a coding rule. A rule keeps only what a diff can check.

## Rejected

- A metrics store now (VictoriaMetrics, or Prometheus with Grafana): 0.5–1 GB, a second login, and signals a restore does not bring back.
- An ops dashboard outside the api: two logins, and it needs the metrics store.
- node-exporter or Coolify's server metrics as the host source: the first needs the store, and the second is neither queryable by the api nor restored with the database.
- The api never sending alerts: the erasure and spend cases go unseen.
- A webhook channel in v0.1: no client has asked for one.
- Spend derived from the answer audit and `connector_run`: it loses enrichment and embedding calls and cannot price a run mid-flight.
- Thresholds in code: every tune a release.

## History

The full record, with its one amendment (T-078): `docs/archive/adr/0025-signals-are-queries-over-rows.md`.
