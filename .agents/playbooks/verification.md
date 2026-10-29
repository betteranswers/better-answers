---
extends: feature, bug-fix, refactoring
when: Proving a change to the SPA, the api's routes or the consent flow on the running app.
---

# Verification

- **In** "Verify on the matching surface.", a change under `apps/web/` or to what a page reads from the api gets its test at the lowest layer that sees it. A change to one component gets a Testing Library case. A change that crosses pages or depends on the api gets a spec under `apps/web/e2e/` that drives the served build. Run the specs of the touched pages per *Running it* in `apps/web/.claude/skills/playwright-specs/SKILL.md`. A change to a page is also driven live through that page's feature file in `.claude/skills/verify/features/`. A change to what a page shows updates its feature file in the same PR. A change under `apps/api/` that no page shows is verified by the api's own suite, which runs the same harness. Name each test and paste its result in the reply.
- **In** "Reproduce it yourself on the matching surface via the driver skill (Non-negotiables)", reproduce a web bug before the fix as a failing test at the lowest layer that sees it, and keep that test as the regression test. A bug in one component gets a Testing Library case. A bug that crosses pages or depends on the api gets a browser spec on the served build.
- **In** "Prove behavior is unchanged on the real artifact", the specs that cover the touched pages pass unchanged, with no edit to their assertions.
