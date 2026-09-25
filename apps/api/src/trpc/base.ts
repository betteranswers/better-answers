import { initTRPC, TRPCError } from "@trpc/server";
import type { Logger } from "pino";
import type { z } from "zod";

import {
  attempt,
  err,
  parse,
  type Claims,
  type Clock,
  type Malformed,
  type RefusalClass,
  type Result,
  type UserPrincipal,
} from "@better-answers/core/kernel";
import {
  consumeIngress,
  withHeldPrincipal,
  withOperator,
  withPrincipal,
  type CounterRule,
  type Tx,
} from "@better-answers/core/store/postgres";

import { sessionClaims, type SessionReader } from "../auth/verify.ts";
import type { Doors } from "../doors.ts";
import { refusalLogged, refusalOf, RefusedError, type RefusalAnswer } from "../refusal.ts";

type TrpcContext = {
  readonly doors: Doors;
  readonly clock: Clock;
  readonly readSession: SessionReader;
  readonly headers: Headers;
  readonly log: Logger;
};

/** Spelled here because tRPC exports the Standard Schema type only from a path it marks internal. */
type StandardParser<Input, Output> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the standard's own signature: the transport hands over whatever arrived, and the kernel `parse` it calls is what narrows it.
    readonly validate: (value: unknown) => { readonly value: Output };
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
};

/**
 * A refusal rides through as the input too, so a malformed input crosses, and is logged, where
 * every other refusal is.
 */
export const parsedBy = <Schema extends z.ZodType>(
  schema: Schema,
): StandardParser<z.input<Schema>, Result<z.output<Schema>, Malformed>> => ({
  "~standard": {
    version: 1,
    vendor: "better-answers",
    validate: (raw) => ({ value: parse(schema, raw) }),
  },
});

export const given = <Input, Value, Refused>(
  parsed: Result<Input, Malformed>,
  run: (input: Input) => Promise<Result<Value, Refused>>,
): Promise<Result<Value, Refused | Malformed>> =>
  parsed.ok ? run(parsed.value) : Promise.resolve(err(parsed.error));

/** The seven classes sort a word by what its caller can do, which is why each falls on one status. */
const CODE_OF_CLASS = {
  unauthenticated: "UNAUTHORIZED",
  forbidden: "FORBIDDEN",
  absent: "NOT_FOUND",
  malformed: "BAD_REQUEST",
  inapplicable: "UNPROCESSABLE_CONTENT",
  conflict: "CONFLICT",
  precondition: "PRECONDITION_FAILED",
} as const satisfies Readonly<Record<RefusalClass, TRPCError["code"]>>;

const refused = (log: Logger, act: string, answered: RefusalAnswer): TRPCError => {
  const refusal = refusalOf(answered);
  log.info({ event: "trpc.refused", act, ...refusalLogged(refusal) }, "refused");
  return new TRPCError({
    code: CODE_OF_CLASS[refusal.class],
    message: refusal.word,
    cause: new RefusedError(refusal),
  });
};

const failed = (log: Logger, act: string, cause: Error): TRPCError => {
  log.error({ event: "trpc.failed", act, err: cause }, "failed");
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `${act} failed`, cause });
};

/**
 * Throws a TRPCError for a refusal or failure. A rejection is caught here, not by tRPC, so it is
 * logged once.
 */
export const crossing = async <Value>(
  ctx: { readonly log: Logger },
  act: string,
  running: Promise<Result<Value, RefusalAnswer | Error>>,
): Promise<Value> => {
  const ran = await attempt(() => running);
  const answered = ran.ok ? ran.value : ran;

  if (answered.ok) return answered.value;
  if (answered.error instanceof Error) throw failed(ctx.log, act, answered.error);
  throw refused(ctx.log, act, answered.error);
};

type InTheTransaction = {
  readonly log: Logger;
  readonly principal: UserPrincipal;
  readonly tx: Tx;
};

/**
 * Answers a procedure with one act, as the resolved member in its transaction. The act's function
 * name labels its logs; never pass an anonymous one.
 */
export const answeredBy =
  <Input, Value>(
    act: (
      principal: UserPrincipal,
      tx: Tx,
      input: Input,
    ) => Promise<Result<Value, RefusalAnswer | Error>>,
  ) =>
  ({
    ctx,
    input,
  }: {
    readonly ctx: InTheTransaction;
    readonly input: Result<Input, Malformed>;
  }): Promise<Value> =>
    crossing(
      ctx,
      act.name,
      given(input, (asked) => act(ctx.principal, ctx.tx, asked)),
    );

/** A ceiling's answer carries this as its cause, so the wire can say when to ask again. */
export class CeilingMet extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`ceiling met; ask again in ${retryAfterSeconds} seconds`);
    this.name = "CeilingMet";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const trpc = initTRPC.context<TrpcContext>().create({
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      refusal: error.cause instanceof RefusedError ? error.cause.refusal : undefined,
      retryAfterSeconds:
        error.cause instanceof CeilingMet ? error.cause.retryAfterSeconds : undefined,
    },
  }),
});

