import { base64 } from "@better-auth/utils/base64";
import { createOTP } from "@better-auth/utils/otp";
import {
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { APIError } from "better-auth/api";
import { generateRandomString, symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { attempt, CeilingMet } from "@better-answers/core/kernel";
import {
  acceptRestoreCode,
  confirmByAuthenticator,
  confirmByPasskey,
  countFailedConfirm,
  keepPasskeyChallenge,
  parkAuthenticatorSecret,
  readConfirmWait,
  readParkedAuthenticatorSecret,
  readPasskeyCredentials,
  replaceFactorsByAuthenticator,
  spendRecoveryCode,
  takePasskeyChallenge,
} from "@better-answers/core/workspaces";
import { AUTHENTICATOR_CODE_LENGTH } from "@better-answers/schema/second-factor";

import { type FactorChange, sendFactorNotice } from "../factor-notice-email.ts";
import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import { PRODUCT_NAME } from "../product-name.ts";
import { passkeyPartyOf } from "./auth.ts";
import {
  AUTHENTICATOR_PERSON_RULE,
  AUTHENTICATOR_STEP_SECONDS,
  CONFIRM_AUTHENTICATOR_PATH,
  CONFIRM_PASSKEY_OPTIONS_PATH,
  CONFIRM_PASSKEY_PATH,
  CONFIRM_PERSON_RULE,
  RECOVERY_CODE_PATH,
  REPLACE_AUTHENTICATOR_FINISH_PATH,
  REPLACE_AUTHENTICATOR_START_PATH,
  RESTORE_CODE_PATH,
  SPEND_A_CODE_PERSON_RULE,
} from "./constants.ts";
import { presented } from "./passkeys.ts";
import {
  askedBy,
  codeAsked,
  finishedWith,
  heldBy,
  mayReplace,
  parsedBody,
  PERSON_ROUTE_REFUSALS,
  type FactorRoutesDependencies,
  personRoutesAt,
  type SignedIn,
  tooManyTries,
} from "./person-routes.ts";

const REFUSALS = {
  noPasskey: { error: "no-passkey" },
  passkeyNotYours: { error: "passkey-not-yours" },
  noAuthenticator: { error: "no-authenticator" },
  recoveryCodeWrong: { error: "recovery-code-wrong" },
  restoreCodeWrong: { error: "restore-code-wrong" },
  setupNotGranted: { error: "setup-not-granted" },
  changedMeanwhile: { error: "changed-meanwhile" },
} as const;

/** The plugin's own, so its verify accepts a key set up here. */
const OTP_SETTINGS = { digits: AUTHENTICATOR_CODE_LENGTH, period: AUTHENTICATOR_STEP_SECONDS };

/** The plugin's own length for a new key. */
const SECRET_LENGTH = 32;

/** As typed: spaces, dashes and case are the store's to ignore. */
const typedCode = z.object({ code: z.string().min(1).max(100) });

const TRANSPORTS = [
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
] as const satisfies readonly AuthenticatorTransportFuture[];

const transport = z.enum(TRANSPORTS);

/** The library keeps them comma-separated, and a device's own word may be one this list lacks. */
const transportsOf = (kept: string | null): AuthenticatorTransportFuture[] =>
  (kept ?? "").split(",").flatMap((named) => {
    const parsed = transport.safeParse(named);
    return parsed.success ? [parsed.data] : [];
  });

type Credential = {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly counter: number;
};

type Answer = {
  readonly response: z.output<typeof presented>["response"];
  readonly challenge: string;
  readonly credential: Credential;
};

type SpendsACode = typeof spendRecoveryCode | typeof acceptRestoreCode;

/**
 * Confirm, recovery and the replacement setup they lead to. None makes a session: each stamps
 * or grants the one the person already holds.
 */
export const mountTheConfirm = (routes: Hono, deps: FactorRoutesDependencies): void => {
  const { auth, door, clock } = deps;
  const fenced = personRoutesAt(routes, "/second-factor/*", deps);
  const { log } = fenced;
  const mail = { send: deps.sendEmail, publicUrl: deps.publicUrl };
  const party = passkeyPartyOf(deps.publicUrl);

  const unanswered = (context: Context, reason: string): Response =>
    fenced.unanswered(context, "auth.confirm_failed", reason);

  /** A refusal no screen can act on reads as unanswered; a lost session as signed out. */
  const refused = (context: Context, why: string | Error): Response => {
    if (why instanceof CeilingMet) return tooManyTries(why.retryAfterSeconds);
    if (why === "person-gone" || why === "session-gone") {
      return context.json(PERSON_ROUTE_REFUSALS.signedOut, 401);
    }
    return unanswered(context, why instanceof Error ? why.message : why);
  };

  /** Never awaited, so a slow relay holds no answer. */
  const notify = (person: SignedIn, change: FactorChange): void => {
    void sendFactorNotice({ mail, log }, person.user.email, change);
  };

  const secretConfig = async () => (await auth.$context).secretConfig;

  const askToConfirm = async (context: Context, person: SignedIn): Promise<Response> => {
    const held = await readPasskeyCredentials(IDENTITY_PRINCIPAL, door, askedBy(clock, person));
    if (!held.ok) return refused(context, held.error);
    if (held.value.length === 0) return context.json(REFUSALS.noPasskey, 409);
    const options = await attempt(() =>
      generateAuthenticationOptions({
        rpID: party.rpID,
        userVerification: "required",
        allowCredentials: held.value.map((credential) => ({
          id: credential.credentialId,
          transports: transportsOf(credential.transports),
        })),
      }),
    );
    if (!options.ok) return unanswered(context, options.error.message);
    const kept = await keepPasskeyChallenge(IDENTITY_PRINCIPAL, door, {
      ...askedBy(clock, person),
      challenge: options.value.challenge,
    });
    return kept.ok ? context.json(options.value) : refused(context, kept.error);
  };

  /** Our own check of the answer, since the library's verify would make a new session. */
  const verifyingTheAnswer = async (context: Context, person: SignedIn, answer: Answer) => {
    const verified = await attempt(() =>
      verifyAuthenticationResponse({
        response: answer.response,
        expectedChallenge: answer.challenge,
        expectedOrigin: party.origin,
        expectedRPID: party.rpID,
        credential: {
          id: answer.credential.credentialId,
          publicKey: new Uint8Array(base64.decode(answer.credential.publicKey)),
          counter: answer.credential.counter,
        },
        requireUserVerification: true,
      }),
    );
    // A bad signature throws, and an unverified user may only be reported: either refuses alike.
    const info = verified.ok && verified.value.verified ? verified.value.authenticationInfo : null;
    if (info?.userVerified !== true) return context.json(PERSON_ROUTE_REFUSALS.notVerified, 400);
    const stamped = await confirmByPasskey(IDENTITY_PRINCIPAL, door, {
      ...askedBy(clock, person),
      credentialId: answer.credential.credentialId,
      counter: info.newCounter,
    });
    if (stamped.ok) return context.json({ confirmed: true });
    return stamped.error === "passkey-not-yours"
      ? context.json(REFUSALS.passkeyNotYours, 400)
      : refused(context, stamped.error);
  };

  const confirmWithAPasskey = async (context: Context, person: SignedIn): Promise<Response> => {
    const answered = await parsedBody(context, presented);
    if (!answered.success) return context.json(PERSON_ROUTE_REFUSALS.notVerified, 400);
    const challenge = await takePasskeyChallenge(IDENTITY_PRINCIPAL, door, askedBy(clock, person));
    if (!challenge.ok) return refused(context, challenge.error);
    if (challenge.value === undefined) {
      return context.json(PERSON_ROUTE_REFUSALS.challengeGone, 400);
    }
    const held = await readPasskeyCredentials(IDENTITY_PRINCIPAL, door, askedBy(clock, person));
    if (!held.ok) return refused(context, held.error);
    const { response } = answered.data;
    const credential = held.value.find((each) => each.credentialId === response.id);
    if (credential === undefined) return context.json(REFUSALS.passkeyNotYours, 400);
    return verifyingTheAnswer(context, person, {
      response,
      challenge: challenge.value,
      credential,
    });
  };

  const confirmed = async (context: Context, person: SignedIn): Promise<Response> => {
    const stamped = await confirmByAuthenticator(IDENTITY_PRINCIPAL, door, askedBy(clock, person));
    if (stamped.ok) return context.json({ confirmed: true });
    return stamped.error === "no-authenticator"
      ? context.json(REFUSALS.noAuthenticator, 409)
      : refused(context, stamped.error);
  };

  const failed = async (context: Context, person: SignedIn): Promise<Response> => {
    const counted = await countFailedConfirm(IDENTITY_PRINCIPAL, door, {
      ...askedBy(clock, person),
      kind: "authenticator",
    });
    if (!counted.ok) return refused(context, counted.error);
    if (counted.value.noticeDue) notify(person, "confirm-failures");
    return context.json(PERSON_ROUTE_REFUSALS.codeWrong, 400);
  };

  /** With a whole session and a set-up authenticator, the library's verify only checks the code. */
  const verifyingTheCode = async (context: Context, person: SignedIn, code: string) => {
    const verified = await attempt(() =>
      auth.api.verifyTOTP({ headers: context.req.raw.headers, body: { code } }),
    );
    if (verified.ok) return confirmed(context, person);
    if (verified.error instanceof APIError && verified.error.statusCode === 401) {
      return failed(context, person);
    }
    return unanswered(context, verified.error.message);
  };

  const confirmWithACode = async (context: Context, person: SignedIn): Promise<Response> => {
    const sent = await parsedBody(context, codeAsked);
    if (!sent.success) return context.json(PERSON_ROUTE_REFUSALS.codeWrong, 400);
    const waiting = await readConfirmWait(IDENTITY_PRINCIPAL, door, {
      ...askedBy(clock, person),
      kind: "authenticator",
    });
    if (!waiting.ok) return refused(context, waiting.error);
    if (waiting.value.waitSeconds > 0) return tooManyTries(waiting.value.waitSeconds);
    const held = await heldBy(deps, person);
    if (held === undefined) return unanswered(context, "the second factor was not read");
    // A setup still waiting on its code would be finished by the verify, and its session swapped.
    if (held.authenticator !== "set-up") return context.json(REFUSALS.noAuthenticator, 409);
    return verifyingTheCode(context, person, sent.data.code);
  };

  /** The act counts its own failures, and refuses a kind still waiting with the ceiling met. */
  const spending =
    (act: SpendsACode, wrong: { readonly error: string }, used?: FactorChange) =>
    async (context: Context, person: SignedIn): Promise<Response> => {
      const sent = await parsedBody(context, typedCode);
      if (!sent.success) return context.json(wrong, 400);
      const tried = await act(IDENTITY_PRINCIPAL, door, {
        ...askedBy(clock, person),
        code: sent.data.code,
      });
      if (!tried.ok) return refused(context, tried.error);
      if (!tried.value.granted) {
        if (tried.value.noticeDue) notify(person, "confirm-failures");
        return context.json({ error: tried.value.refusal }, 400);
      }
      if (used !== undefined) notify(person, used);
      return context.json({ granted: true });
    };

  const refusedToReplace = (context: Context, why: string | Error): Response => {
    if (why === "setup-not-granted") return context.json(REFUSALS.setupNotGranted, 409);
    if (why === "changed-meanwhile") return context.json(REFUSALS.changedMeanwhile, 409);
    return refused(context, why);
  };

  /** The plugin's own making and sealing of a key, kept aside until its first code works. */
  const startTheReplacement = async (context: Context, person: SignedIn): Promise<Response> => {
    const secret = generateRandomString(SECRET_LENGTH);
    const sealed = await attempt(async () =>
      symmetricEncrypt({ key: await secretConfig(), data: secret }),
    );
    if (!sealed.ok) return unanswered(context, sealed.error.message);
    const parked = await parkAuthenticatorSecret(IDENTITY_PRINCIPAL, door, {
      ...askedBy(clock, person),
      encryptedSecret: sealed.value,
    });
    if (!parked.ok) return refusedToReplace(context, parked.error);
    const setupAddress = createOTP(secret, OTP_SETTINGS).url(PRODUCT_NAME, person.user.email);
    return context.json({ setupAddress });
  };

  const replacingWith = async (
    context: Context,
    person: SignedIn,
    code: string,
    sealed: string,
  ) => {
    const works = await attempt(async () => {
      const secret = await symmetricDecrypt({ key: await secretConfig(), data: sealed });
      return createOTP(secret, OTP_SETTINGS).verify(code);
    });
    if (!works.ok) return unanswered(context, works.error.message);
    if (!works.value) return context.json(PERSON_ROUTE_REFUSALS.codeWrong, 400);
    const replaced = await replaceFactorsByAuthenticator(IDENTITY_PRINCIPAL, door, {
      ...askedBy(clock, person),
      encryptedSecret: sealed,
    });
    if (!replaced.ok) return refusedToReplace(context, replaced.error);
    notify(person, "factors-replaced");
    return context.json(finishedWith(replaced.value.issued));
  };

  const finishTheReplacement = async (context: Context, person: SignedIn): Promise<Response> => {
    const sent = await parsedBody(context, codeAsked);
    if (!sent.success) return context.json(PERSON_ROUTE_REFUSALS.codeWrong, 400);
    const held = await heldBy(deps, person);
    if (held === undefined) return unanswered(context, "the second factor was not read");
    if (!mayReplace(held)) return context.json(REFUSALS.setupNotGranted, 409);
    const parked = await readParkedAuthenticatorSecret(
      IDENTITY_PRINCIPAL,
      door,
      askedBy(clock, person),
    );
    if (!parked.ok) return refused(context, parked.error);
    // Granted, but its key is gone: expired, or replaced by a later start.
    if (parked.value === undefined) return context.json(REFUSALS.changedMeanwhile, 409);
    return replacingWith(context, person, sent.data.code, parked.value);
  };

  /** Each counts apart; only the code routes meet the throttle as well. */
  routes.post(
    CONFIRM_PASSKEY_OPTIONS_PATH,
    fenced.asThePerson("confirm-passkey-options", CONFIRM_PERSON_RULE, askToConfirm),
  );
  routes.post(
    CONFIRM_PASSKEY_PATH,
    fenced.asThePerson("confirm-passkey", CONFIRM_PERSON_RULE, confirmWithAPasskey),
  );
  routes.post(
    CONFIRM_AUTHENTICATOR_PATH,
    fenced.asThePerson("confirm-authenticator", CONFIRM_PERSON_RULE, confirmWithACode),
  );
  routes.post(
    RECOVERY_CODE_PATH,
    fenced.asThePerson(
      "recovery-code",
      SPEND_A_CODE_PERSON_RULE,
      spending(spendRecoveryCode, REFUSALS.recoveryCodeWrong, "recovery-code-used"),
    ),
  );
  routes.post(
    RESTORE_CODE_PATH,
    fenced.asThePerson(
      "restore-code",
      SPEND_A_CODE_PERSON_RULE,
      spending(acceptRestoreCode, REFUSALS.restoreCodeWrong),
    ),
  );
  routes.post(
    REPLACE_AUTHENTICATOR_START_PATH,
    fenced.asThePerson(
      "replace-authenticator-start",
      AUTHENTICATOR_PERSON_RULE,
      startTheReplacement,
    ),
  );
  routes.post(
    REPLACE_AUTHENTICATOR_FINISH_PATH,
    fenced.asThePerson(
      "replace-authenticator-finish",
      AUTHENTICATOR_PERSON_RULE,
      finishTheReplacement,
    ),
  );
};
