# Releases — every promotion to production, appended by `release.yml`

One row per run of the `release` workflow: when, who, the two digests the platform stack now runs, and what the release rode on (`pre-client: any green build` before the first client's data is on the box; the drill report or the hotfix reason after — Q7's switch, enforced in the workflow). **The previous row is the rollback**: RUNBOOK.md page 6 runs `release` again with that row's digests. Nothing edits this file by hand except to correct a row the workflow wrote wrongly, and that edit says so in its commit.

Standing release note, true of every row: the app refuses to start unless `PUBLIC_URL`, `AGENT_HOSTNAME` and `APEX_HOSTNAME` are set on the `api` resource and all three hostnames differ, the derived `app.` one included (ADR 0034). The `worker` service is behind the `pipeline` compose profile until `T-006`; its digest is set so the file interpolates, and nothing runs it.

| When (UTC) | By | api | worker | Rode on |
| --- | --- | --- | --- | --- |
| 2026-09-04T14:27:00Z | liam-jons | `sha256:918292a396a56c71b6ffd658b4c6de40b6c29856e60e0d3da5bd0edbac249aa9` | `sha256:81d3083aa5effc493a3dddf438711efb6dfff650201db2dd83987aa83590f19c` | pre-client: any green build |
| 2026-09-04T15:00:00Z | liam-jons | `sha256:828e78f9681fd1be2c8788995eb42fdbad45fed7757578d1aaa37453e6f0b07c` | `sha256:19b4fd4a8d301178136cfe2c88597eff2ad7c703b7e31f29c6b8bbf44fc88efc` | pre-client: any green build |
