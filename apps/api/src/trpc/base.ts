import { initTRPC, TRPCError, type TRPCProcedureType } from "@trpc/server";
import type { Logger } from "pino";
import type { z } from "zod";

import {
  attempt,
  attemptResult,
  CeilingMet,
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
  folded,
  withHeldPrincipal,
  withMember,
  withOperator,
  withOperatorRead,
  withPrincipal,
  withPrincipalRead,
  type CounterRule,
  type Folded,
  type Tx,
} from "@better-answers/core/store/postgres";
import {
  ANSWERING_WORKSPACE_HEADER,
  TAB_WORKSPACE_HEADER,
} from "@better-answers/schema/tab-workspace";

import type { ModelDoors } from "../ask/ask-steps.ts";
import { sessionClaims } from "../auth/verify.ts";
import type { Doors } from "../doors.ts";
import type { Mail } from "../email/email.ts";
import { refusalLogged, refusalOf, RefusedError, type RefusalAnswer } from "../refusal.ts";
import { type GatedSessionReader, PENDING_PROCEDURES, refusalFor } from "../second-factor-gate.ts";

type TrpcContext = {
  readonly doors: Doors;
  readonly modelDoors: ModelDoors;
  readonly askKeepAliveMs: number;
  readonly clock: Clock;
  readonly readSession: GatedSessionReader;
  readonly headers: Headers;
  readonly resHeaders: Headers;
  readonly log: Logger;
  readonly mail: Mail;
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

const CODE_OF_CLASS = {
  unauthenticated: "UNAUTHORIZED",
  forbidden: "FORBIDDEN",
  absent: "NOT_FOUND",
  malformed: "BAD_REQUEST",
  inapplicable: "UNPROCESSABLE_CONTENT",
  conflict: "CONFLICT",
  precondition: "PRECONDITION_FAILED",
} as const satisfies Readonly<Record<RefusalClass, TRPCError["code"]>>;

const refused = (log: Logger, action: string, answered: RefusalAnswer): TRPCError => {
  const refusal = refusalOf(answered);
  log.info({ event: "trpc.refused", action, ...refusalLogged(refusal) }, "refused");
  return new TRPCError({
    code: CODE_OF_CLASS[refusal.class],
    message: refusal.word,
    cause: new RefusedError(refusal),
  });
};

const failed = (log: Logger, action: string, cause: Error): TRPCError => {
  log.error({ event: "trpc.failed", action, err: cause }, "failed");
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `${action} failed`, cause });
};

const throttled = (log: Logger, action: string, met: CeilingMet): TRPCError => {
  const { retryAfterSeconds } = met;
  log.info({ event: "trpc.throttled", action, retryAfterSeconds }, "throttled");
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `Too many calls; ask again in ${retryAfterSeconds} seconds.`,
    cause: met,
  });
};

export const crossing = async <Value>(
  ctx: { readonly log: Logger },
  action: string,
  running: Promise<Result<Value, RefusalAnswer | Error>>,
): Promise<Value> => {
  const answered = await attemptResult(() => running);

  if (answered.ok) return answered.value;
  if (answered.error instanceof CeilingMet) throw throttled(ctx.log, action, answered.error);
  if (answered.error instanceof Error) throw failed(ctx.log, action, answered.error);
  throw refused(ctx.log, action, answered.error);
};

type InTheTransaction = {
  readonly log: Logger;
  readonly principal: UserPrincipal;
  readonly tx: Tx;
};

