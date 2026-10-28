# apps/web

- Meet WCAG 2.2 AA, and test it with a keyboard and a screen reader. Follow GOV.UK Design System semantics (tag, details, notification banner, warning text, summary list) without the GOV.UK brand.
- Give every common action a keystroke, and list them under `?`. Bulk work is select-then-command.
- Write UI text in the glossary's reader words: see `CONCEPTS.md`.
- Read `packages/design-system/readme.md` when updating/implementing the UI.
- `test/` mirrors `src/` without the `features/` level. The test of `src/features/<feature>/x.tsx` is `test/<feature>/x.test.tsx`, and the tests of `src/app/` and `src/shared/` are under `test/app/` and `test/shared/`. Every helper of `test/` is in `test/support/`, even one a single folder uses, and is imported as `@test/<file>`. The web's repository checks sit in `test/gates/`. A spec is in `e2e/<feature>/`, the shell's in `e2e/app/`, and the suite's own modules stay at the `e2e/` root.
