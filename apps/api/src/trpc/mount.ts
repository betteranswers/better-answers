import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";

import type { Clock } from "@better-answers/core/kernel";
import type { PostgresDoor } from "@better-answers/core/store/postgres";

import type { Auth } from "../auth/index.ts";
import { TRPC_IP_RULE } from "../auth/index.ts";
import { limitByIp } from "../ingress/limits.ts";
import { appRouter } from "./router.ts";

export const TRPC_ENDPOINT = "/trpc";

type TrpcRoutesDependencies = {
  readonly auth: Auth;
  readonly door: PostgresDoor;
  readonly clock: Clock;
};

export const createTrpcRoutes = (deps: TrpcRoutesDependencies): Hono => {
  const routes = new Hono();

  routes.use(`${TRPC_ENDPOINT}/*`, limitByIp(deps.door, TRPC_IP_RULE, deps.clock));
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
