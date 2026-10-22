import type { PlatformPrincipal } from "../kernel/index.ts";
import { ERASED_DOMAIN, type Needles } from "../store/git/index.ts";
import { withScope, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { SESSION_VERIFICATION_PREFIXES, verificationIdentifiersOf } from "../workspaces/index.ts";
import { NO_ACTORS_SWEPT, sweepTheActors, type ActorsSwept } from "./actors.ts";
import {
  askersOf,
  NO_QUESTIONS_SWEPT,
  sweepTheQuestions,
  type QuestionsSwept,
} from "./questions.ts";

export type IdentityArm = "no-person" | "last-workspace" | "held-elsewhere";

export type IdentitySwept = {
  readonly arm: IdentityArm;

  readonly pseudonymised: number;
  readonly membersEnded: number;
  readonly ownersDeleted: number;
  readonly sessions: number;
  readonly verifications: number;
  readonly accounts: number;
  readonly passkeys: number;
  readonly authenticators: number;
  readonly recoveryCodes: number;

  readonly confirmFailures: number;
  readonly lastActive: number;
  readonly invitationsHere: number;

  readonly invitationsEverywhere: number;

  readonly questionsSince: QuestionsSwept;

  readonly actorsSince: ActorsSwept;
};

const SWEPT_NOTHING = {
  pseudonymised: 0,
  membersEnded: 0,
  ownersDeleted: 0,
  sessions: 0,
  verifications: 0,
  accounts: 0,
  passkeys: 0,
  authenticators: 0,
  recoveryCodes: 0,
  confirmFailures: 0,
  lastActive: 0,
  invitationsHere: 0,
  invitationsEverywhere: 0,
  questionsSince: NO_QUESTIONS_SWEPT,
  actorsSince: NO_ACTORS_SWEPT,
} as const;

export type ErasureSubject = {
  readonly workspaceId: string;

  readonly personId: string | null;

  readonly emails: readonly string[];

  readonly needles: Needles;

  readonly pseudonym: string;
};

const rowsOf = (result: { readonly rowCount: number | null }): number => result.rowCount ?? 0;

type HeldByThePerson =
  | "session"
  | "account"
  | "passkey"
  | "authenticator"
  | "recovery_code"
  | "second_factor_throttle";

const VERIFICATIONS = `
  DELETE FROM verification
   WHERE lower(identifier) = ANY($1)
      OR identifier IN (SELECT prefix || s.id FROM session s, unnest($3::text[]) AS prefix
                         WHERE s.user_id = $2)`;

const sweepTheSet = async (tx: Tx, subject: ErasureSubject, tombstone: string) => {
  const emails = [...subject.emails];
  const verifications = await tx.query(VERIFICATIONS, [
    emails.flatMap(verificationIdentifiersOf),
    subject.personId,
    [...SESSION_VERIFICATION_PREFIXES],
  ]);

  const invitations = await tx.query<{ workspace_id: string }>(
    "DELETE FROM invitation WHERE lower(email) = ANY($1) RETURNING workspace_id",
    [emails],
  );
  const deleted = async (table: HeldByThePerson): Promise<number> =>
    rowsOf(await tx.query(`DELETE FROM ${table} WHERE user_id = $1`, [subject.personId]));
  const sessions = await deleted("session");
  const accounts = await deleted("account");
  const passkeys = await deleted("passkey");
  const authenticators = await deleted("authenticator");
  const recoveryCodes = await deleted("recovery_code");
  const confirmFailures = await deleted("second_factor_throttle");

  const pseudonymised = await tx.query(
    `UPDATE "user"
        SET email = $2, email_verified = false, name = '', image = NULL, operator = false,
            authenticator_enabled = false, passkey_offer_dismissed_at = NULL,
            recovery_codes_acknowledged = false, restore_required_at = NULL, promoted_at = NULL
      WHERE id = $1`,
    [subject.personId, tombstone],
  );
  return {
    verifications: rowsOf(verifications),
    sessions,
    accounts,
    passkeys,
    authenticators,
    recoveryCodes,
    confirmFailures,
    invitationsHere: invitations.rows.filter((row) => row.workspace_id === subject.workspaceId)
      .length,
    invitationsEverywhere: rowsOf(invitations),
    pseudonymised: rowsOf(pseudonymised),
  };
};

const HELD_ELSEWHERE = `SELECT workspace_id FROM member
   WHERE user_id = $1 AND workspace_id <> $2
     FOR KEY SHARE`;

export const eraseFromTheIdentitySet = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  subject: ErasureSubject,
): Promise<IdentitySwept> => {
  const { personId } = subject;
  if (personId === null) return { arm: "no-person", ...SWEPT_NOTHING };

  return withScope(platform, door, subject.workspaceId, async (tx) => {
    const lastActive = rowsOf(
      await tx.query("DELETE FROM workspace_last_active WHERE user_id = $1", [personId]),
    );
    await tx.query("SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE", [
      subject.workspaceId,
      personId,
    ]);
    const ownersTheMemberCascades = rowsOf(
      await tx.query("SELECT 1 FROM concept_owner WHERE workspace_id = $1 AND person_id = $2", [
        subject.workspaceId,
        personId,
      ]),
    );
    const ended = await tx.query("DELETE FROM member WHERE workspace_id = $1 AND user_id = $2", [
      subject.workspaceId,
      personId,
    ]);
    const membersEnded = rowsOf(ended);
    await tx.query(
      `UPDATE access_request SET invitation_id = NULL, reason = ''
        WHERE workspace_id = $1 AND requester_id = $2`,
      [subject.workspaceId, personId],
    );
    const named = { workspaceId: subject.workspaceId, pseudonym: subject.pseudonym };
    const questionsSince = await sweepTheQuestions(tx, { ...named, askers: askersOf([personId]) });
    const actorsSince = await sweepTheActors(tx, { ...named, needles: subject.needles });
    const done = {
      membersEnded,
      ownersDeleted: ownersTheMemberCascades,
      lastActive,
      questionsSince,
      actorsSince,
    };

    const elsewhere = await tx.query(HELD_ELSEWHERE, [personId, subject.workspaceId]);
    if (elsewhere.rows.length > 0) return { arm: "held-elsewhere", ...SWEPT_NOTHING, ...done };
    const swept = await sweepTheSet(tx, subject, `${subject.pseudonym}@${ERASED_DOMAIN}`);
    return { arm: "last-workspace", ...done, ...swept };
  });
};
