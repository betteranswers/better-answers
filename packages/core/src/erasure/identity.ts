import { ERASED_DOMAIN } from "../store/git/index.ts";
import { withIdentityWrite, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { workspacesHeldBy } from "../workspaces/index.ts";
import { normalizeError, type PlatformPrincipal } from "../kernel/index.ts";

export type IdentityArm = "no-person" | "last-membership" | "membership-ended";

export type IdentitySwept = {
  readonly arm: IdentityArm;

  readonly pseudonymised: number;
  readonly membershipsEnded: number;
  readonly sessions: number;
  readonly verifications: number;
  readonly accounts: number;
  readonly invitationsHere: number;

  // The delete reaches every workspace, so this count varies with records the erasing one may
  // not read: it is the operator's, and never the report's.
  readonly invitationsEverywhere: number;
};

const SWEPT_NOTHING = {
  pseudonymised: 0,
  membershipsEnded: 0,
  sessions: 0,
  verifications: 0,
  accounts: 0,
  invitationsHere: 0,
  invitationsEverywhere: 0,
} as const;

export type ErasureSubject = {
  readonly workspaceId: string;

  readonly personId: string | null;

  // The subject's own resolved addresses, never the identifiers an Admin typed: the deletes
  // keyed by these reach past every fence.
  readonly emails: readonly string[];

  readonly pseudonym: string;
};

const rowsOf = (result: { readonly rowCount: number | null }): number => result.rowCount ?? 0;

const sweepTheSet = async (tx: Tx, subject: ErasureSubject, tombstone: string) => {
  const emails = [...subject.emails];
  const verifications = await tx.query(
    "DELETE FROM verification WHERE lower(identifier) = ANY($1)",
    [emails],
  );

  const invitations = await tx.query<{ workspace_id: string }>(
    "DELETE FROM invitation WHERE lower(email) = ANY($1) RETURNING workspace_id",
    [emails],
  );
  const sessions = await tx.query("DELETE FROM session WHERE user_id = $1", [subject.personId]);
  const accounts = await tx.query("DELETE FROM account WHERE user_id = $1", [subject.personId]);

  const pseudonymised = await tx.query(
    `UPDATE "user"
        SET email = $2, email_verified = false, name = '', image = NULL
      WHERE id = $1`,
    [subject.personId, tombstone],
  );
  return {
    verifications: rowsOf(verifications),
    sessions: rowsOf(sessions),
    accounts: rowsOf(accounts),
    invitationsHere: invitations.rows.filter((row) => row.workspace_id === subject.workspaceId)
      .length,
    invitationsEverywhere: rowsOf(invitations),
    pseudonymised: rowsOf(pseudonymised),
  };
};

export const eraseFromTheIdentitySet = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  subject: ErasureSubject,
): Promise<IdentitySwept> => {
  const { personId } = subject;
  if (personId === null) return { arm: "no-person", ...SWEPT_NOTHING };

  const held = await workspacesHeldBy(platform, door, personId);

  if (!held.ok) throw normalizeError(held.error);
  const elsewhere = held.value.filter((workspaceId) => workspaceId !== subject.workspaceId);
  const arm: IdentityArm = elsewhere.length === 0 ? "last-membership" : "membership-ended";

  return withIdentityWrite(platform, door, async (tx) => {
    const ended = await tx.query("DELETE FROM member WHERE workspace_id = $1 AND user_id = $2", [
      subject.workspaceId,
      personId,
    ]);
    const membershipsEnded = rowsOf(ended);
    if (arm === "membership-ended") return { arm, ...SWEPT_NOTHING, membershipsEnded };
    const swept = await sweepTheSet(tx, subject, `${subject.pseudonym}@${ERASED_DOMAIN}`);
    return { arm, membershipsEnded, ...swept };
  });
};
