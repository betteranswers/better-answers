import type { Context, Hono } from "hono";
import type { Logger } from "pino";
import { z } from "zod";

import { attempt, type Clock } from "@better-answers/core/kernel";
import {
  consumeIngress,
  type CounterRule,
  type PostgresDoor,
} from "@better-answers/core/store/postgres";
import { readSecondFactor, type SecondFactorHeld } from "@better-answers/core/workspaces";
import { AUTHENTICATOR_CODE_LENGTH } from "@better-answers/schema/second-factor";

import type { EmailSender } from "../email.ts";
import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import { tooManyRequests } from "../ingress/limits.ts";
import type { Auth } from "./auth.ts";
import { sameOriginOnly } from "./same-origin.ts";

const signedIn = z
  .object({
    session: z.object({ id: z.string(), createdAt: z.coerce.date(), expiresAt: z.coerce.date() }),
    user: z.object({ id: z.string(), email: z.string() }),
  })
  .nullable()
  .catch(null);

export type SignedIn = NonNullable<z.output<typeof signedIn>>;

/** The session the headers carry, with the age a setup carries over; undefined when there is none. */
export const signedInPerson = async (
  auth: Auth,
  headers: Headers,
): Promise<SignedIn | undefined> => {
  const read = await attempt(() => auth.api.getSession({ headers }));
  return read.ok ? (signedIn.parse(read.value) ?? undefined) : undefined;
};

/** The refusals every route changing a person's own factor shares. */
export const PERSON_ROUTE_REFUSALS = {
  signedOut: { error: "not_signed_in" },
  unanswered: { error: "unanswered" },
  codeWrong: { error: "code-wrong" },
  notVerified: { error: "not-verified" },
  challengeGone: { error: "challenge-gone" },
  /** Restored by the operator: only a session that gave the restore code may set up a factor. */
  restoreCodeNeeded: { error: "restore-code-needed" },
} as const;

/** Past a route's ceiling, or while the person's tries of a code wait. */
export const tooManyTries = (retryAfterSeconds: number): Response =>
  tooManyRequests(retryAfterSeconds, "Too many tries; try again later.");

/** A body that is no JSON reads as nothing, so `schema` refuses it. */
export const parsedBody = async <Schema extends z.ZodType>(context: Context, schema: Schema) =>
  schema.safeParse(await context.req.json().catch(() => undefined));

/** The person and the session a step acts for, at the moment it asks. */
export const askedBy = (clock: Clock, person: SignedIn) => ({
  personId: person.user.id,
  sessionId: person.session.id,
  now: clock.now(),
});

/** What the person holds, with this session's own standing; undefined when it could not be read. */
export const heldBy = async (
  deps: { readonly door: PostgresDoor; readonly clock: Clock },
  person: SignedIn,
): Promise<SecondFactorHeld | undefined> => {
  const held = await readSecondFactor(IDENTITY_PRINCIPAL, deps.door, askedBy(deps.clock, person));
  return held.ok ? held.value : undefined;
};

/** Granted by a spent recovery code or an accepted restore code, to this session alone. */
export const mayReplace = (held: SecondFactorHeld): boolean =>
  held.thisSession?.setupGranted === true;

export const waitsOnTheRestoreCode = (held: SecondFactorHeld): boolean =>
  held.restoreRequired && !mayReplace(held);

/** An authenticator's code as its screen sends it. */
export const codeAsked = z.object({
  code: z.string().regex(new RegExp(`^\\d{${String(AUTHENTICATOR_CODE_LENGTH)}}$`)),
});

/** A person who held codes keeps them through a setup, so none are made or answered. */
export const finishedWith = (
  issued: { readonly recoveryCodes: readonly string[]; readonly madeAt: string } | undefined,
) =>
  issued === undefined
    ? { recoveryCodes: null }
    : { recoveryCodes: issued.recoveryCodes, madeAt: issued.madeAt };

type Step = (context: Context, person: SignedIn) => Promise<Response>;

type PersonRoutes = {
  readonly auth: Auth;
  readonly door: PostgresDoor;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly publicUrl: string;
};

/** What a mount of factor routes needs: the person's routes, and a way to send their notices. */
export type FactorRoutesDependencies = PersonRoutes & { readonly sendEmail: EmailSender };

/**
 * Routes changing a person's own factor: refused from another site, never cached, each step
 * reached by a signed-in person alone and counted per person.
 */
export const personRoutesAt = (routes: Hono, prefix: string, deps: PersonRoutes) => {
  routes.use(prefix, sameOriginOnly(deps.publicUrl));
  routes.use(prefix, async (context, next) => {
    await next();
    context.res.headers.set("cache-control", "no-store");
  });
  const log = deps.logger.child({ module: "auth" });

  return {
    /** Each counter counts apart, across every session the person holds. */
    asThePerson:
      (counter: string, rule: CounterRule, step: Step) =>
      async (context: Context): Promise<Response> => {
        const person = await signedInPerson(deps.auth, context.req.raw.headers);
        if (person === undefined) return context.json(PERSON_ROUTE_REFUSALS.signedOut, 401);
        const counted = await consumeIngress(
          deps.door,
          "person",
          `${counter}:${person.user.id}`,
          rule,
          deps.clock.now(),
        );
        if (!counted.allowed) return tooManyTries(counted.retryAfterSeconds);
        return step(context, person);
      },

    /** The step may have landed, so the page reads again rather than starting over. */
    unanswered: (context: Context, event: string, reason: string): Response => {
      log.warn({ event, reason }, "a second-factor step went unanswered");
      return context.json(PERSON_ROUTE_REFUSALS.unanswered, 502);
    },

    log,
  };
};
