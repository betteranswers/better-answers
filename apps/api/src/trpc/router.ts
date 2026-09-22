import { listRoutes } from "@better-answers/core/llm";
import { readMembership } from "@better-answers/core/workspaces";

import { crossing, queryProcedure, router } from "./base.ts";

export const appRouter = router({
  session: router({
    membership: queryProcedure.query(({ ctx }) =>
      crossing(ctx, readMembership.name, readMembership(ctx.principal, ctx.tx)),
    ),
  }),
  routes: router({
    list: queryProcedure.query(({ ctx }) =>
      crossing(ctx, listRoutes.name, listRoutes(ctx.principal, ctx.tx)),
    ),
  }),
});

export type AppRouter = typeof appRouter;
