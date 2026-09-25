import { boundarySchemas } from "@better-answers/schema";

import { act, declareActs, declareIdentitySetActs, recordFor } from "../audit/index.ts";
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

/** Empty detail: an address, an IP or a user agent here would need rewriting on erasure. */
const SIGN_IN_ACTS = declareIdentitySetActs("people", {
  signedIn: act("people.person.signed_in", {}),
});

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
        detail: {},
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

/** As `recordSignIn`, once the library's consent has landed; the client is the row's subject. */
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
