import { boundarySchemas } from "@better-answers/schema";
import { z } from "zod";

import { act, declareActs, declareIdentitySetActs, record } from "../audit/index.ts";
import {
  admit,
  attempt,
  declareAct,
  err,
  ok,
  type AdmittedOf,
  type Result,
  type UserId,
  type UserPrincipal,
  type WorkspaceId,
  ulid,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { MemberRefusal } from "./vocabulary.ts";

/** Neither row holds the name: the person row keeps the one copy, which erasure blanks. */
const FLAGGED_ACTS = declareActs("people", {
  flagged: act("people.person.name_flagged", {}),
});

/** The operator reads what waits from here, since no workspace's audit log is theirs to read. */
const RAISED_ACTS = declareIdentitySetActs("people", {
  raised: act("people.name_flag.raised", { workspaceId: "id" }),
});

/** Written by the operator's correction of a display name; a flag raised before it waits no more. */
const CORRECTED = "people.person.renamed";

export const flagDisplayNameInput = z.object({
  personId: boundarySchemas.user.select.shape.id,
});

export type FlagDisplayNameInput = z.output<typeof flagDisplayNameInput>;

const flagDisplayNameAct = declareAct({
  admits: { role: "Admin", purposes: [] },
  input: flagDisplayNameInput,
  refuses: ["role-forbids", "no-such-member"],
  effect: "write",
});

export type FlagDisplayNameRefusal = MemberRefusal<"role-forbids" | "no-such-member"> | Error;

/** What the operator is told of a flag just raised. */
export type RaisedFlag = {
  readonly workspaceId: WorkspaceId;
  readonly workspaceName: string;
  readonly personId: UserId;
  readonly displayName: string;
};

export type NameFlagged = {
  readonly personId: UserId;

  /** Null where this workspace's flag on the person already waited, and nothing was written. */
  readonly raised: RaisedFlag | null;
};

/** Held until commit, so of two flags at once the second finds the first's row. */
const HELD_FLAGS_OF_THE_PERSON =
  "SELECT pg_advisory_xact_lock(hashtext('name-flag'), hashtext($1))";

const FLAGGED_PERSON = `SELECT u.name AS "displayName", w.name AS "workspaceName"
                          FROM member m
                          JOIN "user" u ON u.id = m.user_id
                          JOIN workspace w ON w.id = m.workspace_id
                         WHERE m.workspace_id = $1 AND m.user_id = $2`;

const A_FLAG_WAITS = `SELECT EXISTS (
    SELECT 1 FROM identity_audit_event raised
     WHERE raised.subject_kind = split_part($3, '.', 2) AND raised.subject_id = $1
       AND raised.act = $3 AND raised.detail ->> 'workspaceId' = $2
       AND raised.at > COALESCE(
         (SELECT max(corrected.at) FROM identity_audit_event corrected
           WHERE corrected.subject_kind = split_part($4, '.', 2) AND corrected.subject_id = $1
             AND corrected.act = $4),
         '-infinity')
  ) AS waits`;

const FLAGGED_ROW = z.object({ displayName: z.string(), workspaceName: z.string() });

const flagging = async (
  admin: AdmittedOf<typeof flagDisplayNameAct>,
  tx: Tx,
  personId: UserId,
): Promise<Result<NameFlagged, MemberRefusal<"no-such-member">>> => {
  const { workspaceId } = admin;
  await tx.query(HELD_FLAGS_OF_THE_PERSON, [personId]);
  const found = (await tx.query(FLAGGED_PERSON, [workspaceId, personId])).rows[0];
  if (found === undefined) return err("no-such-member");
  const person = FLAGGED_ROW.parse(found);

  const waiting = await tx.query<{ waits: boolean }>(A_FLAG_WAITS, [
    personId,
    workspaceId,
    RAISED_ACTS.raised.name,
    CORRECTED,
  ]);
  if (waiting.rows[0]?.waits === true) return ok({ personId, raised: null });

  await record(admin, tx, {
    id: ulid(),
    act: FLAGGED_ACTS.flagged,
    subjectId: personId,
    detail: {},
  });
  await record(admin, tx, {
    id: ulid(),
    act: RAISED_ACTS.raised,
    subjectId: personId,
    detail: { workspaceId },
  });
  return ok({ personId, raised: { workspaceId, personId, ...person } });
};

/**
 * Flags a member's display name to the operator. The caller's answer is the same for every member
 * and whether or not a flag already waits; only the transport learns whether one was raised, to
 * tell the operator once it commits. An Admin has no act that changes the name itself.
 */
export const flagDisplayName = async (
  principal: UserPrincipal,
  tx: Tx,
  input: FlagDisplayNameInput,
): Promise<Result<NameFlagged, FlagDisplayNameRefusal>> => {
  const admitted = admit(flagDisplayNameAct, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const flagged = await attempt(() => flagging(admitted.value, tx, input.personId));
  return flagged.ok ? flagged.value : err(flagged.error);
};
