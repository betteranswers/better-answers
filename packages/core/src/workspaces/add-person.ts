import { boundarySchemas } from "@better-answers/schema";

import { act, declareIdentitySetActs, record } from "../audit/index.ts";
import {
  attempt,
  emailAddressOf,
  err,
  ok,
  type PlatformPrincipal,
  refusalFor,
  type Result,
  type UserId,
  ulid,
} from "../kernel/index.ts";
import { type PostgresDoor, type Tx, withIdentityWrite } from "../store/postgres/index.ts";
import { applyDisplayNameRule, type DisplayNameRefusal } from "./display-name.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

/** The detail holds no name: its one copy is the `user` row, where erasure blanks it. */
const PERSON_ADDED = declareIdentitySetActs("people", {
  added: act("people.person.added", {}),
}).added;

type AddPersonInput = {
  readonly email: string;
  readonly name: string;
};

type PersonAdded = {
  readonly personId: UserId;
  readonly email: string;
  readonly displayName: string;
};

export type AddPersonRefusal = DisplayNameRefusal | WorkspaceRefusal<"malformed" | "person-exists">;

/** A first sign-in by the same address can land between the read and the insert. */
const ADD_PERSON_CONSTRAINTS = {
  user_email_unique: "person-exists",
} as const satisfies Record<string, AddPersonRefusal>;

/**
 * The platform writes the row itself: Better Auth's create hook blanks every name, which a person
 * named before their first sign-in must keep.
 */
const adding = async (
  platform: PlatformPrincipal,
  tx: Tx,
  person: PersonAdded,
): Promise<Result<PersonAdded, WorkspaceRefusal<"person-exists">>> => {
  const held = await tx.query('SELECT 1 FROM "user" WHERE lower(email) = $1', [person.email]);
  if ((held.rowCount ?? 0) > 0) return err("person-exists");

  await tx.query(
    'INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, $2, $3, false)',
    [person.personId, person.displayName, person.email],
  );
  await record(platform, tx, {
    id: ulid(),
    act: PERSON_ADDED,
    subjectId: person.personId,
    detail: {},
  });
  return ok(person);
};

/**
 * Writes a person the platform names before they have ever signed in, and records it in the
 * identity-set audit log under the platform's own actor. The address stays unverified until their
 * first email-code sign-in, which finds this person and marks it verified.
 */
export const addPerson = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: AddPersonInput,
): Promise<Result<PersonAdded, AddPersonRefusal | Error>> => {
  const email = emailAddressOf(input.email);
  if (email === undefined) return err("malformed");
  const displayName = applyDisplayNameRule(input.name);
  if (!displayName.ok) return err(displayName.error);

  const personId = boundarySchemas.user.select.shape.id.parse(ulid());
  const added = await attempt(() =>
    withIdentityWrite(platform, door, (tx) =>
      adding(platform, tx, { personId, email, displayName: displayName.value }),
    ),
  );
  if (!added.ok) return err(refusalFor(added.error, ADD_PERSON_CONSTRAINTS));
  return added.value;
};
