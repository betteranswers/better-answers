# Coding rules — `apps/web/`

The whole of `CODING_RULES.md` binds this workspace. What follows is true of the browser package alone.

## [WEB1] Import app → features → shared, never back

`src/app/` composes, `src/features/` owns one concern of the product and the requests it issues, and `src/shared/` is the ground both stand on. The direction never reverses, and no feature imports another: ground two features share belongs in `shared/`. A relative import stays inside its own directory; an import that crosses one is written `@/<zone>/…`, which is the only form the per-glob `no-restricted-imports` overrides can read — oxlint ships no path-based import rule.

## [WEB2] Name Better Auth in one directory

`src/features/auth/` is the only directory here that may import `better-auth` or a `@better-auth/*` plugin, with no carve-out. Every zone above it speaks screens, workspaces and roles rather than endpoints.

## [WEB3] Name a file and a folder in kebab-case

Every file and every folder under `src/` is kebab-case, so a name reads the same on a case-insensitive filesystem and a case-sensitive one, and a rename is never a commit that changes nothing on the machine that made it.

## [WEB4] Import the api as a type, in one file

`src/shared/api/trpc.ts` is the only file that may name `@better-answers/api`, and only as an `import type`, so the built bundle holds no reference to the api and runtime coupling stays zero. State the endpoint path rather than importing it, for the same reason.

## [WEB5] Catch a thrown screen inside the shell

The router carries a `defaultErrorComponent`, so a screen that throws is caught inside the shell's outlet and the frame, its landmarks and its navigation survive. It says what happened, offers the way out, announces the outcome to assistive technology, and shows a reader nothing of the error — no message, no name, no stack — and says nothing about where the error went, because no browser-side logger receives it.

## [UX2] Give every common action a keystroke

`?` lists them, and bulk work is select-then-command.

## [A11Y1] Meet WCAG 2.2 AA, tested with a keyboard and a screen reader

Every UI ticket carries that acceptance line. Every interactive element is a native control or has a role, a name and a focus order; an outcome is announced to assistive technology; a component follows GOV.UK Design System semantics — tag, details, notification banner, warning text, summary list — without the GOV.UK brand. The buyers are UK public bodies for whom this is law, and the first client states it of its own products.
