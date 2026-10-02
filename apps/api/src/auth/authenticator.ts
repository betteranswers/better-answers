import { APIError } from "better-auth/api";
import type { Context, Hono } from "hono";
import type { Logger } from "pino";
import { z } from "zod";

import { attempt, type Clock } from "@better-answers/core/kernel";
import { consumeIngress, type PostgresDoor } from "@better-answers/core/store/postgres";
import { readSecondFactor, recordAuthenticatorSetUp } from "@better-answers/core/workspaces";
import { AUTHENTICATOR_CODE_LENGTH } from "@better-answers/schema/second-factor";

import type { EmailSender } from "../email.ts";
import { sendFactorNotice } from "../factor-notice-email.ts";
import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import { tooManyRequests } from "../ingress/limits.ts";
import type { Auth } from "./auth.ts";
import {
  AUTHENTICATOR_FINISH_PATH,
  AUTHENTICATOR_PERSON_RULE,
  AUTHENTICATOR_START_PATH,
} from "./constants.ts";
import { sameOriginOnly } from "./same-origin.ts";

type AuthenticatorDependencies = {
  readonly auth: Auth;
  readonly door: PostgresDoor;
  readonly publicUrl: string;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly sendEmail: EmailSender;
};

const REFUSALS = {
  signedOut: { error: "not_signed_in" },
  held: { error: "authenticator-held" },
  noSetupWaiting: { error: "no-setup-waiting" },
  codeWrong: { error: "code-wrong" },
  unanswered: { error: "unanswered" },
} as const;

const signedIn = z
  .object({
    session: z.object({ id: z.string(), createdAt: z.coerce.date(), expiresAt: z.coerce.date() }),
    user: z.object({ id: z.string(), email: z.string() }),
  })
  .nullable()
  .catch(null);

type SignedIn = NonNullable<z.output<typeof signedIn>>;

const setUpAnswer = z.object({ totpURI: z.string() });

const codeAsked = z.object({
  code: z.string().regex(new RegExp(`^\\d{${String(AUTHENTICATOR_CODE_LENGTH)}}$`)),
});

/** A name and value alone, as a `cookie` header carries each `Set-Cookie` line. */
const cookieOf = (setCookies: readonly string[]): string =>
  setCookies.map((line) => line.split(";", 1)[0] ?? "").join("; ");

/**
 * The library's first verify swaps the session, yet its answer names the old one: the stamp goes
 * to the session the new cookie holds.
 */
