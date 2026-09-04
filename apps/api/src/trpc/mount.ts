import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";

import type { PostgresDoor } from "@better-answers/core/store/postgres";

import type { Auth } from "../auth/index.ts";
import { TRPC_IP_RULE } from "../auth/index.ts";
import { limitByIp } from "../ingress/limits.ts";
import { appRouter } from "./router.ts";

/**
 * The router's HTTP mount, apart from the router on purpose: `TrpcRoutesDependencies`
 * names `Auth`, and `Auth` is Better Auth's inferred instance type — a file that held
 * this next to `appRouter` would put the whole auth server configuration into every
 * program that imports `AppRouter`, which is exactly what happened until T-042
 * (`apps/web/test/api-seam.test.ts` is the fence). One path on the same origin as the
 * app the SPA is served from (ADR 0006's 2026-09-02 amendment), no transformer —
 * nothing on this router puts a `Date` on the wire.
 */

/** The path the router answers on; the SPA's client is built against this one string. */
export const TRPC_ENDPOINT = "/trpc";

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
