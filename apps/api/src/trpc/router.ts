import { TRPCError } from "@trpc/server";

import { listRoutes } from "@better-answers/core/llm";
import { readMembership } from "@better-answers/core/workspaces";

import { router, workspaceProcedure } from "./base.ts";

/**
 * The tier's tRPC router and nothing else — its HTTP mount lives in `mount.ts`, because
 * `AppRouter` is the one type `apps/web` imports (ADR 0006's one exception) and every
 * module this file reaches rides along into the SPA's program. Nothing here may name
 * `Auth` or touch the auth barrel; the runtime coupling stays zero.
 */

export const appRouter = router({
  session: router({
    /**
     * Who the shell is looking at: the workspace, the person and their role (T-037). It is
     * the same read every other procedure makes on its way in — the cookie session into
     * Claims into the resolver — so an ended session, a revoked credential or a membership
     * that has gone answers `UNAUTHORIZED` here before the shell can name anyone.
     */
    membership: workspaceProcedure.query(async ({ ctx }) => {
      const read = await readMembership(ctx.principal, ctx.tx);
      // The two refusals are a session pointing at rows that no longer exist, which is
      // the same thing to a reader as a session that has ended.
      if (!read.ok) throw new TRPCError({ code: "UNAUTHORIZED", message: read.error });
      return read.value;
    }),
  }),
  routes: router({
    /** A workspace's model routes, one row per purpose. Read-only: editing is a later ticket. */
    list: workspaceProcedure.query(({ ctx }) => listRoutes(ctx.principal, ctx.tx)),
  }),
});

export type AppRouter = typeof appRouter;
