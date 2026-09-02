export type { AppRouter } from "./router.ts";

/**
 * The one name `apps/web` is allowed to know (ADR 0006, amended 2026-09-02), and the whole of
 * `@better-answers/api`'s package entry.
 *
 * It is a module of its own rather than a line in `index.ts` because `index.ts` is the tier's
 * *internal* interface — the mount, the endpoint constant, the dependency type — and a package
 * entry that exposed those would invite the SPA to reach for one of them. Here there is nothing
 * to reach for: a second name imported from `@better-answers/api/trpc` does not exist, so the
 * `import type`-only lint override in `.oxlintrc.json` and this file's emptiness together make
 * the exception exactly one type wide.
 */
