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
  type OperatorPrincipal,
  type Result,
  type UserId,
  type UserPrincipal,
  type WorkspaceId,
  ulid,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { DISPLAY_NAME_CORRECTED } from "../workspaces/index.ts";
import type { MemberRefusal } from "./vocabulary.ts";

/** Neither row holds the name: the person row keeps the one copy, which erasure blanks. */
const FLAGGED_ACTS = declareActs("people", {
  flagged: act("people.person.name_flagged", {}),
});

/** The operator reads what waits from here, since no workspace's audit log is theirs to read. */
const RAISED_ACTS = declareIdentitySetActs("people", {
  raised: act("people.name_flag.raised", { workspaceId: "id" }),
});

/**
 * Over the rows aliased `raised`. It takes `$1` and `$2` from `WAITING_ACTS`, so a query using it
 * numbers its own parameters from `$3`.
 */
const STILL_WAITING = `raised.subject_kind = split_part($1, '.', 2) AND raised.act = $1
    AND raised.at > COALESCE(
      (SELECT max(corrected.at) FROM identity_audit_event corrected
        WHERE corrected.subject_kind = split_part($2, '.', 2) AND corrected.act = $2
          AND corrected.subject_id = raised.subject_id),
      '-infinity')`;

const WAITING_ACTS = [RAISED_ACTS.raised.name, DISPLAY_NAME_CORRECTED.name] as const;

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
     WHERE ${STILL_WAITING}
       AND raised.subject_id = $3 AND raised.detail ->> 'workspaceId' = $4
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
    ...WAITING_ACTS,
    personId,
    workspaceId,
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

type FlagWaiting = {
  readonly workspace: { readonly id: WorkspaceId; readonly name: string };
  readonly raisedAt: string;
};

type NameWaiting = {
  readonly personId: UserId;
  readonly displayName: string;

  /** A workspace's second flag is never raised while its first waits, so each appears once. */
  readonly flags: readonly FlagWaiting[];
};

const FLAGS_WAITING = `SELECT raised.subject_id AS "personId", u.name AS "displayName",
         w.id AS "workspaceId", w.name AS "workspaceName", raised.at AS "raisedAt"
    FROM identity_audit_event raised
    JOIN "user" u ON u.id = raised.subject_id
    JOIN workspace w ON w.id = raised.detail ->> 'workspaceId'
   WHERE ${STILL_WAITING}
   ORDER BY raised.at, raised.id`;

const WAITING_ROW = z.object({
  personId: boundarySchemas.user.select.shape.id,
  displayName: boundarySchemas.user.select.shape.name,
  workspaceId: boundarySchemas.workspace.select.shape.id,
  workspaceName: boundarySchemas.workspace.select.shape.name,
  raisedAt: boundarySchemas.identityAuditEvent.select.shape.at,
});

/** The rows come oldest first, so a Map keeps each person where their oldest flag put them. */
const byPerson = (rows: readonly z.output<typeof WAITING_ROW>[]): readonly NameWaiting[] => {
  const people = new Map<UserId, NameWaiting>();
  for (const row of rows) {
    const flag = {
      workspace: { id: row.workspaceId, name: row.workspaceName },
      raisedAt: row.raisedAt.toISOString(),
    };
    const held = people.get(row.personId);
    people.set(
      row.personId,
      held === undefined
        ? { personId: row.personId, displayName: row.displayName, flags: [flag] }
        : { ...held, flags: [...held.flags, flag] },
    );
  }
  return [...people.values()];
};

/**
 * Every person flagged since the operator last corrected their display name, the longest waiting
 * first, each with the workspaces that flagged them and when. A person's own renaming leaves a
 * flag waiting.
 */
export const listNamesWaiting = (
  _operator: OperatorPrincipal,
  tx: Tx,
): Promise<Result<readonly NameWaiting[], Error>> =>
  attempt(async () => {
    const found = await tx.query(FLAGS_WAITING, [...WAITING_ACTS]);
    return byPerson(found.rows.map((row) => WAITING_ROW.parse(row)));
  });
