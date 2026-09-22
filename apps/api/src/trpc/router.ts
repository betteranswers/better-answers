import { TRPCError } from "@trpc/server";

import { listRoutes } from "@better-answers/core/llm";
import { readMembership } from "@better-answers/core/workspaces";

import { queryProcedure, router } from "./base.ts";

const storeFailed = (what: string, cause: Error): TRPCError =>
  new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `${what} could not be read`, cause });

export const appRouter = router({
  session: router({
    membership: queryProcedure.query(async ({ ctx }) => {
      const read = await readMembership(ctx.principal, ctx.tx);

      if (!read.ok) {
        const { error } = read;
        if (error instanceof Error) throw storeFailed("the membership", error);
        throw new TRPCError({ code: "UNAUTHORIZED", message: error });
      }
      return read.value;
    }),
  }),
  routes: router({
    list: queryProcedure.query(async ({ ctx }) => {
      const listed = await listRoutes(ctx.principal, ctx.tx);
      if (!listed.ok) throw storeFailed("the workspace's routes", listed.error);
      return listed.value;
    }),
  }),
});

export type AppRouter = typeof appRouter;
