import { boundarySchemas } from "@better-answers/schema";

import { act, declareIdentitySetActs, record } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  type Claims,
  type PlatformPrincipal,
  type Result,
  type UserId,
  ulid,
} from "../kernel/index.ts";
import {
  type PostgresDoor,
  type Tx,
  withIdentityWrite,
  withOperator,
} from "../store/postgres/index.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

const OPERATOR_ACTS = declareIdentitySetActs("people", {
  grant: act("people.operator.granted", {}),
  revoke: act("people.operator.revoked", {}),
});

type MarkChange = keyof typeof OPERATOR_ACTS;

type OperatorMarkInput = {
  readonly email: string;
  readonly change: MarkChange;
};

type OperatorMarkSet = {
  readonly personId: UserId;

  /** False where the person already stood as asked, and nothing was written. */
  readonly changed: boolean;
};

type Marked = Result<OperatorMarkSet, WorkspaceRefusal<"no-such-user">>;

const marking = async (
  platform: PlatformPrincipal,
  tx: Tx,
  input: OperatorMarkInput,
): Promise<Marked> => {
  const found = await tx.query<{ id: string; operator: boolean }>(
    'SELECT id, operator FROM "user" WHERE lower(email) = lower($1) FOR UPDATE',
    [input.email],
  );
  const row = found.rows[0];
  if (row === undefined) return err("no-such-user");
  const personId = boundarySchemas.user.select.shape.id.parse(row.id);
  const operator = input.change === "grant";
  if (row.operator === operator) return ok({ personId, changed: false });

  await tx.query('UPDATE "user" SET operator = $2, updated_at = now() WHERE id = $1', [
    personId,
    operator,
  ]);
  await record(platform, tx, {
    id: ulid(),
    act: OPERATOR_ACTS[input.change],
    subjectId: personId,
    detail: {},
  });
  return ok({ personId, changed: true });
};

/**
 * Grants or revokes the operator mark of the person holding `email`, matched case-insensitively,
 * and records the change in the identity-set audit log under the platform's own actor. A person
 * already as asked is left alone, with nothing written.
 */
export const setOperatorMark = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: OperatorMarkInput,
): Promise<Result<OperatorMarkSet, WorkspaceRefusal<"no-such-user"> | Error>> => {
  const marked = await attempt(() =>
    withIdentityWrite(platform, door, (tx) => marking(platform, tx, input)),
  );
  if (!marked.ok) return err(marked.error);
  return marked.value;
};

type OperatorStanding =
  | { readonly operator: false }
  | { readonly operator: true; readonly name: string };

/**
 * Whether a signed-in person stands as the operator, by the rule every console act is resolved
 * on, and their display name where they do. It answers no rather than refusing.
 */
export const standingAsOperator = async (
  door: PostgresDoor,
  claims: Pick<Claims, "userId" | "issuedAt">,
): Promise<Result<OperatorStanding, Error>> => {
  const resolved = await attempt(() =>
    withOperator(door, claims, async (operator, tx) => {
      const found = await tx.query<{ name: string }>('SELECT name FROM "user" WHERE id = $1', [
        operator.userId,
      ]);
      return found.rows[0]?.name;
    }),
  );
  if (!resolved.ok) return err(resolved.error);

  const name = resolved.value.ok ? resolved.value.value : undefined;
  return ok(name === undefined ? { operator: false } : { operator: true, name });
};
