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

/**
 * A slice answers a store failure rather than throwing it (the kernel's result
 * convention); a transport is where it becomes a status a client understands. The cause
 * is kept so the tier's logger has the driver's own error, and the message says what
 * could not be done rather than why, which is the client's business and not the store's.
 */
const storeFailed = (what: string, cause: Error): TRPCError =>
  new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `${what} could not be read`, cause });

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
      // the same thing to a reader as a session that has ended. A store failure is not
      // that, and is never told to a client as a signed-out session.
      if (!read.ok) {
        const { error } = read;
        if (error instanceof Error) throw storeFailed("the membership", error);
        throw new TRPCError({ code: "UNAUTHORIZED", message: error });
      }
      return read.value;
    }),
  }),
  routes: router({
    /** A workspace's model routes, one row per purpose. Read-only: editing is a later ticket. */
    list: workspaceProcedure.query(async ({ ctx }) => {
      const listed = await listRoutes(ctx.principal, ctx.tx);
      if (!listed.ok) throw storeFailed("the workspace's routes", listed.error);
      return listed.value;
    }),
  }),
  // PROBE — THROWAWAY (T-113, probe 2 of 4). An async-generator subscription under
  // `workspaceProcedure`: the generator body runs after the resolver returned, so the `tx`
  // it closes over is the client `withPrincipal` already committed and released.
  probe: router({
    stream: workspaceProcedure.subscription(async function* ({ ctx }) {
      const pool = ctx.door.pool;
      const observe = async (at: string) => {
        try {
          const seen = await ctx.tx.query<Record<string, unknown>>(
            `SELECT pg_backend_pid() AS pid, current_workspace_id() AS ws, current_user AS role,
                    (SELECT xact_start < query_start FROM pg_stat_activity WHERE pid = pg_backend_pid()) AS in_block,
                    (SELECT count(*)::int FROM member) AS members_visible,
                    (SELECT count(*)::int FROM member WHERE workspace_id = current_workspace_id()) AS members_in_scope`,
          );
          return { at, ok: true, ...seen.rows[0], idle: pool.idleCount, total: pool.totalCount };
        } catch (error) {
          return {
            at,
            ok: false,
            error: String(error),
            idle: pool.idleCount,
            total: pool.totalCount,
          };
        }
      };
      yield await observe("first-yield");
      await new Promise((resolve) => setTimeout(resolve, 100));
      yield await observe("second-yield");
    }),
    // The shape the split implies: a plain async resolver that does its planning *inside*
    // the resolving transaction and returns an async iterable that holds no `tx`.
    planned: workspaceProcedure.subscription(async ({ ctx }) => {
      const seen = await ctx.tx.query<Record<string, unknown>>(
        `SELECT pg_backend_pid() AS pid, current_workspace_id() AS ws, current_user AS role,
                (SELECT xact_start < query_start FROM pg_stat_activity WHERE pid = pg_backend_pid()) AS in_block`,
      );
      const plan = { at: "resolver", ok: true, ...seen.rows[0] };
      const door = ctx.door;
      const principal = ctx.principal;
      return (async function* () {
        yield plan;
        // The record step: a second, short transaction of its own, as the principal.
        const recorded = await door.pool.query<Record<string, unknown>>(
          "SELECT pg_backend_pid() AS pid, current_workspace_id() AS ws, (SELECT xact_start < query_start FROM pg_stat_activity WHERE pid = pg_backend_pid()) AS in_block",
        );
        yield { at: "generator", principal: principal.workspaceId, ...recorded.rows[0] };
      })();
    }),
  }),
});

export type AppRouter = typeof appRouter;