export const mountTheAuthenticator = (routes: Hono, deps: AuthenticatorDependencies): void => {
  const { auth, door, clock } = deps;
  const log = deps.logger.child({ module: "auth" });
  const mail = { send: deps.sendEmail, publicUrl: deps.publicUrl };

  const sessionOf = async (headers: Headers): Promise<SignedIn | undefined> => {
    const read = await attempt(() => auth.api.getSession({ headers }));
    return read.ok ? (signedIn.parse(read.value) ?? undefined) : undefined;
  };

  /** Starts and codes count apart, per person, across every session they hold. */
  const ceilingOf = async (route: "start" | "finish", personId: string) => {
    const counted = await consumeIngress(
      door,
      "person",
      `authenticator-${route}:${personId}`,
      AUTHENTICATOR_PERSON_RULE,
      clock.now(),
    );
    if (counted.allowed) return undefined;
    return tooManyRequests(counted.retryAfterSeconds, "Too many tries; try again later.");
  };

  const unanswered = (context: Context, reason: string): Response => {
    log.warn(
      { event: "auth.authenticator_failed", reason },
      "an authenticator step went unanswered",
    );
    return context.json(REFUSALS.unanswered, 502);
  };

  const stateOf = async (personId: string) => {
    const held = await readSecondFactor(IDENTITY_PRINCIPAL, door, { personId });
    return held.ok ? held.value.authenticator : undefined;
  };

  const start = async (context: Context, person: SignedIn): Promise<Response> => {
    const state = await stateOf(person.user.id);
    if (state === undefined) return unanswered(context, "the second factor was not read");
    if (state === "set-up") return context.json(REFUSALS.held, 409);
    const started = await attempt(() =>
      auth.api.enableTwoFactor({ headers: context.req.raw.headers, body: { method: "totp" } }),
    );
    if (!started.ok) return unanswered(context, started.error.message);
    // The library's own code set is dropped here: recovery codes are ours.
    return context.json({ setupAddress: setUpAnswer.parse(started.value).totpURI });
  };

  const sessionAfter = async (setCookies: readonly string[]): Promise<string | undefined> => {
    if (setCookies.length === 0) return undefined;
    return (await sessionOf(new Headers({ cookie: cookieOf(setCookies) })))?.session.id;
  };

  const record = async (person: SignedIn, sessionId: string) => {
    const recorded = await recordAuthenticatorSetUp(IDENTITY_PRINCIPAL, door, {
      personId: person.user.id,
      sessionId,
      at: clock.now(),
      carried: { createdAt: person.session.createdAt, expiresAt: person.session.expiresAt },
    });
    if (!recorded.ok) {
      log.error(
        { event: "auth.authenticator_not_recorded", principal: person.user.id },
        "an authenticator was set up but not recorded",
      );
      return { stamped: false, recoveryCodes: undefined };
    }
    if (!recorded.value.stamped) {
      log.warn(
        { event: "auth.authenticator_not_stamped", principal: person.user.id },
        "an authenticator was set up but its session was gone",
      );
    }
    return recorded.value;
  };

  const settle = async (context: Context, person: SignedIn, setCookies: readonly string[]) => {
    const swapped = await sessionAfter(setCookies);
    const { stamped, recoveryCodes } = await record(person, swapped ?? person.session.id);
    // The browser gets the new cookie only once its session carries the old one's age; otherwise
    // the old cookie, now void, signs it out.
    if (stamped && swapped !== undefined) {
      for (const cookie of setCookies) context.header("set-cookie", cookie, { append: true });
    }
    await sendFactorNotice({ mail, log }, person.user.email, "authenticator-added");
    return context.json({ recoveryCodes: recoveryCodes ?? null });
  };

  const verify = async (context: Context, person: SignedIn, code: string) => {
    const verified = await attempt(() =>
      auth.api.verifyTOTP({
        headers: context.req.raw.headers,
        body: { code },
        returnHeaders: true,
      }),
    );
    if (verified.ok) return settle(context, person, verified.value.headers.getSetCookie());
    if (verified.error instanceof APIError && verified.error.statusCode === 401) {
      return context.json(REFUSALS.codeWrong, 400);
    }
    return unanswered(context, verified.error.message);
  };

  const finish = async (context: Context, person: SignedIn): Promise<Response> => {
    const asked = codeAsked.safeParse(await context.req.json().catch(() => undefined));
    if (!asked.success) return context.json(REFUSALS.codeWrong, 400);
    const state = await stateOf(person.user.id);
    if (state === undefined) return unanswered(context, "the second factor was not read");
    // Past setup the library checks a code with no count of tries, so no route may reach it.
    if (state !== "awaiting-code") return context.json(REFUSALS.noSetupWaiting, 409);
    return verify(context, person, asked.data.code);
  };

  const asThePerson =
    (route: "start" | "finish", step: (context: Context, person: SignedIn) => Promise<Response>) =>
    async (context: Context): Promise<Response> => {
      const person = await sessionOf(context.req.raw.headers);
      if (person === undefined) return context.json(REFUSALS.signedOut, 401);
      const limited = await ceilingOf(route, person.user.id);
      return limited ?? step(context, person);
    };

  routes.use("/authenticator/*", sameOriginOnly(deps.publicUrl));
  routes.use("/authenticator/*", async (context, next) => {
    await next();
    context.res.headers.set("cache-control", "no-store");
  });
  routes.post(AUTHENTICATOR_START_PATH, asThePerson("start", start));
  routes.post(AUTHENTICATOR_FINISH_PATH, asThePerson("finish", finish));
};
