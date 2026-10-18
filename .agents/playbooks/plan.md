---
extends: multi-phase-plan
when: Writing a plan for work in this repository that needs more than one owner or will outlast one session.
---

# Plan

These changes add this repository's facts to a plan. They leave the ten live lanes, the perf block and step 6 as pstack wrote them, because `check-plan.mjs` checks those.

- **After** "When the change is one or two files with an obvious approach, skip the plan. Say so and stop.", also skip the plan when one owner can build the work in one session, as one pull request or a short stack of them. Say so, name the Feature, Refactoring or Bug fix playbook it runs under, and stop.
- **In** "Unless the operator names a path, write the file under the agent store", write the plan in `docs/plans/` as `YYYY-MM-DD-HHMM-<type>-<slug>-plan.md`, where `<type>` is the Conventional Commits type. The plan's intro names the route block in `docs/specs/v01-route.md` that the plan serves. Each PR id is its Linear issue, `BA-N`.
- **After** "Each returns file pointers, conventions, test commands, and entry points." When a PR shapes a screen, its explorer reads the personas that screen serves in `docs/personas/personas.md`, and the PR's design names them.
- **In** "Follow this dependency graph", each PR that adds a migration, and each PR that edits `contracts/`, runs alone until it merges. The graph never puts two PRs of the same kind in flight at once. The drizzle journal does not merge, and neither do the digest constants that both tiers generate from `contracts/`.
- **In** "put the resolved skill path or exact commands in each live lane's boot recipe", the web's driver skill is `browser-suite`, at `.claude/skills/browser-suite/SKILL.md`. A PR that changes a page a journey walks in `apps/web/journeys/` changes that journey in the same PR. Its **Files.** and **Build.** boxes name the journey, and it runs the journeys per that skill's *The journeys* before it lands.
- **Replace** "<The merge or append rule from the execution playbook, with the patch-id rule from `playbooks/shipping.md`.>" with the rule in `docs/agents/workflow.md` *Merging*. An agent that did not write the PR posts `PASS` at the head SHA. Once the PR's own `check` is green, the session queues its own PR through the merge queue with `gh pr merge <n> --match-head-commit <sha>`. A push after the verdict needs a new verdict. Queued is not merged, so the session reads the PR back with `gh pr view <n> --json state,mergedAt`. **How to read this** and each **Merge.** block's last box name the same merger.
