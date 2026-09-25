import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import type { Logger } from "pino";

import type { Auth } from "../auth/index.ts";
import { TRPC_IP_RULE } from "../auth/index.ts";
import type { Doors } from "../doors.ts";
import { limitByIp } from "../ingress/limits.ts";
import { CeilingMet } from "./base.ts";
import { appRouter } from "./router.ts";

export const TRPC_ENDPOINT = "/trpc";

type TrpcRoutesDependencies = {
  readonly auth: Auth;
  readonly doors: Doors;
  readonly logger: Logger;
};

export const createTrpcRoutes = (deps: TrpcRoutesDependencies): Hono => {
  const routes = new Hono();
  const log = deps.logger.child({ module: "trpc" });

  routes.use(`${TRPC_ENDPOINT}/*`, limitByIp(deps.doors.postgres, TRPC_IP_RULE, deps.doors.clock));
  routes.use(
    `${TRPC_ENDPOINT}/*`,
    trpcServer({
      router: appRouter,
      endpoint: TRPC_ENDPOINT,
      createContext: (_options, context) => ({
        doors: deps.doors,
        clock: deps.doors.clock,
        readSession: (headers: Headers) => deps.auth.api.getSession({ headers }),
        headers: context.req.raw.headers,
        log,
      }),
      responseMeta: ({ errors }) => {
        const met = errors.map((error) => error.cause).find((cause) => cause instanceof CeilingMet);
        return met instanceof CeilingMet
          ? { headers: { "retry-after": String(met.retryAfterSeconds) } }
          : {};
      },
    }),
  );
  return routes;
};
