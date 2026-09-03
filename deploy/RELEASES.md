# Releases — every promotion to production, appended by `release.yml`

One row per run of the `release` workflow: when, who, the two digests the platform stack now runs, and what the release rode on (`pre-client: any green build` before the first client's data is on the box; the drill report or the hotfix reason after — Q7's switch, enforced in the workflow). **The previous row is the rollback**: RUNBOOK.md page 6 runs `release` again with that row's digests. Nothing edits this file by hand except to correct a row the workflow wrote wrongly, and that edit says so in its commit.

Standing release note, true of every row: the app refuses to start unless `PUBLIC_URL`, `AGENT_HOSTNAME` and `APEX_HOSTNAME` are set on the `api` resource and all three hostnames differ, the derived `app.` one included (ADR 0034). The `worker` service is behind the `pipeline` compose profile until `T-006`; its digest is set so the file interpolates, and nothing runs it.

| When (UTC) | By | api | worker | Rode on |
| --- | --- | --- | --- | --- |
