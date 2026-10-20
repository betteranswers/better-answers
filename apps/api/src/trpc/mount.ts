import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import type { Logger } from "pino";

import { CeilingMet } from "@better-answers/core/kernel";

import type { ModelDoors } from "../ask-steps.ts";
import { ASK_KEEP_ALIVE_MS } from "../ask-stream.ts";
import type { Auth } from "../auth/index.ts";
import { TRPC_IP_RULE } from "../auth/index.ts";
import type { Doors } from "../doors.ts";
import type { Mail } from "../email.ts";
import { limitByIp } from "../ingress/limits.ts";
import { gatedReader, type GatedSessionReader } from "../second-factor-gate.ts";
import { appRouter } from "./router.ts";

export const TRPC_ENDPOINT = "/trpc";

const UNCACHED = "private, no-store";

type TrpcRoutesDependencies = {
  readonly auth: Auth;
  readonly doors: Doors;
  readonly modelDoors: ModelDoors;
  readonly askKeepAliveMs?: number | undefined;
  readonly logger: Logger;
  readonly mail: Mail;
};

export const createTrpcRoutes = (deps: TrpcRoutesDependencies): Hono => {
  const routes = new Hono();
  const log = deps.logger.child({ module: "trpc" });
  const gated = gatedReader((headers) => deps.auth.api.getSession({ headers }), {
    door: deps.doors.postgres,
    clock: deps.doors.clock,
  });

  const readOncePerRequest = (): GatedSessionReader => {
    let read: ReturnType<GatedSessionReader> | undefined;
    return (headers) => (read ??= gated(headers));
  };

  routes.use(
    `${TRPC_ENDPOINT}/*`,
    limitByIp(
      { door: deps.doors.postgres, clock: deps.doors.clock, logger: deps.logger },
      TRPC_IP_RULE,
      "trpc",
    ),
  );
  routes.use(
    `${TRPC_ENDPOINT}/*`,
    trpcServer({
      router: appRouter,
      endpoint: TRPC_ENDPOINT,
      createContext: (options, context) => ({
        doors: deps.doors,
        modelDoors: deps.modelDoors,
        askKeepAliveMs: deps.askKeepAliveMs ?? ASK_KEEP_ALIVE_MS,
        clock: deps.doors.clock,
        readSession: readOncePerRequest(),
        headers: context.req.raw.headers,
        resHeaders: options.resHeaders,
        log,
        mail: deps.mail,
      }),
      responseMeta: ({ errors }) => {
        const met = errors.map((error) => error.cause).find((cause) => cause instanceof CeilingMet);
        const headers = new Headers({ "cache-control": UNCACHED });
        if (met instanceof CeilingMet) headers.set("retry-after", String(met.retryAfterSeconds));
        return { headers };
      },
    }),
  );
  return routes;
};
