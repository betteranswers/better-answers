import { APIError } from "better-auth/api";
import type { Context, Hono, MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import { z } from "zod";

import { attempt, type Clock } from "@better-answers/core/kernel";
import { consumeIngress, type PostgresDoor } from "@better-answers/core/store/postgres";
import {
  applyPasskeyNameRule,
  hasNoDisplayName,
  recordPasskeyAdded,
} from "@better-answers/core/workspaces";

import type { EmailSender } from "../email.ts";
import { sendFactorNotice } from "../factor-notice-email.ts";
import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import { clientIpOf, tooManyRequests } from "../ingress/limits.ts";
import { type Auth, USER_NOT_VERIFIED } from "./auth.ts";
import { finishedWith } from "./authenticator.ts";
import {
  PASSKEY_ADD_OPTIONS_PATH,
  PASSKEY_ADD_PATH,
  PASSKEY_PERSON_RULE,
  PASSKEY_SIGN_IN_IP_RULE,
  PASSKEY_SIGN_IN_OPTIONS_PATH,
  PASSKEY_SIGN_IN_PATH,
} from "./constants.ts";
import { personRoutesAt, type SignedIn } from "./person-routes.ts";

type PasskeysDependencies = {
  readonly auth: Auth;
  readonly door: PostgresDoor;
  readonly publicUrl: string;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly sendEmail: EmailSender;
};

const REFUSALS = {
  malformed: { error: "malformed" },
  notVerified: { error: "not-verified" },
  challengeGone: { error: "challenge-gone" },
  unknown: { error: "passkey-unknown" },
  refused: { error: "passkey-refused" },
  unanswered: { error: "unanswered" },
} as const;

type Refused = { readonly body: { readonly error: string }; readonly status: 400 | 401 };

/** What the library's refusal of a ceremony means to the person, by the code it carries. */
const REFUSED_AS: ReadonlyMap<string, Refused> = new Map([
  [USER_NOT_VERIFIED, { body: REFUSALS.notVerified, status: 400 }],
  ["CHALLENGE_NOT_FOUND", { body: REFUSALS.challengeGone, status: 400 }],
  ["PASSKEY_NOT_FOUND", { body: REFUSALS.unknown, status: 401 }],
  ["AUTHENTICATION_FAILED", { body: REFUSALS.refused, status: 400 }],
  ["FAILED_TO_VERIFY_REGISTRATION", { body: REFUSALS.refused, status: 400 }],
]);

const codeOf = z.object({ code: z.string() }).catch({ code: "" });

/** A server failure carries a refusal's code too, so only a 4xx is the person's to hear. */
const refusalOf = (failure: Error): Refused | undefined =>
  failure instanceof APIError && failure.statusCode < 500
    ? REFUSED_AS.get(codeOf.parse(failure.body).code)
    : undefined;

const naming = z.object({ name: z.string() });

const added = naming.extend({ response: z.record(z.string(), z.unknown()) });

type Assertion = NonNullable<
  Parameters<Auth["api"]["verifyPasskeyAuthentication"]>[0]
>["body"]["response"];

/** The shape the browser's assertion takes; the library verifies every value in it. */
const assertionShape = z.object({
  id: z.string(),
  rawId: z.string(),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string(),
    authenticatorData: z.string(),
    signature: z.string(),
  }),
  clientExtensionResults: z.object({}),
});

const presented = z.object({
  response: z.custom<Assertion>((value) => assertionShape.safeParse(value).success),
});

const kept = z.object({ id: z.string() });

const signedInAs = z.object({ user: z.object({ name: z.string() }) });

/** The name under the rule, trimmed, or the refusal to answer with. */
const judged = (context: Context, name: string) => {
  const ruled = applyPasskeyNameRule(name);
  return ruled.ok
    ? { name: ruled.value, refused: undefined }
    : { name: "", refused: context.json({ error: ruled.error }, 400) };
};

/**
 * Each route calls a closed library endpoint as a server function, so it brings what the router
 * would: a rate rule and the same-origin fence.
 */
