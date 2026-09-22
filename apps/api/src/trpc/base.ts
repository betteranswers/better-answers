import { initTRPC, TRPCError } from "@trpc/server";

import { attempt, type Claims, type PrincipalRefusal } from "@better-answers/core/kernel";
import { withHeldPrincipal, withPrincipal } from "@better-answers/core/store/postgres";

import { sessionClaims, type SessionReader } from "../auth/verify.ts";
import type { Doors } from "../doors.ts";

type TrpcContext = {
  readonly doors: Doors;
  readonly readSession: SessionReader;
  readonly headers: Headers;
};

type TransportRefusal = PrincipalRefusal | "no-session" | "no-active-workspace";

const unauthorized = (refusal: TransportRefusal): TRPCError =>
  new TRPCError({ code: "UNAUTHORIZED", message: refusal });

const trpc = initTRPC.context<TrpcContext>().create();

export const router = trpc.router;

const claimsOf = async (ctx: TrpcContext): Promise<Claims> => {
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
  return claims;
};

const inTheResolversTransaction = (resolve: typeof withPrincipal) =>
  trpc.procedure.use(async ({ ctx, next }) => {
    const claims = await claimsOf(ctx);

    const resolved = await resolve(ctx.doors.postgres, claims, async (principal, tx) => {
      // tRPC returns a failed procedure rather than throwing, so without the throw below
      // the transaction it failed inside commits.
      const ran = await next({ ctx: { principal, tx, doors: undefined } });
      if (!ran.ok) throw ran.error;
      return ran;
    });
    if (!resolved.ok) throw unauthorized(resolved.error);
    return resolved.value;
  });

export const queryProcedure = inTheResolversTransaction(withPrincipal);

export const mutationProcedure = inTheResolversTransaction(withHeldPrincipal);

// A Principal outlives the transaction that resolved it only here; never the request, and the
// act's own door re-judges it.
export const ownTransactionProcedure = trpc.procedure.use(async ({ ctx, next }) => {
  const claims = await claimsOf(ctx);

  const resolved = await withPrincipal(ctx.doors.postgres, claims, async (principal) => principal);
  if (!resolved.ok) throw unauthorized(resolved.error);

  return next({ ctx: { principal: resolved.value, doors: ctx.doors } });
});
