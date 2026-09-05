# Coding rules — `apps/web/`

The whole of `CODING_RULES.md` binds this workspace. What follows is true of the browser
package alone. Each rule names what holds it, because a rule nothing runs is a convention.

## [WEB1] Three zones, and the direction app → features → shared

`src/app/` composes, `src/features/` owns one concern of the product and the requests it
issues, and `src/shared/` is the ground both stand on. The direction never reverses, and no
feature imports another: ground two features share belongs in `shared/`. A relative import
stays inside its own directory, and an import that crosses one is written `@/<zone>/…`,
because that is the form the per-glob `no-restricted-imports` overrides in `.oxlintrc.json`
can read — oxlint 1.80 has no `import/no-restricted-paths`. Held by
`test/lint-rules.test.ts`.

## [WEB2] One directory names Better Auth

`src/features/auth/` is the only directory in this workspace that may import `better-auth`
or a `@better-auth/*` plugin; every zone above it speaks screens, workspaces and roles
rather than endpoints. It is one glob with no carve-out, and it is the same fence
`apps/api/src/auth/` carries on the other side (ADR 0009). Held by
`test/lint-rules.test.ts`.

## [WEB3] Files and folders are kebab-case

Every file and every folder under `src/` is kebab-case, so a name reads the same on a
case-insensitive filesystem and a case-sensitive one and a rename is never a commit that
changes nothing on the machine that made it. `unicorn/filename-case` holds the file;
oxlint 1.80 has no rule for a directory's own name, so `test/folder-case.test.ts` walks the
tree for the folder.

## [WEB4] The api is a type, in one file

`src/shared/api/trpc.ts` is the only file that may name `@better-answers/api`, and only as
an `import type`: `verbatimModuleSyntax` erases it, so the built bundle holds no reference
to the api and runtime coupling stays zero (ADR 0006). A value import is refused there as
everywhere, and the endpoint path is stated rather than imported for the same reason. Held
by `test/lint-rules.test.ts`.

## [WEB5] A screen that throws leaves the frame standing

The router carries a `defaultErrorComponent` (`src/app/failed-screen.tsx`), so a screen that
throws is caught inside the shell's outlet and the frame, its landmarks and its navigation
survive. It says what happened and offers the way out (`[UX1]`), announces the outcome to
assistive technology (`[A11Y1]`), shows a reader nothing of the error — no message, no name,
no stack — and says nothing about where the error went, because no browser-side logger
receives it. Held by `test/failed-screen.test.tsx` and `e2e/failed-screen.spec.ts`.