export const answeredBy =
  <Input, Value>(
    action: (
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
      action.name,
      given(input, (asked) => action(ctx.principal, ctx.tx, asked)),
    );

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

type Session = NonNullable<Awaited<ReturnType<GatedSessionReader>>>;

const sessionOf = async (ctx: TrpcContext, path: string): Promise<Session> => {
  const read = await attempt(() => ctx.readSession(ctx.headers));

  if (!read.ok) throw failed(ctx.log, "readSession", read.error);
  if (read.value === null) throw refused(ctx.log, "readSession", "no-session");
  const pending = refusalFor(read.value.standing, PENDING_PROCEDURES.get(path));
  if (pending !== undefined) throw refused(ctx.log, path, pending);
  return read.value;
};

const claimsOf = async (ctx: TrpcContext, path: string): Promise<Claims> => {
  const session = await sessionOf(ctx, path);

  const claims = await sessionClaims(async () => session, ctx.headers);
  if (claims === undefined) throw refused(ctx.log, "sessionClaims", "no-active-workspace");
  return claims;
};

const MEMBER_READ = "session.member";

const leftBehind = (
  held: string | null,
  claims: Claims,
  path: string,
  type: TRPCProcedureType,
): "workspace-switched" | "workspace-unnamed" | undefined => {
  if (type === "mutation" && held === null) return "workspace-unnamed";
  if (type !== "mutation" && (path === MEMBER_READ || held === null)) return undefined;
  return held === claims.workspaceId ? undefined : "workspace-switched";
};

const claimsInTheTabsWorkspace = async (
  ctx: TrpcContext,
  path: string,
  type: TRPCProcedureType,
): Promise<Claims> => {
  const claims = await claimsOf(ctx, path);

  const left = leftBehind(ctx.headers.get(TAB_WORKSPACE_HEADER), claims, path, type);
  if (left !== undefined) throw refused(ctx.log, path, left);
  ctx.resHeaders.set(ANSWERING_WORKSPACE_HEADER, claims.workspaceId);
  return claims;
};

const settled = <Ran>(
  ctx: TrpcContext,
  resolver: string,
  resolved: Result<Result<Ran, RefusalAnswer>>,
): Ran => {
  if (!resolved.ok) {
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

const consumeCeiling = async (
  ctx: Pick<TrpcContext, "doors" | "clock" | "log">,
  path: string,
  key: string,
  rule: CounterRule,
): Promise<void> => {
  const outcome = await attempt(() =>
    consumeIngress(ctx.doors.postgres, "person", key, rule, ctx.clock.now()),
  );
  if (!outcome.ok) throw failed(ctx.log, consumeIngress.name, outcome.error);
  if (!outcome.value.allowed) {
    throw throttled(ctx.log, path, new CeilingMet(outcome.value.retryAfterSeconds));
  }
};

export type RoadCeiling = { readonly budget: string; readonly rule: CounterRule };

const claimsCounted = async (
  ctx: TrpcContext,
  path: string,
  type: TRPCProcedureType,
  ceiling: RoadCeiling | undefined,
): Promise<Claims> => {
  const claims = await claimsInTheTabsWorkspace(ctx, path, type);
  if (ceiling !== undefined) {
    await consumeCeiling(ctx, path, `${ceiling.budget}:${claims.userId}`, ceiling.rule);
  }
  return claims;
};

const inTheResolversTransaction = (resolve: typeof withPrincipal, ceiling?: RoadCeiling) =>
  trpc.procedure.use(async ({ ctx, path, type, next }) => {
    const claims = await claimsCounted(ctx, path, type, ceiling);

    const resolved = await attempt(() =>
      resolve(ctx.doors.postgres, claims, async (principal, tx) =>
        thrownIfFailed(
          await next({ ctx: { principal, tx, doors: undefined, modelDoors: undefined } }),
        ),
      ),
    );
    return settled(ctx, RESOLVER, resolved);
  });

export const queryProcedure = inTheResolversTransaction(withPrincipalRead);

export const queryCeiling = (ceiling: RoadCeiling) =>
  inTheResolversTransaction(withPrincipalRead, ceiling);

export const mutationProcedure = inTheResolversTransaction(withHeldPrincipal);

const onItsOwnTransactions = (ceiling?: RoadCeiling) =>
  trpc.procedure.use(async ({ ctx, path, type, next }) => {
    const claims = await claimsCounted(ctx, path, type, ceiling);

    const resolved = await attempt(() =>
      withPrincipal(ctx.doors.postgres, claims, async (principal) => principal),
    );
    if (!resolved.ok) throw failed(ctx.log, RESOLVER, resolved.error);
    if (!resolved.value.ok) throw refused(ctx.log, RESOLVER, resolved.value.error);

    return next({ ctx: { principal: resolved.value.value, doors: ctx.doors } });
  });

export type AskingContext = TrpcContext & { readonly principal: UserPrincipal };

export const ownTransactionProcedure = onItsOwnTransactions();

export const ownTransactionCounted = (ceiling: RoadCeiling) => onItsOwnTransactions(ceiling);

export const committedAs = async <Value, Refused>(
  ctx: { readonly principal: UserPrincipal; readonly doors: Doors },
  action: (principal: UserPrincipal, tx: Tx) => Promise<Result<Value, Refused>>,
): Promise<Folded<Result<Value, Refused>>> =>
  folded<Result<Value, Refused>>(await withMember(ctx.principal, ctx.doors.postgres, action));

export const personProcedure = trpc.procedure.use(async ({ ctx, path, next }) => {
  const { user, session } = await sessionOf(ctx, path);
  return next({
    ctx: {
      personId: user.id,
      email: user.email,
      sessionId: session.id,
      issuedAt: session.createdAt,
      doors: ctx.doors,
    },
  });
});

export const personCeiling = (rule: CounterRule) =>
  personProcedure.use(async ({ ctx, path, next }) => {
    await consumeCeiling(ctx, path, `${path}:${ctx.personId}`, rule);
    return next();
  });

export const ownTransactionCeiling = (rule: CounterRule) =>
  ownTransactionProcedure.use(async ({ ctx, path, next }) => {
    await consumeCeiling(ctx, path, `${path}:${ctx.principal.userId}`, rule);
    return next();
  });

const inTheOperatorsTransaction = (resolve: typeof withOperator) =>
  trpc.procedure.use(async ({ ctx, path, next }) => {
    const { user, session } = await sessionOf(ctx, path);

    const resolved = await attempt(() =>
      resolve(
        ctx.doors.postgres,
        { userId: user.id, issuedAt: session.createdAt, sessionId: session.id },
        async (operator, tx) =>
          thrownIfFailed(
            await next({ ctx: { operator, tx, doors: undefined, modelDoors: undefined } }),
          ),
      ),
    );
    return settled(ctx, OPERATOR_RESOLVER, resolved);
  });

export const operatorQueryProcedure = inTheOperatorsTransaction(withOperatorRead);

export const operatorMutationProcedure = inTheOperatorsTransaction(withOperator);
