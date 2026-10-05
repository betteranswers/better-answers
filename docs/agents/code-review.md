# Code review: CE in the session, Cubic on the pull request

Two reviews, each with one job. The loop below is how a change passes both without re-arguing the same finding.

| Tool | Job |
| --- | --- |
| **`/ce-code-review`** (Compound Engineering) | Reviews the diff before the pull request, against the `CODING_STANDARDS.md` files and the plan. A second model family reads it too (*Before the pull request*, below) |
| **Cubic** (`cubic.yaml`, the `cubic` MCP) | Reviews every head on the pull request. It is the safety net once work reaches a pull request. Its allowance is counted in reviewed lines, so the ignore list in `cubic.yaml` skips what is not code, such as tests, `docs/`, skills and generated snapshots |
| **GitNexus** (the `gitnexus` MCP) | Blast radius before a risky edit, changed scope before a large commit. A tool, not a gate |
| **The wiki** (`.cubic/wiki/`, also the MCP's `get_wiki_page`) | Orientation in an unfamiliar area. It is the floor: check the code and the schema before relying on it |

## Before the pull request

`/lfg` and `/ce-work` run `/ce-code-review` and fix what it finds before the pull request opens. It sizes its depth to what the diff risks, not its line count.

Its adversarial pass goes to a second model family through OpenCode, on OpenRouter; `.compound-engineering/config.yaml` names the model. To turn it on, install OpenCode and give it an OpenRouter key in its own config. Without OpenCode the pass is skipped, and the review's Coverage line says so. The repository is public, so the diff it sends is not a disclosure.

The same config names the model's reasoning effort, `high`. Four machine settings in the `env` block of `~/.claude/settings.json` keep a long review from dying with no output: `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=64000` raises OpenCode's default output cap of 32,000, of which reasoning is part, and `CROSS_MODEL_IDLE_SECS=900`, `CROSS_MODEL_HARD_SECS=1800` and `CE_PEER_IDLE_SECS=900` give a single long reasoning step time to finish. `/ce-doc-review` uses the same peer. Why each is needed, and how to read a silent peer's tokens from OpenCode's own store: `docs/solutions/integration-issues/the-glm-review-peer-returns-nothing-when-its-reasoning-fills-opencodes-output-cap.md`.

## On the pull request

1. **Cubic reviews each head.** Its check completing with success is what arms the merge (`docs/agents/workflow.md`, *Merging*).
2. **`ce-babysit-pr` works the threads** in one pass per round: a fix for each finding worth fixing, and a reply saying why for each one that is not. One commit per round.
3. **The ruleset holds the merge** until every thread is resolved. Cubic resolves a thread it sees addressed (`resolve_threads_when_addressed`); a thread answered as a false positive is resolved by whoever answered it.
4. **Stop after three rounds.** A fourth round of findings means the change is wrong-shaped, not under-polished: bring it back to the owner with the open findings.

`get_pr_issues` on the `cubic` MCP lists a pull request's findings when the threads are hard to read. *Fix with cubic* hands a finding to Cubic's coding-agent provider; use it when you are driving the pull request by hand, never while `ce-babysit-pr` is running, because two fixers pushing to one branch undo each other.

When Cubic's allowance runs out, its check completes neutral with *AI review line limit reached*, and nothing arms: the owner decides whether the pull request merges unreviewed. Its allowance resets on the first of each month.