export const mountThePasskeys = (routes: Hono, deps: PasskeysDependencies): void => {
  const { auth, door, clock } = deps;
  const fenced = personRoutesAt(routes, "/passkeys/*", deps);
  const { log } = fenced;
  const mail = { send: deps.sendEmail, publicUrl: deps.publicUrl };

  const unanswered = (context: Context, reason: string): Response =>
    fenced.unanswered(context, "auth.passkey_failed", reason);

  const refusedBy = (context: Context, failure: Error): Response => {
    const refused = refusalOf(failure);
    return refused === undefined
      ? unanswered(context, failure.message)
      : context.json(refused.body, refused.status);
  };

  /** Hands the browser what the library set: the challenge's cookie, or a new session's. */
  const forward = (context: Context, headers: Headers): void => {
    for (const cookie of headers.getSetCookie())
      context.header("set-cookie", cookie, { append: true });
  };

  /** The name is judged before the device is asked, so a refused one leaves no passkey on it. */
  const askToAdd = async (context: Context): Promise<Response> => {
    const named = naming.safeParse(await context.req.json().catch(() => undefined));
    if (!named.success) return context.json(REFUSALS.malformed, 400);
    const { refused } = judged(context, named.data.name);
    if (refused !== undefined) return refused;
    const asked = await attempt(() =>
      auth.api.generatePasskeyRegistrationOptions({
        headers: context.req.raw.headers,
        returnHeaders: true,
      }),
    );
    if (!asked.ok) return unanswered(context, asked.error.message);
    forward(context, asked.value.headers);
    return context.json(asked.value.response);
  };

  /** The library has kept the passkey, so its notice goes whether or not the record lands. */
  const settle = async (context: Context, person: SignedIn, passkeyId: string) => {
    void sendFactorNotice({ mail, log }, person.user.email, "passkey-added");
    const recorded = await recordPasskeyAdded(IDENTITY_PRINCIPAL, door, {
      personId: person.user.id,
      passkeyId,
      sessionId: person.session.id,
      at: clock.now(),
      carried: { createdAt: person.session.createdAt, expiresAt: person.session.expiresAt },
    });
    if (!recorded.ok) {
      log.error(
        { event: "auth.passkey_not_recorded", principal: person.user.id },
        "a passkey was added but not recorded",
      );
      return context.json(REFUSALS.unanswered, 502);
    }
    return context.json({ passkeyId, ...finishedWith(recorded.value.issued) });
  };

  const add = async (context: Context, person: SignedIn): Promise<Response> => {
    const asked = added.safeParse(await context.req.json().catch(() => undefined));
    if (!asked.success) return context.json(REFUSALS.malformed, 400);
    const { name, refused } = judged(context, asked.data.name);
    if (refused !== undefined) return refused;
    const verified = await attempt(() =>
      auth.api.verifyPasskeyRegistration({
        headers: context.req.raw.headers,
        body: { response: asked.data.response, name },
        returnHeaders: true,
      }),
    );
    if (!verified.ok) return refusedBy(context, verified.error);
    forward(context, verified.value.headers);
    return settle(context, person, kept.parse(verified.value.response).id);
  };

  /**
   * No cookie goes in, since a standing session narrows the ask to its own passkeys. The library
   * only prefers user verification; ours requires it.
   */
  const askToSignIn = async (context: Context): Promise<Response> => {
    const asked = await attempt(() =>
      auth.api.generatePasskeyAuthenticationOptions({
        headers: new Headers(),
        returnHeaders: true,
      }),
    );
    if (!asked.ok) return unanswered(context, asked.error.message);
    forward(context, asked.value.headers);
    return context.json({ ...asked.value.response, userVerification: "required" });
  };

  const signIn = async (context: Context): Promise<Response> => {
    const asked = presented.safeParse(await context.req.json().catch(() => undefined));
    if (!asked.success) return context.json(REFUSALS.malformed, 400);
    const verified = await attempt(() =>
      auth.api.verifyPasskeyAuthentication({
        headers: context.req.raw.headers,
        body: { response: asked.data.response },
        returnHeaders: true,
      }),
    );
    if (!verified.ok) return refusedBy(context, verified.error);
    forward(context, verified.value.headers);
    const { user } = signedInAs.parse(verified.value.response);
    return context.json({ displayNameGiven: !hasNoDisplayName(user.name) });
  };

  /** Counted apart from the address's other routes, so the screen's ask on opening spends no link's. */
  const limitByAddress: MiddlewareHandler = async (context, next) => {
    const counted = await consumeIngress(
      door,
      "ip",
      `passkey-sign-in:${clientIpOf(context.req.raw.headers)}`,
      PASSKEY_SIGN_IN_IP_RULE,
      clock.now(),
    );
    if (!counted.allowed) {
      return tooManyRequests(
        counted.retryAfterSeconds,
        "Too many passkey sign-ins from this address; try again shortly.",
      );
    }
    await next();
  };

  routes.use(PASSKEY_SIGN_IN_OPTIONS_PATH, limitByAddress);
  routes.use(PASSKEY_SIGN_IN_PATH, limitByAddress);
  /** Asks and adds count apart. */
  routes.post(
    PASSKEY_ADD_OPTIONS_PATH,
    fenced.asThePerson("passkey-ask", PASSKEY_PERSON_RULE, askToAdd),
  );
  routes.post(PASSKEY_ADD_PATH, fenced.asThePerson("passkey-add", PASSKEY_PERSON_RULE, add));
  routes.post(PASSKEY_SIGN_IN_OPTIONS_PATH, askToSignIn);
  routes.post(PASSKEY_SIGN_IN_PATH, signIn);
};
