import { initTRPC, TRPCError } from "@trpc/server";

import { attempt, type PrincipalRefusal } from "@better-answers/core/kernel";
import { withPrincipal, type PostgresDoor } from "@better-answers/core/store/postgres";

import type { Auth } from "../auth/index.ts";
import { sessionClaims } from "../auth/index.ts";

/**
 * tRPC's footing for this tier (ADR 0008: tRPC inside, the generated surfaces
 * outside): the context, the base procedure every workspace-scoped procedure is built
 * from, and the one place a refusal becomes a protocol error.
 *
 * The context carries the doors and the request's headers and **never a Principal**: a
 * Principal exists only inside the transaction that resolved it, and nothing caches
 * one beyond a request (`[SEC2]`).
 */
export type TrpcContext = {
  readonly door: PostgresDoor;
  readonly auth: Auth;
  readonly headers: Headers;
};

/**
 * What this transport refuses on top of the resolver's own refusals: no session at
 * all, and a session that has not passed the workspace picker.
 */
export type TransportRefusal = PrincipalRefusal | "no-session" | "no-active-workspace";

/**
 * Every refusal is `UNAUTHORIZED` carrying its own name, and there is no branch here
 * that could hand back a default role instead: a refusal the resolver adds later
 * arrives on the wire under its own name or not at all.
 */
const unauthorized = (refusal: TransportRefusal): TRPCError =>
  new TRPCError({ code: "UNAUTHORIZED", message: refusal });

const trpc = initTRPC.context<TrpcContext>().create();

export const router = trpc.router;

/**
 * The base every workspace-scoped procedure builds on. It reads the cookie session
 * into `Claims` the way `/me` does — the same helper, the same shape — and then runs
 * the procedure's own work *inside* the resolver's transaction, so the role is read in
 * the same transaction as the read it authorises and RLS is scoped for the whole
 * resolver. No procedure takes a workspace argument: the workspace is the session's.
 */
export const workspaceProcedure = trpc.procedure.use(async ({ ctx, next }) => {
  const read = await attempt(() => ctx.auth.api.getSession({ headers: ctx.headers }));
  // A session store that could not be reached is the platform's failure, not the
  // person's: only a lookup that succeeded and found nothing is "not signed in".
  if (!read.ok) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "the session could not be read",
      cause: read.error,
    });
  }
  const session = read.value;
  if (session === null || session === undefined) throw unauthorized("no-session");

  // The session is read once and handed to the same reader `/me` passes, so the
  // difference between "not signed in" and "no workspace picked" is kept.
  const claims = await sessionClaims(async () => session, ctx.headers);
  if (claims === undefined) throw unauthorized("no-active-workspace");

  const resolved = await withPrincipal(ctx.door, claims, async (principal, tx) => {
    // tRPC hands a failed resolver back as a value rather than throwing it, so a
    // failure would otherwise commit the transaction it failed inside. Throwing it
    // here rolls the transaction back and `withPrincipal` re-raises it unchanged.
    const ran = await next({ ctx: { principal, tx } });
    if (!ran.ok) throw ran.error;
    return ran;
  });
  if (!resolved.ok) throw unauthorized(resolved.error);
  return resolved.value;
});
