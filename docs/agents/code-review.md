# Code review: Cubic on the PR, GitNexus and the wiki in the session

Three tools touch review here. Each has one job; the loop below is how a build session uses them without re-arguing the same finding five times.

| Tool | Job | Authority |
| --- | --- | --- |
| **Cubic** (`cubic.yaml`, the `cubic` MCP, the `cubic` CLI) | Reviews every PR against the constitution; records triage and learnings on the PR threads | A reviewer, not a rule: a finding that contradicts `CODING_RULES.md` or an ADR is wrong |
| **GitNexus** (the `gitnexus` MCP) | Blast radius before an edit, changed scope before a commit | Evidence about the call graph; its rules are in `AGENTS.md` |
| **The wiki** (`.cubic/wiki/`, also via the MCP's `get_wiki_page`) | Orientation in an unfamiliar area, read first | None. Derived and regenerated on a schedule; where it disagrees with `CONTEXT.md`, `CODING_RULES.md` or an ADR, the ADR wins without discussion, and the wiki is never cited in a review or a PR body |

## The review loop

Cubic reads `cubic.yaml` from `main` only, so the PR that changes it is reviewed under the old config.

1. **Before pushing** — `cubic review -b` on the branch. It is a faster, shallower pass than the PR review; fix what it finds so the PR review starts from a cleaner diff.
2. **Push, open the PR, wait** for Cubic's first review. Then `get_pr_issues` — never read the findings from the GitHub comments by hand.
3. **Triage every finding in one pass**, then fix in **one commit**. Each finding gets exactly one `update_pr_issue_status`:
   - `resolved` after the fix is pushed;
   - `false_positive`, `wont_fix` or `intended_behavior` with the reason in the tool's `comment` field, citing the rule tag or ADR that decides it.
   The `comment` field is the whole record. It posts to the thread, Cubic turns it into a learning, and the PR body never restates it.
4. **Re-review** with `trigger_pr_review` (a push alone re-reviews only when `incremental_commits` is on, which it is). Return to step 3.
5. **Stop after three rounds.** A fourth round of findings means the change is wrong-shaped, not under-polished: bring it back to the user with the open findings rather than continuing.

A finding that names a real rule this repo lacks is a `CODING_RULES.md` change in the same PR, with the finding's URL in the commit message.

## Learnings

`list_learnings` once at the start of a build session, before the first commit, and `get_learning` on any whose title touches the tier being changed. A learning is Cubic's memory of a triage decision; ignoring one means re-deciding it on the PR.

## GitNexus

The two gates are in `AGENTS.md` and are not optional: `impact` on a symbol before editing it, `detect_changes` before every commit. After a merge to `main`, `node .gitnexus/run.cjs analyze` refreshes the index the next session reads.
