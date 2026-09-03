import { trpcServer } from "@hono/trpc-server";
import { TRPCError } from "@trpc/server";
import { Hono } from "hono";

import { listRoutes } from "@better-answers/core/llm";
import { readMembership } from "@better-answers/core/workspaces";
import type { PostgresDoor } from "@better-answers/core/store/postgres";

import type { Auth } from "../auth/index.ts";
import { TRPC_IP_RULE } from "../auth/index.ts";
import { limitByIp } from "../ingress/limits.ts";
import { router, workspaceProcedure } from "./base.ts";

/**
 * The tier's tRPC router and its mount. One path on the same origin as the app the
 * SPA is served from (ADR 0006's 2026-09-02 amendment), no transformer — nothing on
 * this router puts a `Date` on the wire.
 *
 * `AppRouter` is the one type `apps/web` imports (ADR 0006's one exception); the
 * runtime coupling stays zero.
 */

/** The path the router answers on; the SPA's client is built against this one string. */
export const TRPC_ENDPOINT = "/trpc";

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

export type TrpcRoutesDependencies = {
  readonly auth: Auth;
  readonly door: PostgresDoor;
};

export const createTrpcRoutes = (deps: TrpcRoutesDependencies): Hono => {
  const routes = new Hono();
  // The ceiling stands in front of the session lookup: an unauthenticated flood is
  // refused before it can spend a database round trip per request.
  routes.use(`${TRPC_ENDPOINT}/*`, limitByIp(deps.door, TRPC_IP_RULE));
  routes.use(
    `${TRPC_ENDPOINT}/*`,
    trpcServer({
      router: appRouter,
      endpoint: TRPC_ENDPOINT,
      createContext: (_options, context) => ({
        door: deps.door,
        readSession: (headers: Headers) => deps.auth.api.getSession({ headers }),
        headers: context.req.raw.headers,
      }),
    }),
  );
  return routes;
};
