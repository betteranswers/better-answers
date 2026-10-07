import { boundarySchemas } from "@better-answers/schema";

import {
  act,
  declareActs,
  declareIdentitySetActs,
  recordFor,
  type SignInMethod,
} from "../audit/index.ts";
import {
  actorIdOfPerson,
  attempt,
  err,
  ok,
  type PlatformPrincipal,
  type Result,
  ulid,
} from "../kernel/index.ts";
import { type PostgresDoor, withIdentityWrite, withScope } from "../store/postgres/index.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

/** The method word alone: an address, an IP or a user agent here would need rewriting on erasure. */
export const SIGN_IN_ACTS = declareIdentitySetActs("people", {
  signedIn: act("people.person.signed_in", { method: "signInMethod" }),
});

/** Better Auth keys a sign-in code's verification row by this and the lowercased address. */
export const SIGN_IN_CODE_PREFIX = "sign-in-otp-";

/** The row a sign-in link keeps beside its code, keyed the same way. */
export const SIGN_IN_LINK_PREFIX = "sign-in-link-";

/** The operator's restore code, keyed the same way: its hash, never the code, lives in the row. */
export const OPERATOR_RESTORE_PREFIX = "operator-restore-";

/** No prefix starts another, so no address names a stranger's row. Verify and reset rows exist too. */
export const VERIFICATION_PREFIXES = [
  SIGN_IN_CODE_PREFIX,
  SIGN_IN_LINK_PREFIX,
  OPERATOR_RESTORE_PREFIX,
  "email-verification-otp-",
  "forget-password-otp-",
] as const;

export const verificationIdentifiersOf = (email: string): readonly string[] =>
  VERIFICATION_PREFIXES.map((prefix) => `${prefix}${email.toLowerCase()}`);

/** A replacement setup's sealed secret, parked under the session that started it. */
export const AUTHENTICATOR_SECRET_PREFIX = "second-factor-enrol:";

/** A passkey confirm's challenge, kept under the session it was asked for. */
export const PASSKEY_CHALLENGE_PREFIX = "second-factor-challenge:";

/** Rows keyed by a session id rather than an address: erasure reaches them through the person's sessions. */
export const SESSION_VERIFICATION_PREFIXES = [
  AUTHENTICATOR_SECRET_PREFIX,
  PASSKEY_CHALLENGE_PREFIX,
] as const;

const CONSENT_ACTS = declareActs("people", {
  consented: act("people.client.consented", {}),
});

type RecordRefusal = WorkspaceRefusal<"malformed">;

/**
 * Called once the library's sign-in has landed, so the row is written in a transaction of its
 * own: a failure here leaves the person signed in.
 */
export const recordSignIn = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  personId: string,
  method: SignInMethod,
): Promise<Result<undefined, RecordRefusal | Error>> => {
  const person = boundarySchemas.user.select.shape.id.safeParse(personId);
  if (!person.success) return err("malformed");

  const written = await attempt(() =>
    withIdentityWrite(platform, door, (tx) =>
      recordFor(platform, tx, {
        id: ulid(),
        actor: actorIdOfPerson(person.data),
        act: SIGN_IN_ACTS.signedIn,
        subjectId: person.data,
        detail: { method },
      }),
    ),
  );
  return written.ok ? ok(undefined) : err(written.error);
};

type RecordConsentInput = {
  readonly personId: string;
  /** The workspace the consent names, which its tokens are scoped to. */
  readonly workspaceId: string;
  readonly clientId: string;
};

/** As `recordSignIn`, once the library's consent has landed; the assistant is the row's subject. */
export const recordConsent = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: RecordConsentInput,
): Promise<Result<undefined, RecordRefusal | Error>> => {
  const person = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!person.success || !workspace.success) return err("malformed");

  const written = await attempt(() =>
    withScope(platform, door, workspace.data, (tx) =>
      recordFor(platform, tx, {
        id: ulid(),
        actor: actorIdOfPerson(person.data),
        act: CONSENT_ACTS.consented,
        subjectId: input.clientId,
        detail: {},
      }),
    ),
  );
  return written.ok ? ok(undefined) : err(written.error);
};
