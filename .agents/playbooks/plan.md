---
extends: multi-phase-plan
when: Writing a plan for work in this repository that needs more than one owner or will outlast one session.
---

# Plan

These changes add this repository's facts to a plan.

- **In** "Unless the operator names a path, write the file under the agent store", write the plan in `docs/plans/` as `NNN-plan-name.md`. For plans on the v0.1 route, the plan's intro names the route block the plan serves and links its brief, `docs/specs/route/<id>.md`. The pull request that adds the plan sets the block's row in `docs/specs/v01-route.md` to `planned` and links the plan. Each PR id is its Linear issue, `BA-N`.
- **After** "Each returns file pointers, conventions, test commands, and entry points." When a PR shapes a screen, its explorer reads the personas that screen serves in `docs/personas/personas.md`. Along with the project's root skills (`.claude/skills/`) there are domain-specific skills which load when accessing the following locations: `apps/api/.claude/skills/`, `apps/web/`, `apps/worker/`, `.claude/skills/better-answers-design`, `deploy/`, `.github/` - invoke matched skills, read their output and incorporate domain guidance into tasks and plans.
