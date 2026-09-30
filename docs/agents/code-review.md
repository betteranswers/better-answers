# Code review: CE in the session, Cubic on the pull request

Two reviews, each with one job. The loop below is how a change passes both without re-arguing the same finding.

| Tool | Job |
| --- | --- |
| **`/ce-code-review`** (Compound Engineering) | Reviews the diff before the pull request, against the `CODING_STANDARDS.md` files and the plan. A second model family reads it too (*Before the pull request*, below) |
| **Cubic** (`cubic.yaml`, the `cubic` MCP) | Reviews every head on the pull request. It is the safety net once work reaches a pull request |
| **GitNexus** (the `gitnexus` MCP) | Blast radius before a risky edit, changed scope before a large commit. A tool, not a gate |
| **The wiki** (`.cubic/wiki/`, also the MCP's `get_wiki_page`) | Orientation in an unfamiliar area. It is the floor: check the code and the schema before relying on it |

## Before the pull request

`/lfg` and `/ce-work` run `/ce-code-review` and fix what it finds before the pull request opens. It sizes its depth to what the diff risks, not its line count.

Its adversarial pass goes to a second model family through OpenCode, on OpenRouter; `.compound-engineering/config.yaml` names the model. To turn it on, install OpenCode and give it an OpenRouter key in its own config. Without OpenCode the pass is skipped, and the review's Coverage line says so. The repository is public, so the diff it sends is not a disclosure.

## On the pull request

1. **Cubic reviews each head.** Its check completing is what arms the merge (`docs/agents/workflow.md`, *Merging*).
2. **`ce-babysit-pr` works the threads** in one pass per round: a fix for each finding worth fixing, and a reply saying why for each one that is not. One commit per round.
3. **The ruleset holds the merge** until every thread is resolved. Cubic resolves a thread it sees addressed (`resolve_threads_when_addressed`); a thread answered as a false positive is resolved by whoever answered it.
4. **Stop after three rounds.** A fourth round of findings means the change is wrong-shaped, not under-polished: bring it back to the owner with the open findings.

`get_pr_issues` on the `cubic` MCP lists a pull request's findings when the threads are hard to read. *Fix with cubic* hands a finding to Cubic's coding-agent provider; use it when you are driving the pull request by hand, never while `ce-babysit-pr` is running, because two fixers pushing to one branch undo each other.

When Cubic's allowance runs out, its check completes neutral with *AI review line limit reached*, and the merge arms with no review. Its allowance resets on the first of each month.
