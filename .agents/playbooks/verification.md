---
extends: feature, bug-fix, refactoring
when: Proving a change to the SPA, the api's routes or the consent flow on the running app.
---

# Verification

This repository has no `verify` skill. Its matching surface is `.claude/skills/browser-suite/SKILL.md`.

- **In** "Verify on the matching surface.", a change under `apps/web/` or to what a page reads from the api is verified by a spec under `apps/web/e2e/` that drives the served build, run per the browser-suite skill's *Running it*. A change under `apps/api/` that no page shows is verified by the api's own suite, which runs the same harness. Name the spec and paste its result in the reply.
- **In** "Reproduce it yourself on the matching surface via the driver skill (Non-negotiables)", the driver skill is `browser-suite`. Reproduce a web bug as a failing spec on the served build before the fix, and keep that spec as the regression test.
- **In** "Prove behavior is unchanged on the real artifact", the specs that cover the touched pages pass unchanged, with no edit to their assertions.