export const router = trpc.router;

const RESOLVER = "withPrincipal";

const OPERATOR_RESOLVER = "withOperator";

type Session = NonNullable<Awaited<ReturnType<SessionReader>>>;

const sessionOf = async (ctx: TrpcContext): Promise<Session> => {
  const read = await attempt(() => ctx.readSession(ctx.headers));

  if (!read.ok) throw failed(ctx.log, "readSession", read.error);
  if (read.value === null) throw refused(ctx.log, "readSession", "no-session");
  return read.value;
};

const claimsOf = async (ctx: TrpcContext): Promise<Claims> => {
  const session = await sessionOf(ctx);

  const claims = await sessionClaims(async () => session, ctx.headers);
  if (claims === undefined) throw refused(ctx.log, "sessionClaims", "no-active-workspace");
  return claims;
};

const settled = <Ran>(
  ctx: TrpcContext,
  resolver: string,
  resolved: Result<Result<Ran, RefusalAnswer>, Error>,
): Ran => {
  if (!resolved.ok) {
    // The procedure's own answer has crossed already; logging it here would say it twice.
    if (resolved.error instanceof TRPCError) throw resolved.error;
    throw failed(ctx.log, resolver, resolved.error);
  }
  if (!resolved.value.ok) throw refused(ctx.log, resolver, resolved.value.error);
  return resolved.value.value;
};

/**
 * tRPC returns a failed procedure rather than throwing it, so without the throw the transaction it
 * failed inside commits.
 */
const thrownIfFailed = <
  Ran extends { readonly ok: true } | { readonly ok: false; readonly error: Error },
>(
  ran: Ran,
): Ran => {
  if (!ran.ok) throw ran.error;
  return ran;
};

const inTheResolversTransaction = (resolve: typeof withPrincipal) =>
  trpc.procedure.use(async ({ ctx, next }) => {
    const claims = await claimsOf(ctx);

    const resolved = await attempt(() =>
      resolve(ctx.doors.postgres, claims, async (principal, tx) =>
        thrownIfFailed(await next({ ctx: { principal, tx, doors: undefined } })),
      ),
    );
    return settled(ctx, RESOLVER, resolved);
  });

export const queryProcedure = inTheResolversTransaction(withPrincipal);

export const mutationProcedure = inTheResolversTransaction(withHeldPrincipal);

/**
 * A Principal outlives the transaction that resolved it only here; never the request, and the
 * act's own door re-judges it.
 */
export const ownTransactionProcedure = trpc.procedure.use(async ({ ctx, next }) => {
  const claims = await claimsOf(ctx);

  const resolved = await attempt(() =>
    withPrincipal(ctx.doors.postgres, claims, async (principal) => principal),
  );
  if (!resolved.ok) throw failed(ctx.log, RESOLVER, resolved.error);
  if (!resolved.value.ok) throw refused(ctx.log, RESOLVER, resolved.value.error);

  return next({ ctx: { principal: resolved.value.value, doors: ctx.doors } });
});

/**
 * An act on the person themselves needs no workspace; the person is the session's, never a
 * value the request names.
 */
export const personProcedure = trpc.procedure.use(async ({ ctx, next }) => {
  const session = await sessionOf(ctx);
  return next({ ctx: { personId: session.user.id, doors: ctx.doors } });
});

/**
 * A ceiling is no refusal: time is its only remedy, so past one the call answers 429 and when to
 * ask again.
 */
export const personCeiling = (rule: CounterRule) =>
  personProcedure.use(async ({ ctx, path, next }) => {
    const counted = await attempt(() =>
      consumeIngress(
        ctx.doors.postgres,
        "person",
        `${path}:${ctx.personId}`,
        rule,
        ctx.clock.now(),
      ),
    );
    if (!counted.ok) throw failed(ctx.log, consumeIngress.name, counted.error);
    if (!counted.value.allowed) {
      const { retryAfterSeconds } = counted.value;
      ctx.log.info({ event: "trpc.throttled", act: path, retryAfterSeconds }, "throttled");
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many calls from this person; ask again in ${retryAfterSeconds} seconds.`,
        cause: new CeilingMet(retryAfterSeconds),
      });
    }
    return next();
  });

/**
 * Built from the session alone: this surface reads no bearer, so a token never becomes the
 * operator.
 */
export const operatorProcedure = trpc.procedure.use(async ({ ctx, next }) => {
  const { user, session } = await sessionOf(ctx);

  const resolved = await attempt(() =>
    withOperator(
      ctx.doors.postgres,
      // The row's own creation: the library's refresh moves only its update and expiry, so the
      // hour the operator's writes allow runs from the sign-in itself.
      { userId: user.id, issuedAt: session.createdAt },
      async (operator, tx) =>
        thrownIfFailed(await next({ ctx: { operator, tx, doors: undefined } })),
    ),
  );
  return settled(ctx, OPERATOR_RESOLVER, resolved);
});
