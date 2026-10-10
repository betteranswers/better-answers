import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import type { Logger } from "pino";

import { CeilingMet } from "@better-answers/core/kernel";

import type { Auth } from "../auth/index.ts";
import { TRPC_IP_RULE } from "../auth/index.ts";
import type { Doors } from "../doors.ts";
import type { Mail } from "../email.ts";
import { limitByIp } from "../ingress/limits.ts";
import { gatedReader, type GatedSessionReader } from "../second-factor-gate.ts";
import { appRouter } from "./router.ts";

export const TRPC_ENDPOINT = "/trpc";

/** Every answer is one reader's, a refusal too: a kept not-found would outlive the grant ending it. */
const UNCACHED = "private, no-store";

type TrpcRoutesDependencies = {
  readonly auth: Auth;
  readonly doors: Doors;
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

  /** A batch's procedures share one request's headers, so they share its one judged read. */
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
      createContext: (_options, context) => ({
        doors: deps.doors,
        clock: deps.doors.clock,
        readSession: readOncePerRequest(),
        headers: context.req.raw.headers,
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
