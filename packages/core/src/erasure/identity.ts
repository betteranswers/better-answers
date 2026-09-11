import { ERASED_DOMAIN } from "../store/git/index.ts";
import { withIdentityWrite, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { workspacesHeldBy } from "../workspaces/index.ts";
import { normalizeError, type PlatformPrincipal } from "../kernel/index.ts";

/**
 * **The identity set, on the person's last membership** — the erasure routine's step 5 (ADR
 * 0020; ADR 0035; the S0 spec, step 5).
 *
 * Two arms, and which one runs turns on one question: does the requesting workspace hold this
 * person's **only** membership?
 *
 * - **It does.** The person exists on this platform because of this company, so the identity
 *   set goes with them: the user row is pseudonymised — the address to a tombstone nobody can
 *   reach, the name cleared, **the id kept, because every ledger row names it** and a ledger an
 *   erasure rewrote would be a record nobody could rely on — and their sessions, verification
 *   rows, invitations and linked accounts are deleted. The invitations are deleted **wherever
 *   they were sent**, which is the one write of this step that leaves the erasing workspace;
 *   the paragraph below it says why.
 * - **It does not.** Another company's records still name this person, and one controller's
 *   erasure request is not a reason to end their access to another's. This workspace's
 *   membership ends and the identity set waits for the request that ends the last one.
 *
 * Either way **this workspace's membership ends**, which is what the second arm's own sentence
 * says: the set waits for *the request that ends the last one*. A `member` row deleted takes
 * its `group_member` rows with it, which is the cascade `group_tables.ts` already states.
 *
 * **The judgement is the platform principal's and is never shown to a workspace Admin.** It is
 * made here, inside a routine no Admin can call, and what a report says is which arm ran — not
 * how many memberships were counted, and never that another workspace holds one. That is the
 * difference between this and the sole-membership rule ADR 0035 **rejected** for revocation:
 * there, an Admin's own act told them across tenants; here, no outcome reaches one.
 *
 * **Through the Postgres door's identity seam, with no port of its own** (the S0 spec; ADR
 * 0029's amendment). `withIdentityWrite` is a platform-principal, unscoped transaction, which
 * is what these tables need — they carry no `workspace_id` and no policy, so a scoped
 * transaction would see none of them. The precedent is the `workspaces` slice writing `user`
 * and `session` and the `members` slice writing `invitation`, each recorded in
 * `CROSS_OWNER_TABLE_ACCESS`; every table this file touches is recorded there the same way,
 * because the identity set is Better Auth's (ADR 0009) and a write to another module's table
 * is exactly the fact that map exists to hold.
 *
 * **Idempotent, because the second run never reaches the arms at all.** The membership is gone,
 * so the erasure map's identity finders — every one of which is fenced by the membership this
 * workspace holds — name nobody, and the routine hands this step no person.
 */

/** Which arm ran, which is the whole of what the report is told. */
export type IdentityArm =
  /** The request named nobody the identity set holds here: nothing to pseudonymise. */
  | "no-person"
  /** This workspace held the person's only membership: the identity set went with it. */
  | "last-membership"
  /** Other memberships stand: this workspace's ended and the set was left alone. */
  | "membership-ended";

/** What step 5 did, one number per family the erasure map walks. */
export type IdentitySwept = {
  readonly arm: IdentityArm;
  /** 1 where the user row was tombstoned, 0 on either other arm. */
  readonly pseudonymised: number;
  readonly membershipsEnded: number;
  readonly sessions: number;
  readonly verifications: number;
  readonly invitations: number;
  readonly accounts: number;
};

const SWEPT_NOTHING = {
  pseudonymised: 0,
  membershipsEnded: 0,
  sessions: 0,
  verifications: 0,
  invitations: 0,
  accounts: 0,
} as const;

/** The person this step acts on, as the routine already found them. */
export type ErasureSubject = {
  readonly workspaceId: string;
  /**
   * The person id the **erasure map** named, not the request's: a request may name no person
   * and still be about one the identity set holds, because the map resolves the subject by
   * address as well as by id. Acting on what the map found is what keeps the report, the
   * suppressions and this step describing one person.
   */
  readonly personId: string | null;
  /** Every address the identifier set names, lowered — what the map's own finders matched on. */
  readonly emails: readonly string[];
  /** The erasure pseudonym, which the tombstone is built from so one erasure is one string. */
  readonly pseudonym: string;
};

const rowsOf = (result: { readonly rowCount: number | null }): number => result.rowCount ?? 0;

/**
 * The identity rows this person's last membership takes with them, in the order their own
 * predicates require: the two keyed by **address** run before the address is taken away.
 *
 * **This runs on the last-membership arm and on no other** — the arm above returns before
 * reaching it — which is what lets the invitation delete cross the workspace it was asked in.
 */
const sweepTheSet = async (tx: Tx, subject: ErasureSubject, tombstone: string) => {
  const emails = [...subject.emails];
  // Keyed by an identifier and not by a person, which is why it reads the address off the row it
  // is about to change — the map's own `identity-verification` predicate, matched here and for
  // the same reason it gives.
  //
  // **The identifier set is not matched.** This DELETE runs platform-wide, as the platform
  // principal and past row-level security, so an address in the set that belongs to nobody the
  // map found would be a stranger's live codes deleted at one company's word. The set is how an
  // Admin says who the request is about, and the map has already answered that question; what is
  // erased here is what the person it named holds. The invitation delete below does match the
  // set, and the paragraph on it says what makes that different.
  const verifications = await tx.query(
    `DELETE FROM verification
      WHERE lower(identifier) = (SELECT lower(email) FROM "user" WHERE id = $1)`,
    [subject.personId],
  );
  // **Every workspace, because this is the arm on which the person leaves the platform.** An
  // invitation is the one row of the identity set keyed by the address rather than by the
  // person, so one left standing in another company's workspace is a live copy of the address
  // the report has just told the subject was rewritten — and it is a copy that can be opened,
  // which would put the address back into a user row. There is no membership anywhere to weigh
  // against that here: the arm was chosen because this workspace held the last one, the write
  // is made as the platform principal rather than at an Admin's word, and on the other arm —
  // where the person stays somebody else's member and their address is still theirs to be
  // invited by — nothing in this function runs at all.
  //
  // The **map's** invitation finder stays fenced to this workspace, and deliberately: the map
  // is what an access answer is written from, and a document handed to one company is not
  // where another's records are listed (ADR 0035's rejected oracle). So the count found here
  // and the count deleted can differ on this arm, which is the difference between what this
  // workspace may be told and what the platform owes the person.
  const invitations = await tx.query(
    `DELETE FROM invitation
      WHERE lower(email) = ANY($2)
         OR lower(email) = (SELECT lower(email) FROM "user" WHERE id = $1)`,
    [subject.personId, emails],
  );
  const sessions = await tx.query("DELETE FROM session WHERE user_id = $1", [subject.personId]);
  const accounts = await tx.query("DELETE FROM account WHERE user_id = $1", [subject.personId]);
  // The id stands and everything a person is recognised by goes. The address is the pseudonym's
  // own, so it is unique by construction — `user.email` is unique, and a constant tombstone
  // would refuse the second erasure this platform ever ran — and stable, so a second run writes
  // the value that is already there rather than a new one.
  const pseudonymised = await tx.query(
    `UPDATE "user"
        SET email = $2, email_verified = false, name = '', image = NULL
      WHERE id = $1`,
    [subject.personId, tombstone],
  );
  return {
    verifications: rowsOf(verifications),
    invitations: rowsOf(invitations),
    sessions: rowsOf(sessions),
    accounts: rowsOf(accounts),
    pseudonymised: rowsOf(pseudonymised),
  };
};

/**
 * Run step 5 for one subject. The read that decides the arm is `workspacesHeldBy` through the
 * `workspaces` face — the slice that owns that question (ADR 0029 rule 4) — rather than a
 * second copy of its statement here, so there is one place that knows how to ask which
 * workspaces a person holds and one entry on the ownership map for it.
 */
export const eraseFromTheIdentitySet = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  subject: ErasureSubject,
): Promise<IdentitySwept> => {
  const { personId } = subject;
  if (personId === null) return { arm: "no-person", ...SWEPT_NOTHING };

  const held = await workspacesHeldBy(platform, door, personId);
  // A person the map found by their user row and whose memberships cannot be read is a store
  // failure, not an arm: the routine's own `attempt` turns it into the refusal a caller hears.
  // Through the kernel's `normalizeError`, which is the one way a thrown value becomes an Error
  // here as everywhere (`CODING_RULES.md` § TYPES).
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
