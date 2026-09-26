import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { act, declareIdentitySetActs, record, recordFor } from "../audit/index.ts";
import {
  actorIdOfPerson,
  attempt,
  err,
  ok,
  type OperatorPrincipal,
  type PlatformPrincipal,
  type Result,
  type UserId,
  ulid,
} from "../kernel/index.ts";
import { type PostgresDoor, type Tx, withIdentityWrite } from "../store/postgres/index.ts";
import { admitOperatorWrite } from "./operator.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

/**
 * Each row names the person by id and holds no name, so erasure's one copy to blank is the user
 * row.
 */
const PERSON_ACTS = declareIdentitySetActs("people", {
  named: act("people.person.named", {}),
  renamed: act("people.person.renamed", {}),
});

/** The operator's correction: a name flag raised before it waits no more. */
export const DISPLAY_NAME_CORRECTED = PERSON_ACTS.renamed;

const DISPLAY_NAME_MAX_CHARACTERS = 100;

type DisplayNameRefusal = WorkspaceRefusal<
  | "display-name-empty"
  | "display-name-not-one-line"
  | "display-name-control-character"
  | "display-name-angle-bracket"
  | "display-name-too-long"
>;

/**
 * Trimming leaves U+0085, so it is named here. No `u` flag: the mutation run negates `\v` to
 * `\V`, which `u` refuses at load.
 */
const LINE_BREAK = /[\n\v\f\r\u0085\u2028\u2029]/;

const CONTROL_CHARACTER = /\p{Cc}/u;

/** Git drops both from an author's name, so a commit would credit a name the person never gave. */
const ANGLE_BRACKET = /[<>]/u;

/**
 * Code points, as Postgres counts a length: counting graphemes would let a thousand combining
 * marks pass as one character.
 */
// oxlint-disable-next-line typescript/no-misused-spread -- the spread only counts code points, and nothing split is ever shown
const charactersIn = (name: string): number => [...name].length;

/** Answers the name trimmed, the form to store; every rule reads the trimmed name. */
export const applyDisplayNameRule = (asked: string): Result<string, DisplayNameRefusal> => {
  const name = asked.trim();
  if (name === "") return err("display-name-empty");
  if (LINE_BREAK.test(name)) return err("display-name-not-one-line");
  if (CONTROL_CHARACTER.test(name)) return err("display-name-control-character");
  if (ANGLE_BRACKET.test(name)) return err("display-name-angle-bracket");
  if (charactersIn(name) > DISPLAY_NAME_MAX_CHARACTERS) return err("display-name-too-long");
  return ok(name);
};

/** A name of whitespace alone counts as none. */
export const hasNoDisplayName = (held: string): boolean => held.trim() === "";

export const setDisplayNameInput = z.object({ displayName: z.string() });

type SetDisplayNameInput = {
  readonly personId: string;
  readonly displayName: string;
};

export type SetDisplayNameRefusal =
  | DisplayNameRefusal
  | WorkspaceRefusal<"malformed" | "person-gone">;

type DisplayNameSet = {
  readonly personId: UserId;
  readonly displayName: string;
};

/** False, having changed nothing, where no person holds the id. */
const naming = async (tx: Tx, personId: UserId, name: string): Promise<boolean> => {
  const named = await tx.query('UPDATE "user" SET name = $2, updated_at = now() WHERE id = $1', [
    personId,
    name,
  ]);
  return (named.rowCount ?? 0) > 0;
};

/**
 * The person is the one writer: a caller hands the id of the session's own person, never one a
 * request names.
 */
export const setDisplayName = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: SetDisplayNameInput,
): Promise<Result<DisplayNameSet, SetDisplayNameRefusal | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");
  const displayName = applyDisplayNameRule(input.displayName);
  if (!displayName.ok) return err(displayName.error);

  const written = await attempt(() =>
    withIdentityWrite(platform, door, async (tx): Promise<Result<undefined, "person-gone">> => {
      if (!(await naming(tx, personId.data, displayName.value))) return err("person-gone");
      await recordFor(platform, tx, {
        id: ulid(),
        actor: actorIdOfPerson(personId.data),
        act: PERSON_ACTS.named,
        subjectId: personId.data,
        detail: {},
      });
      return ok(undefined);
    }),
  );
  if (!written.ok) return err(written.error);
  if (!written.value.ok) return err(written.value.error);
  return ok({ personId: personId.data, displayName: displayName.value });
};

export const correctDisplayNameInput = z.object({ personId: z.string(), displayName: z.string() });

type CorrectDisplayNameInput = z.output<typeof correctDisplayNameInput> & {
  /** When the act happens, which the sign-in's age is judged against. */
  readonly at: Date;
};

type CorrectDisplayNameRefusal =
  | DisplayNameRefusal
  | WorkspaceRefusal<"no-such-user" | "sign-in-too-old">;

/**
 * Replaces a person's display name under the rule their own name follows, and records it under
 * the operator even where the name is unchanged, so a flag on a name judged fine still clears. A
 * malformed id answers `no-such-user`.
 */
export const correctDisplayName = async (
  operator: OperatorPrincipal,
  tx: Tx,
  input: CorrectDisplayNameInput,
): Promise<Result<DisplayNameSet, CorrectDisplayNameRefusal | Error>> => {
  const admitted = admitOperatorWrite(operator, input);
  if (!admitted.ok) return err(admitted.error);
  const { personId } = admitted.value;
  const displayName = applyDisplayNameRule(input.displayName);
  if (!displayName.ok) return err(displayName.error);

  const named = await attempt(() => naming(tx, personId, displayName.value));
  if (!named.ok) return err(named.error);
  if (!named.value) return err("no-such-user");

  await record(admitted.value.operator, tx, {
    id: ulid(),
    act: DISPLAY_NAME_CORRECTED,
    subjectId: personId,
    detail: {},
  });
  return ok({ personId, displayName: displayName.value });
};
