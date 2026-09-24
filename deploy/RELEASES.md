# Releases — closed 23/09/2026; a promotion is a `release/*` tag now

**This file is frozen** (`T-342`, 23/09/2026). `main`'s ruleset is merge-queue-only, so the push that appended a row is refused: the record was lost and the smoke behind it skipped. A promotion is recorded instead as an **annotated `release/<UTC stamp>-<short commit>` tag**, which no branch ruleset governs. The tag carries what a row carried — when, who, both digests, what the release rode on — and names the commit it points at. List them newest first and read one:

```sh
git fetch --tags && git tag --list 'release/*' --sort=-creatordate
git show --no-patch release/<stamp>
```

**The previous tag is the rollback**: RUNBOOK.md page 6 runs `release` again with that tag's two digests. The rows below are the promotions up to and including 23/09/2026 and stay as the record of them; nothing appends to the table again, and nothing edits a row except to correct one the workflow wrote wrongly, which says so in its commit.

**A promotion made on the box is tagged by hand.** While the workflow's Coolify call is unreachable (the Access debt recorded 04/09/2026) a promotion is made on the box, and it is recorded the same way the workflow would — the same tag name and the same message, with the last line saying it was made on the box and why:

```sh
when="$(date -u +%FT%TZ)"
head="$(git rev-parse HEAD)"
tag="release/${when//[-:]/}-${head:0:7}"
git tag -a "${tag}" "${head}" -m "$(printf 'release: api <short> · worker <short>\n\nWhen (UTC): %s\nBy: <who>\napi: <digest>\nworker: <digest>\nRode on: <drill report or hotfix reason>\nCommit: %s (on-box promotion — the Coolify call was unreachable)\n' "${when}" "${head}")"
git push origin "refs/tags/${tag}"
```

**What blank inputs promote** (`T-211`, 20/09/2026, and still true): the image of `main`'s head commit, by its `sha-<short>` tag — every commit gets one, and there is no `:main` tag. A head with no image is refused by name and nothing older is promoted in its place. A tag moves no branch, so a release now leaves `main`'s head where it found it, with the image it just promoted: a second release with nothing merged between promotes that same head again, where the row used to leave a commit no build ran for.

Standing release note, true of every row and every tag since: the api refuses to start unless `PUBLIC_URL`, `AGENT_HOSTNAME` and `APEX_HOSTNAME` are set on the `api` resource and all three hostnames differ, the derived `app.` one included (ADR 0034). The `worker` service is behind the `pipeline` compose profile until `T-006`; its digest is set so the file interpolates, and nothing runs it.

| When (UTC) | By | api | worker | Rode on |
| --- | --- | --- | --- | --- |
| 2026-09-04T14:27:00Z | liam-jons | `sha256:918292a396a56c71b6ffd658b4c6de40b6c29856e60e0d3da5bd0edbac249aa9` | `sha256:81d3083aa5effc493a3dddf438711efb6dfff650201db2dd83987aa83590f19c` | pre-client: any green build |
| 2026-09-04T15:00:00Z | liam-jons | `sha256:828e78f9681fd1be2c8788995eb42fdbad45fed7757578d1aaa37453e6f0b07c` | `sha256:19b4fd4a8d301178136cfe2c88597eff2ad7c703b7e31f29c6b8bbf44fc88efc` | pre-client: any green build |
| 2026-09-04T15:48:51Z | liam-jons | `sha256:c4f68d904fbe73ca53e45ae2d1d67388a4070981d8b1cf9ede2d151a67432e62` | `sha256:ad3b0ab4f429419ca963cc9496731d536230b897517fc3ef5226cc557c9ff894` | pre-client: any green build |
| 2026-09-04T15:58:44Z | liam-jons | `sha256:e0784f7e5763a5ae83b181affe363760f33c1e01caa0938c0facced47400f69f` | `sha256:e225e467c205f12b593e35ecae3fea8dffa5f24bee3ce5fb71e49f21c66ff127` | pre-client: any green build |
| 2026-09-04T16:13:32Z | liam-jons | `sha256:e0784f7e5763a5ae83b181affe363760f33c1e01caa0938c0facced47400f69f` | `sha256:e225e467c205f12b593e35ecae3fea8dffa5f24bee3ce5fb71e49f21c66ff127` | pre-client: any green build |
| 2026-09-04T17:20:29Z | liam-jons | `sha256:5a43990ff720ce22c2b59d90432fcae47d7bdcc408c7367e8710f1e9ddfc6d4a` | `sha256:daad1625474014f4eb01425975f31a643686fef0598e3caadd8e1ea5a1d5badb` | pre-client: any green build |
| 2026-09-23T04:26:58Z | liam-jons | `sha256:3a01c9d0236f278311e93ab55533f7dbebbaa24c4474d148e0433b778949bec5` | `sha256:557ec42529db89cf26bc4cf30b09523e80b801d707d5c846ae09932576bfdeb3` | pre-client: any green build |
