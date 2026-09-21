import { initTRPC, TRPCError } from "@trpc/server";

import { attempt, type PrincipalRefusal } from "@better-answers/core/kernel";
import { withPrincipal, type PostgresDoor } from "@better-answers/core/store/postgres";

import { sessionClaims, type SessionReader } from "../auth/verify.ts";

type TrpcContext = {
  readonly door: PostgresDoor;
  readonly readSession: SessionReader;
  readonly headers: Headers;
};

type TransportRefusal = PrincipalRefusal | "no-session" | "no-active-workspace";

const unauthorized = (refusal: TransportRefusal): TRPCError =>
  new TRPCError({ code: "UNAUTHORIZED", message: refusal });

const trpc = initTRPC.context<TrpcContext>().create();

export const router = trpc.router;

export const workspaceProcedure = trpc.procedure.use(async ({ ctx, next }) => {
  const read = await attempt(() => ctx.readSession(ctx.headers));

  if (!read.ok) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "the session could not be read",
      cause: read.error,
    });
  }
  const session = read.value;
  if (session === null) throw unauthorized("no-session");

  const claims = await sessionClaims(async () => session, ctx.headers);
  if (claims === undefined) throw unauthorized("no-active-workspace");

  const resolved = await withPrincipal(ctx.door, claims, async (principal, tx) => {
    const ran = await next({ ctx: { principal, tx } });
    if (!ran.ok) throw ran.error;
    return ran;
  });
  if (!resolved.ok) throw unauthorized(resolved.error);
  return resolved.value;
});
