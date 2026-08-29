---
status: accepted
date: 2026-08-28
amends: 0017, 0022, 0024
---

# A signal is a query over rows the platform already keeps; one System screen; three channels that each see what the others cannot

**The constraint.** Two 4 GB boxes (ADR 0024) with nothing to spare for a metrics store, and a review that found no metric, alert or dashboard anywhere in the spec. Prototype 52 showed the other half of the picture: every signal a run emits is already a row or a count over rows, with no instrumentation added. Ticket 38 made the control plane rows; ticket 16 gave ops events one family (`platform_event`); ADR 0017 gave the answer path its audit, feedback, correction and answer-test rows.

**The rule.** A **signal** is a named query over rows the platform already keeps, with a threshold that makes it worth a line. No metrics store, no scrape, no dashboard product in v0.1. The catalogue — forty-one signals, grouped by the row family that answers them, each with a first-draft threshold — is `.scratch/v01-spec/briefings/42-observability-briefing.md` § 2 and moves into the code as one module's table when the first build task lands. **Thresholds are config rows** an Admin changes on System, never code.

**Host figures without an agent.** The worker's heartbeat row carries the box's figures — `/proc/meminfo`, `pswpin` from `/proc/vmstat`, disk under `/data`, the size of `/data/git` per workspace and of each LMDB volume — once a minute, ~300 bytes. That row is the whole host-metrics agent, and it is the evidence ADR 0024's growth step A waits on: **swap-in above 4 MB/s for five minutes during a first index** is the step-A candidate signal.

**Where it shows.** One screen, Control Centre → **System**, eight cards in this order: Boxes · Backups · Sources & worker · Map · Knowledge · Questions · Connected clients · Personal data. Each card is five lines each with an action, worst first (ticket 39's shape); a line is a signal over threshold or an always-on figure; the last 24 rows sit behind a line in place of a chart. Coolify's server view is a second opinion, never the source of a signal.

**Who is told.** Three channels, each for the case only it can see: **healthchecks.io** for silence (the scheduler, every backup job, the drill — the app may be what is down); **Coolify → Resend** for the deploy, container and backup failures Coolify sees; **the app's own email through `SMTP_URL`** for the catalogue's thresholds — an immediate message for the short list (extraction ceiling at 80 %, an erasure request past 21 days, a credential or token about to expire, a restore performed, the worker stale beyond 15 minutes, a backup missed) and a daily digest for the rest, to the Admin role's addresses, each line with its action. An alert is a `platform_event(kind=alert)`; a matching *cleared* event closes it so no condition fires twice.

**Born-evaluable.** Every model call writes an **`llm_call`** row — workspace, purpose (extract · answer · enrich · replay · embed), route, model, tokens in and out, seconds, priced cost, outcome, and the run or answer it served — never the prompt or the completion (`[LOG1]`). It feeds the ceiling, price drift, replay spend, per-client spend and the onboarding ETA, and is what ADR 0017's replay reads.

**Retention.** `platform_event` 90 days; heartbeats one a minute for seven days then one an hour for ninety; `llm_call` six months then a monthly per-workspace aggregate; the answer audit and `audit_event` as ADRs 0014 and 0017 set them. ADR 0017's thinning job does all of it and its own lag is a signal.

**The exporter.** `[LOG1]`'s OpenTelemetry exporter is one config key, `OTEL_EXPORTER_OTLP_ENDPOINT`, empty in v0.1: pino and structlog write JSON to stdout and Coolify's log view is the reader. Tracing arrives as a config change the day something receives it.

## Alternatives considered

- **A metrics store now** (VictoriaMetrics or Prometheus + Grafana on VPC 2) — charts and alert rules for 0.5–1 GB on the Coolify box, a second login, and signals that a restore does not bring back. Returns when the estate passes two boxes or a client asks for charts.
- **An ops dashboard outside the app** for the box and store cards — splits the operator's eyes across two logins and needs the metrics store.
- **node-exporter or Coolify's server metrics as the host source** — standard, but the first needs the store and the second is neither queryable by the app nor restored with the database.
- **The app never sends alerts** — cheaper; the statutory (erasure) and spend (ceiling) cases go unseen unless someone looks.
- **A webhook channel in v0.1** — one more surface for a client who has not asked; Liam's second channel for the scheduler check lives at healthchecks.io.
- **Deriving spend from the answer audit and `connector_run` alone** — loses enrichment and embedding calls and cannot price a run mid-flight.
- **Thresholds in code** — every tune is a release; the first client's first index is expected to tune most of them.

## Consequences

- Records: `llm_call` (new family, ADR 0014 catalogue grows by one); `platform_event` gains kinds `alert` and `cleared`; the `worker_instance` heartbeat carries a `host` JSON; a `signal_threshold` config row per signal.
- `CODING_RULES.md`: `[LOG1]` names the exporter key and the `llm_call` row; `[OPS1]` gains the alert-once rule.
- `CONTEXT.md`: *signal*, *alert*, *System* (card order).
- The first build task's first index on the box is the measurement for every threshold in the catalogue and for ADR 0024's step A.
- Fog kept: SLOs, tracing, a status page, per-client reports, alert routing beyond email.
