# Code review: pstack before the merge, review bots on the pull request

Review is sized to what the change risks, not its line count. The steps below are how a change passes review without re-arguing the same finding.

| Tool | Job |
| --- | --- |
| **`/no-comments`** (pstack) | Strips comments that narrate or that hold a reason about our own code, before review |
| **`/thermos`** (pstack) | Reviews the branch's diff before the pull request: bugs, security and breaking changes, then maintainability |
| **The verdict** (pstack's *Shipping*) | An agent that did not write the change runs it and posts `PASS`, `PASS+NOTES` or `FAIL` with the head SHA. It is what lets the session queue the merge (`docs/agents/workflow.md`, *Merging*) |
| **Cubic** (`cubic.yaml`, the `cubic` MCP) | Reviews each head on the pull request when it is switched on. It is paused today |
| **GitNexus** (the `gitnexus` MCP) | Blast radius before a risky edit, changed scope before a large commit. A tool, not a gate |
| **The wiki** (`.cubic/wiki/`, also the MCP's `get_wiki_page`) | Orientation in an unfamiliar area. It is the floor: check the code and the schema before relying on it |

## Before the pull request

pstack's playbooks run `/no-comments` before review and `/thermos` on the branch. A small, contained change can skip `/thermos`; a change to auth, access, erasure, a migration or `contracts/` does not.

## On the pull request

1. **The verifier posts its verdict** on the head. A `FAIL` goes back to the session that wrote the change, and a new head gets a new verdict.
2. **A review bot's threads are triaged**, not obeyed: a fix for each finding worth fixing, and a reply saying why for each one that is not (pstack's bugbot triage). One commit per round of fixes.

`get_pr_issues` on the `cubic` MCP lists a pull request's findings when the threads are hard to read. *Fix with cubic* hands a finding to Cubic's coding-agent provider; use it only when no session is pushing to the branch, because two fixers pushing to one branch undo each other.
