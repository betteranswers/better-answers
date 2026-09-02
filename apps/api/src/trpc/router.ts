import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";

import { listRoutes } from "@better-answers/core/llm";
import type { PostgresDoor } from "@better-answers/core/store/postgres";

import type { Auth } from "../auth/index.ts";
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
  routes.use(
    `${TRPC_ENDPOINT}/*`,
    trpcServer({
      router: appRouter,
      endpoint: TRPC_ENDPOINT,
      createContext: (_options, context) => ({
        door: deps.door,
        auth: deps.auth,
        headers: context.req.raw.headers,
      }),
    }),
  );
  return routes;
};
