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

- The signals are one module's table in the code. A new signal is a row of that table, never a second module.
- Thresholds are config rows an Admin changes on System, never code. Each signal has one `signal_threshold` row.
- Each line on System's Signals page is a signal over its threshold or an always-on figure. Each line carries its action, and the lines run worst first. A signal's last 24 rows sit behind its line, in place of a chart.
- An **alert** is recorded once as a `platform_event(kind=alert)` and closed by a *cleared* event, so no condition fires twice.
- Every model call writes one `llm_call` row: `workspace_id`, its own id and when it was called, purpose, model choice, model, tokens in and out, seconds, priced cost in pounds sterling, outcome, and the sync or answer it served. Never the prompt or the completion.
- *Questions asked* is its own table, with a workspace id and a retention period (ADR 0017).
- Each worker keeps a row of its own (`worker_instance`), and once a minute it writes the box's figures to that row as one `host` JSON: memory, `pswpin`, disk under `/data`, the git store's size per workspace and each LMDB volume's. That row is the whole host-metrics agent. Swap-in above 4 MB/s for five minutes during a first index is ADR 0024's step-A signal.
- Three channels, each for the case only it can see:
  - healthchecks.io for silence: the scheduler, every backup job and the restore drill;
  - Coolify through Resend for the deploy, container and backup failures Coolify sees;
  - the api's own email through `SMTP_URL` for the thresholds, sent to the workspace's Admins.
- The api's email goes out at once for six alerts: extraction spend at 80 % of the ceiling, an erasure request open past 21 days, a credential or token about to expire, a restore performed, the worker stale beyond 15 minutes, and a missed backup. Every other alert waits for the daily digest. Each line of the email carries its action.
- Retention: `platform_event` 90 days; the worker's host figures one a minute for seven days, then one an hour for ninety; `llm_call` six months, then a monthly per-workspace aggregate. One retention pass carries out every period here and ADR 0017's, and its own lag is a signal.
- pino and structlog write JSON to stdout, and Coolify's log view is the reader. The loggers' OpenTelemetry exporter is one config key, `OTEL_EXPORTER_OTLP_ENDPOINT`, empty in v0.1. Tracing arrives as a config change on the day something receives it.

These shapes live here, not in the rules. The logging rule in `CODING_STANDARDS.md` keeps the checkable sentence that no prompt or completion reaches a logger, an exporter or a row. `deploy/AGENTS.md` keeps "no metrics store and no scrape". The alert-once rule moved here from the deploy rule.

`llm_call` has its table, which the api writes when a question's model call settles. The worker writes none yet, and `llm_call`'s retention is not built. `platform_event`, `signal_threshold`, `worker_instance` and the signals module do not exist yet, the Signals page is declared and not built, and no alert is sent. `contracts/cost-ledger/rows.json` holds the `llm_call` row's golden rows, and both tiers hold its columns and outcomes to the table.

The worker's host row is not the job's heartbeat. Today the only heartbeat is `job.heartbeat_at`, which the worker renews every 20 seconds while it holds a claimed job. The worker's container health check (`apps/worker/src/better_answers_worker/health.py`) reads it. A worker is healthy while a job it holds beat in the last 40 seconds, or while no job has waited longer than a lease for a worker. An idle worker writes no heartbeat, and no row carries the box's figures.

## Why

- Two 4 GB boxes (ADR 0024) have nothing to spare for a metrics store.
- Every signal a sync emits is already a row or a count over rows, with no instrumentation added.
- The first customer's first index is expected to tune most thresholds, and a threshold in code makes every tune a release.
- Silence is watched from outside because the api may be what is down.
- Without the api's own alerts, the statutory case (erasure) and the spend case (the ceiling) go unseen unless someone looks.
- `llm_call` feeds the ceiling, price drift, replay spend, per-customer spend and the onboarding estimate, and ADR 0017's replay reads it.
- A column list in a rule was a specification dressed as a coding rule. A rule keeps only what a diff can check.

## Rejected

- A metrics store now (VictoriaMetrics, or Prometheus with Grafana): 0.5–1 GB, a second login, and signals a restore does not bring back. It returns when the estate passes two boxes or a customer asks for charts.
- An ops dashboard outside the api: two logins, and it needs the metrics store.
- node-exporter or Coolify's server metrics as the host source: the first needs the store, and the second is neither queryable by the api nor restored with the database.
- The api never sending alerts: the erasure and spend cases go unseen.
- A webhook channel in v0.1: no customer has asked for one.
- Spend derived from *Questions asked* and the syncs' job rows: it loses enrichment and embedding calls and cannot price a sync mid-flight.
- Thresholds in code: every tune a release.

## History

The full record, with its one amendment (T-078): `docs/archive/adr/0025-signals-are-queries-over-rows.md`.

ADR 0047 of 30/09/2026 replaced the archived record's one System screen of eight cards, five lines to a card, with System's four pages: Audit log, Signals, Health and Backups. The record's other rules were missing from this doc until 20/10/2026 (BA-215): the signals module, `signal_threshold`, the Signals page's lines, the six immediate alerts and their Admin recipients, the retention pass and its lag, and the exporter key. The record called the worker's own row its heartbeat. This doc names it the worker's host row, because the job's lease heartbeat is a different column.
